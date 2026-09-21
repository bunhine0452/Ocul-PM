//! 태그 **병합** — 디스크 frontmatter 재작성 ({#tag-merge}).
//!
//! `add_journal_related` 와 같은 모양이다: 파일마다 같은 문지기
//! (`entry_write_guard`)를 읽기 **앞**에서 잡고, `tags` 한 줄만 바꾸고, 통째로
//! 다시 쓰고, 워처와 같은 길로 캐시에 재투영한다. **본문은 읽은 바이트 그대로**
//! 되돌려 쓰므로 서술은 한 글자도 안 변한다.
//!
//! # 왜 한 건이 막혀도 계속 가는가
//!
//! 806종을 정리하려면 한 번에 수십 개 파일을 고쳐야 한다. 한 건이 잠겨 있다고
//! 전부 되돌리면 사용자는 **아무것도** 못 고치고, 무엇이 막았는지도 모른다.
//! 그래서 건너뛰고 [`TagMergeSkip`] 으로 이름을 댄다 — 다시 누르면 남은 것만
//! 고쳐진다 (병합은 멱등이다: 이미 `into` 인 일지는 바뀔 것이 없어 건너뛴다).
//!
//! # 후보는 캐시가 고르고, 진실은 디스크가 쓴다
//!
//! "이 태그를 가진 일지"는 캐시(`oculpm_journal_tags`)에 묻는다 — 화면이 보여
//! 준 통계와 **같은 표**라, 「23건」이라 적힌 버튼이 23건을 고친다. 고르고 난
//! 뒤의 읽기·쓰기는 전부 디스크 원본이다. 캐시가 뒤처졌으면 그 일지는 이번에
//! 안 잡히고, 워처가 따라잡은 뒤 다시 누르면 잡힌다.

use std::collections::HashSet;

use crate::db::Db;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::{JournalCache, PathChangeKind};
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{parse_frontmatter_and_body, write_frontmatter_and_body};
use crate::oculpm::tags::{is_source_marker, normalize_tag, TagMergeReport, TagMergeSkip};

use super::journal::{entry_write_guard, resolve_entry_path};
use super::OculpmManager;

impl OculpmManager {
    /// `from` 의 태그들을 `into` 하나로 모은다.
    ///
    /// 거절하는 셋: 빈 `into` · 출처 표식(`mcp-tool`)이 낀 경우 · 고칠 것이
    /// 하나도 없는 `from`. 앞의 둘은 기록의 뜻을 망가뜨리고, 마지막은 화면이
    /// "했다"고 말하는데 파일은 그대로인 경우라 조용히 넘기면 안 된다.
    pub async fn merge_journal_tags(
        &self,
        db: &Db,
        project_id: u32,
        from: Vec<String>,
        into: String,
    ) -> Result<TagMergeReport, OculpmError> {
        let target = normalize_tag(&into);
        if target.is_empty() || is_source_marker(&target) {
            return Err(OculpmError::InvalidConfig(format!(
                "merge target is not a usable tag: {into:?}"
            )));
        }
        let sources: HashSet<String> = from
            .iter()
            .map(|t| normalize_tag(t))
            .filter(|t| !t.is_empty() && !is_source_marker(t) && t != &target)
            .collect();
        if sources.is_empty() {
            return Err(OculpmError::InvalidConfig(
                "nothing to merge: every source tag is empty, a source marker, or the target"
                    .to_string(),
            ));
        }

        // 후보 고르기 — 캐시의 태그 원문을 정규화해 맞춘다 (SQL 로 못 접는다).
        let cache = JournalCache::new(db);
        let mut paths: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for (tag, rel, _workday) in cache.tag_rows(project_id).await? {
            if sources.contains(&normalize_tag(&tag)) && seen.insert(rel.clone()) {
                paths.push(rel);
            }
        }
        paths.sort(); // 결정적 순서 — 건너뛴 목록이 매번 같은 차례로 나온다.

        let journal_root = self.journal_root(project_id).await?;
        let redact = self.redact_patterns(project_id).await;
        let tz = self.tz_for(project_id).await;

        let mut report = TagMergeReport {
            rewritten: 0,
            skipped: Vec::new(),
        };
        for rel in paths {
            match rewrite_one(&journal_root, &rel, &sources, &target) {
                Ok(true) => {
                    report.rewritten += 1;
                    // 화면이 워처 왕복을 기다리지 않게 그 자리에서 재투영한다
                    // (`add_journal_related` 와 같은 계약). 실패해도 디스크는
                    // 이미 맞으므로 워처가 곧 따라잡는다.
                    let projector = JournalCache::with_redaction(db, redact.clone()).with_tz(tz);
                    let _ = projector
                        .apply_path_change(
                            project_id,
                            &journal_root,
                            &rel,
                            PathChangeKind::Modified,
                        )
                        .await;
                }
                Ok(false) => report.skipped.push(TagMergeSkip {
                    path: rel,
                    reason: "unchanged".to_string(),
                }),
                Err(reason) => report.skipped.push(TagMergeSkip { path: rel, reason }),
            }
        }
        Ok(report)
    }
}

/// 일지 한 건의 `tags` 를 다시 쓴다. `Ok(false)` = 바꿀 것이 없었다.
///
/// 사유 문자열은 **기계가 읽는 토큰**이다 — 문장은 화면이 만든다 (백엔드가
/// 한국어를 만들면 영어 모드에서 그대로 새어 나온다).
fn rewrite_one(
    journal_root: &std::path::Path,
    rel: &str,
    sources: &HashSet<String>,
    target: &str,
) -> Result<bool, String> {
    let abs = resolve_entry_path(journal_root, rel).map_err(|_| "invalid-path".to_string())?;
    let _guard = entry_write_guard(&abs).map_err(|_| "locked".to_string())?;
    let text = std::fs::read_to_string(&abs).map_err(|_| "unreadable".to_string())?;
    let (mut parsed, body) = parse_frontmatter_and_body(&text);
    let Some(mut fm) = parsed.parsed.take() else {
        return Err("broken-frontmatter".to_string());
    };

    // 원본 순서를 지키며 치환하고, 그 뒤 중복만 접는다. 건드리지 않는 태그는
    // 정규화도 하지 않는다 — 이 도구가 고치기로 한 것은 `from` 뿐이다.
    let mut next: Vec<String> = Vec::with_capacity(fm.tags.len());
    for tag in &fm.tags {
        let mapped = if sources.contains(&normalize_tag(tag)) {
            target.to_string()
        } else {
            tag.clone()
        };
        if !next.iter().any(|t| t == &mapped) {
            next.push(mapped);
        }
    }
    if next == fm.tags {
        return Ok(false);
    }

    fm.tags = next;
    let new_text = write_frontmatter_and_body(&fm, &body);
    write_atomic(&abs, new_text.as_bytes()).map_err(|_| "write-failed".to_string())?;
    Ok(true)
}
