//! 전송(Unix 소켓)·신호가 없는 OS 의 자리 — `mod.rs` 의 `#[cfg(unix)]` 짝이다
//! (크로스플랫폼 W1). 여기 있는 것은 전부 명시적 실패이거나 "모름"(None)이다 (D4).
//!
//! 파일로 뗀 이유: `mod.rs` 가 파일 크기 래칫(800줄) 위에 있어 스텁이 늘리면 안 된다.
//! PORT-STUB(L-PTY): Windows 전송(네임드 파이프)·Job Object 종료가 들어오면 이 파일을 걷는다.

use std::path::Path;
use std::sync::Arc;

use super::{HostSession, HostState};

// Windows 의 libc 에는 SIGHUP·SIGKILL 이 없다. 값은 아래 `signal_session` 이 무시한다.
pub(super) const SIG_HANGUP: i32 = 1;
pub(super) const SIG_KILL: i32 = 9;

// PORT-STUB(L-PTY): Windows 는 셸마다 Job Object 에 넣고 Job 종료로 트리 전체를
// 끝낸다 (#pty-kill). 지금은 [`serve`] 가 스텁이라 이 길에 닿지 않는다.
pub(super) fn signal_session(_foreground: Option<i32>, _shell_pid: Option<i32>, _sig: i32) {}

pub(super) fn process_group_leader_of(_session: &HostSession) -> Option<i32> {
    None
}

pub(super) fn command_line_of(_pid: i32) -> Option<String> {
    None
}

/// 전송이 없는 OS — listen 하지 않고 명시적으로 실패한다 (D4). `run_host` 는 이
/// 에러를 찍고 코드 1 로 끝난다.
// PORT-STUB(L-PTY): Windows 는 사용자 전용 네임드 파이프(`first_pipe_instance`)로.
pub async fn serve(_state: Arc<HostState>, _socket: &Path) -> Result<(), String> {
    Err(crate::ptyhost::UNSUPPORTED_OS.to_string())
}
