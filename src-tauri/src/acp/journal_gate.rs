//! 앱 안 ACP 대화의 **배달 게이트** (플랜 `v3-record-integrity` {#gate-beyond-cc}).
//!
//! Claude Code 의 셸 훅이 하는 일을 앱이 인프로세스로 한다. 훅이 없기 때문이다 —
//! `client_mcp_servers()` 는 MCP 서버를 넘기지 훅을 넘기지 않는다.
//!
//! # 이 모듈이 하는 일 두 가지
//!
//! **① 생존 흔적을 남긴다** ([`markers`](crate::oculpm::verdict::markers)).
//! 이게 없으면 판정이 자기 자신에 대해서도, 옆 대화에 대해서도 무너진다. 특히
//! 뒤쪽이 중요하다: 같은 워킹트리에서 도는 Claude Code 대화의 게이트는 "살아
//! 있는 다른 대화"를 그 파일 두 개로만 센다. ACP 대화가 흔적을 안 남기면 ACP 의
//! 편집이 **CC 대화의 것으로 보이고**, 한 글자도 안 쓴 CC 세션이 붙잡힌다.
//!
//! **② 판정을 붙인다** ([`judge`](crate::oculpm::verdict::judge)). 셸을 거치지
//! 않는다 — 우리는 이미 그 함수가 사는 프로세스 안이다. `oculpm-mcp verdict`
//! 서브커맨드는 셸 전용 껍데기고, 여기서는 [`collect`] + [`judge`] 를 직접 부른다.
//!
//! # 차단 대신 무엇을 하는가
//!
//! Claude Code 훅은 `exit 2` 로 턴을 되돌릴 수 있다. 앱 안 ACP 에는 그 수단이
//! 없다 — 프로토콜에 "이 턴을 물리고 에이전트에게 다시 시키기"가 없고, 있다 해도
//! 사용자가 보고 있는 대화에서 앱이 말없이 턴을 한 번 더 돌리는 것은 게이트가
//! 아니라 유령이다.
//!
//! 그래서 **대화 위에 배너 하나**다. 규율은 셸 게이트에서 그대로 가져온다.
//!
//! - **대화당 한 번만 발화한다** — `.delivery-gate-<대화>` 플래그를 CC 훅과
//!   **같은 파일**로 공유한다. 반복하면 잔소리가 되고, 잔소리는 무시된다.
//! - **기록하면 사라진다** — 매 턴 다시 판정해서 [`Clear`] 가 되면 배너를 거둔다.
//!   한 번 뜨고 안 없어지는 경고는 사용자가 배너를 끄는 법을 배우게 만든다.
//! - **판정 불가에는 침묵한다** — 옆 대화가 살아 있으면 아무도 붙잡지 않는다.
//!
//! 조용한 성공도 아니다: 발화 순간 신호 원장에 `missing` 한 줄이 남아 Today
//! 카드와 회고의 상시 한 줄이 센다. 사용자가 배너를 못 보고 지나가도 숫자는 남는다.
//!
//! # 왜 "세션 종료"가 아니라 매 턴인가
//!
//! 앱 안 대화에는 `SessionEnd` 가 없다. 대화는 탭에 그대로 있고, 어댑터가 죽어도
//! 대화는 에이전트 쪽에 남아 언제든 재개된다. "종료 때 판정"만 걸면 판정이 영영
//! 안 도는 대화가 대부분이 된다. 그래서 판정은 **턴 끝**에 붙이고 — 그것이
//! `delivery-gate.sh` 가 `Stop` 에서 하는 일과 같은 자리다 — 명시적으로 내리거나
//! 지우는 순간([`closed`])에 `session-end.sh` 처럼 한 번 더 정리한다.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::oculpm::verdict::{self, markers, Clear, Verdict};

/// 대화 위에 뜨는 이의 한 건.
///
/// 판정이 만든 문구를 그대로 들고 간다 — 화면이 다시 짓지 않는다. 같은 사건에
/// 두 벌의 어휘가 생기면 어느 쪽이 진짜인지 아무도 모르게 된다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct AcpObjection {
    /// 어느 ACP 대화의 이의인가 — 화면이 자기 대화인지 가른다.
    pub acp_session_id: String,
    /// 그 대화의 기록 신원 (`agent.session` 에 실리는 값).
    pub conversation: String,
    /// 기록되지 않은 변경 (정렬·중복 제거됨).
    pub changed: Vec<String>,
    /// 몇 개를 왜 붙잡았는가.
    pub reason: String,
    /// **무엇을 하라** — 도구 이름과 대상까지.
    pub action: String,
}

/// 대화별 미해소 이의. 기록이 아니라 **화면이 읽을 최신 상태**다.
#[derive(Default)]
pub struct AcpGateState {
    pending: Mutex<HashMap<String, AcpObjection>>,
    /// 사용자가 닫은 대화. 판정이 살아 있어도 배너를 다시 세우지 않는다.
    dismissed: Mutex<BTreeSet<String>>,
}

/// 이 표가 들고 있을 최대 대화 수. 넘으면 통째로 비운다 — 캐시지 기록이 아니라,
/// 잃어도 다음 턴에 다시 판정되어 돌아온다.
const MAX_PENDING: usize = 64;

impl AcpGateState {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, AcpObjection>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn dismissed(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.dismissed.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 이의를 세운다 — **닫아 둔 대화에는 다시 세우지 않는다.**
    ///
    /// 이 한 줄이 "대화당 1회"의 화면 쪽 절반이다. 없으면 다음 턴의 판정이
    /// 배너를 그대로 다시 세워, 사용자가 닫은 것이 닫히지 않는다.
    pub fn record(&self, objection: AcpObjection) {
        if self.dismissed().contains(&objection.acp_session_id) {
            return;
        }
        let mut map = self.map();
        if map.len() >= MAX_PENDING && !map.contains_key(&objection.acp_session_id) {
            map.clear();
        }
        map.insert(objection.acp_session_id.clone(), objection);
    }

    pub fn get(&self, acp_session_id: &str) -> Option<AcpObjection> {
        self.map().get(acp_session_id).cloned()
    }

    /// 사용자가 배너를 닫았다 — 이 대화에서는 다시 세우지 않는다.
    pub fn dismiss(&self, acp_session_id: &str) {
        self.map().remove(acp_session_id);
        let mut seen = self.dismissed();
        if seen.len() >= MAX_PENDING {
            seen.clear();
        }
        seen.insert(acp_session_id.to_string());
    }

    /// 해소됐다 (기록했거나 대화가 사라졌다).
    ///
    /// 닫아 둔 기억도 함께 지운다: 기록한 **뒤에** 새로 생긴 미기록 변경은 그
    /// 대화의 새 사건이고, 그때는 다시 말해 주는 편이 맞다 (원장은 안 는다 —
    /// `.delivery-gate-<대화>` 플래그가 이미 서 있다).
    pub fn clear(&self, acp_session_id: &str) {
        self.map().remove(acp_session_id);
        self.dismissed().remove(acp_session_id);
    }
}

/// 이 대화의 세그먼트를 연다 — `session/new` 성공과 `session/load` 직후.
///
/// `conversation` 은 [`recording`](super::recording) 이 발급한 기록 신원이다.
/// ACP UUID 가 아닌 이유: 일지의 `agent.session` 에 실려 나가는 값이 이것이고,
/// 판정 사다리의 1순위가 그 값을 본다.
pub fn opened(root: &Path, conversation: &str) {
    markers::open_segment(root, conversation);
}

/// 턴 하나가 끝났다 — 생존 흔적을 갱신하고 판정한다.
///
/// 반환값은 **화면에 띄울 이의**다. `None` 이면 조용하다 (기록했거나, 기록할 것이
/// 없거나, 판정할 수 없다).
///
/// 생존 흔적을 판정 **전에** 찍는다 — `delivery-gate.sh` 와 같은 순서다. 동시에
/// 도는 옆 대화가 우리를 볼 수 있어야 그쪽이 우리 편집을 자기 것으로 오인하지
/// 않는다.
pub fn turn_ended(
    state: &AcpGateState,
    root: &Path,
    acp_session_id: &str,
    conversation: &str,
) -> Option<AcpObjection> {
    markers::touch_live(root, conversation);
    if conversation.trim().is_empty() {
        return None;
    }

    let now = Utc::now();
    let verdict = verdict::judge(&verdict::collect(root, conversation, now.timestamp()));
    match verdict {
        Verdict::Objection(ref objection) => {
            let pending = AcpObjection {
                acp_session_id: acp_session_id.to_string(),
                conversation: conversation.to_string(),
                changed: objection.changed.clone(),
                reason: objection.reason(),
                action: objection.action(),
            };
            // 원장은 **처음 붙잡을 때 한 번만.** 매 턴 적으면 한 대화가 원장을
            // 통째로 밀어낸다. 플래그는 CC 훅과 같은 파일이라, 같은 대화 id 로
            // 셸이 먼저 말했으면 여기서는 조용히 넘어간다.
            if markers::claim_gate_once(root, conversation) {
                verdict::ledger::append(root, conversation, &verdict, now);
            }
            state.record(pending.clone());
            Some(pending)
        }
        // 기록했으면 배너를 거둔다. 한 번 뜬 경고가 안 없어지면 사용자는 배너를
        // 끄는 법을 배운다.
        Verdict::Clear(Clear::Recorded(_)) | Verdict::Clear(Clear::NothingToRecord) => {
            state.clear(acp_session_id);
            None
        }
        // 판정 불가는 그대로 둔다 — 걷지도, 새로 띄우지도 않는다. 모름을
        // 무결로도 위반으로도 말하지 않는 규율이 여기까지 이어진다.
        Verdict::Undecided(_) => None,
    }
}

/// 대화를 명시적으로 내렸다 (어댑터 정지 · 대화 삭제).
///
/// `session-end.sh` 와 같은 순서다: **판정이 먼저**, 그다음 마커 청소. 뒤집으면
/// 판정이 자기 마커를 못 찾아 늘 판정 불가가 된다.
pub fn closed(state: &AcpGateState, root: &Path, acp_session_id: &str, conversation: &str) {
    if !conversation.trim().is_empty() {
        let now = Utc::now();
        let verdict = verdict::judge(&verdict::collect(root, conversation, now.timestamp()));
        verdict::ledger::append(root, conversation, &verdict, now);
    }
    markers::close_segment(root, conversation);
    state.clear(acp_session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn objection(session: &str) -> AcpObjection {
        AcpObjection {
            acp_session_id: session.to_string(),
            conversation: format!("acp-20260905-{session}"),
            changed: vec!["src/lib.rs".into()],
            reason: "r".into(),
            action: "a".into(),
        }
    }

    #[test]
    fn a_pending_objection_is_readable_per_conversation_and_clears() {
        let state = AcpGateState::default();
        state.record(objection("uuid-1"));
        state.record(objection("uuid-2"));

        assert_eq!(
            state.get("uuid-1").unwrap().conversation,
            "acp-20260905-uuid-1"
        );
        assert!(state.get("uuid-3").is_none(), "모르는 대화는 None 이다");

        state.clear("uuid-1");
        assert!(state.get("uuid-1").is_none());
        assert!(
            state.get("uuid-2").is_some(),
            "옆 대화를 함께 거두면 안 된다"
        );
    }

    /// **닫은 배너는 다음 턴에 다시 서지 않는다** — "대화당 1회"의 화면 쪽 절반.
    ///
    /// 판정은 매 턴 다시 도는데, 닫힘을 기억하지 않으면 판정이 배너를 그대로
    /// 다시 세운다. 그러면 사용자가 닫은 것이 닫히지 않고, 게이트는 잔소리가 된다.
    #[test]
    fn a_dismissed_banner_does_not_come_back_on_the_next_turn() {
        let state = AcpGateState::default();
        state.record(objection("uuid-1"));
        state.dismiss("uuid-1");

        state.record(objection("uuid-1"));
        assert!(state.get("uuid-1").is_none(), "닫은 배너가 다시 섰다");
        state.record(objection("uuid-2"));
        assert!(state.get("uuid-2").is_some(), "옆 대화까지 함께 막았다");

        // 기록해서 해소되면 닫은 기억도 풀린다 — 그 뒤에 새로 생긴 미기록은
        // 그 대화의 **새 사건**이라 다시 말해 주는 편이 맞다.
        state.clear("uuid-1");
        state.record(objection("uuid-1"));
        assert!(state.get("uuid-1").is_some());
    }

    /// 표가 무한히 자라지 않는다. 잃어도 다음 턴에 다시 판정돼 돌아온다.
    #[test]
    fn the_pending_table_is_bounded() {
        let state = AcpGateState::default();
        for i in 0..(MAX_PENDING + 3) {
            state.record(objection(&format!("uuid-{i}")));
        }
        assert!(state.map().len() <= MAX_PENDING);
    }

    /// 빈 신원으로는 판정하지 않는다 — 신원이 없으면 무엇을 붙잡을지 모른다.
    #[test]
    fn an_empty_identity_never_raises_an_objection() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        let state = AcpGateState::default();
        assert!(turn_ended(&state, dir.path(), "uuid-1", "   ").is_none());
    }
}
