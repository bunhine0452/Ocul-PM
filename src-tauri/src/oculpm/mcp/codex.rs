//! Codex MCP 등록 (`~/.codex/config.toml`). Claude 설정과 독립적으로
//! 프로젝트별 stdio 서버만 보존적으로 관리한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use toml_edit::{value, Document, Item, Table};

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};
use crate::oculpm::mcp::register::BINARY_SIGNATURE;

/// Codex 설정 파일. `CODEX_HOME`을 존중해 별도 프로필을 쓰는 사용자도 같은
/// 설정을 보며, 없으면 Codex의 기본 위치를 사용한다.
pub fn config_path() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|b| b.home_dir().join(".codex")))
        .map(|dir| dir.join("config.toml"))
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodexRegistrationStatus {
    /// Codex 설정 폴더가 존재한다. 없으면 설치/첫 실행 전으로 취급한다.
    pub installed: bool,
    /// 이 프로젝트 루트를 가리키는 oculpm stdio 서버가 등록돼 있다.
    pub registered: bool,
    pub binary_found: bool,
    pub binary_path: Option<String>,
    pub config_path: String,
    /// 우리가 쓰는 `mcp_servers` 키 — 항상 하나다 (`oculpm`).
    pub server_key: String,
    /// 이 항목이 프로젝트를 **박아 두고 있다** (`--root <경로>`). v2.39.0 이 쓴
    /// 항목이 여기 걸린다 — 그대로 두면 다른 프로젝트의 기록이 이 경로로 간다.
    pub pinned_root: Option<String>,
    /// oculpm이 소유하지 않는 Codex MCP 서버 수 (정보 표시용).
    pub foreign_servers: u32,
}

fn read_config(path: &Path) -> OculpmResult<Document> {
    if !path.exists() {
        return Ok(Document::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| OculpmError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    if raw.trim().is_empty() {
        return Ok(Document::new());
    }
    raw.parse::<Document>()
        .map_err(|e| OculpmError::InvalidConfig(format!("Could not parse Codex config.toml: {e}")))
}

fn write_config(path: &Path, document: &Document) -> OculpmResult<()> {
    atomic_io::write_atomic(path, document.to_string().as_bytes())
}

/// `~/.codex/config.toml` 은 **머신 전역**이다. 프로젝트마다 항목을 만들면 그
/// 항목이 **모든** Codex 세션에 실리고, 그중 하나가 `--root` 로 프로젝트를 박아
/// 두면 다른 프로젝트에서 부른 기록이 박힌 프로젝트로 간다 — v2.39.0 에서 실제로
/// 그랬다(유튜브 프로젝트의 Codex 가 이 저장소에 일지를 썼다).
///
/// 그래서 키는 **하나**이고, `--root` 도 싣지 않는다. Codex 는 MCP 서버를 **그
/// 세션의 작업 폴더에서** 띄우므로(pid 71440 실측: cwd = 세션 워크스페이스),
/// 인자 없는 서버가 곧 「지금 열려 있는 프로젝트」다 — 서버 바이너리가
/// `--root` → `OCULPM_ROOT` → cwd 순으로 루트를 정하기 때문이다. Claude 의
/// 프로젝트별 `.mcp.json` 이 `${CLAUDE_PROJECT_DIR}` 로 하는 일을, 전역 설정
/// 에서는 cwd 가 대신한다.
pub const SERVER_KEY: &str = "oculpm";

fn entry_is_ours(entry: &Item) -> bool {
    entry
        .as_table_like()
        .and_then(|table| table.get("command"))
        .and_then(Item::as_value)
        .and_then(toml_edit::Value::as_str)
        .is_some_and(|command| command.contains(BINARY_SIGNATURE))
}

/// 이 항목이 박아 둔 루트 (`args = ["--root", "<경로>"]`). v2.39.0 이 쓴 항목과
/// 손으로 적은 항목이 여기 걸린다 — 화면이 「다시 등록하세요」라고 말할 근거다.
fn pinned_root_of(entry: &Item) -> Option<String> {
    let args = entry
        .as_table_like()?
        .get("args")?
        .as_value()?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let at = args.iter().position(|a| a == "--root")?;
    args.get(at + 1).cloned()
}

fn server_entry(binary: &Path) -> Item {
    let mut table = Table::new();
    table["command"] = value(binary.to_string_lossy().as_ref());
    Item::Table(table)
}

pub fn status_at(
    config_path: &Path,
    binary: Option<&Path>,
) -> OculpmResult<CodexRegistrationStatus> {
    let installed = config_path.parent().is_some_and(Path::exists);
    let document = read_config(config_path)?;
    let mut registered = false;
    let mut pinned_root = None;
    let mut foreign_servers = 0;
    if let Some(servers) = document.get("mcp_servers").and_then(Item::as_table_like) {
        for (_, entry) in servers.iter() {
            if !entry_is_ours(entry) {
                foreign_servers += 1;
                continue;
            }
            registered = true;
            if pinned_root.is_none() {
                pinned_root = pinned_root_of(entry);
            }
        }
    }
    Ok(CodexRegistrationStatus {
        installed,
        registered,
        binary_found: binary.is_some(),
        binary_path: binary.map(|path| path.to_string_lossy().to_string()),
        config_path: config_path.to_string_lossy().to_string(),
        server_key: SERVER_KEY.to_string(),
        pinned_root,
        foreign_servers,
    })
}

/// 등록은 우리 항목 하나로 수렴시킨다 — 옛 이름·옛 `--root` 항목은 걷어내고
/// `[mcp_servers.oculpm]` 만 남긴다. 손으로 쓴 주석과 남의 서버는 toml_edit 가
/// 그대로 보존한다.
pub fn register_at(config_path: &Path, binary: &Path) -> OculpmResult<CodexRegistrationStatus> {
    if !config_path.parent().is_some_and(Path::exists) {
        return Err(OculpmError::InvalidConfig(
            "No Codex config folder - check that Codex has been installed and opened".into(),
        ));
    }
    let mut document = read_config(config_path)?;
    if document.get("mcp_servers").is_none() {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    let servers = document["mcp_servers"].as_table_like_mut().ok_or_else(|| {
        OculpmError::InvalidConfig("\"mcp_servers\" in Codex config.toml is not a table".into())
    })?;
    let stale: Vec<String> = servers
        .iter()
        .filter(|&(key, entry)| key != SERVER_KEY && entry_is_ours(entry))
        .map(|(key, _)| key.to_string())
        .collect();
    for key in stale {
        servers.remove(&key);
    }
    servers.insert(SERVER_KEY, server_entry(binary));
    write_config(config_path, &document)?;
    status_at(config_path, Some(binary))
}

/// 해제는 우리 서버만 (어느 키에 있든) 제거한다. Claude 의 `.mcp.json` 과 다른
/// Codex 서버는 절대 건드리지 않는다.
pub fn unregister_at(
    config_path: &Path,
    binary: Option<&Path>,
) -> OculpmResult<CodexRegistrationStatus> {
    let mut document = read_config(config_path)?;
    if let Some(servers) = document
        .get_mut("mcp_servers")
        .and_then(Item::as_table_like_mut)
    {
        let ours: Vec<String> = servers
            .iter()
            .filter(|&(_, entry)| entry_is_ours(entry))
            .map(|(key, _)| key.to_string())
            .collect();
        for key in ours {
            servers.remove(&key);
        }
    }
    if config_path.exists() {
        write_config(config_path, &document)?;
    }
    status_at(config_path, binary)
}

// ─── Codex 플러그인 (`codex plugin add oculpm-codex@oculpm`) ────────────────
//
// MCP 등록과 달리 플러그인은 우리가 대신 깔지 않는다 — `codex plugin` CLI 가
// 마켓플레이스를 받아 캐시에 펼치는 일까지 하기 때문에, 설정을 흉내 내 쓰면
// 캐시 없는 반쪽 상태가 된다. 여기서는 **읽기만** 하고 화면이 명령을 안내한다
// (Claude 플러그인 블록과 같은 규약).

/// 마켓플레이스 항목 키는 `<플러그인 이름>@<마켓플레이스 이름>` 이다.
pub const PLUGIN_NAME: &str = "oculpm-codex";

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodexPluginStatus {
    /// Codex 설정 폴더가 있다 (설치/첫 실행 추정 근거).
    pub codex_installed: bool,
    /// `[plugins."oculpm-codex@<마켓플레이스>"]` 가 있고 켜져 있다.
    pub enabled: bool,
    /// 그 항목이 붙어 있는 마켓플레이스 이름.
    pub marketplace: Option<String>,
    /// 그 마켓플레이스가 `[marketplaces.*]` 에 실제로 설정돼 있다.
    ///
    /// **false 인데 항목이 있으면 고아다** — Codex 의 첫 실행 임포트가 Claude
    /// 의 활성 플러그인 목록을 옮겨 오면서 마켓플레이스는 가져오지 않으면 이
    /// 상태가 된다 (2026-09-03 에 실제로 겪었다: `oculpm@oculpm` 이 그랬다).
    pub marketplace_configured: bool,
    /// 캐시에 펼쳐진 버전 — 여기까지 있어야 실제로 로드된다.
    pub cached_version: Option<String>,
    pub config_path: String,
}

/// `config.toml` 을 읽어 플러그인 설치 상태를 본다. 파싱 실패는 "없음"으로
/// 접는다 — 이 블록은 안내용이라 오탐만 없으면 된다.
pub fn plugin_status_at(config_path: &Path, codex_home: &Path) -> CodexPluginStatus {
    let mut status = CodexPluginStatus {
        codex_installed: codex_home.is_dir(),
        enabled: false,
        marketplace: None,
        marketplace_configured: false,
        cached_version: None,
        config_path: config_path.to_string_lossy().to_string(),
    };

    let Ok(raw) = std::fs::read_to_string(config_path) else {
        return status;
    };
    let Ok(doc) = raw.parse::<toml::Value>() else {
        return status;
    };

    let prefix = format!("{PLUGIN_NAME}@");
    let entry = doc
        .get("plugins")
        .and_then(toml::Value::as_table)
        .and_then(|plugins| {
            plugins
                .iter()
                .find(|(key, _)| key.starts_with(&prefix))
                .map(|(key, value)| (key[prefix.len()..].to_string(), value))
        });
    let Some((marketplace, entry)) = entry else {
        return status;
    };

    // `enabled` 가 없으면 켜진 것으로 본다 — Codex 가 적어 주는 기본값이다.
    status.enabled = entry
        .get("enabled")
        .and_then(toml::Value::as_bool)
        .unwrap_or(true);
    status.marketplace_configured = doc
        .get("marketplaces")
        .and_then(toml::Value::as_table)
        .is_some_and(|m| m.contains_key(&marketplace));
    status.cached_version = newest_cached_version(codex_home, &marketplace);
    status.marketplace = Some(marketplace);
    status
}

/// `<codex_home>/plugins/cache/<마켓플레이스>/<플러그인>/<버전>/` 중 하나.
/// 여러 버전이 남아 있으면 이름순 마지막(대개 최신)을 고른다.
fn newest_cached_version(codex_home: &Path, marketplace: &str) -> Option<String> {
    let dir = codex_home
        .join("plugins")
        .join("cache")
        .join(marketplace)
        .join(PLUGIN_NAME);
    let mut versions: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    versions.sort();
    versions.pop()
}
