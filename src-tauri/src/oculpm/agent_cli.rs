//! `oculpm <도구> [json]` — **에이전트의 손** (플랜 `session-shim-cli`).
//!
//! `--pty-host`·`config` 와 같은 same-exe 서브커맨드다. 새 바이너리를 빌드·
//! 서명·배포하지 않는 것이 요점이다 ([`shim`](crate::oculpm::shim) 이 이
//! 실행 파일로 심링크를 건다).
//!
//! ## 표면을 새로 만들지 않았다
//!
//! 도구 목록도 구현도 [`mcp::tools`](crate::oculpm::mcp::tools) 그대로다 —
//! 이 파일은 **stdin/stdout 을 그 함수에 잇는 어댑터**일 뿐이다. 두 벌을
//! 만들면 하나만 고쳐지는 날이 반드시 오고, 그날 기록 규격이 표면마다
//! 달라진다. MCP 를 쓰는 에이전트와 셸만 쓰는 에이전트가 **같은 계약**을 본다.
//!
//! ## 종료 코드가 의미를 갖는다
//!
//! | 코드 | 뜻 |
//! |---|---|
//! | 0 | 성공 |
//! | 1 | 사용자 오류 (인자·JSON·도구 이름) |
//! | 2 | 입출력 |
//! | 3 | 추적되지 않는 프로젝트 (`.oculpm/` 없음) |
//! | 4 | 그 밖의 실패 |
//! | 5 | **쓰기 충돌** — 기대한 내용이 아니다 (`base_hash` 불일치, 또는 다른 세션이 그 플랜을 쥐고 있다) |
//!
//! 5 가 따로 있는 이유는 병렬 세션 때문이다. 두 세션이 같은 플랜 항목을 동시에
//! 고치면 나중 쓴 쪽이 이기고 그 사이 변경이 사라진다 — 이 저장소가 실제로
//! 겪은 사고다. 충돌을 일반 오류로 뭉뚱그리면 호출자가 "다시 읽고 다시 쓴다"를
//! 판단할 수 없다.
//!
//! ## `plan_update` 는 두 번 부르는 것이 정상이다
//!
//! `base_hash` 는 **필수**다 (플랜 `v3-record-integrity` `{#cas-required}`).
//! 셸에서는 이렇게 쓴다:
//!
//! ```sh
//! h=$(oculpm plan_status '{"plan_id":"my-plan"}' | jq -r '.plans[0].hash')
//! oculpm plan_update "{\"plan_id\":\"my-plan\",\"item_id\":\"x\",\"status\":\"done\",\"base_hash\":\"$h\"}"
//! ```
//!
//! **강제 우회 플래그는 두지 않았다.** `--no-base-hash` 같은 것을 만들면 계약이
//! 둘이 되고, 마찰을 만나는 호출자는 언제나 둘째 계약을 고른다 — 그 순간 이
//! 안전장치는 문서로 강등된다. exit 5 를 받으면 위 두 줄을 다시 돌리는 것이
//! 정답이고, 그 재시도가 CAS 가 하려던 일 전부다.
//!
//! stdout 은 결과만, stderr 는 오류만 — 에이전트가 파이프로 받는다.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::oculpm::mcp::tools;
use crate::oculpm::shim;

const USAGE: &str = "\
usage: oculpm <tool> [json|-]

  <tool>   an oculpm MCP tool name (journal_write, plan_status, plan_update,
           plan_create, journal_search, journal_read, agent_register,
           agent_list, agent_inbox, agent_send, task_create, task_update,
           claim_paths, project_init)
  json     tool arguments as JSON; `-` reads them from stdin (default: {})

  oculpm tools            print the tool definitions (same JSON the MCP
                          server serves) and exit
  oculpm whoami           print this session's identity and project root

  plan_update requires base_hash — read it first, then write:
    h=$(oculpm plan_status '{\"plan_id\":\"P\"}' | jq -r '.plans[0].hash')
    oculpm plan_update \"{\\\"plan_id\\\":\\\"P\\\",\\\"item_id\\\":\\\"I\\\",\\\"status\\\":\\\"done\\\",\\\"base_hash\\\":\\\"$h\\\"}\"
  there is no force flag: on exit 5 re-read the hash and call again.

options:
  --project <path>        project root (default: session token, else the
                          nearest ancestor of the current directory that
                          has a .oculpm/)

exit: 0 ok · 1 user error · 2 io · 3 project not tracked · 4 other
      5 write conflict (base_hash mismatch, or another session holds the
        plan — re-read the hash and retry)
";

/// [`crate::oculpm::error`] 없이도 알아볼 수 있게 **오류 문자열 앞에 붙는 표지.**
///
/// 메시지 본문을 정규식으로 뜯지 않으려고 둔다 — 문구는 번역·다듬기의 대상이고
/// 종료 코드는 계약이다.
pub const WRITE_CONFLICT_PREFIX: &str = "write-conflict:";

/// 이 낱말이 CLI 진입인가.
///
/// `main.rs` 가 GUI 를 띄우기 **전에** 판정해야 해서 여기 둔다. 정확히 일치할
/// 때만 CLI 로 간다 — macOS 가 붙이는 `-psn_0_123` 같은 인자로 앱이 헤드리스로
/// 뜨는 사고를 막는다.
pub fn is_cli_verb(word: &str) -> bool {
    matches!(word, "tools" | "whoami")
        || tools::tool_definitions().as_array().is_some_and(|list| {
            list.iter()
                .filter_map(|t| t.get("name").and_then(serde_json::Value::as_str))
                .any(|name| name == word)
        })
}

/// `main.rs` 가 도구 이름을 만나면 여기로 들어오고, 돌아가지 않는다.
pub fn run(args: Vec<String>) -> ! {
    let code = match dispatch(args) {
        Ok(out) => {
            if !out.is_empty() {
                println!("{out}");
            }
            0
        }
        Err(Fail { code, message }) => {
            eprintln!("{message}");
            code
        }
    };
    std::process::exit(code);
}

#[derive(Debug)]
struct Fail {
    code: i32,
    message: String,
}

fn fail(code: i32, message: impl Into<String>) -> Fail {
    Fail {
        code,
        message: message.into(),
    }
}

fn dispatch(args: Vec<String>) -> Result<String, Fail> {
    let mut positional: Vec<String> = Vec::new();
    let mut project: Option<PathBuf> = None;
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--project" => {
                let path = it.next().ok_or_else(|| fail(1, "--project needs a path"))?;
                project = Some(PathBuf::from(path));
            }
            "-h" | "--help" => return Ok(USAGE.to_string()),
            other => positional.push(other.to_string()),
        }
    }

    let tool = positional
        .first()
        .cloned()
        .ok_or_else(|| fail(1, USAGE.trim_end()))?;
    if tool == "tools" {
        return Ok(tools::tool_definitions().to_string());
    }

    let token = shim::resolve_token(std::env::args().next().as_deref());
    let root = resolve_root(project, token.as_ref())?;

    if tool == "whoami" {
        return Ok(serde_json::json!({
            "project_root": root.display().to_string(),
            "agent_id": token.as_ref().and_then(|t| t.agent_id.clone()),
            "session_id": token.as_ref().and_then(|t| t.session_id.clone()),
            // 토큰이 없으면 세션도 **자칭**이다. 그 사실을 숨기지 않는다.
            "verified_session": token.is_some(),
            // 에이전트까지 우리가 아는가 (ACP 세션만 true).
            "verified_agent": token.as_ref().is_some_and(|t| t.agent_id.is_some()),
        })
        .to_string());
    }

    // `.oculpm/` 이 없으면 도구가 뭘 하든 실패한다 — 메시지를 뜯어 보는 대신
    // 여기서 미리 판정해 전용 코드로 나간다 (문구는 바뀌어도 코드는 계약이다).
    if tool != "project_init" && !root.join(".oculpm").is_dir() {
        return Err(fail(
            3,
            format!("not a tracked project: {} has no .oculpm/", root.display()),
        ));
    }

    let mut args_json = read_args(positional.get(1).map(String::as_str))?;
    // 토큰이 있으면 **토큰이 이긴다.** 인자로 준 agent_id 는 자칭이고, 토큰은
    // 우리가 그 세션에 적어 준 값이다.
    if let Some(token) = &token {
        if let Some(obj) = args_json.as_object_mut() {
            // 토큰이 에이전트를 아는 경우에만 덮어쓴다. 터미널 세션은 누가
            // 그 안에서 도는지 모르므로(모듈 문서 참조) 자칭을 그대로 둔다 —
            // 모르는 것을 우리 이름으로 덮어쓰면 그것도 거짓이다.
            if let Some(agent) = &token.agent_id {
                obj.insert("agent_id".into(), Value::String(agent.clone()));
            }
            if let Some(session) = &token.session_id {
                obj.entry("session_id")
                    .or_insert_with(|| Value::String(session.clone()));
            }
        }
    }

    match tools::call_tool(&root, &tool, &args_json) {
        Ok(value) => Ok(value.to_string()),
        Err(message) if message.starts_with(WRITE_CONFLICT_PREFIX) => Err(fail(5, message)),
        Err(message) => Err(fail(4, message)),
    }
}

/// 인자 JSON — 없으면 `{}`, `-` 면 stdin.
fn read_args(raw: Option<&str>) -> Result<Value, Fail> {
    let text = match raw {
        None => return Ok(Value::Object(Default::default())),
        Some("-") => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| fail(2, format!("cannot read stdin: {e}")))?;
            buf
        }
        Some(inline) => inline.to_string(),
    };
    if text.trim().is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    serde_json::from_str(&text).map_err(|e| fail(1, format!("arguments are not valid JSON: {e}")))
}

/// 프로젝트 루트 — 인자 → 토큰 → 현재 디렉터리에서 위로.
///
/// CWD 에서 올라가며 찾는 이유는 심 없이 그냥 `oculpm` 을 친 사람도 있기
/// 때문이다. 그때는 신원이 자칭일 뿐 기록은 정상적으로 남는다.
fn resolve_root(
    explicit: Option<PathBuf>,
    token: Option<&shim::SessionToken>,
) -> Result<PathBuf, Fail> {
    if let Some(path) = explicit {
        return path
            .canonicalize()
            .map_err(|e| fail(2, format!("cannot resolve --project: {e}")));
    }
    if let Some(token) = token {
        return Ok(PathBuf::from(&token.project_root));
    }
    let cwd = std::env::current_dir().map_err(|e| fail(2, format!("cannot read cwd: {e}")))?;
    Ok(find_tracked_ancestor(&cwd).unwrap_or(cwd))
}

fn find_tracked_ancestor(start: &Path) -> Option<PathBuf> {
    shim::tracked_root(start)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn args_come_from_argv_or_default_to_empty() {
        assert_eq!(read_args(None).ok().unwrap(), serde_json::json!({}));
        assert_eq!(read_args(Some("  ")).ok().unwrap(), serde_json::json!({}));
        assert_eq!(
            read_args(Some(r#"{"a":1}"#)).ok().unwrap(),
            serde_json::json!({"a": 1})
        );
    }

    #[test]
    fn broken_json_is_a_user_error_not_a_crash() {
        let err = read_args(Some("{not json")).err().unwrap();
        assert_eq!(err.code, 1);
    }

    #[test]
    fn the_root_walks_up_to_the_tracked_ancestor() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm")).unwrap();
        let deep = root.join("src/features/skills");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(find_tracked_ancestor(&deep), Some(root.to_path_buf()));
        assert_eq!(find_tracked_ancestor(Path::new("/")), None);
    }

    /// 추적되지 않는 프로젝트는 **전용 코드**로 나간다 — 호출자가 "앱에서 추가
    /// 하라"를 판단할 수 있게. 메시지 문구에 기대지 않는다.
    #[test]
    fn an_untracked_project_exits_with_its_own_code() {
        let dir = TempDir::new().unwrap();
        let err = dispatch(vec![
            "plan_status".into(),
            "--project".into(),
            dir.path().display().to_string(),
        ])
        .err()
        .unwrap();
        assert_eq!(err.code, 3);
        assert!(
            !dir.path().join(".oculpm").exists(),
            "가드가 만들면 안 된다"
        );
    }

    #[test]
    fn tools_prints_the_same_definitions_the_mcp_server_serves() {
        let out = dispatch(vec!["tools".into()]).unwrap();
        assert!(out.contains("journal_write"));
        assert!(out.contains("claim_paths"));
    }

    /// 앱이 **인자 하나 때문에** 헤드리스로 뜨면 안 된다.
    #[test]
    fn only_exact_tool_names_enter_the_cli() {
        assert!(is_cli_verb("journal_write"));
        assert!(is_cli_verb("claim_paths"));
        assert!(is_cli_verb("whoami"));
        assert!(!is_cli_verb("-psn_0_1234"));
        assert!(!is_cli_verb("journal"));
        assert!(!is_cli_verb(""));
    }

    #[test]
    fn help_is_not_an_error() {
        assert!(dispatch(vec!["--help".into()]).unwrap().contains("exit:"));
    }
}
