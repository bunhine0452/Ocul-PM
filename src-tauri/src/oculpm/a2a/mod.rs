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
//! - [`mailbox`] — Phase 2. 메시지 배달 (한 번 쓰고 끝).
//! - [`tasks`] — Phase 2. 태스크 수명주기 (덧붙이기만 하는 원장).
//! - [`leases`] — Phase 3. 작업 구역 임대 (부딪히기 전에 막는다).

use serde::{Deserialize, Serialize};

pub mod leases;
pub mod mailbox;
pub mod registry;
pub mod tasks;

/// A2A 원장이 디스크에서 바뀌었다 — 화면이 다시 읽으라는 신호.
///
/// 폴링을 두지 않기 위한 것이다: 참여자·우편함·태스크는 **앱 밖 프로세스가**
/// 쓰는 자리라 앱이 스스로는 알 수 없고, 워처만이 그것을 본다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct OculpmA2aChanged {
    pub project_id: u32,
    pub kind: A2aChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum A2aChangeKind {
    /// 참여자 카드 (`agents/live/`).
    Participants,
    /// 우편함 (`agents/inbox/`).
    Message,
    /// 태스크 원장 (`agents/tasks/`).
    Task,
}

/// **남의 구역을 밟았다.** 에이전트가 스스로 신고한 파일 변경이 다른
/// 에이전트의 임대에 걸렸을 때 (마스터플랜 §7).
///
/// 막지는 않는다 — 변경은 이미 일어난 뒤에 신고가 오고, 되돌리는 것은 사용자의
/// 판단이다. 우리가 하는 일은 **보이게** 하는 것이다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct OculpmA2aTrespass {
    pub project_id: u32,
    /// 밟은 쪽.
    pub actor: String,
    /// 프로젝트 상대 경로.
    pub path: String,
    /// 그 구역의 주인.
    pub holder: String,
    /// 주인의 임대가 언제까지인가.
    pub until: String,
}
