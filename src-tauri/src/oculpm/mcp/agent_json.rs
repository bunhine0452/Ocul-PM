//! Cursor · Gemini CLI 의 프로젝트 MCP 등록 (love-round-20261123, 사용자 결정 11-23).
//!
//! 두 도구는 Claude 의 `.mcp.json` 을 읽지 않고, 플러그인도 없다 — 각자의 프로젝트 파일에서
//! `mcpServers` 를 읽는다:
//!
//! | 도구 | 파일 | 모양 |
//! |---|---|---|
//! | Cursor | `.cursor/mcp.json` | `{"mcpServers": {"<이름>": {"command", "args"}}}` |
//! | Gemini CLI | `.gemini/settings.json` | 같은 `mcpServers` — 다른 설정 키와 한 파일 |
//!
//! `.mcp.json` 등록(`register.rs`)과 같은 계약이다: 우리 키(`oculpm`)만 만지고, 남의 서버와
//! 모르는 키는 **순서까지** 보존하며(`serde_json` 의 `preserve_order`), 이미 같은 항목이면
//! 쓰지 않고(멱등), **JSON 으로 못 읽는 파일은 절대 덮어쓰지 않는다** — Gemini 설정은 주석을
//! 허용하는데, 그런 파일을 다시 쓰면 주석이 사라지므로 거절하고 경로와 이유를 말한다.
//!
//! 사용자가 설정에서 누를 때만 쓴다. 실행 경로는 Claude · Codex 등록과 같은 출처
//! ([`register::locate_binary`]). `type` 키는 싣지 않는다 — Cursor 는 `command` 로 stdio 를
//! 알아보고, Gemini 는 그 키를 모른다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::oculpm::atomic_io;
use crate::oculpm::mcp::register::{BINARY_SIGNATURE, SERVER_KEY};

/// MCP 를 프로젝트 JSON 으로 받는 에이전트.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentMcpTarget {
    Cursor,
    Gemini,
}

impl AgentMcpTarget {
    /// 프로젝트 루트 기준 설정 파일.
    pub fn rel_path(self) -> &'static str {
        match self {
            AgentMcpTarget::Cursor => ".cursor/mcp.json",
            AgentMcpTarget::Gemini => ".gemini/settings.json",
        }
    }

    /// 이 도구를 쓴다는 표시 — 프로젝트 안(`agents::detect` 와 같은 인접 표식)과 홈 폴더.
    fn markers(self) -> (&'static [&'static str], &'static str) {
        match self {
            AgentMcpTarget::Cursor => (&[".cursor"], ".cursor"),
            AgentMcpTarget::Gemini => (&[".gemini", "GEMINI.md"], ".gemini"),
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AgentMcpStatus {
    pub target: AgentMcpTarget,
    /// 이 프로젝트나 이 기기에서 그 도구의 흔적을 찾았다 — 없으면 화면에 행을 세우지 않는다.
    pub detected: bool,
    /// 설정 파일에 우리 서버가 있다.
    pub registered: bool,
    pub binary_found: bool,
    pub binary_path: Option<String>,
    /// 쓰는 자리 (절대 경로) — 화면이 그대로 보여 준다.
    pub config_path: String,
}

/// 「그대로 두었다」 문구 — 화면 사전(`src/i18n/errors.ts`)이 이 모양을 되돌린다.
fn left_unchanged(path: &Path, why: &str) -> String {
    format!("{} was left unchanged: {why}", path.display())
}

fn config_file(target: AgentMcpTarget, root: &Path) -> Result<PathBuf, String> {
    // 링크는 따라가지 않는다 — 링크 대상의 내용이 프로젝트 파일로 복사되고 링크가 깨진다.
    crate::path_guard::secure_join_managed(root, target.rel_path())
}

fn read_config(path: &Path) -> Result<Value, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Object(Map::new())),
        Err(e) => return Err(format!("Could not read {}: {e}", path.display())),
    };
    if raw.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| left_unchanged(path, &format!("it is not plain JSON ({e})")))?;
    if !value.is_object() {
        return Err(left_unchanged(path, "its top level is not a JSON object"));
    }
    Ok(value)
}

fn servers_of<'a>(value: &'a Value, path: &Path) -> Result<Option<&'a Map<String, Value>>, String> {
    match value.get("mcpServers") {
        None => Ok(None),
        Some(Value::Object(m)) => Ok(Some(m)),
        Some(_) => Err(left_unchanged(path, "\"mcpServers\" is not an object")),
    }
}

fn entry_is_ours(key: &str, entry: &Value) -> bool {
    key == SERVER_KEY
        || entry
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|c| c.contains(BINARY_SIGNATURE))
}

fn server_entry(binary: &Path, root: &Path) -> Value {
    json!({
        "command": binary.to_string_lossy(),
        "args": ["--root", root.to_string_lossy()],
    })
}

fn write_config(path: &Path, value: &Value) -> Result<(), String> {
    let mut pretty = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    pretty.push('\n');
    atomic_io::write_atomic(path, pretty.as_bytes())
        .map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// 이 도구를 쓰는 흔적 — 프로젝트의 인접 표식이나 홈의 설정 폴더.
pub fn detected(target: AgentMcpTarget, root: &Path, home: Option<&Path>) -> bool {
    let (in_project, in_home) = target.markers();
    in_project.iter().any(|m| root.join(m).exists())
        || home.is_some_and(|h| h.join(in_home).is_dir())
}

pub fn status(
    target: AgentMcpTarget,
    root: &Path,
    home: Option<&Path>,
    binary: Option<&Path>,
) -> Result<AgentMcpStatus, String> {
    let path = config_file(target, root)?;
    let value = read_config(&path)?;
    let registered = servers_of(&value, &path)?
        .is_some_and(|servers| servers.iter().any(|(k, e)| entry_is_ours(k, e)));
    Ok(AgentMcpStatus {
        target,
        detected: detected(target, root, home),
        registered,
        binary_found: binary.is_some(),
        binary_path: binary.map(|b| b.to_string_lossy().to_string()),
        config_path: path.to_string_lossy().to_string(),
    })
}

/// 등록 (멱등) — 같은 항목이 이미 있으면 파일을 건드리지 않는다.
pub fn register(
    target: AgentMcpTarget,
    root: &Path,
    home: Option<&Path>,
    binary: &Path,
) -> Result<AgentMcpStatus, String> {
    let path = config_file(target, root)?;
    let mut value = read_config(&path)?;
    servers_of(&value, &path)?;
    let entry = server_entry(binary, root);
    let obj = value
        .as_object_mut()
        .expect("read_config returns an object");
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .expect("checked by servers_of above");
    if servers.get(SERVER_KEY) != Some(&entry) {
        // 키가 이미 있으면 그 자리에서 바뀐다(IndexMap) — 순서가 그대로다.
        servers.insert(SERVER_KEY.to_string(), entry);
        write_config(&path, &value)?;
    }
    status(target, root, home, Some(binary))
}

/// 해제 (멱등) — 우리 키 · 우리 실행 파일 항목만 걷고, 비면 `mcpServers` 도 걷는다.
/// 파일이 없거나 우리 것이 없으면 쓰지 않는다.
pub fn unregister(
    target: AgentMcpTarget,
    root: &Path,
    home: Option<&Path>,
    binary: Option<&Path>,
) -> Result<AgentMcpStatus, String> {
    let path = config_file(target, root)?;
    let mut value = read_config(&path)?;
    let ours = servers_of(&value, &path)?
        .is_some_and(|servers| servers.iter().any(|(k, e)| entry_is_ours(k, e)));
    if ours {
        let obj = value
            .as_object_mut()
            .expect("read_config returns an object");
        if let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) {
            servers.retain(|k, e| !entry_is_ours(k, e));
            if servers.is_empty() {
                obj.remove("mcpServers");
            }
        }
        write_config(&path, &value)?;
    }
    status(target, root, home, binary)
}

#[cfg(test)]
#[path = "agent_json_tests.rs"]
mod tests;
