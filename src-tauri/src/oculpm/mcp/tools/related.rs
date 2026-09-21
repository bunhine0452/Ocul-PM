//! `journal_write` 의 `related` — 인자 파싱과 **자동 연결** ({#related-auto}).
//!
//! `tools/mod.rs` 에서 갈라 나온 이유는 둘이다. 그 파일은 1197줄이라 래칫이
//! 성장을 막고 있고, 여기 있는 것은 "이 일지를 무엇에 잇는가"라는 하나의
//! 계약이다.
//!
//! ## 자동 연결은 왜 있는가
//!
//! AGENTS.md §0 은 "과거를 먼저 찾고, 이어지면 `related` 에 넣으라"고 한다.
//! 실측(이 저장소, 2026-09-21)은 일지 727건 중 `related` 가 채워진 것이 243건.
//! 규칙을 읽은 에이전트도 절반 넘게 빼먹는다. 그런데 **버그·에러**만큼은
//! "같은 파일을 고쳤던 지난 버그 일지"가 거의 언제나 읽을 가치가 있다 —
//! 이 저장소에서 bug 일지가 5건 넘게 붙은 파일이 31개다.
//!
//! 그래서 규칙이 좁다: `related` 를 **아무것도 안 준** bug/error 일지에
//! 한해, `files_touched` 의 **허브 아닌** 파일을 만진 가장 최근 bug/error
//! 일지 1건을 `followup` 으로 잇는다. 그리고 응답 `auto_related` 로 **반드시
//! 드러낸다** — 에이전트가 자기 일지에 뭐가 붙었는지 모르면 그건 자동이 아니라
//! 몰래 하는 일이다.
//!
//! ## DB 가 아니라 디스크다
//!
//! MCP 서버는 앱 밖의 프로세스라 앱 DB(`~/Library/…/ocul-pm.db`)를 못 연다 —
//! 이 모듈 전체가 `tools/mod.rs` 의 설계("도구는 `.oculpm/` 마크다운만 읽고
//! 쓴다")를 그대로 따른다. 그래서 IDF corpus 통계 대신 **정적 허브 표**
//! ([`crate::oculpm::related::is_hub_file`])만 쓰고, 파일명 토큰으로 bug/error
//! 만 열어 읽는 walk 폴백이다. 읽는 파일 수에는 상한을 둔다.

use std::path::Path;

use serde_json::{json, Value};

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::related::is_hub_file;
use crate::oculpm::spec::{EntryType, FileTouched, RelatedRef};

/// 자동 연결이 파일을 열어 볼 수 있는 최대 개수. 겹치는 일지가 없는 저장소에서
/// walk 이 무한정 커지지 않게 하는 안전핀 — 최신순이므로 잘리는 쪽은 언제나
/// 가장 오래된 일지다.
const MAX_SCAN: usize = 300;

/// `related` 인자 → [`RelatedRef`]. 존재하지 않는 참조는 **거부하지 않고**
/// 경고로 돌려준다 (오타 하나로 일지 전체가 막히면 도구를 안 쓴다).
pub(super) fn parse_related_arg(
    root: &Path,
    args: &Value,
    warnings: &mut Vec<String>,
) -> Vec<RelatedRef> {
    args.get("related")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let raw = r.get("ref")?.as_str()?.trim();
                    let ref_path = crate::oculpm::related::normalize_journal_ref(raw);
                    if ref_path.is_empty() {
                        return None;
                    }
                    let kind = match r.get("kind").and_then(Value::as_str).unwrap_or("followup") {
                        k @ ("blocks" | "blocked_by" | "followup" | "duplicate") => k.to_string(),
                        other => {
                            warnings.push(format!(
                                "related.kind {other:?} 는 blocks|blocked_by|followup|duplicate 중 하나여야 한다 — followup 으로 기록"
                            ));
                            "followup".to_string()
                        }
                    };
                    if !root.join(".oculpm").join("journal").join(&ref_path).is_file() {
                        warnings.push(format!("related 참조가 존재하지 않는다: {ref_path}"));
                    }
                    Some(RelatedRef { ref_path, kind })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 조건이 맞으면 `related` 에 followup 한 건을 **더하고**, 응답에 실을 근거를
/// 돌려준다. 조건이 아니면 아무것도 하지 않고 빈 배열 (조용히 건너뛴다).
pub(super) fn auto_relate(
    root: &Path,
    entry_type: EntryType,
    files: &[FileTouched],
    related: &mut Vec<RelatedRef>,
) -> Vec<Value> {
    if !related.is_empty() || !matches!(entry_type, EntryType::Bug | EntryType::Error) {
        return Vec::new();
    }
    let targets: Vec<String> = files
        .iter()
        .map(|f| f.path.replace('\\', "/"))
        .filter(|p| !p.is_empty() && !is_hub_file(p))
        .collect();
    if targets.is_empty() {
        return Vec::new();
    }
    let Some((ref_path, via)) = latest_defect_touching(root, &targets) else {
        return Vec::new();
    };
    related.push(RelatedRef {
        ref_path: ref_path.clone(),
        kind: "followup".to_string(),
    });
    vec![json!({ "ref": ref_path, "kind": "followup", "via": via })]
}

/// `targets` 중 하나를 만진 **가장 최근** bug/error 일지 `(경로, 그 파일)`.
///
/// 최신순 정렬은 경로 문자열 역순이다 — `YYYYMMDD/Folder/HHMM_…` 라 그것이 곧
/// 시간 역순이고, 파일을 열지 않고 정해지며, 체크아웃마다 바뀌는 mtime 과 달리
/// 결정적이다 (`journal_search` 와 같은 근거).
fn latest_defect_touching(root: &Path, targets: &[String]) -> Option<(String, String)> {
    let journal_root = root.join(".oculpm").join("journal");
    let mut rels: Vec<String> = crate::oculpm::cache::walk_journal(&journal_root)
        .into_iter()
        .map(|(rel, _mtime)| rel)
        .filter(|rel| matches!(super::type_token_of_rel(rel), Some("bug") | Some("error")))
        .collect();
    rels.sort_unstable_by(|a, b| b.cmp(a));

    for rel in rels.iter().take(MAX_SCAN) {
        let Ok(raw) = std::fs::read_to_string(journal_root.join(rel)) else {
            continue;
        };
        let (fm, _body) = parse_frontmatter_and_body(&raw);
        let Some(fm) = fm.parsed else { continue };
        let hit = fm
            .files_touched
            .iter()
            .map(|ft| ft.path.replace('\\', "/"))
            .find(|p| targets.iter().any(|t| t == p));
        if let Some(p) = hit {
            return Some((rel.clone(), p));
        }
    }
    None
}
