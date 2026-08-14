//! PR-ACP1 — ACP 어댑터 조달 (docs/acp-panel/00-master-plan.md D2).
//!
//! 어댑터는 npm 패키지다. `npx` 를 매 실행마다 태우면 네트워크·지연이 붙고
//! 오프라인에서 앱이 죽으므로, **앱 데이터 디렉터리에 버전을 고정해 1회 설치**하고
//! 그 경로를 직접 실행한다. 업데이트는 사용자가 누르는 명시적 액션이다.
//!
//! 버전을 고정하는 이유는 리스크 R2 — 어댑터는 2주에 6회 배포되는 0.x 다.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// npm 패키지 이름 (scope 와 이름을 나눠 두는 건 경로 join 때문 — 슬래시를
/// 그대로 join 하면 Windows 에서 깨진다).
pub const PKG_SCOPE: &str = "@agentclientprotocol";
pub const PKG_NAME: &str = "claude-agent-acp";

/// 고정 버전. 올릴 때는 스파이크(docs/acp-panel/spike/acp_spike.py)를 다시 돌려
/// `session/update` 종류가 늘거나 바뀌지 않았는지 확인한다.
pub const PINNED_VERSION: &str = "0.67.0";

/// 앱 데이터 디렉터리 하위 설치 경로.
const INSTALL_SUBDIR: &str = "acp";

/// npm 설치는 네트워크에 달려 있다 — 무한 대기 대신 실패로 끊는다.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

pub fn install_dir(app_data: &Path) -> PathBuf {
    app_data.join(INSTALL_SUBDIR)
}

fn package_dir(app_data: &Path) -> PathBuf {
    install_dir(app_data)
        .join("node_modules")
        .join(PKG_SCOPE)
        .join(PKG_NAME)
}

/// 어댑터 진입점(node 로 실행할 JS). 존재 여부는 확인하지 않는다.
pub fn entry_path(app_data: &Path) -> PathBuf {
    package_dir(app_data).join("dist").join("index.js")
}

/// 어댑터가 **함께 들고 오는** Claude Code CLI.
///
/// 이걸 안 보고 있었다. `claude` 는 시스템에 따로 깔아야 하는 줄 알고 PATH 만
/// 뒤졌는데, 실은 `@anthropic-ai/claude-agent-sdk` 의 플랫폼별 선택적 의존성으로
/// **네이티브 바이너리가 딸려 온다**. 즉 어댑터를 깔면 Claude Code 도 함께 깔린다 —
/// 사용자가 따로 설치할 것은 Node 뿐이다.
///
/// (어댑터도 `CLAUDE_CODE_EXECUTABLE` → 이 경로 순으로 찾는다. 우리가 여기서
/// 같은 경로를 계산하는 것은 **진단을 정직하게** 하기 위해서다.)
pub fn bundled_claude(app_data: &Path) -> Option<PathBuf> {
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let path = install_dir(app_data)
        .join("node_modules")
        .join("@anthropic-ai")
        .join(format!(
            "claude-agent-sdk-{}-{arch}",
            std::env::consts::OS
        ))
        .join(format!("claude{ext}"));
    path.is_file().then_some(path)
}

/// 설치된 버전. 미설치·손상은 `None`.
pub fn installed_version(app_data: &Path) -> Option<String> {
    if !entry_path(app_data).is_file() {
        return None;
    }
    let manifest = package_dir(app_data).join("package.json");
    let raw = std::fs::read_to_string(manifest).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("version")?
        .as_str()
        .map(std::string::ToString::to_string)
}

/// 고정 버전을 설치한다(멱등 — 이미 맞으면 npm 이 알아서 no-op).
pub async fn install(app_data: &Path, npm: &Path, path_env: &str) -> Result<String, String> {
    let dir = install_dir(app_data);
    std::fs::create_dir_all(&dir).map_err(|e| format!("설치 폴더를 만들 수 없습니다: {e}"))?;

    let spec = format!("{PKG_SCOPE}/{PKG_NAME}@{PINNED_VERSION}");
    let spawned = tokio::process::Command::new(npm)
        .args(["install", "--no-audit", "--no-fund", "--prefix"])
        .arg(&dir)
        .arg(&spec)
        // npm 은 내부적으로 node 를 다시 찾는다 — 우리가 해석한 PATH 를 물려준다.
        .env("PATH", path_env)
        .kill_on_drop(true)
        .output();

    let out = match tokio::time::timeout(INSTALL_TIMEOUT, spawned).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(format!("npm 실행 실패: {e}")),
        Err(_) => return Err("npm 설치가 5분을 넘겨 중단했습니다".to_string()),
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("npm 설치 실패: {}", tail(&stderr)));
    }

    installed_version(app_data)
        .ok_or_else(|| "설치는 끝났지만 어댑터 진입점을 찾을 수 없습니다".to_string())
}

/// 에러 메시지는 npm 의 장문 로그 끝부분만 — 토스트에 통째로 쏟지 않는다.
fn tail(text: &str) -> String {
    const MAX: usize = 400;
    let trimmed = text.trim();
    if trimmed.len() <= MAX {
        return trimmed.to_string();
    }
    let start = trimmed.len() - MAX;
    // char 경계로 맞춘다 (npm 로그엔 이모지가 섞인다).
    let start = trimmed
        .char_indices()
        .map(|(i, _)| i)
        .find(|&i| i >= start)
        .unwrap_or(0);
    format!("…{}", &trimmed[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_path_nests_scope_and_name_separately() {
        let entry = entry_path(Path::new("/data"));
        assert!(entry.ends_with("acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"));
    }

    #[test]
    fn installed_version_is_none_without_entry() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(installed_version(dir.path()), None);
    }

    /// package.json 만 있고 dist/index.js 가 없으면 "설치됨"으로 봐선 안 된다 —
    /// 반쯤 지워진 node_modules 로 프로세스를 띄우면 진단이 거짓말을 한다.
    #[test]
    fn installed_version_requires_the_entry_file() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir
            .path()
            .join("acp/node_modules")
            .join(PKG_SCOPE)
            .join(PKG_NAME);
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("package.json"), r#"{"version":"0.67.0"}"#).unwrap();
        assert_eq!(installed_version(dir.path()), None);

        std::fs::create_dir_all(pkg.join("dist")).unwrap();
        std::fs::write(pkg.join("dist/index.js"), "").unwrap();
        assert_eq!(installed_version(dir.path()), Some("0.67.0".to_string()));
    }

    #[test]
    fn tail_truncates_on_char_boundaries() {
        let noisy = format!("{}실패했습니다 ✖", "x".repeat(500));
        let cut = tail(&noisy);
        assert!(cut.starts_with('…'));
        assert!(cut.ends_with('✖'));
    }
}
