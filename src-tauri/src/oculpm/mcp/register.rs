//! PR-CI2 — MCP 서버 등록 (`.mcp.json` 머지) + Claude Desktop 원클릭 등록.
//!
//! claude_hooks 설치기와 동일한 계약: 우리 키(`oculpm`)만 만지고, 남의 서버
//! 정의·미지의 키는 보존하며, **파싱 불가 파일은 절대 덮어쓰지 않는다**.
//! Claude Desktop 은 훅·transcript 가 없어 MCP 가 유일한 연동로다 (마스터플랜
//! §1) — `claude_desktop_config.json` 에 같은 stdio 바이너리를 프로젝트별
//! 키(`oculpm-<폴더명>`)로 기입하고, 설정은 앱 재시작 시 반영된다.
//!
//! D3 캐비앗 그대로 — `.mcp.json` 은 커밋되는 프로젝트 파일인데 바이너리
//! 경로는 머신 종속이다. UI 가 이를 고지하고, 팀 공유가 필요해지면 PR-CI8
//! (플러그인 패키징)이 경로 문제를 해소한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};

pub const MCP_JSON_REL: &str = ".mcp.json";
/// `.mcp.json` `mcpServers` 아래 우리 키.
pub const SERVER_KEY: &str = "oculpm";
/// command 경로에 이 조각이 있으면 우리 엔트리로 간주 (키 충돌 시 식별).
const BINARY_SIGNATURE: &str = "oculpm-mcp";

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct McpRegistrationStatus {
    /// `.mcp.json` 에 우리 서버가 등록되어 있다.
    pub registered: bool,
    /// 사이드카 바이너리를 찾았다 (없으면 등록 불가 — dev 는 `cargo build`).
    pub binary_found: bool,
    pub binary_path: Option<String>,
    pub mcp_json_path: String,
    /// Claude Desktop `claude_desktop_config.json` 에 붙여넣을 스니펫.
    pub desktop_snippet: String,
    /// 우리 것 아닌 MCP 서버 정의 수 (정보 표시용 — 건드리지 않음).
    pub foreign_servers: u32,
}

/// 실행 파일 옆의 `oculpm-mcp` — dev(`target/debug/`)와 번들(.app 의
/// `Contents/MacOS/`) 모두 메인 바이너리의 형제 경로다.
pub fn resolve_binary_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "oculpm-mcp.exe" } else { "oculpm-mcp" };
    let candidate = dir.join(name);
    candidate.is_file().then_some(candidate)
}

fn mcp_json_path(root: &Path) -> PathBuf {
    root.join(MCP_JSON_REL)
}

fn read_json_config(path: &Path) -> OculpmResult<Value> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = std::fs::read_to_string(path).map_err(|e| OculpmError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    if raw.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&raw).map_err(|e| OculpmError::JsonParse {
        path: path.to_path_buf(),
        source: e,
    })
}

fn write_json_config(path: &Path, value: &Value) -> OculpmResult<()> {
    let mut pretty = serde_json::to_string_pretty(value).map_err(OculpmError::JsonSerialize)?;
    pretty.push('\n');
    atomic_io::write_atomic(path, pretty.as_bytes())
}

fn read_mcp_json(root: &Path) -> OculpmResult<Value> {
    read_json_config(&mcp_json_path(root))
}

fn write_mcp_json(root: &Path, value: &Value) -> OculpmResult<()> {
    write_json_config(&mcp_json_path(root), value)
}

fn entry_is_ours(entry: &Value) -> bool {
    entry
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(BINARY_SIGNATURE))
}

fn server_entry(binary: &Path, root: &Path) -> Value {
    json!({
        "type": "stdio",
        "command": binary.to_string_lossy(),
        "args": ["--root", root.to_string_lossy()],
    })
}

/// Desktop 서버 키 — 프로젝트 폴더명을 붙여 여러 프로젝트가 한 설정 파일에
/// 공존하게 한다 (Desktop 설정은 머신 전역 1개).
pub fn desktop_server_key(root: &Path) -> String {
    let dir_name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    format!("oculpm-{dir_name}")
}

/// 원클릭이 실패하는 환경(권한 등)을 위한 수동 폴백 스니펫.
fn desktop_snippet(binary: Option<&Path>, root: &Path) -> String {
    let command = binary
        .map(|b| b.to_string_lossy().to_string())
        .unwrap_or_else(|| "<oculpm-mcp 바이너리 경로>".to_string());
    let snippet = json!({
        "mcpServers": {
            desktop_server_key(root): {
                "command": command,
                "args": ["--root", root.to_string_lossy()],
            }
        }
    });
    serde_json::to_string_pretty(&snippet).unwrap_or_default()
}

// ─── Claude Desktop (`claude_desktop_config.json`) ──────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DesktopRegistrationStatus {
    /// 설정 폴더가 존재한다 — Claude Desktop 설치 추정 근거.
    pub installed: bool,
    /// 이 프로젝트의 서버 엔트리가 등록되어 있다.
    pub registered: bool,
    pub config_path: String,
    /// 이 프로젝트가 쓰는 서버 키 (`oculpm-<폴더명>`).
    pub server_key: String,
    /// oculpm 아닌 서버 정의 수 (정보 표시용 — 건드리지 않음).
    pub foreign_servers: u32,
}

/// Claude Desktop 설정 파일 경로. `directories::BaseDirs::config_dir()` 가
/// macOS `~/Library/Application Support` / Windows Roaming AppData /
/// Linux `~/.config` 를 모두 맞게 준다.
pub fn desktop_config_path() -> Option<PathBuf> {
    directories::BaseDirs::new()
        .map(|b| b.config_dir().join("Claude").join("claude_desktop_config.json"))
}

/// 이 프로젝트의 엔트리인가 — 서명 바이너리 + `--root` 인자가 같은 루트.
fn entry_is_ours_for_root(entry: &Value, root: &Path) -> bool {
    let root_str = root.to_string_lossy();
    entry_is_ours(entry)
        && entry
            .get("args")
            .and_then(Value::as_array)
            .is_some_and(|args| args.iter().any(|a| a.as_str() == Some(root_str.as_ref())))
}

pub fn desktop_status_at(config_path: &Path, root: &Path) -> OculpmResult<DesktopRegistrationStatus> {
    let installed = config_path.parent().is_some_and(Path::exists);
    let value = read_json_config(config_path)?;
    let key = desktop_server_key(root);
    let mut registered = false;
    let mut foreign = 0u32;
    if let Some(servers) = value.get("mcpServers").and_then(Value::as_object) {
        for (k, entry) in servers {
            if *k == key || entry_is_ours_for_root(entry, root) {
                registered = true;
            } else if !entry_is_ours(entry) {
                foreign += 1;
            }
            // 남은 경우 = 다른 프로젝트의 oculpm 엔트리 — 우리도 남도 아님.
        }
    }
    Ok(DesktopRegistrationStatus {
        installed,
        registered,
        config_path: config_path.to_string_lossy().to_string(),
        server_key: key,
        foreign_servers: foreign,
    })
}

/// 등록 (멱등). 설정 폴더가 없으면(= Desktop 미설치 추정) 폴더를 만들지 않고
/// 에러 — 남의 앱 데이터 디렉터리를 우리가 창조하지 않는다.
pub fn desktop_register_at(
    config_path: &Path,
    root: &Path,
    binary: &Path,
) -> OculpmResult<DesktopRegistrationStatus> {
    if !config_path.parent().is_some_and(Path::exists) {
        return Err(OculpmError::InvalidConfig(
            "Claude Desktop 설정 폴더가 없습니다 — Claude Desktop 이 설치되어 있는지 확인하세요".into(),
        ));
    }
    let mut value = read_json_config(config_path)?;
    if !value.is_object() {
        return Err(OculpmError::InvalidConfig(
            "claude_desktop_config.json 최상위가 JSON 오브젝트가 아닙니다".into(),
        ));
    }
    let obj = value.as_object_mut().expect("checked is_object above");
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(servers) = servers.as_object_mut() else {
        return Err(OculpmError::InvalidConfig(
            "claude_desktop_config.json 의 \"mcpServers\" 가 오브젝트가 아닙니다".into(),
        ));
    };
    let key = desktop_server_key(root);
    // 폴더명이 바뀌어 키가 달라진 과거 엔트리(같은 루트)는 걷어낸다 — 멱등.
    servers.retain(|k, entry| *k == key || !entry_is_ours_for_root(entry, root));
    servers.insert(
        key,
        json!({
            "command": binary.to_string_lossy(),
            "args": ["--root", root.to_string_lossy()],
        }),
    );
    write_json_config(config_path, &value)?;
    desktop_status_at(config_path, root)
}

/// 해제 (멱등). 이 프로젝트의 키/루트 엔트리만 걷어낸다 — 다른 프로젝트의
/// oculpm 엔트리와 남의 서버는 보존.
pub fn desktop_unregister_at(
    config_path: &Path,
    root: &Path,
) -> OculpmResult<DesktopRegistrationStatus> {
    let mut value = read_json_config(config_path)?;
    if let Some(obj) = value.as_object_mut() {
        let key = desktop_server_key(root);
        if let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) {
            servers.retain(|k, entry| *k != key && !entry_is_ours_for_root(entry, root));
            if servers.is_empty() {
                obj.remove("mcpServers");
            }
        }
        if config_path.exists() {
            write_json_config(config_path, &value)?;
        }
    }
    desktop_status_at(config_path, root)
}

pub fn status_with_binary(root: &Path, binary: Option<&Path>) -> OculpmResult<McpRegistrationStatus> {
    let value = read_mcp_json(root)?;
    let servers = value.get("mcpServers").and_then(Value::as_object);
    let mut registered = false;
    let mut foreign = 0u32;
    if let Some(servers) = servers {
        for (key, entry) in servers {
            if key == SERVER_KEY || entry_is_ours(entry) {
                registered = true;
            } else {
                foreign += 1;
            }
        }
    }
    Ok(McpRegistrationStatus {
        registered,
        binary_found: binary.is_some(),
        binary_path: binary.map(|b| b.to_string_lossy().to_string()),
        mcp_json_path: mcp_json_path(root).to_string_lossy().to_string(),
        desktop_snippet: desktop_snippet(binary, root),
        foreign_servers: foreign,
    })
}

/// 등록 (멱등). 바이너리를 못 찾으면 에러 — 죽은 경로를 커밋 파일에 남기지
/// 않는다.
pub fn register_with_binary(root: &Path, binary: &Path) -> OculpmResult<McpRegistrationStatus> {
    let mut value = read_mcp_json(root)?;
    if !value.is_object() {
        return Err(OculpmError::InvalidConfig(
            ".mcp.json 최상위가 JSON 오브젝트가 아닙니다".into(),
        ));
    }
    let obj = value.as_object_mut().expect("checked is_object above");
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(servers) = servers.as_object_mut() else {
        return Err(OculpmError::InvalidConfig(
            ".mcp.json 의 \"mcpServers\" 가 오브젝트가 아닙니다".into(),
        ));
    };
    servers.insert(SERVER_KEY.to_string(), server_entry(binary, root));
    write_mcp_json(root, &value)?;
    status_with_binary(root, Some(binary))
}

/// 해제 (멱등). 우리 키/서명 엔트리만 걷어내고, 비면 정리한다.
pub fn unregister_with_binary(
    root: &Path,
    binary: Option<&Path>,
) -> OculpmResult<McpRegistrationStatus> {
    let mut value = read_mcp_json(root)?;
    if let Some(obj) = value.as_object_mut() {
        if let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) {
            servers.retain(|key, entry| key != SERVER_KEY && !entry_is_ours(entry));
            if servers.is_empty() {
                obj.remove("mcpServers");
            }
        }
        write_mcp_json(root, &value)?;
    }
    status_with_binary(root, binary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fake_binary(dir: &Path) -> PathBuf {
        let p = dir.join("oculpm-mcp");
        std::fs::write(&p, "#!/bin/sh\n").unwrap();
        p
    }

    #[test]
    fn register_status_unregister_roundtrip_preserves_foreign_servers() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let binary = fake_binary(root);
        std::fs::write(
            root.join(MCP_JSON_REL),
            r#"{ "mcpServers": { "notion": { "type": "http", "url": "https://mcp.notion.com/mcp" } }, "unknownKey": 1 }"#,
        )
        .unwrap();

        let st = register_with_binary(root, &binary).unwrap();
        assert!(st.registered && st.binary_found);
        assert_eq!(st.foreign_servers, 1);

        let v: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(MCP_JSON_REL)).unwrap())
                .unwrap();
        assert_eq!(v["unknownKey"], 1);
        assert_eq!(v["mcpServers"]["notion"]["type"], "http");
        assert_eq!(v["mcpServers"]["oculpm"]["type"], "stdio");
        assert_eq!(v["mcpServers"]["oculpm"]["args"][0], "--root");

        let st = unregister_with_binary(root, Some(&binary)).unwrap();
        assert!(!st.registered);
        let v: Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(MCP_JSON_REL)).unwrap())
                .unwrap();
        assert!(v["mcpServers"].get("oculpm").is_none());
        assert_eq!(v["mcpServers"]["notion"]["type"], "http", "남의 서버 보존");
    }

    #[test]
    fn broken_mcp_json_is_never_overwritten() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let binary = fake_binary(root);
        std::fs::write(root.join(MCP_JSON_REL), "{ broken !!").unwrap();
        assert!(status_with_binary(root, Some(&binary)).is_err());
        assert!(register_with_binary(root, &binary).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join(MCP_JSON_REL)).unwrap(),
            "{ broken !!"
        );
    }

    #[test]
    fn desktop_snippet_names_server_after_project_dir() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let st = status_with_binary(root, None).unwrap();
        assert!(!st.registered && !st.binary_found);
        assert!(st.desktop_snippet.contains("oculpm-"));
        assert!(st.desktop_snippet.contains("--root"));
    }
}
