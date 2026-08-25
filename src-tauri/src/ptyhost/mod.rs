//! PTY 호스트 — 터미널 세션을 앱 프로세스에서 분리한다 (#pty-host).
//!
//! 왜: 업데이트가 앱을 재시작하면 PTY(fd)가 함께 닫혀 셸 — 그 안의 Claude
//! Code 세션 — 이 죽는다. fd 는 프로세스를 넘어 살릴 수 없으므로, PTY 를
//! **소유하는 별도 프로세스**만이 답이다.
//!
//! 모양: 같은 실행파일이 `--pty-host <socket>` 플래그로 GUI 없이 뜬다
//! (`main.rs` 가 분기). 앱은 Unix 도메인 소켓(`<app_data>/ptyhost.sock`)으로
//! 붙어 세션을 부리고, 출력 이벤트를 받아 tauri 이벤트로 재방출한다. 앱이
//! 재시작하면 소켓에 다시 붙어 attach — 프런트엔드는 원래부터 attach→(miss 면)
//! start 흐름이라 **아무 변경 없이** 세션을 이어받는다.
//!
//! 별도 바이너리가 아닌 같은 실행파일인 이유: `current_exe()` 는 언제나
//! 존재한다 — dev 빌드·패키징·업데이트 직후 어디서든 경로 문제로 스폰이
//! 실패할 일이 없다 (Chrome 헬퍼 프로세스 방식).

pub mod client;
pub mod host;
pub mod protocol;
