//! 이 프로세스가 **열어 둔 세그먼트 등록부** (플랜 `v3-release` {#acp-segment-close}).
//!
//! # 왜 필요한가
//!
//! 세그먼트를 닫는 자리가 여태 둘뿐이었다 — `acp_stop`(사용자가 어댑터를 내림)
//! 과 `acp_delete_session`(대화 삭제). 둘 다 **사용자가 명시적으로 한 일**이다.
//! 그러지 않고 끝나는 길이 실제로는 더 흔하다.
//!
//! - **앱 종료** — `ExitRequested` 는 어댑터를 내리지만 마커는 그대로 둔다.
//! - **어댑터 사망** — node 가 죽거나 로그인이 풀리면 연결 태스크가 끝나는데,
//!   그 자리에서도 마커를 안 거뒀다.
//!
//! 남은 `.session-live-<대화>` 는 [`PEER_LIVE_WINDOW_SECS`] 동안 "살아 있는
//! 대화"로 계속 세어진다. 그 여섯 시간 동안 같은 워킹트리의 **옆 대화**는
//! 용의자가 둘이라고 판단해 판정을 포기한다([`Undecided::LivePeers`]) — 즉
//! 죽은 대화 하나가 게이트 전체를 침묵시킨다.
//!
//! [`PEER_LIVE_WINDOW_SECS`]: crate::oculpm::verdict::PEER_LIVE_WINDOW_SECS
//! [`Undecided::LivePeers`]: crate::oculpm::verdict::Undecided::LivePeers
//!
//! # 왜 등록부인가 (마커를 훑지 않고)
//!
//! 종료 시점에 `.oculpm/hooks` 를 훑어 전부 지우는 편이 짧지만, 그 폴더에는
//! **셸 훅이 쓴 남의 대화 마커**가 섞여 있다. 옆 터미널에서 도는 Claude Code
//! 대화의 마커를 우리가 지우면 그쪽이 스스로 눈을 감는다 — `prune_stale` 이
//! 나이로만 걷는 이유와 같은 규율이다. 그래서 **우리가 연 것만** 적어 두고
//! 그것만 닫는다.
//!
//! # 수명
//!
//! | 사건 | 등록부 |
//! |---|---|
//! | `session/new` · `session/load` 성공 | 적는다 (같은 대화는 한 줄) |
//! | `acp_stop` · `acp_delete_session` | 그 줄을 지운다 (닫기는 커맨드가 한다) |
//! | 어댑터 사망 | 그 대상의 줄을 **꺼내서** 닫는다 |
//! | 앱 종료 | 전부 **꺼내서** 닫는다 |
//!
//! 프로세스 안에서만 사는 표라 앱이 SIGKILL 로 죽으면 이 길도 안 돈다. 그때는
//! 예전과 같이 6시간 창이 만료를 대신한다 — 이 등록부는 그 창을 **없애는** 것이
//! 아니라 정상 종료·어댑터 사망에서 **당장 닫는** 것이 몫이다.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 열려 있는 세그먼트 한 줄.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSegment {
    /// 어느 어댑터(프로젝트×provider)의 것인가.
    pub target_id: u64,
    /// 그 대화가 사는 프로젝트 루트 (마커가 놓인 자리).
    pub root: PathBuf,
    /// 기록 신원 (`agent.session` 에 실리는 값) — 마커 이름의 접미.
    pub conversation: String,
}

/// 이 프로세스가 연 세그먼트 전부. 잠금 구간이 짧아(밀어넣기/꺼내기) 표준
/// `Mutex` 로 충분하고, 독이 올라도 [`into_inner`](std::sync::PoisonError)
/// 로 이어 간다 — 청소를 못 하는 것이 청소를 잘못하는 것보다 나쁘다.
#[derive(Default)]
pub struct OpenSegments {
    inner: Mutex<Vec<OpenSegment>>,
}

/// 등록부가 들고 있을 최대 줄 수. 넘으면 가장 오래된 것부터 버린다 — 표는
/// 청소 목록이지 기록이 아니라서, 잃어도 6시간 창이 뒤를 봐준다.
const MAX_OPEN: usize = 64;

impl OpenSegments {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<OpenSegment>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 이 대화의 세그먼트를 열었다고 적는다. 같은 대화는 한 줄만 남는다 —
    /// 재개(`session/load`)가 같은 신원으로 다시 오기 때문이다.
    pub fn remember(&self, target_id: u64, root: &Path, conversation: &str) {
        if conversation.trim().is_empty() {
            return;
        }
        let mut open = self.lock();
        open.retain(|s| s.conversation != conversation);
        if open.len() >= MAX_OPEN {
            open.remove(0);
        }
        open.push(OpenSegment {
            target_id,
            root: root.to_path_buf(),
            conversation: conversation.to_string(),
        });
    }

    /// 이미 닫힌 대화를 표에서 뺀다 (닫기는 커맨드 쪽이 이미 했다).
    pub fn forget(&self, conversation: &str) {
        self.lock().retain(|s| s.conversation != conversation);
    }

    /// 이 대상의 열린 세그먼트를 **꺼낸다** — 꺼낸 것은 표에서 사라지므로
    /// 어댑터 사망과 앱 종료가 겹쳐도 같은 대화를 두 번 닫지 않는다.
    pub fn take_for_target(&self, target_id: u64) -> Vec<OpenSegment> {
        let mut open = self.lock();
        let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *open)
            .into_iter()
            .partition(|s| s.target_id == target_id);
        *open = rest;
        mine
    }

    /// 전부 꺼낸다 (앱 종료).
    pub fn take_all(&self) -> Vec<OpenSegment> {
        std::mem::take(&mut *self.lock())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(target: u64, conv: &str) -> OpenSegment {
        OpenSegment {
            target_id: target,
            root: PathBuf::from("/p"),
            conversation: conv.to_string(),
        }
    }

    /// 재개는 같은 신원으로 다시 온다 — 줄이 늘면 종료 때 같은 대화를 두 번
    /// 닫으려 들고, 두 번째는 마커가 없어 늘 "판정 불가"를 원장에 적는다.
    #[test]
    fn reopening_the_same_conversation_keeps_one_row() {
        let open = OpenSegments::default();
        open.remember(1, Path::new("/p"), "c1");
        open.remember(1, Path::new("/p"), "c1");
        assert_eq!(open.take_all(), vec![seg(1, "c1")]);
    }

    /// 어댑터 하나가 죽어도 **옆 어댑터의 대화는 살아 있다.** 함께 꺼내면
    /// 도는 대화의 마커를 지워 그 대화가 스스로 눈을 감는다.
    #[test]
    fn a_dead_adapter_only_takes_its_own_conversations() {
        let open = OpenSegments::default();
        open.remember(1, Path::new("/p"), "c1");
        open.remember(2, Path::new("/p"), "c2");

        assert_eq!(open.take_for_target(1), vec![seg(1, "c1")]);
        assert_eq!(open.take_all(), vec![seg(2, "c2")]);
    }

    /// 꺼낸 줄은 사라진다 — 어댑터 사망 뒤 앱 종료가 이어져도 두 번 닫지 않는다.
    #[test]
    fn taking_a_segment_removes_it_from_the_table() {
        let open = OpenSegments::default();
        open.remember(1, Path::new("/p"), "c1");

        assert_eq!(open.take_for_target(1).len(), 1);
        assert!(open.take_for_target(1).is_empty());
        assert!(open.take_all().is_empty());
    }

    /// 명시적으로 닫은 대화(`acp_stop`)는 표에서 빠진다.
    #[test]
    fn an_explicitly_closed_conversation_is_forgotten() {
        let open = OpenSegments::default();
        open.remember(1, Path::new("/p"), "c1");
        open.forget("c1");
        assert!(open.take_all().is_empty());
    }

    /// 빈 신원은 적지 않는다 — 마커 이름이 접미 없이 만들어져 아무도 못 읽는다.
    #[test]
    fn an_empty_identity_is_never_remembered() {
        let open = OpenSegments::default();
        open.remember(1, Path::new("/p"), "   ");
        assert!(open.take_all().is_empty());
    }

    /// 표는 무한히 자라지 않는다. 잃어도 6시간 창이 뒤를 봐준다.
    #[test]
    fn the_table_is_bounded() {
        let open = OpenSegments::default();
        for i in 0..(MAX_OPEN + 5) {
            open.remember(1, Path::new("/p"), &format!("c{i}"));
        }
        assert_eq!(open.take_all().len(), MAX_OPEN);
    }
}
