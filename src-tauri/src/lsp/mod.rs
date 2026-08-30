//! LSP 클라이언트 — 코드 화면의 인텔리전스 층.
//!
//! 설계 SSOT: `docs/lsp/00-master-plan.md`. 요약하면:
//!
//! - **프레이밍은 MCP 와 다르다** (`crate::framing`) — Content-Length 헤더.
//!   DAP 와 공용이라 크레이트 루트에 있다.
//! - **루트는 프로젝트 루트가 아니다** (`registry`) — 열린 파일에서 위로 올라가며 찾는다.
//! - **위치는 변환하지 않는다** — LSP 의 `character` 는 UTF-16 코드 유닛이고 JS 문자열도
//!   UTF-16 이라 프런트와 LSP 는 이미 같은 단위다. Rust 는 통과만 시킨다.
//! - **서버 조달은 `acp::env` 재사용** — 로그인 셸 PATH (Finder 실행 PATH 함정).

pub mod client;
pub mod edit;
pub mod registry;
pub mod spec;
pub mod state;
