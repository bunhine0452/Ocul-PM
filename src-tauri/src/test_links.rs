//! 테스트 전용 — 링크를 만든다 (크로스플랫폼 W2 `#fs-symlink-tests`).
//!
//! 경로 탈출 가드(루트 밖을 가리키는 링크를 거절한다)는 Windows 에서도 같은
//! 계약이다. 그런데 테스트가 `std::os::unix::fs::symlink` 를 직접 불러 Windows
//! 에서는 컴파일조차 안 됐고, W1 은 그 12곳을 `cfg(unix)` 로 막아 두었다 —
//! Windows 에서는 **가드가 한 번도 시험되지 않은** 상태였다.
//!
//! Windows 에서 링크를 만드는 길은 셋이고, 권한이 다르다:
//!
//! 1. 심볼릭 링크(`symlink_file`·`symlink_dir`) — `SeCreateSymbolicLinkPrivilege`
//!    (관리자 또는 개발자 모드). GitHub 의 Windows 러너는 관리자라 된다.
//! 2. 디렉터리 정션(`mklink /J`) — 권한이 필요 없다. 폴더만 된다. 가드 입장에서는
//!    심링크와 같다: std 의 `FileType::is_symlink` 가 정션(이름 대리 reparse
//!    point)도 참으로 보고, `canonicalize` 가 정션을 따라간다.
//! 3. 파일에는 권한 없는 대안이 없다 (하드 링크는 "같은 파일" 이지 링크가 아니다).
//!
//! 만들 수 없으면 그 사유를 찍고 `false` 를 돌려준다 — 테스트는 거기서 끝낸다.
//! **단 CI 에서는 건너뛰지 않는다**: 러너가 실기기인 이 라운드에서 "건너뜀" 은
//! 곧 "검증 안 됨" 이라, 조용히 초록이 되면 안 된다 (D1). 그래서 `CI` 환경변수가
//! 있으면 패닉한다.

use std::path::Path;

/// 파일 링크. 대상이 없어도(깨진 링크) 만든다.
pub(crate) fn file(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).expect("심링크 생성");
        true
    }
    #[cfg(windows)]
    {
        match std::os::windows::fs::symlink_file(target, link) {
            Ok(()) => true,
            Err(e) => skip(&format!(
                "파일 심링크를 만들 수 없다({e}) — 개발자 모드나 관리자 권한이 필요하다"
            )),
        }
    }
}

/// 폴더 링크. Windows 는 심링크 → 정션 순으로 시도한다.
pub(crate) fn dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).expect("심링크 생성");
        true
    }
    #[cfg(windows)]
    {
        let symlink_err = match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => return true,
            Err(e) => e,
        };
        match junction(target, link) {
            Ok(()) => true,
            Err(junction_err) => skip(&format!(
                "폴더 링크를 만들 수 없다 — 심링크: {symlink_err} · 정션: {junction_err}"
            )),
        }
    }
}

/// `mklink /J` — 권한 없이 되는 폴더 링크. 대상은 절대경로여야 한다.
#[cfg(windows)]
fn junction(target: &Path, link: &Path) -> Result<(), String> {
    let out = crate::proc::std_cmd("cmd")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(link)
        .arg(target)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 링크를 못 만들었다. 로컬에서는 사유를 찍고 건너뛰고, CI 에서는 붉힌다.
#[cfg(windows)]
fn skip(reason: &str) -> bool {
    if std::env::var_os("CI").is_some() {
        panic!("CI 러너에서 링크를 만들지 못했다 — 건너뛰면 가드가 검증되지 않는다: {reason}");
    }
    eprintln!("SKIP(링크): {reason}");
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 도우미 자신 — 만든 것이 std 가 보기에 정말 링크인가. 가드들은
    /// `symlink_metadata().file_type().is_symlink()` 로 링크를 알아본다.
    #[test]
    fn made_links_read_as_links() {
        let tmp = tempfile::TempDir::new().unwrap();
        let real_dir = tmp.path().join("real");
        std::fs::create_dir_all(&real_dir).unwrap();
        std::fs::write(real_dir.join("a.txt"), b"x").unwrap();

        if dir(&real_dir, &tmp.path().join("dir_link")) {
            let meta = std::fs::symlink_metadata(tmp.path().join("dir_link")).unwrap();
            assert!(
                meta.file_type().is_symlink(),
                "폴더 링크가 링크로 안 읽힌다"
            );
            // 링크를 따라가 안을 읽을 수 있다.
            assert!(tmp.path().join("dir_link/a.txt").is_file());
        }
        if file(&real_dir.join("a.txt"), &tmp.path().join("file_link")) {
            let meta = std::fs::symlink_metadata(tmp.path().join("file_link")).unwrap();
            assert!(
                meta.file_type().is_symlink(),
                "파일 링크가 링크로 안 읽힌다"
            );
            assert_eq!(std::fs::read(tmp.path().join("file_link")).unwrap(), b"x");
        }
    }
}
