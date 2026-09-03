//! A2A — 에이전트 간 통신 (설계 SSOT: `docs/a2a/00-master-plan.md`).
//!
//! 한 프로젝트에 동시에 붙은 에이전트들(앱 안의 ACP 패널, 앱 밖의 CLI 세션)이
//! 서로를 발견하고, 작업을 넘기고, 같은 파일을 동시에 고치는 사고를 막는다.
//!
//! A2A 표준의 **스키마와 수명주기**(Agent Card · Message · Task · Artifact)를
//! 그대로 채택하되, v1 의 배달은 `.oculpm/` 파일 + MCP 이고 앱이 브로커다.
//! 이유는 참여자 중 누구도 HTTP 서버를 열 수 없기 때문이다 — ACP 에이전트는
//! stdio 로 앱에 매여 있고, 앱 밖 세션은 우리 프로세스가 아니다. 둘의 공통
//! 창구는 이미 모든 세션에 물려 있는 `oculpm-mcp` 뿐이다 (마스터플랜 §1).
//!
//! - [`registry`] — Phase 1. 참여자 발견 (Agent Card).

pub mod registry;
