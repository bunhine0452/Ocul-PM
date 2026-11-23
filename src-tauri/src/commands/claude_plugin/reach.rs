//! 플러그인이 앱을 찾는가 — 셔틀(`plugin/oculpm/bin/oculpm-mcp`)의 후보 목록과 **같은 표**.
//!
//! 셔틀은 정해진 자리에서만 `oculpm-mcp` 를 찾는다. dmg 마운트나 내려받기 폴더에서 앱을 바로 연 사람은
//! MCP 가 실패하고(`/mcp` 에만 보인다) 훅도 조용히 넘어간다. 앱은 그 자리들을 직접 볼 수 있으니 하나도
//! 없으면 설정이 말한다(11-23 #app-path-unreachable). 표가 셔틀과 갈라지면 테스트가 빨개진다
//! (`tests.rs` 가 셔틀의 `for cand in` 목록을 이 표의 첫 열과 줄마다 맞춘다).

use std::path::{Path, PathBuf};

/// 후보 경로가 어디서 시작하는가.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Base {
    /// `OCULPM_MCP_BIN` — 사람이 지정한 자리.
    Env,
    /// 절대 경로 그대로.
    Root,
    Home,
    /// `XDG_DATA_HOME`, 없으면 `~/.local/share`.
    DataHome,
    LocalAppData,
    ProgramFiles,
    ProgramW6432,
    /// 저장소 개발 빌드 — 설치본에는 없는 자리라 판정에 넣지 않는다.
    Dev,
}

/// 셔틀의 `for cand in` 목록, 줄마다 `(셔틀의 글자, 시작, 그 뒤 경로)`. 순서도 같다.
pub const SHUTTLE_CANDIDATES: &[(&str, Base, &str)] = &[
    ("\"${OCULPM_MCP_BIN:-}\"", Base::Env, ""),
    (
        "\"/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp\"",
        Base::Root,
        "Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
    ),
    (
        "\"$HOME/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp\"",
        Base::Home,
        "Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp",
    ),
    ("\"/usr/bin/oculpm-mcp\"", Base::Root, "usr/bin/oculpm-mcp"),
    (
        "\"${data_home:+$data_home/ocul-pm/bin/oculpm-mcp}\"",
        Base::DataHome,
        "ocul-pm/bin/oculpm-mcp",
    ),
    (
        "\"$HOME/.local/bin/oculpm-mcp\"",
        Base::Home,
        ".local/bin/oculpm-mcp",
    ),
    (
        "\"${LOCALAPPDATA:+$LOCALAPPDATA/Ocul-PM/oculpm-mcp.exe}\"",
        Base::LocalAppData,
        "Ocul-PM/oculpm-mcp.exe",
    ),
    (
        "\"${LOCALAPPDATA:+$LOCALAPPDATA/Programs/Ocul-PM/oculpm-mcp.exe}\"",
        Base::LocalAppData,
        "Programs/Ocul-PM/oculpm-mcp.exe",
    ),
    (
        "\"${program_files:+$program_files/Ocul-PM/oculpm-mcp.exe}\"",
        Base::ProgramFiles,
        "Ocul-PM/oculpm-mcp.exe",
    ),
    (
        "\"${program_w6432:+$program_w6432/Ocul-PM/oculpm-mcp.exe}\"",
        Base::ProgramW6432,
        "Ocul-PM/oculpm-mcp.exe",
    ),
    (
        "\"$plugin_root/../../src-tauri/target/debug/oculpm-mcp\"",
        Base::Dev,
        "",
    ),
    (
        "\"$plugin_root/../../src-tauri/target/release/oculpm-mcp\"",
        Base::Dev,
        "",
    ),
];

/// 표를 이 기기의 경로로 편다. `fs_root` 는 실제로는 `/` 다(테스트가 임시 폴더를 준다). 빈 환경변수는
/// 없는 것으로 본다 — 셔틀의 `:-` · `:+` 와 같다.
pub fn candidate_paths(
    env: &dyn Fn(&str) -> Option<String>,
    home: Option<&Path>,
    fs_root: &Path,
) -> Vec<PathBuf> {
    let var = |k: &str| env(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    let data_home = var("XDG_DATA_HOME").or_else(|| home.map(|h| h.join(".local/share")));
    SHUTTLE_CANDIDATES
        .iter()
        .filter_map(|(_, base, rel)| match base {
            Base::Env => var("OCULPM_MCP_BIN"),
            Base::Root => Some(fs_root.join(rel)),
            Base::Home => home.map(|h| h.join(rel)),
            Base::DataHome => data_home.as_ref().map(|d| d.join(rel)),
            Base::LocalAppData => var("LOCALAPPDATA").map(|d| d.join(rel)),
            Base::ProgramFiles => var("PROGRAMFILES")
                .or_else(|| var("ProgramFiles"))
                .map(|d| d.join(rel)),
            Base::ProgramW6432 => var("PROGRAMW6432")
                .or_else(|| var("ProgramW6432"))
                .map(|d| d.join(rel)),
            Base::Dev => None,
        })
        .collect()
}

/// 후보 중 하나라도 파일로 있으면 셔틀이 앱에 닿는다.
pub fn reaches_app(candidates: &[PathBuf]) -> bool {
    candidates.iter().any(|p| p.is_file())
}

/// 이 기기의 판정. 개발 빌드는 늘 닿는다고 본다 — 저장소에서 `--plugin-dir` 로 싣는 플러그인은
/// 표에 없는 개발 빌드 자리를 쓴다.
pub fn app_reachable() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    let home = crate::oculpm::paths::home_dir();
    reaches_app(&candidate_paths(
        &|k| std::env::var(k).ok(),
        home.as_deref(),
        Path::new("/"),
    ))
}
