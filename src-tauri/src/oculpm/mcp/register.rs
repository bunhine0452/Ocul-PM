//! PR-CI2 — MCP 서버 등록 (`.mcp.json` 머지).
//!
//! claude_hooks 설치기와 동일한 계약: 우리 키(`oculpm`)만 만지고, 남의 서버
//! 정의·미지의 키는 보존하며, **파싱 불가 파일은 절대 덮어쓰지 않는다**.
//! (Claude Desktop 원클릭 등록은 4.0 에서 걷었다 — 에이전트 연결은 Claude Code ·
//! Codex 의 플러그인·MCP 가 맡는다.)
//!
//! D3 캐비앗 그대로 — `.mcp.json` 은 커밋되는 프로젝트 파일인데 바이너리
//! 경로는 머신 종속이다. UI 가 이를 고지하고, 팀 공유가 필요해지면 PR-CI8
//! (플러그인 패키징)이 경로 문제를 해소한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::oculpm::atomic_io;
use crate::oculpm::error::{OculpmError, OculpmResult};
use crate::oculpm::paths;

pub const MCP_JSON_REL: &str = ".mcp.json";
/// `.mcp.json` `mcpServers` 아래 우리 키.
pub const SERVER_KEY: &str = "oculpm";
/// command 경로에 이 조각이 있으면 우리 엔트리로 간주 (키 충돌 시 식별).
pub(crate) const BINARY_SIGNATURE: &str = "oculpm-mcp";

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct McpRegistrationStatus {
    /// `.mcp.json` 에 우리 서버가 등록되어 있다.
    pub registered: bool,
    /// 사이드카 바이너리를 찾았다 (없으면 등록 불가 — dev 는 `cargo build`).
    pub binary_found: bool,
    pub binary_path: Option<String>,
    pub mcp_json_path: String,
    /// 우리 것 아닌 MCP 서버 정의 수 (정보 표시용 — 건드리지 않음).
    pub foreign_servers: u32,
}

/// 사이드카 파일 이름 — tauri externalBin 이 `-<triple>` 을 떼고 메인 실행 파일
/// 옆에 이 이름으로 둔다.
pub const SIDECAR_NAME: &str = if cfg!(windows) {
    "oculpm-mcp.exe"
} else {
    "oculpm-mcp"
};

/// 사이드카를 못 찾았을 때 화면에 싣는 문구.
pub const BINARY_NOT_FOUND: &str =
    "Could not find the oculpm-mcp binary - in dev, run `cargo build --bin oculpm-mcp` and retry";

/// 다른 앱 설정에 적을 사이드카 경로 — 상태 표시용(`None` = 못 찾음). 왜
/// 못 찾았는지가 필요한 등록 경로는 [`locate_binary`] 를 쓴다.
pub fn resolve_binary_path() -> Option<PathBuf> {
    match locate_binary() {
        Ok(path) => Some(path),
        // 못 찾은 것은 상태가 말한다. 그 밖(AppImage 복사 실패)은 로그에도 남긴다.
        Err(e) if e == BINARY_NOT_FOUND => None,
        Err(e) => {
            tracing::warn!(target: "oculpm::mcp", error = %e, "oculpm-mcp 사이드카 안정 사본 실패");
            None
        }
    }
}

/// 다른 앱(Claude Code · Codex) 설정에 적을 사이드카 경로.
///
/// - macOS · Windows · deb: 메인 실행 파일의 **형제** — dev(`target/debug/`),
///   `.app` 의 `Contents/MacOS/`, NSIS 설치 폴더(`%LOCALAPPDATA%\Ocul-PM\`),
///   deb 의 `/usr/bin/`. 셋 다 앱이 꺼져도 남는 자리다.
/// - Linux AppImage: 형제는 실행 중에만 있는 마운트(`/tmp/.mount_XXXX`) 안이다 —
///   그 경로를 적으면 앱이 꺼지는 순간 죽는다(D10). 안정 자리
///   ([`paths::stable_sidecar_dir`])로 복사한 사본을 준다.
pub fn locate_binary() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not resolve the app executable: {e}"))?;
    let appdir = if cfg!(target_os = "linux") {
        std::env::var_os("APPDIR").map(PathBuf::from)
    } else {
        None
    };
    locate_binary_from(
        &exe,
        appdir.as_deref(),
        paths::stable_sidecar_dir().as_deref(),
    )
}

/// [`locate_binary`] 의 판정 — 입력을 받는 순수 함수라 세 OS 러너가 같은 표를 문다.
pub fn locate_binary_from(
    exe: &Path,
    appdir: Option<&Path>,
    stable_dir: Option<&Path>,
) -> Result<PathBuf, String> {
    let sibling = exe
        .parent()
        .map(|dir| dir.join(SIDECAR_NAME))
        .filter(|p| p.is_file())
        .ok_or_else(|| BINARY_NOT_FOUND.to_string())?;
    if !runs_from_appimage(exe, appdir) {
        return Ok(sibling);
    }
    let dir = stable_dir
        .ok_or("Could not find the user data folder for the AppImage copy of oculpm-mcp")?;
    let dst = dir.join(SIDECAR_NAME);
    install_stable_copy(&sibling, &dst).map_err(|e| {
        format!(
            "Could not copy oculpm-mcp out of the AppImage to {}: {e}",
            dst.display()
        )
    })?;
    Ok(dst)
}

/// 이 실행 파일이 AppImage 마운트 안에서 도나. `APPDIR` 은 AppImage 런타임이
/// 싣는 마운트 지점인데 **자식에게도 물려진다** — 앱 내장 터미널에서 띄운 deb
/// 판처럼 변수만 있고 마운트 밖인 경우가 있어, 변수 존재가 아니라 경로 포함으로 본다.
pub fn runs_from_appimage(exe: &Path, appdir: Option<&Path>) -> bool {
    appdir.is_some_and(|dir| !dir.as_os_str().is_empty() && exe.starts_with(dir))
}

/// [`install_stable_copy`] 가 한 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StableCopy {
    /// 내용이 같아 손대지 않았다 (mtime 도 그대로).
    Unchanged,
    /// 새로 썼다 (없었거나 내용이 달랐다 — AppImage 업데이트 뒤).
    Written,
}

/// `src` 를 `dst` 로 복사하되 **내용이 같으면 손대지 않는다**. 다르면 옆 임시
/// 파일에 복사한 뒤 `rename` 으로 바꾼다 — 그 경로로 떠 있는 MCP 서버를 제자리
/// 덮어쓰면 `ETXTBSY` 지만, `rename` 은 되고 옛 프로세스는 옛 inode 를 계속 쓴다.
pub fn install_stable_copy(src: &Path, dst: &Path) -> std::io::Result<StableCopy> {
    if dst.is_file() && same_contents(src, dst)? {
        return Ok(StableCopy::Unchanged);
    }
    let dir = dst.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "destination has no parent",
        )
    })?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{SIDECAR_NAME}.tmp-{}", std::process::id()));
    let staged = std::fs::copy(src, &tmp)
        .and_then(|_| mark_executable(&tmp))
        .and_then(|()| std::fs::rename(&tmp, dst));
    if staged.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    staged.map(|()| StableCopy::Written)
}

fn same_contents(a: &Path, b: &Path) -> std::io::Result<bool> {
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let digest = |p: &Path| -> std::io::Result<blake3::Hash> {
        let mut hasher = blake3::Hasher::new();
        hasher.update_reader(std::fs::File::open(p)?)?;
        Ok(hasher.finalize())
    };
    Ok(digest(a)? == digest(b)?)
}

#[cfg(unix)]
fn mark_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn mark_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// 기동 때 부른다 — **Linux AppImage 에서만** 안정 사본을 새로 고친다(업데이트로
/// 바뀐 사이드카가 옛 사본 뒤에 숨지 않게). 그 밖의 설치에서는 아무것도 하지 않고
/// `Ok(None)`. 연결 자리는 `lib.rs` 의 setup (L-OS 합류 diff).
pub fn refresh_stable_sidecar() -> Result<Option<PathBuf>, String> {
    if !cfg!(target_os = "linux") {
        return Ok(None);
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not resolve the app executable: {e}"))?;
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    if !runs_from_appimage(&exe, appdir.as_deref()) {
        return Ok(None);
    }
    locate_binary().map(Some)
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

/// 읽고 합쳐 쓰는 자리 — 링크면 손대지 않는다. 따라가면 `.mcp.json -> ~/.claude.json`
/// 같은 링크의 대상이 프로젝트 파일로 복사된다 (`path_guard::secure_join_managed`).
fn guarded_mcp_json(root: &Path) -> OculpmResult<PathBuf> {
    crate::path_guard::secure_join_managed(root, MCP_JSON_REL).map_err(OculpmError::InvalidConfig)
}

fn read_mcp_json(root: &Path) -> OculpmResult<Value> {
    read_json_config(&guarded_mcp_json(root)?)
}

fn write_mcp_json(root: &Path, value: &Value) -> OculpmResult<()> {
    write_json_config(&guarded_mcp_json(root)?, value)
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

pub fn status_with_binary(
    root: &Path,
    binary: Option<&Path>,
) -> OculpmResult<McpRegistrationStatus> {
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
        foreign_servers: foreign,
    })
}

/// 등록 (멱등). 바이너리를 못 찾으면 에러 — 죽은 경로를 커밋 파일에 남기지
/// 않는다.
pub fn register_with_binary(root: &Path, binary: &Path) -> OculpmResult<McpRegistrationStatus> {
    let mut value = read_mcp_json(root)?;
    if !value.is_object() {
        return Err(OculpmError::InvalidConfig(
            "The top level of .mcp.json is not a JSON object".into(),
        ));
    }
    let obj = value.as_object_mut().expect("checked is_object above");
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(servers) = servers.as_object_mut() else {
        return Err(OculpmError::InvalidConfig(
            "\"mcpServers\" in .mcp.json is not an object".into(),
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

    // ─── 사이드카 자리 (#integ-sidecar) ─────────────────────────────────────

    fn app_dir_with_sidecar(dir: &Path, body: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(SIDECAR_NAME), body).unwrap();
        dir.join("ocul-pm")
    }

    /// macOS `.app` · Windows 설치 폴더 · deb `/usr/bin` — 형제가 곧 안정 자리다.
    #[test]
    fn outside_an_appimage_the_sidecar_is_the_executables_sibling() {
        let tmp = TempDir::new().unwrap();
        let exe = app_dir_with_sidecar(&tmp.path().join("bin"), "x");
        let stable = tmp.path().join("share");
        let sibling = tmp.path().join("bin").join(SIDECAR_NAME);
        assert_eq!(
            locate_binary_from(&exe, None, Some(&stable)),
            Ok(sibling.clone())
        );
        // `APPDIR` 이 물려받은 것일 뿐 마운트 밖이면 형제 그대로.
        let foreign = tmp.path().join("mount");
        assert_eq!(
            locate_binary_from(&exe, Some(&foreign), Some(&stable)),
            Ok(sibling)
        );
        assert!(!stable.exists(), "AppImage 가 아니면 사본을 만들지 않는다");

        let bare = tmp.path().join("empty").join("ocul-pm");
        assert_eq!(
            locate_binary_from(&bare, None, Some(&stable)),
            Err(BINARY_NOT_FOUND.to_string())
        );
    }

    /// AppImage — 마운트 안의 형제를 안정 자리로 복사하고, 같은 내용이면 손대지
    /// 않으며, 업데이트로 바뀌면 새로 쓴다 (D10).
    #[test]
    fn inside_an_appimage_the_sidecar_is_copied_out_and_kept_fresh() {
        let tmp = TempDir::new().unwrap();
        let mount = tmp.path().join(".mount_ocul");
        let exe = app_dir_with_sidecar(&mount.join("usr").join("bin"), "v1");
        let stable = tmp.path().join("share").join("ocul-pm").join("bin");
        let dst = stable.join(SIDECAR_NAME);

        assert_eq!(
            locate_binary_from(&exe, Some(&mount), Some(&stable)),
            Ok(dst.clone())
        );
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "v1");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&dst).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "다른 앱이 exec 할 수 있어야 한다");
        }

        let sibling = mount.join("usr").join("bin").join(SIDECAR_NAME);
        assert_eq!(
            install_stable_copy(&sibling, &dst).unwrap(),
            StableCopy::Unchanged
        );
        std::fs::write(&sibling, "v2-updated").unwrap();
        assert_eq!(
            install_stable_copy(&sibling, &dst).unwrap(),
            StableCopy::Written
        );
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "v2-updated");
        let leftovers: Vec<_> = std::fs::read_dir(&stable).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "임시 파일이 남았다: {leftovers:?}");

        // 안정 자리를 모르면 마운트 경로로 조용히 넘어가지 않고 실패한다.
        assert!(locate_binary_from(&exe, Some(&mount), None).is_err());
    }

    #[test]
    fn an_empty_appdir_is_not_an_appimage() {
        assert!(!runs_from_appimage(
            Path::new("/x/ocul-pm"),
            Some(Path::new(""))
        ));
        assert!(!runs_from_appimage(Path::new("/x/ocul-pm"), None));
        assert!(runs_from_appimage(
            Path::new("/tmp/.mount_a/usr/bin/ocul-pm"),
            Some(Path::new("/tmp/.mount_a"))
        ));
    }
}
