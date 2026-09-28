//! 설치 형식 — 이 실행 파일이 **어떤 설치로** 깔렸는가 (크로스플랫폼 L-UPD
//! `#upd-target-missing`, 설계 D10).
//!
//! 번들러는 실행 파일의 자리표시자 `__TAURI_BUNDLE_TYPE_VAR_UNK` 를 설치 형식 표식
//! (`…_DEB` · `…_APP`(AppImage) · `…_NSS`(NSIS) · …)으로 바꿔 굽는다
//! (tauri-utils `platform::bundle_type`). 업데이터(tauri-plugin-updater 2.10.1
//! `Updater::get_urls`)는 이 표식으로 latest.json 의 `{os}-{arch}-{형식}` 키를 먼저,
//! 그다음 `{os}-{arch}` 를 찾는다 — 둘 다 없으면 **버전과 무관하게** TargetsNotFound 다.
//! 릴리스는 deb 키와 맨 `linux-x86_64` 를 일부러 싣지 않으므로(`.github/scripts/release/
//! latest-json.mjs` 머리 주석) deb 설치본은 확인할 때마다 그 오류로 끝난다.
//!
//! 프런트(`src/lib/updaterRoute.ts`)는 이 값으로 둘을 정한다:
//!   - deb(·rpm) 설치본은 앱 안 업데이트를 하지 않는다 — 파일의 주인이 패키지 관리자다.
//!   - 「대상 없음」 오류는 이 OS·형식의 빌드가 이번 릴리스에 없다는 **중립** 상태다.
//!
//! 진단 화면도 같은 커맨드를 쓸 수 있다 (`install_kind`). 기동 로그에도 한 줄 남긴다 —
//! 업데이트 스모크가 「설치가 실제로 돌았다」 를 이 줄의 판으로 읽는다.

use serde::Serialize;
use tauri::utils::config::BundleType;

/// 이 실행 파일의 설치 형식과, 업데이터가 latest.json 에서 찾을 키.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct InstallKind {
    /// 업데이터가 latest.json 키에 쓰는 OS 이름 — `darwin` · `windows` · `linux`.
    /// 그 밖의 OS 는 `null` (업데이터가 UnsupportedOs 로 끝난다).
    pub os: Option<String>,
    /// 업데이터가 쓰는 아키텍처 이름 — `x86_64` · `aarch64` · `i686` · `armv7` · `riscv64`.
    pub arch: Option<String>,
    /// 설치 형식 — `nsis` · `msi` · `appimage` · `deb` · `rpm` · `app`. 번들 밖에서 도는
    /// 실행 파일(`cargo run` · E2E 디버그 빌드)은 macOS 말고는 `null`.
    pub bundle_type: Option<String>,
    /// 업데이터가 latest.json `platforms` 에서 찾는 키, 찾는 순서대로.
    pub updater_targets: Vec<String>,
}

/// tauri-plugin-updater 2.10.1 `updater_os()` 의 복제 — 키의 OS 자리.
fn updater_os() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        Some("linux")
    } else if cfg!(target_os = "macos") {
        Some("darwin")
    } else if cfg!(target_os = "windows") {
        Some("windows")
    } else {
        None
    }
}

/// tauri-plugin-updater 2.10.1 `updater_arch()` 의 복제 — 키의 아키텍처 자리.
fn updater_arch() -> Option<&'static str> {
    if cfg!(target_arch = "x86") {
        Some("i686")
    } else if cfg!(target_arch = "x86_64") {
        Some("x86_64")
    } else if cfg!(target_arch = "arm") {
        Some("armv7")
    } else if cfg!(target_arch = "aarch64") {
        Some("aarch64")
    } else if cfg!(target_arch = "riscv64") {
        Some("riscv64")
    } else {
        None
    }
}

/// tauri-plugin-updater 2.10.1 `installer_for_bundle_type` + `Installer::name` 의 복제.
/// Dmg 는 실행 파일 표식에 없다(`.app` 이 App 을 돌려준다) — 업데이터도 None 으로 친다.
fn installer_name(bundle: &BundleType) -> Option<&'static str> {
    match bundle {
        BundleType::Deb => Some("deb"),
        BundleType::Rpm => Some("rpm"),
        BundleType::AppImage => Some("appimage"),
        BundleType::Msi => Some("msi"),
        BundleType::Nsis => Some("nsis"),
        BundleType::App => Some("app"),
        _ => None,
    }
}

/// 순수 — OS·아키텍처·표식으로 설치 형식과 업데이터의 키 순서를 만든다.
fn compute(os: Option<&str>, arch: Option<&str>, bundle: Option<BundleType>) -> InstallKind {
    let installer = bundle.as_ref().and_then(installer_name);
    let mut updater_targets = Vec::new();
    if let (Some(os), Some(arch)) = (os, arch) {
        if let Some(installer) = installer {
            updater_targets.push(format!("{os}-{arch}-{installer}"));
        }
        updater_targets.push(format!("{os}-{arch}"));
    }
    InstallKind {
        os: os.map(str::to_string),
        arch: arch.map(str::to_string),
        bundle_type: installer.map(str::to_string),
        updater_targets,
    }
}

/// 지금 도는 실행 파일의 설치 형식.
pub fn current_install_kind() -> InstallKind {
    compute(
        updater_os(),
        updater_arch(),
        tauri::utils::platform::bundle_type(),
    )
}

/// 기동 로그 한 줄 — 앱 판(`tauri.conf.json` version)과 설치 형식.
///
/// 로그의 다른 줄은 판을 적지 않는다. 업데이트 뒤 재시작한 프로세스가 **새 판**인지는
/// 이 줄로만 읽힌다 (`.github/scripts/updater-smoke-*`).
pub fn log_install_kind_at_boot(version: &impl std::fmt::Display) {
    let kind = current_install_kind();
    tracing::info!(
        target: "oculpm::boot",
        version = %version,
        bundle = %kind.bundle_type.as_deref().unwrap_or("none"),
        targets = %kind.updater_targets.join(","),
        "[FLOW] install kind — version {version}"
    );
}

/// 이 실행 파일의 설치 형식 (업데이터의 키 선택과 같은 규칙).
#[tauri::command]
#[specta::specta]
pub fn install_kind() -> InstallKind {
    current_install_kind()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(os: &str, arch: &str, bundle: Option<BundleType>) -> Vec<String> {
        compute(Some(os), Some(arch), bundle).updater_targets
    }

    /// 릴리스가 latest.json 에 싣는 키(`latest-json.mjs` 의 MAC_KEYS · NONMAC)를 각 설치
    /// 형식이 **첫 키로** 찾는다 — 이 줄이 어긋나면 그 설치본의 자동 업데이트가 조용히 죽는다.
    #[test]
    fn release_keys_are_the_first_target_of_each_shipped_format() {
        assert_eq!(
            targets("darwin", "aarch64", Some(BundleType::App)),
            ["darwin-aarch64-app", "darwin-aarch64"]
        );
        assert_eq!(
            targets("windows", "x86_64", Some(BundleType::Nsis)),
            ["windows-x86_64-nsis", "windows-x86_64"]
        );
        assert_eq!(
            targets("linux", "x86_64", Some(BundleType::AppImage)),
            ["linux-x86_64-appimage", "linux-x86_64"]
        );
    }

    /// deb 는 자기 키(`linux-x86_64-deb`)도 맨 키도 릴리스에 없다 — 둘 다 찾고 못 찾는다.
    #[test]
    fn deb_looks_for_keys_the_release_never_ships() {
        let kind = compute(Some("linux"), Some("x86_64"), Some(BundleType::Deb));
        assert_eq!(kind.bundle_type.as_deref(), Some("deb"));
        assert_eq!(kind.updater_targets, ["linux-x86_64-deb", "linux-x86_64"]);
    }

    /// 번들 밖(표식 UNK)은 맨 키 하나만 찾는다. 모르는 OS 는 키가 없다.
    #[test]
    fn unbundled_and_unknown_os() {
        let kind = compute(Some("linux"), Some("x86_64"), None);
        assert_eq!(kind.bundle_type, None);
        assert_eq!(kind.updater_targets, ["linux-x86_64"]);

        let kind = compute(None, Some("x86_64"), Some(BundleType::Nsis));
        assert_eq!(kind.os, None);
        assert!(kind.updater_targets.is_empty());
    }

    /// Dmg 는 업데이터가 설치 형식으로 치지 않는다 (플러그인과 같은 규칙).
    #[test]
    fn dmg_has_no_installer_name() {
        let kind = compute(Some("darwin"), Some("aarch64"), Some(BundleType::Dmg));
        assert_eq!(kind.bundle_type, None);
        assert_eq!(kind.updater_targets, ["darwin-aarch64"]);
    }
}
