//! 호스트 실행 파일의 **판별 복사본** — Windows 업데이트를 건너는 자리
//! (플랜 `cross-platform-port` #w3-update-ptyhost-lock, 사용자 결정 2026-09-24).
//!
//! ## 왜
//!
//! 호스트가 앱보다 오래 사는 이유는 하나, 업데이트 재시작을 건너기 위해서다. macOS 는
//! 번들 교체가 돌고 있는 프로세스를 건드리지 않아 그냥 건넌다. Windows 는 두 가지가 막는다:
//!
//! 1. Tauri 의 NSIS 설치 파일은 업데이트 전에 `ocul-pm.exe` 를 **이름으로** 찾아 끝낸다.
//!    같은 실행 파일로 도는 `--pty-host` 도 그 이름이라 함께 끝나고, 그 안의 셸(Claude
//!    Code)이 끊긴다.
//! 2. 실행 중인 이미지는 덮어쓰지도 지우지도 못한다. 원본으로 도는 호스트가 있으면 설치
//!    파일이 원본 교체에서 막힌다.
//!
//! 그래서 Windows 에서는 호스트를 **설치 폴더 밖, 다른 이름의 복사본**에서 띄운다.
//!
//! ## 모양
//!
//! - **자리**: `%LOCALAPPDATA%\<identifier>\<소켓 줄기>\` — 릴리스는 `ptyhost`, dev 는
//!   `ptyhost-dev` ([`stage_dir_for`]). 설치 폴더 밖이고 사용자 전용이며, 로밍하지 않는다
//!   (실행 파일은 로밍 프로필에 두지 않는다). 빌드 종류마다 폴더가 갈려 dev 가 설치본의
//!   복사본을 지우려 들지 않는다.
//! - **이름**: `ocul-pm-ptyhost-<판>-<내용 해시 16자>.exe` ([`copy_name`]). `ocul-pm.exe`
//!   와 이름이 달라 이름으로 끝내는 설치 파일에 걸리지 않는다. 해시가 이름에 있어 같은
//!   판의 다른 빌드(dev 재빌드)는 다른 파일이 된다.
//! - **만들기** ([`stage`]): 그 이름의 파일이 이미 있고 내용 해시가 맞으면 **손대지
//!   않는다.** 아니면 임시 파일에 쓰고 원자적으로 이름을 바꾼다 — 반쯤 쓰인 실행 파일이
//!   그 이름으로 보이는 순간이 없다. 내용은 스트림으로 옮긴다: `fs::copy`(CopyFileExW)는
//!   대체 스트림까지 옮겨, 원본에 `Zone.Identifier` 가 붙어 있으면 복사본도 "인터넷에서
//!   받은 파일" 이 된다.
//! - **지우기** ([`prune`]): 다른 판의 복사본은 **쓰는 호스트가 없을 때만** 지워진다 —
//!   Windows 는 실행 중인 이미지를 지우지 못하므로 그 거절이 곧 판정이다. 거절은 조용히
//!   넘기고(부르는 쪽이 로그) 다음 기동 때 다시 한다.
//!
//! **자리 규칙(파이프 이름)은 여기와 무관하다.** 정식·옛 자리는 `client::socket_candidates`
//! 가 app-data 경로로 정하고, `pipe::pipe_name_for` 가 그 경로와 사용자 SID 로 이름을
//! 만든다. 실행 파일 경로는 어디에도 들어가지 않으므로 복사본에서 뜬 호스트도 원본에서 뜬
//! 호스트와 같은 자리에 앉고, 판이 바뀌어도 옛 호스트를 이어받는 규칙이 그대로다.
//!
//! 이 모듈의 파일 다루기는 OS 와 무관해 테스트 빌드에서는 모든 OS 에서 돈다. 앱에서 쓰는
//! 곳은 Windows 의 `launch` 하나다.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::protocol::APP_BUILD;

/// 복사본 이름의 머리. `ocul-pm.exe` 와 **다른 이름**이어야 한다 — 설치 파일이 이름으로
/// 끝내는 대상에서 빠지는 것이 이 모듈의 전부다.
pub const COPY_PREFIX: &str = "ocul-pm-ptyhost-";

/// 임시 파일 — 점으로 시작해 [`COPY_PREFIX`] 로 시작하는 복사본과 섞이지 않는다.
const TMP_SUFFIX: &str = ".tmp";

/// 이만큼 묵은 임시 파일은 끊긴 복사의 잔해다. 한창 쓰는 중인 것은 건드리지 않는다.
const STALE_TMP: Duration = Duration::from_secs(10 * 60);

/// 복사 한 번에 옮기는 조각.
const CHUNK: usize = 1 << 20;

/// 이름 바꾸기의 재시도 간격 (합 ~1초) — 방금 닫힌 실행 파일을 백신이 훑는 동안
/// Windows 는 그 파일의 이름 바꾸기를 거절한다.
const PUBLISH_BACKOFF_MS: [u64; 6] = [20, 40, 80, 160, 320, 400];

/// 복사본의 파일 이름. 순수 함수.
///
/// 판에 파일 이름으로 못 쓸 글자가 섞여 있으면 `_` 로 바꾼다.
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
    let hash = &hash_hex[..hash_hex.len().min(16)];
    format!("{COPY_PREFIX}{build}-{hash}.exe")
}

/// 복사본을 둘 폴더 — `<local_data>\<identifier>\<소켓 줄기>`. 순수 함수.
///
/// 소켓은 `app_data_dir()` 바로 아래(`<roaming>\<identifier>\ptyhost[-dev].sock`)라 그
/// 부모 이름이 곧 앱 식별자다. Tauri 의 `app_local_data_dir()` 도 `<local_data>\<identifier>`
/// 라 앱의 로컬 데이터 폴더 안에 자리가 생긴다. 소켓 모양이 그렇지 않으면 `None` —
/// 부르는 쪽은 원본으로 띄운다.
pub fn stage_dir_for(local_data: &Path, socket: &Path) -> Option<PathBuf> {
    let identifier = socket.parent()?.file_name()?;
    let stem = socket.file_stem()?;
    Some(local_data.join(identifier).join(stem))
}

/// 이 사용자의 복사본 폴더 — `%LOCALAPPDATA%` (FOLDERID_LocalAppData) 기준.
#[cfg(windows)]
pub fn default_stage_dir(socket: &Path) -> Option<PathBuf> {
    let base = directories::BaseDirs::new()?;
    stage_dir_for(base.data_local_dir(), socket)
}

/// `exe` 의 복사본을 `dir` 에 마련하고 그 경로를 돌려준다.
///
/// 같은 내용의 복사본이 이미 있으면 **손대지 않는다**(쓰기·이름 바꾸기 없음). 없거나
/// 내용이 다르면 임시 파일에 쓰고 원자적으로 이름을 바꾼다. 실패하면 임시 파일을 치우고
/// 에러 — 부르는 쪽은 원본으로 물러선다.
pub fn stage(exe: &Path, dir: &Path) -> io::Result<PathBuf> {
    let hash = hash_file(exe)?;
    let target = dir.join(copy_name(APP_BUILD, hash.to_hex().as_str()));
    if holds(&target, &hash) {
        return Ok(target);
    }
    fs::create_dir_all(dir)?;
    let tmp = dir.join(tmp_name());
    let written = match copy_hashing(exe, &tmp) {
        Ok(h) => h,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
    };
    if written != hash {
        let _ = fs::remove_file(&tmp);
        return Err(io::Error::other(
            "the executable changed while it was being copied",
        ));
    }
    match publish(&tmp, &target) {
        Ok(()) => Ok(target),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            // 경합: 다른 기동이 같은 복사본을 먼저 내걸었고 그게 벌써 돌고 있으면(실행
            // 중인 이미지는 바꿔 끼울 수 없다) 우리 이름 바꾸기가 거절된다. 내용이 맞으면
            // 그대로 쓴다.
            if holds(&target, &hash) {
                Ok(target)
            } else {
                Err(e)
            }
        }
    }
}

/// [`prune`] 의 결과 — 지운 것과, 지우지 못한 것(대개 호스트가 돌고 있다)과 그 이유.
#[derive(Debug, Default)]
pub struct Pruned {
    pub removed: Vec<PathBuf>,
    pub kept: Vec<(PathBuf, io::Error)>,
}

/// `dir` 의 다른 복사본과 묵은 임시 파일을 지운다 — `keep` 은 건드리지 않는다.
///
/// 판정은 OS 가 한다: Windows 는 실행 중인 이미지를 지우지 못하므로, 쓰는 호스트가 있는
/// 복사본은 여기서 거절되어 [`Pruned::kept`] 로 남는다. 우리 머리([`COPY_PREFIX`])가
/// 아닌 파일은 보지도 않는다.
pub fn prune(dir: &Path, keep: &Path) -> Pruned {
    let mut out = Pruned::default();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    let keep = keep.file_name();
    for entry in entries.flatten() {
        let name = entry.file_name();
        if Some(name.as_os_str()) == keep {
            continue;
        }
        let text = name.to_string_lossy();
        let is_copy = text.starts_with(COPY_PREFIX) && text.ends_with(".exe");
        let is_stale_tmp = text
            .strip_prefix('.')
            .is_some_and(|rest| rest.starts_with(COPY_PREFIX))
            && text.ends_with(TMP_SUFFIX)
            && older_than(&entry.path(), STALE_TMP);
        if !(is_copy || is_stale_tmp) {
            continue;
        }
        let path = entry.path();
        match fs::remove_file(&path) {
            Ok(()) => out.removed.push(path),
            Err(e) => out.kept.push((path, e)),
        }
    }
    out
}

fn hash_file(path: &Path) -> io::Result<blake3::Hash> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(fs::File::open(path)?)?;
    Ok(hasher.finalize())
}

/// `target` 이 `hash` 내용의 파일인가. 읽지 못하면 아니다.
fn holds(target: &Path, hash: &blake3::Hash) -> bool {
    target.is_file() && hash_file(target).is_ok_and(|h| h == *hash)
}

/// 같은 폴더의 겹치지 않는 임시 이름 — 프로세스 번호와 시각.
fn tmp_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(".{COPY_PREFIX}{}-{nanos}{TMP_SUFFIX}", std::process::id())
}

/// `src` 를 새 파일 `dst` 로 옮기며 해시를 잰다 — 내용만 옮긴다(대체 스트림 없음).
fn copy_hashing(src: &Path, dst: &Path) -> io::Result<blake3::Hash> {
    let mut from = fs::File::open(src)?;
    let mut to = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dst)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = from.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        to.write_all(&buf[..n])?;
    }
    to.sync_all()?;
    Ok(hasher.finalize())
}

/// 임시 파일을 제 이름으로 — 잠깐 잠긴 것이면 짧게 물러섰다 다시.
fn publish(tmp: &Path, target: &Path) -> io::Result<()> {
    let mut waits = PUBLISH_BACKOFF_MS.iter();
    loop {
        match fs::rename(tmp, target) {
            Err(e) if transient(&e) => match waits.next() {
                Some(ms) => std::thread::sleep(Duration::from_millis(*ms)),
                None => return Err(e),
            },
            done => return done,
        }
    }
}

/// 다른 프로세스가 잠깐 쥐고 있어서 난 실패인가 — Windows 의 공유 위반·잠금 위반·접근
/// 거부(백신이 막 닫힌 파일을 여는 동안). 다른 OS 에는 이런 일시 실패가 없다.
fn transient(e: &io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32 | 33))
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

    fn exe_in(dir: &Path, bytes: &[u8]) -> PathBuf {
        let path = dir.join("ocul-pm.exe");
        fs::write(&path, bytes).unwrap();
        path
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// **이름이 `ocul-pm.exe` 가 아니어야** 설치 파일이 이름으로 끝내는 대상에서 빠진다.
    /// 모양은 고정이다 — 바꾸면 [`prune`] 이 옛 복사본을 못 알아본다.
    #[test]
    fn the_copy_is_named_apart_from_the_app() {
        let name = copy_name("3.4.0", "0123456789abcdef0123");
        assert_eq!(name, "ocul-pm-ptyhost-3.4.0-0123456789abcdef.exe");
        assert!(!name.eq_ignore_ascii_case("ocul-pm.exe"));
        assert_eq!(
            copy_name("3.4.0+win/beta 1", "ab"),
            "ocul-pm-ptyhost-3.4.0_win_beta_1-ab.exe",
            "파일 이름으로 못 쓰는 글자는 접는다"
        );
    }

    /// 자리 — `<local>\<identifier>\<소켓 줄기>`. 빌드 종류(`-dev`)마다 갈린다.
    #[test]
    fn the_stage_dir_is_the_apps_local_folder_split_by_build_kind() {
        let local = Path::new("/local");
        let release = stage_dir_for(local, Path::new("/roaming/com.x.app/ptyhost.sock"));
        assert_eq!(release, Some(local.join("com.x.app").join("ptyhost")));
        let dev = stage_dir_for(local, Path::new("/roaming/com.x.app/ptyhost-dev.sock"));
        assert_eq!(dev, Some(local.join("com.x.app").join("ptyhost-dev")));
        assert_ne!(release, dev);
        assert_eq!(
            stage_dir_for(local, Path::new("ptyhost.sock")),
            None,
            "부모 이름(식별자)이 없으면 자리를 지어내지 않는다"
        );
    }

    /// 같은 내용이면 **손대지 않는다** — 두 번째 부름은 같은 경로, 같은 파일(수정 시각
    /// 그대로), 임시 파일 없음.
    #[test]
    fn staging_the_same_executable_twice_touches_nothing() {
        let src = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let exe = exe_in(src.path(), b"MZ pretend executable");

        let first = stage(&exe, dir.path()).expect("복사본을 만든다");
        assert_eq!(fs::read(&first).unwrap(), b"MZ pretend executable");
        let name = first.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(COPY_PREFIX), "{name}");
        assert!(name.contains(APP_BUILD), "{name}");
        let written = fs::metadata(&first).unwrap().modified().unwrap();

        std::thread::sleep(Duration::from_millis(20));
        let second = stage(&exe, dir.path()).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            fs::metadata(&second).unwrap().modified().unwrap(),
            written,
            "같은 내용의 복사본을 다시 썼다"
        );
        assert_eq!(names(dir.path()), vec![name], "임시 파일이 남았다");
    }

    /// 내용이 바뀌면(새 판·재빌드) **다른 이름**의 복사본 — 옛것은 그대로 둔다(돌고 있을
    /// 수 있다 — 지우는 것은 [`prune`] 의 일이다).
    #[test]
    fn a_new_build_gets_its_own_copy() {
        let src = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let old = stage(&exe_in(src.path(), b"MZ build one"), dir.path()).unwrap();
        let new = stage(&exe_in(src.path(), b"MZ build two"), dir.path()).unwrap();
        assert_ne!(old, new);
        assert_eq!(fs::read(&old).unwrap(), b"MZ build one");
        assert_eq!(fs::read(&new).unwrap(), b"MZ build two");
    }

    /// 그 이름인데 내용이 틀린 파일(잘린 복사·손상)은 믿지 않고 새로 쓴다.
    #[test]
    fn a_damaged_copy_is_replaced() {
        let src = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let exe = exe_in(src.path(), b"MZ the real thing");
        let copy = stage(&exe, dir.path()).unwrap();
        fs::write(&copy, b"MZ the real").unwrap();
        let again = stage(&exe, dir.path()).unwrap();
        assert_eq!(again, copy);
        assert_eq!(fs::read(&again).unwrap(), b"MZ the real thing");
    }

    /// 만들 수 없으면 에러 — 부르는 쪽이 원본으로 물러선다. 임시 파일도 남지 않는다.
    #[test]
    fn staging_into_an_impossible_place_fails_cleanly() {
        let src = tempfile::tempdir().unwrap();
        let exe = exe_in(src.path(), b"MZ x");
        let blocker = src.path().join("not-a-dir");
        fs::write(&blocker, b"").unwrap();
        assert!(stage(&exe, &blocker.join("stage")).is_err());
        assert!(stage(&src.path().join("missing.exe"), src.path()).is_err());
        assert_eq!(names(src.path()), vec!["not-a-dir", "ocul-pm.exe"]);
    }

    /// 지우기 — 다른 복사본과 묵은 임시 파일만. `keep`·한창 쓰는 임시 파일·남의 파일은 그대로.
    #[test]
    fn prune_removes_other_copies_and_stale_temps_only() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let keep = d.join(copy_name("2.0.0", "bbbb"));
        for name in [
            copy_name("1.0.0", "aaaa"),
            copy_name("2.0.0", "bbbb"),
            ".ocul-pm-ptyhost-1-2.tmp".to_string(),
            "ocul-pm.exe".to_string(),
            "notes.txt".to_string(),
        ] {
            fs::write(d.join(name), b"x").unwrap();
        }
        // 한창 쓰는 임시 파일은 방금 만들어졌다 — 묵은 것만 지운다.
        let pruned = prune(d, &keep);
        assert_eq!(pruned.removed, vec![d.join(copy_name("1.0.0", "aaaa"))]);
        assert!(pruned.kept.is_empty(), "{:?}", pruned.kept);
        assert_eq!(
            names(d),
            vec![
                ".ocul-pm-ptyhost-1-2.tmp",
                "notes.txt",
                "ocul-pm-ptyhost-2.0.0-bbbb.exe",
                "ocul-pm.exe",
            ]
        );

        let tmp = fs::File::options()
            .write(true)
            .open(d.join(".ocul-pm-ptyhost-1-2.tmp"))
            .unwrap();
        tmp.set_modified(SystemTime::now() - STALE_TMP - Duration::from_secs(60))
            .unwrap();
        drop(tmp);
        let pruned = prune(d, &keep);
        assert_eq!(pruned.removed, vec![d.join(".ocul-pm-ptyhost-1-2.tmp")]);
        assert_eq!(
            names(d),
            vec!["notes.txt", "ocul-pm-ptyhost-2.0.0-bbbb.exe", "ocul-pm.exe"]
        );
    }

    /// 폴더가 없으면 할 일이 없다 — 에러도 아니다.
    #[test]
    fn pruning_a_missing_dir_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let pruned = prune(&dir.path().join("nope"), Path::new("x.exe"));
        assert!(pruned.removed.is_empty() && pruned.kept.is_empty());
    }
}
