//! 대화 자신의 트랜스크립트에서 **이 대화가 고친 파일**을 읽는다
//! (플랜 `v3-release` {#gate-positive-attribution}).
//!
//! # 왜 필요한가
//!
//! 판정은 여태 "누가 고쳤나"를 mtime 으로만 물었다. mtime 은 "이 창 안에 변경이
//! 있었다"까지만 말하고 **누가** 는 말하지 못한다. 그래서 살아 있는 옆 대화가
//! 하나라도 있으면 판정은 [`Undecided::LivePeers`](super::Undecided::LivePeers)
//! 로 멈춘다 — 오탐을 피하려고 고른 미탐이다.
//!
//! 문제는 이 저장소(와 이 도구를 쓰는 사람들)의 주 사용 방식이 **병렬 세션**
//! 이라는 것이다. 옆 대화가 늘 하나쯤 살아 있으니 게이트가 사실상 꺼져 있었다.
//!
//! Stop 훅 payload 의 `transcript_path` 가 그 벽을 넘는 재료다. 그 파일에는
//! **그 대화 자신이 부른 도구 호출**이 들어 있다 — `Edit`/`Write` 가 어느 파일을
//! 건드렸는지 그 대화가 자기 입으로 적어 둔 것이다. mtime 과 달리 이건 추론이
//! 아니라 1차 출처다.
//!
//! # 이 모듈이 **일부러 놓치는** 것
//!
//! 게이트는 "일지를 안 썼다"고 사람을 나무라는 장치라, 틀리는 방향이 한쪽이어야
//! 한다. 여기서 나오는 목록은 언제나 **실제 편집의 부분집합**이다.
//!
//! - **`Bash` 로 고친 파일** — `sed`·리다이렉션·스크립트는 인자를 파싱해야
//!   알 수 있고, 그 파싱은 틀리는 순간 오탐이 된다. 통째로 놓친다.
//! - **결과가 오류인 호출** — 도구가 실패했으면 파일은 안 바뀌었다. 짝지어진
//!   `tool_result` 가 오류면 버린다.
//! - **결과가 아직 없는 호출** — 턴이 잘렸거나 트랜스크립트가 쓰이는 중이다.
//!   확인되지 않은 편집은 안 센다.
//! - **[`MAX_BYTES`] 를 넘는 뒷부분** — 아주 긴 대화의 꼬리는 안 읽는다. 앞에서
//!   부터 읽으므로 **먼저 한 편집**이 남는데, 기록되지 않은 채 오래된 편집이
//!   바로 그 대화가 붙잡혀야 할 이유라서 자르는 자리로 맞다.
//!
//! 넷 다 "덜 붙잡는" 쪽이다. 반대 방향의 실수(안 고친 파일을 고쳤다고 적기)는
//! 이 파서만으로는 일어나지 않는다 — 대화가 자기 도구 호출을 지어내지 않는 한.

use std::collections::{BTreeSet, HashMap};
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

/// 트랜스크립트에서 읽을 최대 바이트. 게이트는 **매 턴** 도는 자리라 상한이
/// 필요하다. 64 MiB 면 이 저장소에서 가장 긴 대화도 통째로 들어간다.
const MAX_BYTES: usize = 64 * 1024 * 1024;

/// 결과를 기다리는 도구 호출의 최대 수 — 병리적인 트랜스크립트에서 표가
/// 무한히 자라지 않게. 넘으면 그 뒤의 호출은 안 센다(미탐 방향).
const MAX_PENDING_CALLS: usize = 8192;

/// 파일 경로를 인자로 받는 편집 도구들. 여기 없는 도구(`Bash` 등)는 안 센다.
const EDIT_TOOLS: [&str; 4] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/// 이 대화가 **성공시킨** `plan_update` 호출 하나 (oculpm MCP 도구).
///
/// 확인 게이트([`super::check`])의 재료다 — 이 대화가 어느 계획의 항목을 닫았고, 그 계획에
/// 판정(`판정 ✓|✗ …`)을 남긴 적이 있는가. 편집과 같은 규칙으로 덜 센다: 결과가 오류이거나
/// 아직 없는 호출은 안 센다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanUpdateCall {
    pub plan_id: String,
    /// `done` · `in_progress` … (도구 인자 그대로).
    pub status: String,
    pub note: Option<String>,
}

/// 트랜스크립트를 **한 번** 읽어 얻은 것 — 편집 대상과 `plan_update` 호출.
///
/// 게이트는 매 턴 도는 자리라 같은 파일을 두 번 읽지 않는다. 편집 경로는 날것(도구 인자
/// 그대로)으로 들고 있다가 git 최상위를 안 뒤에 맞춘다([`Self::edited_under`]).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Transcript {
    /// 성공한 편집 도구 호출이 건드린 경로.
    edits: Vec<String>,
    /// 성공한 `plan_update` 호출 (일어난 순서).
    pub plan_updates: Vec<PlanUpdateCall>,
}

impl Transcript {
    /// 파일을 못 열면 빈 것 — 판정은 "모름"으로 접힌다.
    pub fn read(transcript: &Path) -> Self {
        match std::fs::File::open(transcript) {
            Ok(file) => Self::scan(BufReader::new(file)),
            Err(_) => Self::default(),
        }
    }

    /// 이 대화가 고친 파일 — `top` 기준 상대경로.
    ///
    /// `top` 은 git 최상위다. 워킹트리 목록(`git status`)이 그 기준으로 오므로,
    /// 두 쪽이 **같은 어휘**를 써야 교집합이 성립한다. `top` 밖의 편집(다른 저장소·
    /// 임시 파일)은 어차피 이 프로젝트의 더티 목록에 없으므로 버린다.
    pub fn edited_under(&self, top: &Path) -> BTreeSet<String> {
        self.edits
            .iter()
            .filter_map(|raw| relative_to(top, Path::new(raw)))
            .collect()
    }

    /// 읽는 자리를 떼어낸다 — 테스트가 파일 없이 문자열로 물을 수 있게.
    fn scan(reader: impl BufRead) -> Self {
        // 도구 호출 id → 그 호출이 한 일. 결과를 볼 때까지 여기 머문다.
        let mut pending: HashMap<String, Call> = HashMap::new();
        let mut out = Self::default();
        let mut read = 0usize;

        for line in reader.lines().map_while(Result::ok) {
            read += line.len() + 1;
            if read > MAX_BYTES {
                break;
            }
            // 도구 호출 · 결과가 없는 줄(긴 본문 · 생각 · 첨부)은 JSON 으로 뜯지 않는다 —
            // 긴 대화에서 바이트의 대부분이 이쪽이고, 게이트는 매 턴 이 파일을 읽는다.
            if !line.contains("tool_use") && !line.contains("tool_result") {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(blocks) = entry
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for block in blocks {
                match block.get("type").and_then(Value::as_str) {
                    Some("tool_use") => {
                        if pending.len() >= MAX_PENDING_CALLS {
                            continue;
                        }
                        let Some(id) = block.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(call) = call_of(block) else {
                            continue;
                        };
                        pending.insert(id.to_string(), call);
                    }
                    Some("tool_result") => {
                        let Some(id) = block.get("tool_use_id").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(call) = pending.remove(id) else {
                            continue;
                        };
                        // 오류로 끝난 호출은 아무것도 안 바꿨다. `is_error` 는 없을
                        // 수도 있고(성공), 구현에 따라 문자열로 오기도 한다.
                        if is_error(block) {
                            continue;
                        }
                        match call {
                            Call::Edit(path) => out.edits.push(path),
                            Call::PlanUpdate(update) => out.plan_updates.push(update),
                        }
                    }
                    _ => {}
                }
            }
        }
        // `pending` 에 남은 것은 **결과를 못 본 호출**이다 — 안 센다.
        out
    }
}

/// 결과를 기다리는 도구 호출 — 우리가 세는 두 가지뿐이다.
enum Call {
    Edit(String),
    PlanUpdate(PlanUpdateCall),
}

/// 이 대화가 고친 파일 — `top` 기준 상대경로 ([`Transcript::edited_under`]).
#[cfg(test)]
fn edited_paths(transcript: &Path, top: &Path) -> BTreeSet<String> {
    Transcript::read(transcript).edited_under(top)
}

/// 편집만 묻는 옛 모양 — 아래 테스트들이 쓴다.
#[cfg(test)]
fn scan(reader: impl BufRead, top: &Path) -> BTreeSet<String> {
    Transcript::scan(reader).edited_under(top)
}

/// 이 `tool_use` 블록이 우리가 세는 호출이면 그것 (편집 도구 · oculpm 의 `plan_update`).
fn call_of(block: &Value) -> Option<Call> {
    let name = block.get("name").and_then(Value::as_str)?;
    let input = block.get("input")?;
    if EDIT_TOOLS.contains(&name) {
        let raw = ["file_path", "notebook_path"]
            .iter()
            .find_map(|key| input.get(key).and_then(Value::as_str))?;
        return Some(Call::Edit(raw.to_string()));
    }
    if is_plan_update_tool(name) {
        let text = |key: &str| {
            input
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        return Some(Call::PlanUpdate(PlanUpdateCall {
            plan_id: text("plan_id")?,
            status: text("status")?,
            note: text("note"),
        }));
    }
    None
}

/// oculpm MCP 의 `plan_update` 인가 — 플러그인(`mcp__plugin_oculpm_oculpm__plan_update`)과
/// 직접 등록(`mcp__oculpm__plan_update`) 양쪽. 다른 서버의 같은 이름 도구는 세지 않는다.
fn is_plan_update_tool(name: &str) -> bool {
    name.strip_suffix("__plan_update")
        .is_some_and(|server| server.starts_with("mcp__") && server.contains("oculpm"))
}

/// `top` 아래의 경로만 `top` 기준 상대경로로. 밖이면 `None`.
///
/// 심링크는 풀지 않는다. 풀어서 맞추는 쪽이 더 많이 붙잡겠지만, 게이트가 도는
/// 매 턴 `canonicalize` 를 부르면 없는 파일에서 실패하고 비용도 는다 — 못 맞추면
/// 그 파일만 빠지는 미탐이라 감수한다.
fn relative_to(top: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(top).ok()?;
    let text = rel.to_str()?;
    (!text.is_empty()).then(|| text.replace('\\', "/"))
}

/// `is_error` 를 관용적으로 읽는다 — 없으면 성공, 불리언·문자열 양쪽 허용.
fn is_error(block: &Value) -> bool {
    match block.get("is_error") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOP: &str = "/repo";

    fn scan_lines(lines: &[&str]) -> BTreeSet<String> {
        scan(lines.join("\n").as_bytes(), Path::new(TOP))
    }

    fn tool_use(id: &str, name: &str, path: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"{id}","name":"{name}","input":{{"file_path":"{path}"}}}}]}}}}"#
        )
    }

    fn tool_result(id: &str, is_error: &str) -> String {
        format!(
            r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"{id}","is_error":{is_error}}}]}}}}"#
        )
    }

    /// 골자 — 성공한 편집 하나가 `top` 기준 상대경로로 나온다.
    #[test]
    fn a_successful_edit_is_reported_relative_to_the_repo_top() {
        let got = scan_lines(&[
            &tool_use("t1", "Edit", "/repo/src/lib.rs"),
            &tool_result("t1", "false"),
        ]);
        assert_eq!(got, BTreeSet::from(["src/lib.rs".to_string()]));
    }

    /// **결과가 오류면 안 센다.** 실패한 편집은 파일을 안 바꿨는데, 그것으로
    /// 사람을 붙잡으면 게이트가 거짓말을 한다.
    #[test]
    fn an_errored_edit_is_not_counted() {
        assert!(scan_lines(&[
            &tool_use("t1", "Edit", "/repo/src/lib.rs"),
            &tool_result("t1", "true"),
        ])
        .is_empty());
    }

    /// **결과를 못 본 호출도 안 센다** — 턴이 잘렸거나 아직 쓰이는 중이다.
    #[test]
    fn an_unfinished_call_is_not_counted() {
        assert!(scan_lines(&[&tool_use("t1", "Write", "/repo/a.rs")]).is_empty());
    }

    /// `Bash` 로 고친 것은 통째로 놓친다 — 인자 파싱은 틀리는 순간 오탐이다.
    #[test]
    fn a_bash_edit_is_deliberately_missed() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"sed -i s/a/b/ /repo/a.rs"}}]}}"#;
        assert!(scan_lines(&[line, &tool_result("t1", "false")]).is_empty());
    }

    /// 저장소 밖의 편집은 버린다 — 이 프로젝트의 더티 목록에 있을 수가 없다.
    #[test]
    fn an_edit_outside_the_repo_is_dropped() {
        assert!(scan_lines(&[
            &tool_use("t1", "Write", "/tmp/scratch.md"),
            &tool_result("t1", "false"),
        ])
        .is_empty());
    }

    /// 노트북은 `notebook_path` 로 온다.
    #[test]
    fn a_notebook_edit_is_read_from_its_own_key() {
        let use_line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"NotebookEdit","input":{"notebook_path":"/repo/nb.ipynb"}}]}}"#;
        let got = scan(
            format!("{use_line}\n{}", tool_result("t1", "false")).as_bytes(),
            Path::new(TOP),
        );
        assert_eq!(got, BTreeSet::from(["nb.ipynb".to_string()]));
    }

    /// 깨진 줄 하나가 나머지를 막지 않는다 — 트랜스크립트는 우리 파일이 아니다.
    #[test]
    fn a_broken_line_does_not_stop_the_scan() {
        let got = scan_lines(&[
            "{ this is not json",
            &tool_use("t1", "Edit", "/repo/a.rs"),
            &tool_result("t1", "false"),
        ]);
        assert_eq!(got, BTreeSet::from(["a.rs".to_string()]));
    }

    /// `is_error` 가 문자열로 와도 오류는 오류다 (직렬화 구현에 안 기댄다).
    #[test]
    fn a_stringly_typed_error_flag_is_still_an_error() {
        assert!(scan_lines(&[
            &tool_use("t1", "Edit", "/repo/a.rs"),
            &tool_result("t1", "\"true\""),
        ])
        .is_empty());
    }

    /// 파일이 없으면 빈 집합 — 판정은 "모름"으로 접힌다.
    #[test]
    fn a_missing_transcript_yields_nothing() {
        assert!(edited_paths(Path::new("/nope/none.jsonl"), Path::new(TOP)).is_empty());
    }

    // ─── plan_update 호출 (확인 게이트의 재료) ──────────────────────────────

    const PLUGIN_TOOL: &str = "mcp__plugin_oculpm_oculpm__plan_update";

    fn plan_update(id: &str, tool: &str, plan: &str, status: &str, note: Option<&str>) -> String {
        let note = note
            .map(|n| format!(r#","note":"{n}""#))
            .unwrap_or_default();
        format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"{id}","name":"{tool}","input":{{"plan_id":"{plan}","item_id":"a","status":"{status}"{note}}}}}]}}}}"#
        )
    }

    /// 성공한 `plan_update` 만, 일어난 순서로 — 플러그인 · 직접 등록 양쪽 이름.
    #[test]
    fn successful_plan_updates_are_collected_in_order() {
        let lines = [
            plan_update("p1", PLUGIN_TOOL, "round", "in_progress", None),
            tool_result("p1", "false"),
            plan_update(
                "p2",
                "mcp__oculpm__plan_update",
                "round",
                "done",
                Some("판정 ✓ 12 passed"),
            ),
            tool_result("p2", "false"),
        ];
        let got = Transcript::scan(lines.join("\n").as_bytes());
        assert_eq!(
            got.plan_updates,
            vec![
                PlanUpdateCall {
                    plan_id: "round".into(),
                    status: "in_progress".into(),
                    note: None,
                },
                PlanUpdateCall {
                    plan_id: "round".into(),
                    status: "done".into(),
                    note: Some("판정 ✓ 12 passed".into()),
                },
            ]
        );
        assert!(got.edited_under(Path::new(TOP)).is_empty());
    }

    /// 오류로 끝났거나 결과가 없는 호출, 다른 서버의 같은 이름 도구는 안 센다.
    #[test]
    fn failed_unfinished_and_foreign_plan_updates_are_not_counted() {
        let lines = [
            plan_update("p1", PLUGIN_TOOL, "round", "done", None),
            tool_result("p1", "true"),
            plan_update("p2", PLUGIN_TOOL, "round", "done", None),
            plan_update("p3", "mcp__linear__plan_update", "round", "done", None),
            tool_result("p3", "false"),
            plan_update("p4", "plan_update", "round", "done", None),
            tool_result("p4", "false"),
        ];
        assert!(Transcript::scan(lines.join("\n").as_bytes())
            .plan_updates
            .is_empty());
    }

    /// 도구 호출이 없는 긴 줄은 건너뛰어도 그 앞뒤의 호출은 그대로 읽힌다.
    #[test]
    fn lines_without_tool_blocks_are_skipped_without_losing_calls() {
        let prose = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{}"}}]}}}}"#,
            "가".repeat(5000)
        );
        let got = scan_lines(&[
            &prose,
            &tool_use("t1", "Edit", "/repo/a.rs"),
            &prose,
            &tool_result("t1", "false"),
        ]);
        assert_eq!(got, BTreeSet::from(["a.rs".to_string()]));
    }
}
