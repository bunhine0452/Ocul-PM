//! 호스트를 띄울 **앱 묶음 복제본** — macOS 에서 업데이트를 건너도 보호 폴더 권한이
//! 유지되는 자리 (플랜 `bug-opt-round-20261018` #carry-ptyhost-stale-tcc, 2026-10-24).
//!
//! ## 왜
//!
//! 호스트는 업데이트를 건너려고 앱보다 오래 산다. macOS 는 돌고 있는 프로세스를 건드리지
//! 않으니 프로세스는 건너지만, 업데이트가 `/Applications/Ocul-PM.app` 을 갈아 끼우면
//! 호스트의 실행 파일은 디스크에서 사라진다. 그 뒤로 macOS 는 그 호스트를 설치된 앱으로
//! 알아보지 못해 **데스크탑·문서 폴더 접근을 거부한다** — 새 터미널마다
//! `getcwd: Operation not permitted`. 실측(2026-10-24): v3.6.0 호스트가 세션 10개를 쥔 채
//! v3.13.2 까지 살았고, 복제본에서 띄운 호스트는 접근이 되며, 그 복제본을 지운 뒤 처음
//! 접근하면 똑같이 거부된다.
//!
//! 그래서 호스트는 앱 데이터 폴더의 **복제본 묶음**에서 띄운다. 업데이트는 그걸 모르고,
//! 서명·공증이 그대로라 macOS 는 같은 Ocul-PM 으로 알아본다(이미 준 허용이 그대로 적용).
//! 복제는 APFS `clonefile` — 즉시, 내용이 같은 동안 디스크를 더 쓰지 않는다.
//!
//! ## 모양
//!
//! - **자리**: `<app_data>/<소켓 줄기>.noindex/` ([`stage_dir_for`]). `.noindex` 는
//!   Spotlight 가 그 안의 앱 묶음을 「응용 프로그램」으로 잡지 않게 한다.
//! - **이름**: `<판>-<실행 파일 내용 해시 16자>/Ocul-PM.app`. 해시가 이름에 있어 같은
//!   판의 다른 빌드는 다른 자리가 된다.
//! - **만들기** ([`stage`]): 그 자리에 내용이 맞는 복제본이 있으면 손대지 않는다. 아니면
//!   임시 폴더에 복제하고 폴더째 이름을 바꾼다 — 반쯤 된 묶음이 제 이름으로 보이는 순간이 없다.
//! - **지우기** ([`prune`]): 다른 복제본은 **그 안의 실행 파일로 도는 프로세스가 없을
//!   때만** 지운다. macOS 는 Windows 와 달리 돌고 있는 묶음도 지워 버리므로(그게 이
//!   버그다) 판정을 OS 에 맡기지 못하고 프로세스 목록([`running_paths`])으로 한다.
//!
//! 앱이 묶음 안에서 돌지 않으면(dev 의 `target/debug/ocul-pm`, 테스트) 복제하지 않는다 —
//! 부르는 쪽은 예전처럼 원본으로 띄운다.

use std::ffi::CString;
use std::fs;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::protocol::APP_BUILD;

/// 이만큼 묵은 임시 폴더는 끊긴 복제의 잔해다.
const STALE_TMP: Duration = Duration::from_secs(10 * 60);

/// 실행 파일이 든 앱 묶음 — `X.app/Contents/MacOS/<exe>` 의 `X.app`. 묶음 밖이면 `None`.
pub fn bundle_of(exe: &Path) -> Option<&Path> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then_some(bundle)
}

/// 복제본을 둘 폴더 — 소켓 옆 `<줄기>.noindex`. 순수 함수.
pub fn stage_dir_for(socket: &Path) -> Option<PathBuf> {
    let stem = socket.file_stem()?.to_str()?;
    Some(socket.parent()?.join(format!("{stem}.noindex")))
}

/// 복제본 폴더 이름. 판에 파일 이름으로 못 쓸 글자가 있으면 `_`.
pub fn copy_name(build: &str, hash_hex: &str) -> String {
    let build: String = build
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{build}-{}", &hash_hex[..hash_hex.len().min(16)])
}

/// `exe`(묶음 안의 실행 파일)의 묶음을 `dir` 에 복제하고, **복제본 안의 같은 실행 파일**
/// 경로를 돌려준다. 실패하면 임시 폴더를 치우고 에러 — 부르는 쪽은 원본으로 물러선다.
pub fn stage(exe: &Path, dir: &Path) -> io::Result<PathBuf> {
    let bundle = bundle_of(exe).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the executable is not inside an .app bundle",
        )
    })?;
    let inner = exe
        .strip_prefix(bundle)
        .map_err(io::Error::other)?
        .to_path_buf();
    let bundle_name = bundle.file_name().expect("bundle_of checked");
    let hash = hash_file(exe)?;
    let name = copy_name(APP_BUILD, hash.to_hex().as_str());
    let target = dir.join(&name);
    let staged_exe = target.join(bundle_name).join(&inner);
    if holds(&staged_exe, &hash) {
        return Ok(staged_exe);
    }
    fs::create_dir_all(dir)?;
    let tmp = dir.join(tmp_name(&name));
    let result = (|| {
        fs::create_dir(&tmp)?;
        clonefile(bundle, &tmp.join(bundle_name))?;
        if !holds(&tmp.join(bundle_name).join(&inner), &hash) {
            return Err(io::Error::other(
                "the bundle changed while it was being cloned",
            ));
        }
        // 묵은 잔해(내용이 다른 같은 이름)가 있으면 비우고 내건다.
        if target.exists() {
            fs::remove_dir_all(&target)?;
        }
        fs::rename(&tmp, &target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&tmp);
        // 경합: 다른 기동이 같은 복제본을 먼저 내걸었으면 그걸 쓴다.
        return if holds(&staged_exe, &hash) {
            Ok(staged_exe)
        } else {
            Err(e)
        };
    }
    Ok(staged_exe)
}

/// [`prune`] 의 결과.
#[derive(Debug, Default)]
pub struct Pruned {
    pub removed: Vec<PathBuf>,
    /// 그 안의 실행 파일로 도는 프로세스가 있어 남긴 것.
    pub in_use: Vec<PathBuf>,
    pub failed: Vec<(PathBuf, io::Error)>,
}

/// `dir` 의 다른 복제본과 묵은 임시 폴더를 지운다 — `keep` 과, `running` 중 어느
/// 경로라도 그 아래에 있는 복제본은 건드리지 않는다. 우리 이름 꼴이 아닌 것은 보지 않는다.
pub fn prune(dir: &Path, keep: &Path, running: &[PathBuf]) -> Pruned {
    let mut out = Pruned::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if keep.starts_with(&path) {
            continue;
        }
        let text = entry.file_name().to_string_lossy().into_owned();
        let is_tmp = text.starts_with('.') && text.ends_with(".tmp");
        if is_tmp && !older_than(&path, STALE_TMP) {
            continue;
        }
        if !is_tmp && !is_copy_name(&text) {
            continue;
        }
        if running.iter().any(|p| p.starts_with(&path)) {
            out.in_use.push(path);
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => out.removed.push(path),
            Err(e) => out.failed.push((path, e)),
        }
    }
    out
}

/// `<판>-<16자 hex>` 꼴인가.
fn is_copy_name(name: &str) -> bool {
    name.rsplit_once('-').is_some_and(|(build, hash)| {
        !build.is_empty() && hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

/// 지금 도는 모든 프로세스의 실행 파일 경로 (읽을 수 있는 것만).
pub fn running_paths() -> Vec<PathBuf> {
    // SAFETY: 크기를 먼저 묻고(빈 버퍼) 그만큼(+여유) 받는다. proc_pidpath 는 버퍼 길이를 받는다.
    unsafe {
        let n = libc::proc_listallpids(std::ptr::null_mut(), 0);
        if n <= 0 {
            return Vec::new();
        }
        let mut pids = vec![0 as libc::pid_t; n as usize + 64];
        let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
        let got = libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes);
        if got <= 0 {
            return Vec::new();
        }
        pids.truncate(got as usize);
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        pids.into_iter()
            .filter_map(|pid| {
                let len = libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32);
                (len > 0).then(|| PathBuf::from(std::ffi::OsStr::from_bytes(&buf[..len as usize])))
            })
            .collect()
    }
}

fn clonefile(src: &Path, dst: &Path) -> io::Result<()> {
    let src = CString::new(src.as_os_str().as_bytes()).map_err(io::Error::other)?;
    let dst = CString::new(dst.as_os_str().as_bytes()).map_err(io::Error::other)?;
    // SAFETY: 두 경로 모두 NUL 로 끝나는 지역 CString.
    if unsafe { libc::clonefile(src.as_ptr(), dst.as_ptr(), 0) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn hash_file(path: &Path) -> io::Result<blake3::Hash> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(fs::File::open(path)?)?;
    Ok(hasher.finalize())
}

fn holds(path: &Path, hash: &blake3::Hash) -> bool {
    path.is_file() && hash_file(path).is_ok_and(|h| h == *hash)
}

fn tmp_name(name: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(".{name}-{}-{nanos}.tmp", std::process::id())
}

fn older_than(path: &Path, age: Duration) -> bool {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|elapsed| elapsed > age)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 가짜 묶음 하나 — `X.app/Contents/MacOS/ocul-pm` 과 Info.plist.
    fn fake_bundle(root: &Path, body: &[u8]) -> PathBuf {
        let macos = root.join("Ocul-PM.app/Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        fs::write(root.join("Ocul-PM.app/Contents/Info.plist"), b"<plist/>").unwrap();
        let exe = macos.join("ocul-pm");
        fs::write(&exe, body).unwrap();
        exe
    }

    #[test]
    fn only_an_executable_inside_an_app_bundle_has_a_bundle() {
        let exe = Path::new("/Applications/Ocul-PM.app/Contents/MacOS/ocul-pm");
        assert_eq!(bundle_of(exe), Some(Path::new("/Applications/Ocul-PM.app")));
        assert_eq!(bundle_of(Path::new("/repo/target/debug/ocul-pm")), None);
        assert_eq!(
            bundle_of(Path::new("/x/Foo/Contents/MacOS/ocul-pm")),
            None,
            ".app 이 아니다"
        );
    }

    #[test]
    fn the_stage_dir_sits_beside_the_socket_out_of_spotlight() {
        let dir = stage_dir_for(Path::new("/data/com.x/ptyhost.sock")).unwrap();
        assert_eq!(dir, Path::new("/data/com.x/ptyhost.noindex"));
    }

    /// 복제본 안의 실행 파일을 돌려주고, 같은 내용이면 두 번째는 손대지 않는다.
    #[test]
    fn stages_the_whole_bundle_once_and_reuses_it() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = fake_bundle(&tmp.path().join("Applications"), b"v1");
        let dir = tmp.path().join("ptyhost.noindex");
        let staged = stage(&exe, &dir).expect("stage");
        assert!(staged.starts_with(&dir));
        assert!(staged.ends_with("Ocul-PM.app/Contents/MacOS/ocul-pm"));
        assert_eq!(fs::read(&staged).unwrap(), b"v1");
        let plist = staged
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("Info.plist");
        assert!(plist.is_file(), "묶음 전체가 복제돼야 서명이 산다");
        let before = fs::metadata(&staged).unwrap().modified().unwrap();
        assert_eq!(stage(&exe, &dir).unwrap(), staged);
        assert_eq!(fs::metadata(&staged).unwrap().modified().unwrap(), before);
    }

    /// **업데이트 시나리오** — 원본 묶음이 갈아 끼워지고 지워져도 복제본은 남는다.
    #[test]
    fn the_copy_survives_the_original_being_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let apps = tmp.path().join("Applications");
        let exe = fake_bundle(&apps, b"v1");
        let dir = tmp.path().join("ptyhost.noindex");
        let old = stage(&exe, &dir).unwrap();
        fs::remove_dir_all(apps.join("Ocul-PM.app")).unwrap();
        let exe = fake_bundle(&apps, b"v2");
        let new = stage(&exe, &dir).unwrap();
        assert_ne!(old, new, "내용이 다르면 다른 자리");
        assert_eq!(fs::read(&old).unwrap(), b"v1");
        assert_eq!(fs::read(&new).unwrap(), b"v2");
    }

    /// 지우기는 keep 과 **돌고 있는 것**을 남기고, 우리 꼴이 아닌 것은 보지 않는다.
    #[test]
    fn prune_spares_the_kept_and_the_running_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let mk = |name: &str| {
            let p = dir.join(name).join("Ocul-PM.app/Contents/MacOS");
            fs::create_dir_all(&p).unwrap();
            p.join("ocul-pm")
        };
        let keep = mk("3.13.4-aaaaaaaaaaaaaaaa");
        let running = mk("3.6.0-bbbbbbbbbbbbbbbb");
        mk("3.13.2-cccccccccccccccc");
        fs::create_dir_all(dir.join("notes")).unwrap();
        let pruned = prune(dir, &keep, &[running.clone(), PathBuf::from("/bin/zsh")]);
        assert_eq!(pruned.removed, vec![dir.join("3.13.2-cccccccccccccccc")]);
        assert_eq!(pruned.in_use, vec![dir.join("3.6.0-bbbbbbbbbbbbbbbb")]);
        assert!(keep.parent().unwrap().exists());
        assert!(
            dir.join("notes").exists(),
            "우리 꼴이 아닌 것은 건드리지 않는다"
        );
    }

    /// 이 테스트 프로세스 자신이 목록에 있다 — 판정의 근거가 실제로 읽힌다.
    #[test]
    fn running_paths_sees_this_process() {
        let me = std::env::current_exe().unwrap().canonicalize().unwrap();
        assert!(running_paths()
            .iter()
            .any(|p| p.canonicalize().ok().as_deref() == Some(me.as_path())));
    }
}
