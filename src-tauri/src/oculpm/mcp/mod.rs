//! PR-CI2 — oculpm MCP 서버 (docs/claude-integration/00-master-plan.md D3).
//!
//! `oculpm-mcp` 바이너리(src/bin/oculpm_mcp.rs)가 이 모듈을 stdio 루프로
//! 감싼다. 로직은 전부 여기(lib) 에 있어 앱과 규격 구현을 공유하고 단위
//! 테스트된다.

pub mod a2a_tools;
pub mod codex;
pub mod protocol;
pub mod register;
pub mod tools;
