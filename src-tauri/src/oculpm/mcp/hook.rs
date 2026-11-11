//! `oculpm-mcp hook <event>` — 플러그인 훅이 **셸 없이** 바이너리를 바로 부르는 자리 (11-11).
//!
//! 왜: Windows 에서 Claude Code 는 훅을 Git Bash 로 돌리고, 거기서는 프로세스 하나(`sed` ·
//! `grep` · `head` · `$(...)` 서브셸)를 띄우는 데 수십 ms 가 든다. 매 편집마다 도는
//! PreToolUse 의 옛 `hooks/refix-warn.sh` 는 payload 를 sed/grep 파이프라인으로 뜯느라 열 개
//! 넘는 프로세스를 띄운 뒤에야 `oculpm-mcp refix` 를 불렀다. 이제 훅 명령이 셔틀
//! (`bin/oculpm-mcp`, 자식 프로세스 0)을 거쳐 이 함수를 부르고, payload 는 여기서 JSON 으로
//! 읽는다 — 정규식으로 뜯던 `\\` 풀기·키 순서 같은 함정도 같이 사라진다.
//!
//! 계약 (옛 셸과 같다): stdin 은 끝까지 읽는다 · 네트워크 없음 · **모든 실패는 무해** —
//! exit 0, 출력 없음. 막지 않는다 (허가 결정을 내지 않는다).
//!
//! ```text
//! oculpm-mcp hook pre-tool-use   < PreToolUse payload (stdin JSON)
//!   stdout  재수정 경고 JSON (있을 때만) · exit 0
//! ```

use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// payload 상한 — 훅 payload 는 몇 KB 다. 넘치는 것은 끝까지 비우되 읽지 않는다.
const MAX_PAYLOAD: u64 = 4 * 1024 * 1024;

pub fn run(args: &[String]) -> i32 {
    let mut stdin = std::io::stdin().lock();
    let mut buf = Vec::new();
    let _ = stdin.by_ref().take(MAX_PAYLOAD).read_to_end(&mut buf);
    // 남은 것도 비운다 — 다 읽기 전에 끝나면 보내는 쪽이 EPIPE 를 본다.
    let _ = std::io::copy(&mut stdin, &mut std::io::sink());
    let payload = String::from_utf8_lossy(&buf);
    let project_dir = std::env::var("CLAUDE_PROJECT_DIR").unwrap_or_default();
    // 모르는 이벤트는 무해하게 지나간다 — 새 hooks.json 이 옛 바이너리를 만나는 경우.
    if args.first().map(String::as_str) == Some("pre-tool-use") {
        if let Some(json) = pre_tool_use(&payload, &project_dir) {
            println!("{json}");
        }
    }
    0
}

/// 프로젝트 루트: `CLAUDE_PROJECT_DIR` → payload 의 `cwd` → 현재 디렉터리 (형제 훅과 같은 3단).
fn project_root(payload: &Value, project_dir: &str) -> PathBuf {
    if !project_dir.is_empty() {
        return PathBuf::from(project_dir);
    }
    match payload.get("cwd").and_then(Value::as_str) {
        Some(cwd) if !cwd.is_empty() => PathBuf::from(cwd),
        _ => PathBuf::from("."),
    }
}

/// `.oculpm` 이 없거나, 쓰기를 프로젝트 밖으로 돌릴 링크가 끼어 있으면 `false`.
fn tracked_without_links(root: &Path, links: &[&str]) -> bool {
    root.join(".oculpm").is_dir() && !links.iter().any(|l| root.join(l).is_symlink())
}

/// 대화 id — 마커 파일 이름에 쓰이므로 `[A-Za-z0-9._-]` 만 (옛 셸의 sed 와 같은 문자 집합).
fn session_id(payload: &Value) -> String {
    payload
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|s| {
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        })
        .unwrap_or_default()
        .to_string()
}

/// PreToolUse(Edit · Write · MultiEdit · NotebookEdit) — 재수정 경고. 판단은 `refix::warning`.
pub fn pre_tool_use(payload: &str, project_dir: &str) -> Option<String> {
    let payload: Value = serde_json::from_str(payload.trim()).ok()?;
    let root = project_root(&payload, project_dir);
    if !tracked_without_links(&root, &[".oculpm", ".oculpm/hooks", ".oculpm/journal"]) {
        return None;
    }
    let input = payload.get("tool_input")?;
    let file = ["file_path", "notebook_path"].iter().find_map(|k| {
        input
            .get(*k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    })?;
    crate::oculpm::refix::warning(&root, file, &session_id(&payload), 7)
}

#[cfg(test)]
#[path = "hook_tests.rs"]
mod tests;
