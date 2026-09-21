//! `journal_write` 의 `tags` — 정규화와 **사전 대조 힌트** ({#tag-normalize}).
//!
//! `tools/mod.rs` 에서 갈라 나온 이유는 `related.rs` 와 같다. 그 파일은 크기
//! 래칫 위라 한 줄도 못 늘리고, 여기 있는 것은 "이 일지를 무슨 말로 부르는가"
//! 라는 하나의 계약이다.
//!
//! # 고치는 것과 알려만 주는 것
//!
//! **정규화는 적용한다.** `Bug Fix` 와 `bug_fix` 와 `bug-fix` 는 같은 말이고,
//! 그 셋이 갈라져 있을 이유는 없다.
//!
//! **유사 태그는 치환하지 않는다.** `bugs` 를 말없이 `bug` 로 바꾸면 에이전트는
//! 자기 일지에 무엇이 적혔는지 모른 채 다음 호출에서 또 `bugs` 를 쓴다. 고쳐야
//! 할 것은 이번 한 건이 아니라 **에이전트의 어휘**라, 응답 `tag_hints` 로
//! 돌려주고 다음 호출에 반영하게 한다. 같은 이유로 `auto_related` 도 무엇이
//! 붙었는지 반드시 드러낸다 (`related.rs`).
//!
//! # 사전은 어디서 오는가
//!
//! MCP 서버는 앱 밖의 프로세스다. 그래서 `journal_search` 와 **같은 두 길**을
//! 쓴다 — 앱 캐시를 읽기 전용으로 열어 보고(`journal_search::cache`), 못 열면
//! 디스크의 최근 일지만 열어 frontmatter `tags` 를 센다. 어느 쪽이든 실패는
//! 무해하다: 사전이 비면 힌트가 0건일 뿐 일지는 그대로 써진다.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::journal_search::cache::{self, CacheHandle};
use crate::oculpm::spec::SOURCE_MARKER_TAGS;
use crate::oculpm::tags::{build_dictionary, normalize_tag, suggest_similar, TagHint};

/// 디스크 폴백이 열어 보는 일지 수의 상한. 최신순이라 잘리는 쪽은 언제나 가장
/// 오래된 일지다 — 어휘는 최근 것이 대표한다.
const MAX_SCAN: usize = 300;

/// `tags` 인자 → (일지에 적을 태그, 응답에 실을 힌트).
pub(super) fn normalize_and_hint(root: &Path, args: &Value) -> (Vec<String>, Vec<Value>) {
    let handle = cache::open_for_root(root);
    normalize_and_hint_with(root, args, handle.as_ref())
}

/// 캐시 핸들을 밖에서 주입할 수 있는 판 — `search.rs` 와 같은 이유로
/// 테스트가 **두 길 모두**를 물 수 있게 한다.
pub(crate) fn normalize_and_hint_with(
    root: &Path,
    args: &Value,
    cache: Option<&CacheHandle>,
) -> (Vec<String>, Vec<Value>) {
    let raw: Vec<String> = args
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    // 정규화 + 중복 제거(순서 보존). 빈 값은 버린다 — `"!!!"` 같은 태그는
    // 정규화하면 아무것도 남지 않는다.
    let mut tags: Vec<String> = Vec::with_capacity(raw.len() + 1);
    let mut pairs: Vec<(String, String)> = Vec::with_capacity(raw.len());
    for given in &raw {
        let norm = normalize_tag(given);
        if norm.is_empty() || tags.iter().any(|t| t == &norm) {
            continue;
        }
        pairs.push((given.clone(), norm.clone()));
        tags.push(norm);
    }
    for marker in SOURCE_MARKER_TAGS {
        if !tags.iter().any(|t| t == marker) {
            tags.push((*marker).to_string()); // 출처 표식 — 파일 자기신고와 구분
        }
    }

    // 줄 것이 없으면 사전도 짓지 않는다 (자동 기록에서 흔한 길이다).
    if pairs.is_empty() {
        return (tags, Vec::new());
    }

    let dictionary = build_dictionary(&collect_counts(root, cache));
    let hints = pairs
        .iter()
        .filter_map(|(given, norm)| {
            let (suggest, reason) = suggest_similar(norm, &dictionary)?;
            let hint = TagHint {
                given: given.clone(),
                suggest,
                reason: reason.to_string(),
            };
            // 직렬화가 실패할 수 없는 모양이지만, 실패했다고 일지를 막지는
            // 않는다 — 힌트는 부록이다.
            serde_json::to_value(hint).ok()
        })
        .collect();
    (tags, hints)
}

/// 이 프로젝트의 태그 빈도. 캐시가 열리면 SQL 한 방, 아니면 디스크 폴백.
fn collect_counts(root: &Path, cache: Option<&CacheHandle>) -> HashMap<String, u32> {
    if let Some(handle) = cache {
        if let Some(counts) = counts_from_cache(handle) {
            return counts;
        }
    }
    counts_from_disk(root)
}

fn counts_from_cache(handle: &CacheHandle) -> Option<HashMap<String, u32>> {
    let mut stmt = handle
        .conn
        .prepare(
            "SELECT tag, COUNT(*) FROM oculpm_journal_tags \
             WHERE project_id = ?1 GROUP BY tag",
        )
        .ok()?;
    let rows = stmt
        .query_map([handle.project_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .ok()?;
    Some(
        rows.flatten()
            .map(|(tag, n)| (tag, n.max(0) as u32))
            .collect(),
    )
}

/// 최근 [`MAX_SCAN`] 건의 frontmatter `tags` 만 센다. 본문은 읽지 않는다 —
/// `parse_frontmatter_and_body` 가 이미 읽은 문자열을 가르기만 한다.
///
/// 최신순 정렬은 경로 문자열 역순이다 (`YYYYMMDD/Folder/HHMM_…`) — 파일을 열지
/// 않고 정해지고, 체크아웃마다 바뀌는 mtime 과 달리 결정적이다
/// (`related.rs` · `journal_search` 와 같은 근거).
fn counts_from_disk(root: &Path) -> HashMap<String, u32> {
    let journal_root = root.join(".oculpm").join("journal");
    let mut rels: Vec<String> = crate::oculpm::cache::walk_journal(&journal_root)
        .into_iter()
        .map(|(rel, _mtime)| rel)
        .collect();
    rels.sort_unstable_by(|a, b| b.cmp(a));

    let mut counts: HashMap<String, u32> = HashMap::new();
    for rel in rels.iter().take(MAX_SCAN) {
        let Ok(raw) = std::fs::read_to_string(journal_root.join(rel)) else {
            continue;
        };
        let Some(fm) = parse_frontmatter_and_body(&raw).0.parsed else {
            continue;
        };
        for tag in fm.tags {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    counts
}
