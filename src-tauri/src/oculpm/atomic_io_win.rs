//! 윈도우 게시 — 대상이 잠깐 잠겨 있을 때의 재시도와 **덮지 않는** 이동
//! (크로스플랫폼 L-FS · 플랜 `cross-platform-port` #fs-atomic).
//!
//! ## 왜 재시도인가
//!
//! 윈도우의 교체 `rename` 은 대상 파일을 다른 프로세스가 `FILE_SHARE_DELETE` 없이
//! 열고 있으면 `ERROR_ACCESS_DENIED`(5)·`ERROR_SHARING_VIOLATION`(32)로 거부한다.
//! 유닉스에는 없는 실패다 — 에디터가 저장 직후 파일을 다시 읽는 순간, 백신·검색
//! 색인기가 막 닫힌 파일을 훑는 순간에 난다. 대부분 수십~수백 ms 안에 풀리므로 짧게
//! 물러섰다 다시 한다. **끝내 안 풀리면 에러로 올린다** — 삼키면 호출자는 썼다고
//! 믿는데 디스크에는 옛 내용이 남는다. `ERROR_ACCESS_DENIED` 는 영구 원인(읽기 전용
//! 속성·권한)일 수도 있다 — 그때 재시도는 약 1초 늦게 같은 에러를 낼 뿐이다.
//!
//! ## 덮지 않는 이동
//!
//! `write_atomic_new` 는 하드링크로 배타적으로 게시한다. 하드링크가 실패하면 유닉스는
//! `rename` 으로 물러서며 그 볼륨에서의 배타성을 포기하는데, 윈도우의 `rename` 은
//! 대상이 있으면 **소리 없이 바꿔치기**한다 — 그리고 윈도우에서는 링크 실패가 FAT
//! 볼륨만의 일이 아니다: 백신이 방금 닫힌 tmp 를 훑는 동안에도 링크가 거부된다.
//! 그 순간 두 프로세스가 같은 일지 이름을 골랐다면 뒤가 앞을 덮는다. 그래서 윈도우의
//! 물러서기는 `MoveFileExW` 를 `MOVEFILE_REPLACE_EXISTING` **없이** 부른다 — 대상이
//! 있으면 거부하므로 어느 볼륨에서도 배타성을 잃지 않는다.

use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION,
};
use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

/// 재시도 사이의 기다림. 합 ~1초 — 백신 스캔 한 번은 덮고, 멈춘 앱을 오래 붙들지는 않는다.
const BACKOFF_MS: [u64; 7] = [10, 20, 40, 80, 160, 320, 400];

/// 다른 프로세스가 잠깐 쥐고 있어서 난 실패인가 (다시 해 볼 만한가).
pub(super) fn is_transient(e: &io::Error) -> bool {
    matches!(
        e.raw_os_error().map(|c| c as u32),
        Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION | ERROR_ACCESS_DENIED)
    )
}

/// `op` 를 부르고, 일시적 실패면 `backoff` 만큼씩 기다렸다 다시 부른다. 기다림을
/// 다 쓰면 마지막 에러를 그대로 돌려준다.
fn retry(
    mut op: impl FnMut() -> io::Result<()>,
    backoff: &[u64],
    mut sleep: impl FnMut(Duration),
) -> io::Result<()> {
    let mut waits = backoff.iter();
    loop {
        match op() {
            Err(e) if is_transient(&e) => match waits.next() {
                Some(ms) => sleep(Duration::from_millis(*ms)),
                None => return Err(e),
            },
            done => return done,
        }
    }
}

/// 교체 게시 (`write_atomic`) — `std::fs::rename` + 재시도.
pub(super) fn rename_replace(from: &Path, to: &Path) -> io::Result<()> {
    retry(
        || std::fs::rename(from, to),
        &BACKOFF_MS,
        std::thread::sleep,
    )
}

/// 배타 게시 (`write_atomic_new`) — `std::fs::hard_link` + 재시도.
pub(super) fn hard_link(from: &Path, to: &Path) -> io::Result<()> {
    retry(
        || std::fs::hard_link(from, to),
        &BACKOFF_MS,
        std::thread::sleep,
    )
}

/// 덮지 않는 이동. 대상이 있으면 `AlreadyExists` (`ERROR_ALREADY_EXISTS`/`ERROR_FILE_EXISTS`).
pub(super) fn move_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let (from, to) = (verbatim_wide(from)?, verbatim_wide(to)?);
    retry(
        || {
            // SAFETY: 두 버퍼 모두 NUL 로 끝나는 UTF-16 이고 호출 동안 살아 있다.
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        },
        &BACKOFF_MS,
        std::thread::sleep,
    )
}

/// Win32 API 에 직접 넘길 경로 — 부모를 `canonicalize`(`\\?\C:\…`, 구분자 `\`)한 뒤
/// 이름을 다시 붙인다. std 는 긴 경로(260자+)에 이 접두를 알아서 붙이지만 손으로
/// 부르는 API 는 그렇지 않다. `.oculpm/journal/…` 처럼 `/` 가 섞인 경로도 여기서 펴진다.
fn verbatim_wide(p: &Path) -> io::Result<Vec<u16>> {
    let name = p
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let parent = match p.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    let full = std::fs::canonicalize(parent)?.join(name);
    Ok(full.as_os_str().encode_wide().chain(Some(0)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::atomic_io::{write_atomic, write_atomic_new};
    use std::os::windows::fs::OpenOptionsExt;
    use std::time::Instant;

    /// `FILE_SHARE_READ` 만 주고 연다 — 에디터·백신이 대상을 붙든 모양.
    fn hold(path: &Path) -> std::fs::File {
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1) // FILE_SHARE_READ — 쓰기·지우기(이름 바꾸기) 공유 없음
            .open(path)
            .unwrap()
    }

    fn strays(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn retry_waits_out_transient_errors_and_gives_up_after_the_budget() {
        let transient = || io::Error::from_raw_os_error(ERROR_SHARING_VIOLATION as i32);
        // 두 번 막혔다가 풀린다.
        let mut calls = 0;
        let mut slept = Vec::new();
        let r = retry(
            || {
                calls += 1;
                if calls < 3 {
                    Err(transient())
                } else {
                    Ok(())
                }
            },
            &[1, 2, 3],
            |d| slept.push(d),
        );
        assert!(r.is_ok());
        assert_eq!(slept, [Duration::from_millis(1), Duration::from_millis(2)]);
        // 끝내 안 풀리면 기다림을 다 쓰고 마지막 에러를 올린다.
        let mut n = 0;
        let r = retry(
            || {
                n += 1;
                Err(transient())
            },
            &[1, 2],
            |_| {},
        );
        assert!(r.is_err_and(|e| is_transient(&e)));
        assert_eq!(n, 3);
        // 일시적이지 않은 실패는 기다리지 않는다.
        let r = retry(
            || Err(io::Error::from(io::ErrorKind::NotFound)),
            &[1],
            |_| panic!("기다리면 안 된다"),
        );
        assert!(r.is_err());
    }

    /// 전제 확인: 붙든 대상 위로의 교체 `rename` 은 **일시적 실패로 분류되는 코드**를 낸다.
    /// (이 가정이 러너에서 틀리면 재시도가 헛돈다 — 그래서 실제로 재 본다.)
    #[test]
    fn a_held_target_refuses_a_plain_rename_with_a_transient_error() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("t.md");
        let src = dir.path().join("s.tmp");
        std::fs::write(&target, "old").unwrap();
        std::fs::write(&src, "new").unwrap();
        let held = hold(&target);
        let err = std::fs::rename(&src, &target).unwrap_err();
        assert!(is_transient(&err), "{err:?} (raw {:?})", err.raw_os_error());
        drop(held);
    }

    #[test]
    fn write_atomic_waits_out_a_briefly_held_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("plan.md");
        std::fs::write(&target, "old").unwrap();
        let held = hold(&target);
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            drop(held);
        });
        write_atomic(&target, b"new").unwrap();
        release.join().unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
        assert!(strays(dir.path()).is_empty(), "{:?}", strays(dir.path()));
    }

    /// 끝내 안 풀리면 **에러**다 — 옛 내용은 그대로, tmp 는 남기지 않는다.
    #[test]
    fn write_atomic_fails_loudly_when_the_target_stays_held() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("plan.md");
        std::fs::write(&target, "old").unwrap();
        let held = hold(&target);
        let started = Instant::now();
        let err = write_atomic(&target, b"new").unwrap_err();
        let waited = started.elapsed();
        drop(held);
        assert!(
            waited >= Duration::from_millis(900),
            "재시도 없이 포기했다: {waited:?}"
        );
        assert!(format!("{err}").contains("plan.md"), "{err}");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        assert!(strays(dir.path()).is_empty(), "{:?}", strays(dir.path()));
    }

    /// 물러서기 이동은 **덮지 않는다** — 하드링크가 막힌 순간에도 배타성이 산다.
    #[test]
    fn move_no_replace_refuses_an_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("0925_a.md");
        let src = dir.path().join("0925_a.md.x.tmp");
        std::fs::write(&target, "first").unwrap();
        std::fs::write(&src, "second").unwrap();
        let err = move_no_replace(&src, &target).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists, "{err:?}");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "first");
        assert!(src.exists());

        std::fs::remove_file(&target).unwrap();
        move_no_replace(&src, &target).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "second");
        assert!(!src.exists());
    }

    /// NTFS 에서 하드링크 게시가 실제로 돈다 — 그리고 260자를 넘는 경로에서도.
    #[test]
    fn exclusive_and_replacing_writes_work_past_max_path() {
        let dir = tempfile::tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        for i in 0..8 {
            deep.push(format!("{i}-{}", "d".repeat(40)));
        }
        let target = deep.join(".oculpm/journal/20260924/Bugs/0925_long.md");
        assert!(target.as_os_str().len() > 300, "{}", target.display());

        write_atomic_new(&target, b"one").unwrap();
        assert!(write_atomic_new(&target, b"two")
            .unwrap_err()
            .is_already_exists());
        assert_eq!(std::fs::read(&target).unwrap(), b"one");
        write_atomic(&target, b"three").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"three");

        let other = deep.join("moved.md");
        let src = deep.join("moved.md.y.tmp");
        std::fs::write(&src, "m").unwrap();
        move_no_replace(&src, &other).unwrap();
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "m");
    }
}
