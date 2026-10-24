//! 책임을 넘기지 않는 기동 — 자식이 **스스로 TCC 책임 프로세스**가 된다 (macOS).
//!
//! macOS 는 데스크탑·문서 폴더 같은 보호 자원 접근을 "책임 프로세스" 의 코드 서명으로
//! 판정하고, 기본값은 띄운 쪽이 책임을 물려준다. 앱보다 오래 사는 PTY 호스트에게 그건
//! 사고다: 책임이 업데이트로 사라질 앱 프로세스에 묶인다. 그래서 호스트는 책임을
//! **자기 것으로** 들고 뜬다 — 터미널 앱(iTerm2·Terminal)이 셸을 띄울 때 쓰는 것과 같은
//! `responsibility_spawnattrs_setdisclaim` 이다 (libSystem, 헤더 없는 공개 심볼).
//!
//! 판정 대상이 호스트 자신이 되므로 호스트의 실행 파일이 **디스크에 살아 있어야** 한다 —
//! 그 자리는 `ptyhost::stage_mac` 이 업데이트가 지우지 않는 복제본으로 마련한다.
//!
//! 표준 입출력은 `/dev/null`, 나머지 fd 는 하나도 물려주지 않는다(`POSIX_SPAWN_CLOEXEC_DEFAULT`)
//! — Windows `detached.rs` 와 같은 이유(#pty-handle-inherit). 새 프로세스 그룹으로 띄워
//! 개발 터미널의 Ctrl+C 가 닿지 않는다.

use std::ffi::{CString, OsStr};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::ExitStatus;

extern "C" {
    fn responsibility_spawnattrs_setdisclaim(
        attrs: *mut libc::posix_spawnattr_t,
        disclaim: libc::c_int,
    ) -> libc::c_int;
    fn posix_spawn_file_actions_addchdir_np(
        actions: *mut libc::posix_spawn_file_actions_t,
        path: *const libc::c_char,
    ) -> libc::c_int;
}

/// 띄운 자식 — `try_wait`·`wait` 는 `std::process::Child` 와 같은 뜻.
pub struct Disclaimed {
    pid: libc::pid_t,
    status: Option<ExitStatus>,
}

impl Disclaimed {
    pub fn id(&self) -> u32 {
        self.pid as u32
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.wait_with(libc::WNOHANG)
    }

    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        loop {
            if let Some(status) = self.wait_with(0)? {
                return Ok(status);
            }
        }
    }

    fn wait_with(&mut self, flags: libc::c_int) -> io::Result<Option<ExitStatus>> {
        if let Some(status) = self.status {
            return Ok(Some(status));
        }
        let mut raw = 0;
        // SAFETY: 우리가 띄운 자식의 pid, 출력 자리는 지역 변수.
        match unsafe { libc::waitpid(self.pid, &mut raw, flags) } {
            0 => Ok(None),
            -1 => {
                let e = io::Error::last_os_error();
                if e.kind() == io::ErrorKind::Interrupted {
                    Ok(None)
                } else {
                    Err(e)
                }
            }
            _ => {
                let status = ExitStatus::from_raw(raw);
                self.status = Some(status);
                Ok(Some(status))
            }
        }
    }
}

/// 실패한 libc 호출을 io::Error 로 — posix_spawn 계열은 errno 가 아니라 반환값이 오류다.
fn check(rc: libc::c_int) -> io::Result<()> {
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(rc))
    }
}

fn c_string(s: &OsStr) -> io::Result<CString> {
    CString::new(s.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in an argument"))
}

/// `program args…` 를 책임을 넘기지 않고 띄운다. 환경은 부모 것 그대로.
pub fn spawn_disclaimed(
    program: &Path,
    args: &[&OsStr],
    cwd: Option<&Path>,
) -> io::Result<Disclaimed> {
    let program_c = c_string(program.as_os_str())?;
    let mut owned = vec![program_c.clone()];
    for arg in args {
        owned.push(c_string(arg)?);
    }
    let mut argv: Vec<*mut libc::c_char> = owned.iter().map(|s| s.as_ptr() as *mut _).collect();
    argv.push(std::ptr::null_mut());
    let dev_null = CString::new("/dev/null").expect("static");
    let cwd_c = cwd.map(|dir| c_string(dir.as_os_str())).transpose()?;

    // SAFETY: attrs·actions 는 init 이 채우고 아래에서 destroy 한다. 넘기는 문자열은
    // 이 함수가 끝날 때까지 산다(`owned`·`dev_null`·`cwd_c`). `environ` 은 libc 의 전역.
    unsafe {
        let mut attrs: libc::posix_spawnattr_t = std::ptr::null_mut();
        check(libc::posix_spawnattr_init(&mut attrs))?;
        let mut actions: libc::posix_spawn_file_actions_t = std::ptr::null_mut();
        if let Err(e) = check(libc::posix_spawn_file_actions_init(&mut actions)) {
            libc::posix_spawnattr_destroy(&mut attrs);
            return Err(e);
        }
        let result = (|| {
            let flags = libc::POSIX_SPAWN_SETPGROUP | libc::POSIX_SPAWN_CLOEXEC_DEFAULT;
            check(libc::posix_spawnattr_setflags(
                &mut attrs,
                flags as libc::c_short,
            ))?;
            check(libc::posix_spawnattr_setpgroup(&mut attrs, 0))?;
            check(responsibility_spawnattrs_setdisclaim(&mut attrs, 1))?;
            check(libc::posix_spawn_file_actions_addopen(
                &mut actions,
                0,
                dev_null.as_ptr(),
                libc::O_RDONLY,
                0,
            ))?;
            check(libc::posix_spawn_file_actions_addopen(
                &mut actions,
                1,
                dev_null.as_ptr(),
                libc::O_WRONLY,
                0,
            ))?;
            check(libc::posix_spawn_file_actions_addopen(
                &mut actions,
                2,
                dev_null.as_ptr(),
                libc::O_WRONLY,
                0,
            ))?;
            if let Some(dir) = &cwd_c {
                check(posix_spawn_file_actions_addchdir_np(
                    &mut actions,
                    dir.as_ptr(),
                ))?;
            }
            extern "C" {
                static environ: *const *mut libc::c_char;
            }
            let mut pid: libc::pid_t = 0;
            check(libc::posix_spawn(
                &mut pid,
                program_c.as_ptr(),
                &actions,
                &attrs,
                argv.as_ptr(),
                environ,
            ))?;
            Ok(pid)
        })();
        libc::posix_spawn_file_actions_destroy(&mut actions);
        libc::posix_spawnattr_destroy(&mut attrs);
        result.map(|pid| Disclaimed { pid, status: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 띄우고 기다린다 — 종료 코드가 그대로 돌아오고, 표준 출력은 `/dev/null` 이라
    /// 테스트의 출력에 아무것도 새지 않는다.
    #[test]
    fn spawns_and_reaps_with_the_exit_code() {
        let mut child = spawn_disclaimed(
            Path::new("/bin/sh"),
            &[OsStr::new("-c"), OsStr::new("echo leak; exit 7")],
            Some(Path::new("/")),
        )
        .expect("spawn");
        assert_eq!(child.wait().expect("wait").code(), Some(7));
        // 이미 거둔 뒤에도 같은 답 — 두 번 waitpid 하지 않는다.
        assert_eq!(
            child.try_wait().expect("try_wait").and_then(|s| s.code()),
            Some(7)
        );
    }

    #[test]
    fn a_missing_program_is_an_error_not_a_child() {
        assert!(spawn_disclaimed(Path::new("/nonexistent/ocul-pm"), &[], None).is_err());
    }
}
