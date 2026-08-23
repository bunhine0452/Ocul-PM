//! 디버그 어댑터 프로토콜 (DAP) — 인앱 디버거.
//!
//! 설계 SSOT: `docs/dap/00-master-plan.md`.
//!
//! - **프레이밍은 LSP 와 공용** (`crate::framing`) — DAP 가 LSP 의 base protocol 을
//!   그대로 가져다 썼다.
//! - **봉투는 다르다** (`protocol`) — JSON-RPC 가 아니라 `seq`/`request_seq`.
//! - **조달이 어렵다** (`registry`) — 어댑터는 PATH 에 없는 경우가 더 많다.
//! - **수명이 다르다** (`session`) — 언어 서버는 오래 살고, 디버그 세션은 실행 한 번.

pub mod client;
pub mod protocol;
pub mod registry;
pub mod session;
pub mod spec;
pub mod state;
