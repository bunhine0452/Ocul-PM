//! PR-CI2 — MCP 서버 등록 커맨드 (docs/claude-integration/00-master-plan.md D3).
//!
//! 설정 → Agents 의 "MCP 서버" 블록이 부른다. 로직은 `oculpm::mcp::register`
//! 소유 — 여기는 루트 해석·바이너리 탐색·에러 문자열 변환만 (commands 는 얇게).
//! 다른 도구의 설정 위치(OS 별)는 `oculpm::paths` 한 곳이 안다.

use tauri::State;

use crate::db::Db;
use crate::oculpm::mcp::{
    codex::{self, CodexPluginStatus, CodexRegistrationStatus},
    register::{self, locate_binary, resolve_binary_path, McpRegistrationStatus},
};

fn codex_config_path() -> Result<std::path::PathBuf, String> {
    codex::config_path().ok_or_else(|| "Could not find the home directory".to_string())
}

async fn project_root(db: &Db, project_id: u32) -> Result<std::path::PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(project.root_path))
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_status(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    register::status_with_binary(&root, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_register(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = locate_binary()?;
    register::register_with_binary(&root, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_unregister(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<McpRegistrationStatus, String> {
    let root = project_root(&db, project_id).await?;
    let binary = resolve_binary_path();
    register::unregister_with_binary(&root, binary.as_deref()).map_err(|e| e.to_string())
}

/// Codex 는 Claude 의 프로젝트 `.mcp.json` 을 읽지 않는다. 이 명령들은
/// `~/.codex/config.toml` 의 oculpm stdio 항목 **하나**를 관리한다.
///
/// **머신 스코프다.** 그 파일은 모든 Codex 세션에 실리므로 프로젝트별 항목을
/// 만들면 안 된다 — 루트를 박은 항목이 다른 프로젝트의 기록까지 그리로 보낸다.
/// 대신 인자 없는 서버 하나를 두고, 루트는 세션의 작업 폴더(cwd)가 정한다.
#[tauri::command]
#[specta::specta]
pub fn codex_mcp_status() -> Result<CodexRegistrationStatus, String> {
    let binary = resolve_binary_path();
    codex::status_at(&codex_config_path()?, binary.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn codex_mcp_register() -> Result<CodexRegistrationStatus, String> {
    let binary = locate_binary()?;
    codex::register_at(&codex_config_path()?, &binary).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn codex_mcp_unregister() -> Result<CodexRegistrationStatus, String> {
    let binary = resolve_binary_path();
    codex::unregister_at(&codex_config_path()?, binary.as_deref()).map_err(|e| e.to_string())
}

/// Codex 플러그인 설치 상태 (머신 스코프, **읽기 전용**). 설치·해제는
/// `codex plugin` CLI 가 해야 마켓플레이스가 캐시까지 펼쳐진다 — 설정만
/// 흉내 내면 캐시 없는 반쪽 상태가 되므로 화면은 명령만 안내한다.
#[tauri::command]
#[specta::specta]
pub fn codex_plugin_status() -> Result<CodexPluginStatus, String> {
    let config = codex_config_path()?;
    let home = config
        .parent()
        .ok_or_else(|| "Could not find the Codex home directory".to_string())?;
    Ok(codex::plugin_status_at(&config, home))
}

// ─── A3 — Claude Code 플러그인 설치 감지 ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ClaudePluginStatus {
    pub installed: bool,
    /// 발견된 플러그인 디렉터리 (installed=true 일 때).
    pub path: Option<String>,
    /// `~/.claude/plugins/installed_plugins.json` 이 말하는, **이 프로젝트에 적용되는**
    /// 판. 프로젝트 스코프 설치가 있으면 그것, 없으면 사용자 스코프.
    pub installed_version: Option<String>,
    /// `project` | `user` — `installed_version` 의 출처.
    pub scope: Option<String>,
    /// 이 앱이 들고 있는 플러그인 판 (`plugin/oculpm/.claude-plugin/plugin.json`).
    pub bundled_version: String,
    /// 깔린 판이 앱의 판보다 낮다 — `/plugin update oculpm@oculpm` 을 안내할 때.
    pub behind: bool,
}

/// 앱이 들고 있는 플러그인 판 — 마켓플레이스가 미는 것과 같은 파일에서.
pub fn bundled_plugin_version() -> String {
    const MANIFEST: &str = include_str!("../../../plugin/oculpm/.claude-plugin/plugin.json");
    serde_json::from_str::<serde_json::Value>(MANIFEST)
        .ok()
        .and_then(|v| {
            v.get("version")
                .and_then(|s| s.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

/// `installed_plugins.json` 에서 이 프로젝트에 적용되는 oculpm 항목을 고른다 —
/// `(version, scope)`. 프로젝트 스코프(`projectPath` 가 루트이거나 루트의 조상)가
/// 사용자 스코프보다 먼저다 — Claude Code 가 그 순서로 겹친다.
///
/// 실측 2026-10-27: 프로젝트 15개가 2.29.0 ~ 3.13.2 로 제각각이었고, 프로젝트 스코프는
/// 스스로 올라가지 않는다. 그래서 「깔렸다」만으로는 모자라고 **몇 판인지**가 필요하다.
pub fn pick_plugin_entry(
    registry: &serde_json::Value,
    project_root: Option<&std::path::Path>,
) -> Option<(String, String)> {
    let entries = registry
        .get("plugins")?
        .as_object()?
        .iter()
        .find(|(k, _)| k.as_str() == "oculpm@oculpm" || k.starts_with("oculpm@"))?
        .1
        .as_array()?;
    let norm = |p: &str| p.trim_end_matches(['/', '\\']).to_string();
    let root = project_root.map(|r| norm(&r.to_string_lossy()));
    let version_of = |e: &serde_json::Value| {
        e.get("version")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    if let Some(root) = root.as_deref() {
        // 가장 깊은 조상이 이긴다 (하위 폴더 설치가 상위를 덮는다).
        let mut best: Option<(usize, String)> = None;
        for e in entries {
            let Some(pp) = e.get("projectPath").and_then(|v| v.as_str()) else {
                continue;
            };
            let pp = norm(pp);
            if root == pp
                || root.starts_with(&format!("{pp}/"))
                || root.starts_with(&format!("{pp}\\"))
            {
                if let Some(v) = version_of(e) {
                    if best.as_ref().is_none_or(|(len, _)| pp.len() > *len) {
                        best = Some((pp.len(), v));
                    }
                }
            }
        }
        if let Some((_, v)) = best {
            return Some((v, "project".to_string()));
        }
    }
    entries
        .iter()
        .filter(|e| {
            e.get("projectPath").is_none()
                || e.get("scope").and_then(|s| s.as_str()) == Some("user")
        })
        .find_map(|e| version_of(e).map(|v| (v, "user".to_string())))
}

/// `installed < bundled` — 숫자 세 자리 비교. 못 읽는 쪽이 있으면 false (안내하지 않는다).
pub fn version_behind(installed: &str, bundled: &str) -> bool {
    let parse = |s: &str| -> Option<Vec<u64>> {
        let v: Vec<u64> = s
            .trim()
            .trim_start_matches('v')
            .split('.')
            .map(|p| p.trim().parse::<u64>().ok())
            .collect::<Option<Vec<_>>>()?;
        (!v.is_empty()).then_some(v)
    };
    match (parse(installed), parse(bundled)) {
        (Some(a), Some(b)) => {
            let n = a.len().max(b.len());
            let at = |v: &Vec<u64>, i: usize| v.get(i).copied().unwrap_or(0);
            (0..n).any(|i| at(&a, i) != at(&b, i))
                && (0..n)
                    .find(|&i| at(&a, i) != at(&b, i))
                    .is_some_and(|i| at(&a, i) < at(&b, i))
        }
        _ => false,
    }
}

/// `~/.claude/plugins/**` 를 얕게 훑어 oculpm 플러그인 설치 여부를 본다.
/// 설치 레이아웃(마켓플레이스 캐시 구조)이 CLI 버전에 따라 다를 수 있어
/// "이름이 oculpm 인 `.claude-plugin/plugin.json`" 을 깊이 6·항목 2,000개
/// 상한으로 탐색한다 — 설정 화면의 택일 안내(훅·MCP 이중 등록 방지)용이라
/// 놓쳐도 무해(안내가 안 뜰 뿐), 오탐만 없으면 된다.
#[tauri::command]
#[specta::specta]
pub async fn claude_plugin_status(
    db: State<'_, Db>,
    project_id: Option<u32>,
) -> Result<ClaudePluginStatus, String> {
    let root = match project_id {
        Some(id) => Some(project_root(&db, id).await?),
        None => None,
    };
    Ok(claude_plugin_status_at(root.as_deref()))
}

/// 동기 본체 — 커맨드와 테스트가 같이 쓴다.
pub fn claude_plugin_status_at(project_root: Option<&std::path::Path>) -> ClaudePluginStatus {
    let bundled_version = bundled_plugin_version();
    let mut out = ClaudePluginStatus {
        installed: false,
        path: None,
        installed_version: None,
        scope: None,
        bundled_version,
        behind: false,
    };
    let Some(home) = crate::oculpm::paths::claude_code_home() else {
        return out;
    };
    let base = home.join("plugins");
    if !base.is_dir() {
        return out;
    }
    let mut budget = 2_000usize;
    if let Some(dir) = find_oculpm_plugin(&base, 6, &mut budget) {
        out.installed = true;
        out.path = Some(dir.display().to_string());
    }
    // 판은 레지스트리에서 — 캐시 폴더 이름은 판마다 하나씩 남아 「어느 것이 적용되나」를
    // 말하지 않는다.
    if let Ok(text) = std::fs::read_to_string(base.join("installed_plugins.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some((ver, scope)) = pick_plugin_entry(&v, project_root) {
                out.behind = version_behind(&ver, &out.bundled_version);
                out.installed = true;
                out.installed_version = Some(ver);
                out.scope = Some(scope);
            }
        }
    }
    out
}

fn find_oculpm_plugin(
    dir: &std::path::Path,
    depth: u8,
    budget: &mut usize,
) -> Option<std::path::PathBuf> {
    if depth == 0 || *budget == 0 {
        return None;
    }
    let manifest = dir.join(".claude-plugin").join("plugin.json");
    if manifest.is_file() {
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v.get("name").and_then(|n| n.as_str()) == Some("oculpm") {
                    return Some(dir.to_path_buf());
                }
            }
        }
        // 다른 플러그인의 루트 — 그 아래로 더 내려갈 이유가 없다.
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir() && !t.is_symlink())
            .unwrap_or(false);
        if is_dir {
            if let Some(hit) = find_oculpm_plugin(&path, depth - 1, budget) {
                return Some(hit);
            }
        }
    }
    None
}

#[cfg(test)]
mod plugin_drift_tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn registry() -> serde_json::Value {
        json!({"version": 2, "plugins": {"oculpm@oculpm": [
            {"scope": "project", "projectPath": "/u/me/Desktop/git/ai-pm", "version": "3.3.0"},
            {"scope": "project", "projectPath": "/u/me/Desktop/1dev/board", "version": "3.13.0"},
            {"scope": "project", "projectPath": "/u/me/Desktop/1dev/board/packages/core", "version": "3.13.2"},
            {"scope": "user", "version": "3.6.0"}
        ]}})
    }

    #[test]
    fn project_scope_wins_and_the_deepest_ancestor_wins() {
        let r = registry();
        assert_eq!(
            pick_plugin_entry(&r, Some(Path::new("/u/me/Desktop/git/ai-pm"))),
            Some(("3.3.0".into(), "project".into()))
        );
        assert_eq!(
            pick_plugin_entry(
                &r,
                Some(Path::new("/u/me/Desktop/1dev/board/packages/core/src"))
            ),
            Some(("3.13.2".into(), "project".into()))
        );
        assert_eq!(
            pick_plugin_entry(&r, Some(Path::new("/u/me/Desktop/1dev/board/other"))),
            Some(("3.13.0".into(), "project".into()))
        );
        // 어느 프로젝트 스코프에도 안 걸리면 사용자 스코프.
        assert_eq!(
            pick_plugin_entry(&r, Some(Path::new("/u/me/elsewhere"))),
            Some(("3.6.0".into(), "user".into()))
        );
        assert_eq!(
            pick_plugin_entry(&r, None),
            Some(("3.6.0".into(), "user".into()))
        );
        assert_eq!(pick_plugin_entry(&json!({"plugins": {}}), None), None);
    }

    #[test]
    fn behind_is_a_numeric_compare_that_never_nags_on_junk() {
        assert!(version_behind("3.3.0", "3.14.0"));
        assert!(version_behind("2.31.0", "3.0.0"));
        assert!(!version_behind("3.14.0", "3.14.0"));
        assert!(!version_behind("3.15.0", "3.14.0"));
        assert!(!version_behind("0120fb83", "3.14.0"));
        assert!(version_behind("v3.13", "3.13.2"));
    }

    #[test]
    fn the_bundled_version_is_the_plugin_manifest() {
        let v = bundled_plugin_version();
        assert!(v.split('.').count() == 3, "{v}");
    }
}
