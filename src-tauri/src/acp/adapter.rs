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
pub const CODEX_PKG_NAME: &str = "codex-acp";

/// 고정 버전. 올릴 때는 스파이크(docs/acp-panel/spike/acp_spike.py)를 다시 돌려
/// `session/update` 종류가 늘거나 바뀌지 않았는지 확인한다.
///
/// 0.73.0 → 0.75.1 (2026-09-06): `session/update` 종류는 **그대로 15종**이고
/// `_meta._claude/*` 자리(`rateLimit`·`origin`·`sdkMessage`·
/// `askUserQuestionOption`)도 불변이다. `subagent_*`·`async_task_*` 는 여전히
/// **우리가 광고하지 않은 capability 뒤**에 있어 오지 않는다 (그 이유는
/// `super::process` 의 `air` 광고 주석에). 번들 Claude Code
/// (`claude-agent-sdk`)도 `0.3.257` 그대로 — 이번엔 어댑터만 움직였다.
///
/// 다만 **`/usage` 의 답이 통째로 바뀌었다.** 어댑터가 CLI 의 평문 출력을
/// 가로채 SDK 의 구조화 응답을 **마크다운**으로 다시 그린다
/// (`dist/usage-markdown.js`). 우리 계기는 그 평문을 읽고 있었으므로
/// `session::parse_usage_report` / `parse_usage_detail` 에 마크다운 갈래를
/// 더했다 — 구조화 조회가 실패하면 어댑터가 **원래 평문을 그대로 흘려보내므로**
/// 옛 갈래도 남겨 둔다.
///
/// 나머지 새것은 우리 쪽 변경이 필요 없다:
/// - `_auth/status_update`(연결 단위 로그인 신원 push) — 우리가 모르는 알림은
///   크레이트가 조용히 버린다(`Ignoring unhandled notification`).
/// - 컨텍스트 압축이 `tool_call`("Compact conversation", kind=think)로 온다.
///   평범한 도구 호출이라 이미 그려진다. 곁들인 `_meta.contextCompaction` 은
///   아직 안 읽는다.
/// - `sessionFailure` 에 `reason` 이 붙었다 — `--hide-claude-auth` 전용이고
///   우리는 그 플래그를 넘기지 않는다. `failure_of` 는 모르는 키를 무시한다.
///
/// 0.75.1 → 0.76.0 (2026-09-11): 두 tarball 의 `dist/` 를 대조했다. 바뀐 것은
/// `acp-agent`·`air-extension`·`clear-context-coordinator` 셋과 새 모듈
/// `session-model`·`session-effort` — 모델/effort 설정 옵션의 내부 정리와,
/// 클라이언트가 광고해야만 켜지는 AIR capability `recommendedValue` 하나다.
/// 우리는 광고하지 않으므로 무영향. `usage-markdown.js` 는 바이트 동일,
/// 번들 SDK 도 `0.3.257` 그대로 — 우리 쪽 변경은 이 상수 한 줄뿐이다.
///
/// 0.76.0 → 0.77.0 (2026-09-15): `dist/` 대조. **번들 SDK 가 `0.3.257` →
/// `0.3.270` 으로 움직였다** — 딸려 오는 Claude Code CLI 도 같이 바뀐다는 뜻.
/// 어댑터 쪽 변경 11개 파일 중 우리 계기에 닿는 것:
/// - **agent 설정 옵션 제거** (`AGENT_CONFIG_ID`·`DEFAULT_AGENT_ID` 삭제,
///   `configOptions` 에서 빠짐). 우리 셀렉터는 온 목록을 그대로 그리므로
///   항목 하나가 사라질 뿐이다(`id === "agent"` 를 집는 코드 없음).
/// - **권한 요청 `defaultToNo`** (SDK 0.3.268+ 의 삭제류 Bash·Artifact 게시
///   안전 확인): 어댑터가 **거절 선택지를 앞에** 정렬하고 `_meta` 에 힌트를
///   싣는다. `PermissionCard` 는 강조를 순서가 아니라 kind 로 고르고 포커스도
///   뺏지 않으므로 순서만 바뀐다 — 의도된 "거절이 먼저" 다.
///   `suppressAlwaysAllowRule` 이 참이면 「항상 허용」이 아예 안 온다.
/// - `sessionFailure.reason` 에 `access_denied` 신설(조직 검증 필요 ·
///   Bedrock/Vertex 자격 증명 실패, category `access`). `FailureRow` 는
///   category 로 분기하지 않고 제목·상세만 그리므로 그대로 흐른다.
/// - 재시도 안내에 `no_response`(첫 바이트 대기) 문구 추가 — 텍스트다.
/// - 재생되는 사용자 메시지에서 `<system-reminder>` 를 벗긴다(CLI 주입
///   컨텍스트). `owedTrailingIdles` 정산이 `running` 전이에서 리셋된다
///   (CLI 2.1.270+ 가 백그라운드 에이전트 중 idle 을 보류하는 것 대응).
///   둘 다 어댑터 내부.
/// - elicitation(AskUserQuestion) 다중 선택 + 자유 답 병합, TaskList 파서
///   재작성, `allowBypass` 매개변수화 — 우리는 elicitation 을 광고하지 않고
///   나머지는 내부다.
///
/// `session/update` 종류·`_meta._claude/*` 자리는 불변. 우리 쪽 변경은 이
/// 상수 한 줄뿐이다.
pub const PINNED_VERSION: &str = "0.77.0";
pub const CODEX_PINNED_VERSION: &str = "1.8.0";

/// 앱 데이터 디렉터리 하위 설치 경로.
const INSTALL_SUBDIR: &str = "acp";

/// npm 설치는 네트워크에 달려 있다 — 무한 대기 대신 실패로 끊는다.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

pub fn install_dir(app_data: &Path) -> PathBuf {
    app_data.join(INSTALL_SUBDIR)
}

fn package_dir(app_data: &Path) -> PathBuf {
    package_dir_for(app_data, PKG_NAME)
}

fn package_dir_for(app_data: &Path, package_name: &str) -> PathBuf {
    install_dir(app_data)
        .join("node_modules")
        .join(PKG_SCOPE)
        .join(package_name)
}

/// 어댑터 진입점(node 로 실행할 JS). 존재 여부는 확인하지 않는다.
pub fn entry_path(app_data: &Path) -> PathBuf {
    package_dir(app_data).join("dist").join("index.js")
}

pub fn codex_entry_path(app_data: &Path) -> PathBuf {
    package_dir_for(app_data, CODEX_PKG_NAME)
        .join("dist")
        .join("index.js")
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
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
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
            npm_platform(std::env::consts::OS)
        ))
        .join(format!("claude{ext}"));
    path.is_file().then_some(path)
}

/// Rust 의 OS 이름 → npm 플랫폼 패키지 이름의 OS 자리(Node `process.platform`).
///
/// Windows 는 `win32`, macOS 는 `darwin` 이다 — Rust 이름(`windows`·`macos`)으로
/// 찾으면 딸려 온 `claude` 를 못 보고 진단이 "Claude Code 를 설치하세요" 라고
/// 거짓말을 한다(어댑터 자신은 딸려 온 것으로 멀쩡히 돈다). Linux 는 같은 이름.
///
/// macOS 는 2026-09-24 사용자 결정으로 고쳤다(크로스플랫폼 #mac-bundled-claude —
/// 그 전엔 `macos` 로 찾아 시스템 `claude` 가 없는 사용자의 진단이 "준비 안 됨" 이었다).
/// 이 함수는 **진단**(`acp::diagnose`)만 먹인다 — 실제로 도는 claude 는 어댑터가
/// 고르므로 바뀌지 않는다.
fn npm_platform(rust_os: &str) -> &str {
    match rust_os {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

/// 설치된 버전. 미설치·손상은 `None`.
pub fn installed_version(app_data: &Path) -> Option<String> {
    installed_version_for(app_data, PKG_NAME, &entry_path(app_data))
}

pub fn codex_installed_version(app_data: &Path) -> Option<String> {
    installed_version_for(app_data, CODEX_PKG_NAME, &codex_entry_path(app_data))
}

fn installed_version_for(app_data: &Path, package_name: &str, entry: &Path) -> Option<String> {
    if !entry.is_file() {
        return None;
    }
    let manifest = package_dir_for(app_data, package_name).join("package.json");
    let raw = std::fs::read_to_string(manifest).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("version")?
        .as_str()
        .map(std::string::ToString::to_string)
}

/// 고정 버전을 설치한다(멱등 — 이미 맞으면 npm 이 알아서 no-op).
pub async fn install(app_data: &Path, npm: &Path, path_env: &str) -> Result<String, String> {
    install_package(app_data, npm, path_env, PKG_NAME, PINNED_VERSION).await
}

pub async fn install_codex(app_data: &Path, npm: &Path, path_env: &str) -> Result<String, String> {
    install_package(
        app_data,
        npm,
        path_env,
        CODEX_PKG_NAME,
        CODEX_PINNED_VERSION,
    )
    .await
}

async fn install_package(
    app_data: &Path,
    npm: &Path,
    path_env: &str,
    package_name: &str,
    version: &str,
) -> Result<String, String> {
    let dir = install_dir(app_data);
    std::fs::create_dir_all(&dir).map_err(|e| format!("설치 폴더를 만들 수 없습니다: {e}"))?;

    let spec = format!("{PKG_SCOPE}/{package_name}@{version}");
    let spawned = crate::proc::tokio_cmd(npm)
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

    let entry = if package_name == CODEX_PKG_NAME {
        codex_entry_path(app_data)
    } else {
        entry_path(app_data)
    };
    installed_version_for(app_data, package_name, &entry)
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
        assert!(
            entry.ends_with("acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js")
        );
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

    /// Windows 의 딸려 온 CLI 는 `claude-agent-sdk-win32-x64\claude.exe` 다 —
    /// npm 의 플랫폼 이름(`win32`)으로 찾아야 진단이 그것을 본다.
    #[test]
    fn bundled_claude_uses_npm_platform_names() {
        assert_eq!(npm_platform("windows"), "win32");
        assert_eq!(npm_platform("macos"), "darwin");
        assert_eq!(npm_platform("linux"), "linux");

        let dir = tempfile::tempdir().unwrap();
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => other,
        };
        // 실제 npm 패키지 폴더 이름을 **문자열로** 못박는다 — `npm_platform` 으로 다시
        // 계산하면 그 함수가 틀려도 이 테스트가 통과한다(macOS 결함이 그렇게 숨었다).
        let (os, exe) = if cfg!(windows) {
            ("win32", "claude.exe")
        } else if cfg!(target_os = "macos") {
            ("darwin", "claude")
        } else {
            ("linux", "claude")
        };
        let bin = dir
            .path()
            .join("acp/node_modules/@anthropic-ai")
            .join(format!("claude-agent-sdk-{os}-{arch}"))
            .join(exe);
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, b"").unwrap();
        assert_eq!(bundled_claude(dir.path()), Some(bin));
    }

    #[test]
    fn codex_entry_uses_its_own_package() {
        assert!(codex_entry_path(Path::new("/data"))
            .ends_with("acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js"));
    }

    #[test]
    fn tail_truncates_on_char_boundaries() {
        let noisy = format!("{}실패했습니다 ✖", "x".repeat(500));
        let cut = tail(&noisy);
        assert!(cut.starts_with('…'));
        assert!(cut.ends_with('✖'));
    }
}
