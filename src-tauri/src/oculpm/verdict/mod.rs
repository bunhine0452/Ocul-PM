//! 판정 — "이 대화가 자기 작업을 기록했는가"를 **한 자리**에서 답한다.
//!
//! 이 물음에 답하는 코드가 세 벌 있었다: `delivery-gate.sh`(턴 차단),
//! `session-end.sh`(미기록 신호), `claude_hooks::journal_missing_signals`
//! (Today 카드의 해소 필터). 셋 다 같은 근사를 썼다 — **프로젝트 전역 일지
//! mtime**. 근사 하나에 세 표면이 얹혀 있으니, 그 근사가 틀리는 상황(병렬
//! 세션)에서 셋이 동시에 틀렸다.
//!
//! 2026-09-05 에 실제로 그랬다. 저장소에 **한 글자도 쓰지 않은** 읽기 전용
//! 조사 세션이 배달 게이트에 걸렸다. 같은 워킹트리의 다른 에이전트가 편집한
//! 파일이 그 세션의 마커보다 새로웠다는 것이 유일한 근거였다.
//!
//! # 용어 — 무엇을 세는가
//!
//! 신호 원장 164행이 고유 세션 117개였던 이유가 이 혼동이다. 이름을 못박는다:
//!
//! | 이름 | 정체 | 예 |
//! |---|---|---|
//! | **대화**(conversation) | 에이전트 자신의 대화 id. resume·compact 를 건너 살아남는다. 프론트매터 `agent.session`, 훅 payload 의 `session_id`. **판정 단위는 이것이다.** | `6a994a30-…` |
//! | **세그먼트**(segment) | 마커 하나의 수명 (SessionStart→SessionEnd). 한 대화가 resume 마다 새 세그먼트를 낳는다 — 원장이 한 대화를 최대 11번 세던 이유. | `.session-start-6a994a30-…` |
//! | **작업 세션**(workday session) | 워처가 발급하는 `YYYYMMDD-NNN`. 시간대 하나이고 그 안에 대화 여럿이 들어간다. 프론트매터 `session_id`, `sessions.json`. | `20260905-003` |
//!
//! # 판정의 비대칭
//!
//! 두 물음을 순서대로 묻는다. **틀리는 방향이 서로 달라서** 엄격함의 기준도
//! 다르다.
//!
//! 1. **기록했는가** — 여기서 관대해도 안전하다. 잘못 "기록했다"고 보면
//!    침묵할 뿐이다. 그래서 근거의 사다리를 끝까지 내려간다.
//! 2. **이 변경이 이 대화의 것인가** — 여기서 관대하면 **엉뚱한 대화를
//!    붙잡는다.** 그래서 근거가 모자라면 [`Undecided`] 로 멈춘다.
//!
//! `Option` 을 "없음 = 위반" 으로 읽지 않는 것이 이 모듈의 전부다. 없으면
//! 다음 입력으로 내려가고, 전부 없으면 **판정 불가**라고 말한다 — 미기록이
//! 아니라.
//!
//! # 순수
//!
//! [`judge`] 는 파일시스템을 읽지 않는다. 수집(IO)은 [`collect`] 가 하고,
//! 하네스는 [`VerdictInput`] 을 손으로 지어 판정만 시험한다. 이 함수는
//! `mcp-lifecycle-hooks` 플랜이 `stop_verdict(state)` 로 옳게 설계해 놓고
//! "판정이 셸에 있어 하네스가 없다"는 이유로 폐기했던 그 함수다.

pub mod cli;
mod collect;
pub mod ledger;
pub mod markers;
#[cfg(test)]
mod tests;

pub use collect::{collect, collect_journal_conversations, PEER_LIVE_WINDOW_SECS};

use std::collections::BTreeSet;

// ─────────────────────────────────────────────────────────────────────────────
// 입력 — 판정에 쓰이는 사실 전부. 이 구조체 밖의 어떤 것도 읽지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

/// 워킹트리에서 더티인 파일 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedFile {
    /// git 최상위 기준 상대경로.
    pub path: String,
    /// mtime (unix 초).
    pub modified_at: i64,
}

/// 일지 하나에서 판정에 필요한 것만.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct JournalRecord {
    /// 프론트매터 `agent.session` — **대화** id. 1순위 근거.
    pub agent_session: Option<String>,
    /// 프론트매터 `session_id` — **작업 세션** id. 2·3순위의 조인 키.
    pub workday_session_id: Option<String>,
    /// 파일 mtime (unix 초). 4순위(전역 근사)의 유일한 근거.
    pub modified_at: i64,
}

/// `sessions.json` 의 작업 세션 한 줄에서 판정에 필요한 것만.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkdaySession {
    pub id: String,
    /// 이 작업 세션에 붙어 있던 **대화** id 들.
    pub agent_sessions: Vec<String>,
    pub started_at: i64,
    /// `None` = 아직 열려 있다.
    pub ended_at: Option<i64>,
}

/// 판정 입력.
#[derive(Debug, Clone, Default)]
pub struct VerdictInput {
    /// 판정 대상 **대화** id. 비어 있으면 대화 단위 근거는 전부 무효다.
    pub conversation: String,
    /// 이 대화의 **현재 세그먼트**가 시작한 시각 (unix 초). `None` = 마커
    /// 없음 → 언제부터가 이 대화인지 모른다 → 판정 불가.
    pub segment_started_at: Option<i64>,
    /// 지금 **살아 있는 다른 대화**들. 하나라도 있으면 파일시스템은 누가
    /// 고쳤는지 말하지 못한다.
    pub live_peers: Vec<String>,
    /// 워킹트리의 더티 파일 (`.oculpm` 밖만).
    pub changes: Vec<ChangedFile>,
    /// 최근 일지들 (수집 창은 [`collect`] 가 정한다).
    pub journals: Vec<JournalRecord>,
    /// `sessions.json` 의 작업 세션들. 앱이 안 돌면 비어 있다.
    pub workday_sessions: Vec<WorkdaySession>,
    /// 워킹트리를 읽을 수 있었는가 (git 부재·비저장소 = `false`).
    pub working_tree_readable: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────────────────────────

/// "기록했다"를 무엇으로 확인했는가. 사다리의 아래로 갈수록 약하다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordBasis {
    /// 1순위 — 일지가 자기 프론트매터에 이 **대화** id 를 적었다.
    AgentSession,
    /// 2순위 — 이 대화가 참여자로 등록된 **작업 세션**에 일지가 걸려 있다
    /// (`sessions.json` 의 `agent_sessions`).
    AgentSessions,
    /// 3순위 — 참여자 등록은 없지만, 이 세그먼트의 시각을 품는 작업 세션에
    /// 일지가 걸려 있다 (`journal_write` 가 `session_id` 를 찍는 그 경로).
    SessionsJson,
    /// 4순위 — 마커 이후에 **아무** 일지나 생겼다. 프로젝트 전역 근사라
    /// 살아 있는 옆 대화가 있으면 쓰지 않는다.
    MarkerMtime,
}

/// 변경을 이 대화의 것으로 본 근거.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeBasis {
    /// 살아 있는 대화가 우리뿐이라, 세그먼트 시작 이후의 변경은 우리 것이다.
    SoleLiveConversation,
}

/// 이의 없음.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clear {
    /// 이 대화에 귀속되는 변경이 없다 — **읽기만 한 세션**이 여기로 온다.
    NothingToRecord,
    /// 기록했다.
    Recorded(RecordBasis),
}

/// 판정 불가. **미기록이 아니다** — 뭉뚱그리면 오탐이 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Undecided {
    /// 세그먼트 마커가 없다.
    NoSegmentMarker,
    /// 살아 있는 다른 대화가 있다 — 파일시스템은 누가 고쳤는지 모른다.
    LivePeers { peers: usize },
    /// 워킹트리를 읽지 못했다 (git 부재 등).
    NoWorkingTree,
}

/// 이의 — 이 대화의 변경이 기록되지 않았다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Objection {
    pub basis: ChangeBasis,
    /// 이 대화에 귀속된, 기록되지 않은 변경 (정렬·중복 제거됨).
    pub changed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Clear(Clear),
    Undecided(Undecided),
    Objection(Objection),
}

/// 이의 — 호출자는 이 코드로 갈라도 되고 [`Verdict`] 를 직접 봐도 된다.
pub const EXIT_OBJECTION: i32 = 10;
/// 판정 불가.
pub const EXIT_UNDECIDED: i32 = 11;

impl Verdict {
    /// 셸 진입점의 종료 코드. 0 = 이의 없음.
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Clear(_) => 0,
            Self::Objection(_) => EXIT_OBJECTION,
            Self::Undecided(_) => EXIT_UNDECIDED,
        }
    }

    /// 원장에 남길 한 단어. 판정 불가와 미기록을 **구별해서** 적는다 —
    /// 이 구별이 없어서 원장 164행 중 55%가 사후에 판정 불가가 됐다.
    pub fn ledger_word(&self) -> &'static str {
        match self {
            Self::Clear(_) => "recorded",
            Self::Objection(_) => "missing",
            Self::Undecided(_) => "undecided",
        }
    }
}

impl Objection {
    /// 몇 개를 왜 붙잡았는가.
    pub fn reason(&self) -> String {
        format!(
            "이 대화에서 바꾼 파일 {}개가 아직 기록되지 않았습니다.",
            self.changed.len()
        )
    }

    /// **무엇을 하라** — 「일지를 쓰세요」가 아니라 도구 이름과 대상까지.
    /// 폐기 당시 회고가 지목한 자리다: 지시가 모호하면 게이트는 잔소리가 된다.
    /// 파일 목록은 바로 위 줄에 한 번만 찍고 여기서는 개수로 가리킨다.
    pub fn action(&self) -> String {
        format!(
            "논리 단위(버그 수정/기능/리팩토링/에러 해결)가 끝났으면 journal_write 로 \
             위 파일 {}개를 files_touched 에 넣어 일지를 쓰고, plan_update 로 대응 플래너 항목을 \
             갱신하세요.",
            self.changed.len()
        )
    }

    /// 게이트가 stderr 로 내보내는 전문.
    pub fn message(&self) -> String {
        format!(
            "oculpm 배달 게이트: {}\n  {}\n- {}\n- 아직 작업이 진행 중이면 이 안내를 무시하고 계속하세요 \
             (이 게이트는 대화당 한 번만 뜹니다).",
            self.reason(),
            self.file_list(),
            self.action()
        )
    }

    /// 목록은 앞의 몇 개만 — 100개를 나열하면 지시가 묻힌다.
    fn file_list(&self) -> String {
        const SHOWN: usize = 5;
        let head = self
            .changed
            .iter()
            .take(SHOWN)
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        if self.changed.len() > SHOWN {
            format!("{head} 외 {}개", self.changed.len() - SHOWN)
        } else {
            head
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/// 이 대화가 자기 작업을 기록했는가.
///
/// 순서가 곧 설계다:
/// 1. **기록 확인**이 먼저다. 기록했으면 변경이 누구 것이었는지 물을 이유가
///    없다.
/// 2. 기록이 확인되지 않으면 **변경 귀속**을 묻는다. 귀속을 확신하지 못하면
///    [`Undecided`] — 이의를 제기하지 **않는다.**
pub fn judge(input: &VerdictInput) -> Verdict {
    if let Some(basis) = recorded_basis(input) {
        return Verdict::Clear(Clear::Recorded(basis));
    }
    if !input.working_tree_readable {
        return Verdict::Undecided(Undecided::NoWorkingTree);
    }
    let Some(started) = input.segment_started_at else {
        return Verdict::Undecided(Undecided::NoSegmentMarker);
    };

    let mut changed: Vec<String> = input
        .changes
        .iter()
        .filter(|c| c.modified_at > started)
        .map(|c| c.path.clone())
        .collect();
    if changed.is_empty() {
        // 읽기만 한 세션은 여기서 끝난다 — 침묵.
        return Verdict::Clear(Clear::NothingToRecord);
    }
    if !input.live_peers.is_empty() {
        // 골든 케이스. mtime 은 "이 창 안에 변경이 있었다"까지만 말하고
        // "누가" 는 말하지 못한다. 용의자가 둘 이상이면 아무도 붙잡지 않는다.
        return Verdict::Undecided(Undecided::LivePeers {
            peers: input.live_peers.len(),
        });
    }
    changed.sort();
    changed.dedup();
    Verdict::Objection(Objection {
        basis: ChangeBasis::SoleLiveConversation,
        changed,
    })
}

/// 기록 확인 사다리. 위 칸이 없으면 **다음 칸으로 내려간다** — 없음을
/// 미기록으로 읽지 않는다.
fn recorded_basis(input: &VerdictInput) -> Option<RecordBasis> {
    let conv = input.conversation.trim();

    if !conv.is_empty() {
        // 1순위 — 일지가 자기 입으로 이 대화를 적었다. 유일하게 병렬 세션에서
        // 정확하다.
        if input
            .journals
            .iter()
            .any(|j| j.agent_session.as_deref().map(str::trim) == Some(conv))
        {
            return Some(RecordBasis::AgentSession);
        }

        // 2순위 — 이 대화가 참여자로 등록된 작업 세션에 일지가 걸려 있다.
        // 작업 세션 하나에 대화가 여럿 들어갈 수 있어 옆 대화의 일지가 우리를
        // 대신 덮을 수 있다 — 침묵 방향이라 감수한다 (위 "판정의 비대칭").
        let joined: BTreeSet<&str> = input
            .workday_sessions
            .iter()
            .filter(|s| s.agent_sessions.iter().any(|a| a.trim() == conv))
            .map(|s| s.id.as_str())
            .collect();
        if journal_filed_under(input, &joined) {
            return Some(RecordBasis::AgentSessions);
        }
    }

    if let Some(started) = input.segment_started_at {
        // 3순위 — 참여자 등록이 없어도(워처가 우리 훅을 못 봤다), 이 세그먼트의
        // 시각을 품는 작업 세션은 알 수 있다. `journal_write` 가 `session_id`
        // 를 찍을 때 쓰는 바로 그 경로다.
        let covering: BTreeSet<&str> = input
            .workday_sessions
            .iter()
            .filter(|s| s.started_at <= started && s.ended_at.map(|e| started <= e).unwrap_or(true))
            .map(|s| s.id.as_str())
            .collect();
        if journal_filed_under(input, &covering) {
            return Some(RecordBasis::SessionsJson);
        }

        // 4순위 — 마커 이후의 아무 일지. 이것이 여태 세 표면이 쓰던 전부이고,
        // **살아 있는 옆 대화가 있으면 쓰지 않는다**: 옆 대화의 일지로 우리가
        // 면죄되면 원장은 "기록했다"는 거짓을 남긴다. 그때는 침묵하되
        // 판정 불가로 남는 편이 정직하다.
        if input.live_peers.is_empty() && input.journals.iter().any(|j| j.modified_at > started) {
            return Some(RecordBasis::MarkerMtime);
        }
    }

    None
}

fn journal_filed_under(input: &VerdictInput, sessions: &BTreeSet<&str>) -> bool {
    !sessions.is_empty()
        && input.journals.iter().any(|j| {
            j.workday_session_id
                .as_deref()
                .is_some_and(|id| sessions.contains(id))
        })
}
