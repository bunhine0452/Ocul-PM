//! Claude Code 플러그인이 **이 프로젝트에** 붙었는가 (설정 · 오늘의 첫 걸음 · 계획 빈 화면이 함께 읽는다).
//!
//! **읽기만 한다.** 설치 · 켜기 · 올리기는 사람이 터미널에 붙여 넣는 명령이 한다 — 플러그인은 CLI 가
//! 마켓플레이스를 받아 캐시까지 펼쳐야 완성되므로 설정 파일만 흉내 내면 반쪽 상태가 된다.
//!
//! 11-23 (#plugin-detect-false-positive): 예전엔 `~/.claude/plugins/**` 에 이름이 oculpm 인
//! `plugin.json` 이 하나라도 있으면 「깔렸다」 였다. `marketplace add` 만 해도 마켓 클론 안에 그 파일이
//! 생기고, 다른 프로젝트에만 깔았어도 캐시에 남아, 훅도 MCP 도 오지 않는 프로젝트에 「연결됨」 이 떴다.
//! 이제 연결됨은 **이 프로젝트에 적용되는 설치 기록이 있고 꺼져 있지 않을 때만**이고, 그 밖은 저마다
//! 다른 상태와 다음 명령 한 줄을 갖는다.
//!
//! (예전엔 `commands/mcp.rs` 끝에 있었다 — MCP 등록과 상관없는 판정이라 따로 둔다.)

mod reach;
mod registry;
#[cfg(test)]
mod tests;

use std::path::Path;

use tauri::State;

use crate::db::Db;

use registry::version_behind;

/// 이 프로젝트에서 플러그인이 어떤 상태인가 — 상태마다 다음 할 일(붙여 넣을 명령)이 다르다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ClaudePluginState {
    /// 이 프로젝트에 적용되는 설치가 있고 꺼져 있지 않다.
    Connected,
    /// 깔려 있지만 `enabledPlugins` 에서 꺼 두었다.
    Disabled,
    /// 다른 프로젝트에만 깔렸다 (프로젝트 · 로컬 스코프).
    OtherProject,
    /// 마켓플레이스만 더했고 설치는 아직이다.
    MarketplaceOnly,
    NotInstalled,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ClaudePluginStatus {
    pub state: ClaudePluginState,
    /// 이 프로젝트에 적용되는 설치 기록이 있다 (켜졌든 꺼졌든 — 켜짐까지는 `state`).
    pub installed: bool,
    /// 디스크에서 찾은 oculpm 플러그인 폴더(캐시 · 마켓 클론). 설치 여부를 말하지 않는다.
    pub path: Option<String>,
    /// `installed_plugins.json` 이 말하는, **이 프로젝트에 적용되는** 판.
    pub installed_version: Option<String>,
    /// `project` | `local` | `user` — `installed_version` 의 출처.
    pub scope: Option<String>,
    /// 이 앱이 들고 있는 플러그인 판 (`plugin/oculpm/.claude-plugin/plugin.json`).
    pub bundled_version: String,
    /// 깔린 판이 앱의 판보다 낮다 — 플러그인을 올릴 때.
    pub behind: bool,
    /// 깔린 판이 앱의 판보다 높다 — 앱을 올릴 때. 새 스킬 · 훅이 옛 앱의 MCP 를 부르고, 옛 MCP 는
    /// 모르는 인자를 조용히 버린다 (#plugin-ahead-of-app).
    pub ahead: bool,
    /// 다른 프로젝트에 깔린 판 중 앱보다 낮은 것의 수. 프로젝트 스코프는 스스로 올라가지 않는다.
    pub other_behind: u32,
    /// 플러그인 셔틀이 찾는 자리 중 하나에 앱의 `oculpm-mcp` 가 있다. 없으면 플러그인이 깔려도 MCP ·
    /// 훅이 앱에 닿지 않는다 (응용 프로그램 폴더 밖에서 연 앱).
    pub app_reachable: bool,
}

/// 앱이 들고 있는 플러그인 판 — 마켓플레이스가 미는 것과 같은 파일에서.
pub fn bundled_plugin_version() -> String {
    const MANIFEST: &str = include_str!("../../../../plugin/oculpm/.claude-plugin/plugin.json");
    serde_json::from_str::<serde_json::Value>(MANIFEST)
        .ok()
        .and_then(|v| {
            v.get("version")
                .and_then(|s| s.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

/// 이 프로젝트에서 Claude Code 플러그인의 상태 (**읽기 전용**) — 연결됨은 이 프로젝트에 적용되는 켜진
/// 설치가 있을 때만. `project_id` 가 없으면(시작 창) 사용자 스코프만 본다.
#[tauri::command]
#[specta::specta]
pub async fn claude_plugin_status(
    db: State<'_, Db>,
    project_id: Option<u32>,
) -> Result<ClaudePluginStatus, String> {
    let root = match project_id {
        Some(id) => Some(std::path::PathBuf::from(
            db.get_project(id)
                .await
                .map_err(|e| e.to_string())?
                .root_path,
        )),
        None => None,
    };
    super::blocking(move || Ok(claude_plugin_status_at(root.as_deref()))).await
}

/// 이 기기의 판정 — 커맨드가 쓴다.
pub fn claude_plugin_status_at(project_root: Option<&Path>) -> ClaudePluginStatus {
    status_in(
        crate::oculpm::paths::claude_code_home().as_deref(),
        project_root,
        bundled_plugin_version(),
        reach::app_reachable(),
    )
}

/// 판정 본체 — Claude 홈(`~/.claude`)을 받는 순수 함수라 테스트가 임시 폴더로 문다.
pub fn status_in(
    claude_home: Option<&Path>,
    project_root: Option<&Path>,
    bundled_version: String,
    app_reachable: bool,
) -> ClaudePluginStatus {
    let mut out = ClaudePluginStatus {
        state: ClaudePluginState::NotInstalled,
        installed: false,
        path: None,
        installed_version: None,
        scope: None,
        bundled_version,
        behind: false,
        ahead: false,
        other_behind: 0,
        app_reachable,
    };
    let Some(home) = claude_home else {
        return out;
    };
    let base = home.join("plugins");
    let read_json = |name: &str| {
        std::fs::read_to_string(base.join(name))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .unwrap_or(serde_json::Value::Null)
    };

    let mut budget = 2_000usize;
    if base.is_dir() {
        out.path = find_oculpm_plugin(&base, 6, &mut budget).map(|d| d.display().to_string());
    }
    let known = read_json("known_marketplaces.json");
    let marketplace = out.path.is_some() || known.get("oculpm").is_some();

    let registry = read_json("installed_plugins.json");
    let entries = registry::oculpm_entries(&registry);
    let picked = registry::pick(&entries, project_root);
    out.other_behind = registry::others_behind(
        &entries,
        picked.as_ref().map(|p| p.index),
        &out.bundled_version,
    );

    let Some(p) = picked else {
        out.state = if !entries.is_empty() {
            ClaudePluginState::OtherProject
        } else if marketplace {
            ClaudePluginState::MarketplaceOnly
        } else {
            ClaudePluginState::NotInstalled
        };
        return out;
    };
    out.installed = true;
    out.behind = version_behind(&p.version, &out.bundled_version);
    out.ahead = version_behind(&out.bundled_version, &p.version);
    // 켜고 끈 값은 이 프로젝트 폴더와, 설치가 걸린 조상 폴더(있으면)의 `.claude/` 에서 읽는다.
    let installed_at = p.project_path.as_deref().map(Path::new);
    let dirs: Vec<&Path> = project_root
        .into_iter()
        .chain(installed_at.filter(|d| Some(*d) != project_root))
        .collect();
    out.state = if registry::disabled(home, &dirs) {
        ClaudePluginState::Disabled
    } else {
        ClaudePluginState::Connected
    };
    out.installed_version = Some(p.version);
    out.scope = Some(p.scope);
    out
}

/// `~/.claude/plugins/**` 를 얕게 훑어 oculpm 플러그인 폴더를 찾는다(깊이 6 · 항목 2,000개 상한).
/// 캐시든 마켓 클론이든 이름이 oculpm 인 `.claude-plugin/plugin.json` 이면 된다. **설치를 말하지
/// 않는다** — 「마켓플레이스만 더함」 을 가르는 데와 경로를 보이는 데만 쓴다.
fn find_oculpm_plugin(dir: &Path, depth: u8, budget: &mut usize) -> Option<std::path::PathBuf> {
    if depth == 0 || *budget == 0 {
        return None;
    }
    let manifest = dir.join(".claude-plugin").join("plugin.json");
    if manifest.is_file() {
        let text = std::fs::read_to_string(&manifest).ok()?;
        let v = serde_json::from_str::<serde_json::Value>(&text).ok()?;
        // 다른 플러그인의 루트면 그 아래로 더 내려갈 이유가 없다.
        return (v.get("name").and_then(|n| n.as_str()) == Some("oculpm"))
            .then(|| dir.to_path_buf());
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        let is_dir = entry
            .file_type()
            .map(|t| t.is_dir() && !t.is_symlink())
            .unwrap_or(false);
        if is_dir {
            if let Some(hit) = find_oculpm_plugin(&entry.path(), depth - 1, budget) {
                return Some(hit);
            }
        }
    }
    None
}
