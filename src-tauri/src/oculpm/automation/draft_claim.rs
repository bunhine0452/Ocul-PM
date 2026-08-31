//! 초안 이중 생성 금지 — 두 경로가 나눠 갖는 중복 키 (Phase 2 §2.3).
//!
//! 일지 초안을 만드는 길이 이제 **둘**이다:
//!
//! | 경로 | 발동 | 존재 이유 |
//! |---|---|---|
//! | 훅 `AgentExit` (`journal_draft.rs`) | Claude Code 세션 종료 | 정밀한 transcript 요약 |
//! | 정착 트리거 (`watchers.rs`) | 손이 멎음 | **비-Claude-Code 작업**이 안 사라지게 |
//!
//! 둘은 같은 작업 구간에 **둘 다** 걸릴 수 있다. 세션이 끝나면 훅이 초안을 쓰고,
//! 그 쓰기가 잦아든 뒤 정착 타이머가 만료되면 두 번째 초안이 생긴다.
//!
//! # 왜 "일지가 있나" 검사만으로는 부족한가
//!
//! [`crate::oculpm::journal_draft::self_entry_exists`] 는 mtime 으로 창 안의 일지를
//! 전부 본다(자필이든 `auto:*` 초안이든) — 그래서 **순차로 도착하면** 나중 쪽이
//! 알아서 비킨다. 하지만 두 경로가 **동시에** 검사를 통과하면 둘 다 쓴다.
//! 그 창을 막는 것이 이 등록소다: 같은 구간에 겹치는 청구는 **먼저 온 쪽만**
//! 성공하고, 진 쪽은 사유를 들고 물러난다.
//!
//! # 왜 테이블이 아니라 메모리인가
//!
//! 두 경로는 같은 프로세스 안에 있다(훅 소비도 정착 드라이버도 이 앱이다).
//! Phase 2 는 새 마이그레이션을 예약하지 않았고(R6), 청구는 **한 구간이 살아
//! 있는 동안**에만 의미가 있다 — 재시작 후에는 디스크의 일지가 그 사실을 이미
//! 말해 준다. 그래서 프로세스 수명의 등록소로 충분하다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use chrono::{DateTime, Duration as ChronoDuration, Utc};

/// 청구를 들고 있는 시간. 이보다 오래된 것은 새 청구가 올 때 버린다 —
/// 하루 종일 켜 둔 앱에서 등록소가 자라지 않게.
pub const CLAIM_TTL: ChronoDuration = ChronoDuration::hours(6);

/// 초안을 만들려는 두 경로. 진 쪽의 사유 문구에 들어간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DraftPath {
    /// 훅 `AgentExit` — Claude Code 세션 종료.
    HookAgentExit,
    /// 정착 트리거 — 손이 멎었다.
    Settle,
}

impl DraftPath {
    pub fn as_str(self) -> &'static str {
        match self {
            DraftPath::HookAgentExit => "hook agent-exit",
            DraftPath::Settle => "settle trigger",
        }
    }
}

/// 청구 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimVerdict {
    /// 이 구간은 내 것이다 — 써도 된다.
    Claimed,
    /// 겹치는 구간을 이미 다른 경로가 잡았다. 사유와 함께 물러난다.
    Taken(DraftPath),
}

#[derive(Debug, Clone, Copy)]
struct Claim {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    by: DraftPath,
    at: DateTime<Utc>,
}

/// 두 구간이 겹치는가 (닫힌 구간 — 경계가 맞닿아도 같은 작업으로 본다).
pub fn overlaps(a: (DateTime<Utc>, DateTime<Utc>), b: (DateTime<Utc>, DateTime<Utc>)) -> bool {
    a.0 <= b.1 && b.0 <= a.1
}

/// 진 쪽이 원장에 적을 사유. `None` = 이겼다(쓸 차례다).
///
/// 문구가 여기 한 곳에만 있는 이유: 두 경로가 서로 다른 말로 스킵을 적으면
/// History 에서 "왜 안 돌았나" 를 읽을 수 없다.
pub fn claim_skip_reason(verdict: ClaimVerdict) -> Option<&'static str> {
    match verdict {
        ClaimVerdict::Claimed => None,
        ClaimVerdict::Taken(DraftPath::HookAgentExit) => {
            Some("같은 구간을 훅(AgentExit) 초안이 먼저 잡았다")
        }
        ClaimVerdict::Taken(DraftPath::Settle) => Some("같은 구간을 정착 트리거가 먼저 잡았다"),
    }
}

/// 프로젝트별 중복 키 등록소. 프로세스에 하나 두고 두 경로가 공유한다.
#[derive(Debug, Default)]
pub struct DraftClaims {
    inner: Mutex<HashMap<u32, Vec<Claim>>>,
}

impl DraftClaims {
    pub fn new() -> Self {
        Self::default()
    }

    /// `(project_id, start..end)` 를 청구한다. 겹치는 청구가 이미 있으면
    /// [`ClaimVerdict::Taken`] — **잡은 쪽이 이긴다** (나중 쪽은 쓰지 않는다).
    ///
    /// `now` 는 주입 — TTL 정리도 시각을 읽지 않는다.
    pub fn try_claim(
        &self,
        project_id: u32,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        by: DraftPath,
        now: DateTime<Utc>,
    ) -> ClaimVerdict {
        // start > end 로 들어오면(시계 역전) 한 점으로 접는다 — 패닉하지 않는다.
        let (start, end) = if start <= end {
            (start, end)
        } else {
            (end, end)
        };
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            // 다른 스레드가 패닉해 락이 오염됐다 — 중복 방지가 앱을 멈출 이유는
            // 없다. 안쪽 값을 그대로 쓴다.
            Err(poisoned) => poisoned.into_inner(),
        };
        let list = guard.entry(project_id).or_default();
        list.retain(|c| now - c.at < CLAIM_TTL);
        if let Some(existing) = list
            .iter()
            .find(|c| overlaps((c.start, c.end), (start, end)))
        {
            return ClaimVerdict::Taken(existing.by);
        }
        list.push(Claim {
            start,
            end,
            by,
            at: now,
        });
        ClaimVerdict::Claimed
    }

    /// 청구를 되돌린다 — 쓰기 전에 다른 이유로 물러날 때 (창을 영영 막지 않게).
    pub fn release(&self, project_id: u32, start: DateTime<Utc>, end: DateTime<Utc>) {
        let (start, end) = if start <= end {
            (start, end)
        } else {
            (end, end)
        };
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(list) = guard.get_mut(&project_id) {
            list.retain(|c| !(c.start == start && c.end == end));
        }
    }

    #[cfg(test)]
    fn len(&self, project_id: u32) -> usize {
        self.inner
            .lock()
            .map(|g| g.get(&project_id).map(Vec::len).unwrap_or(0))
            .unwrap_or(0)
    }
}

/// 이 구간 안에 **어떤 일지든** 이미 있는가 (자필이든 `auto:*` 초안이든).
///
/// 정착 트리거의 첫 관문이다 — 설계 §2.3 의 "창 안에 어떤 일지든 있으면 스킵".
/// 판정 자체는 훅 경로와 **같은 함수**를 쓴다: 두 경로가 서로 다른 규칙으로
/// "이미 있음" 을 판단하면 그 차이가 곧 중복이다.
pub fn entry_exists_in_window(
    project_root: &Path,
    workday: &str,
    since: std::time::SystemTime,
) -> bool {
    let day_dir = project_root.join(".oculpm").join("journal").join(workday);
    crate::oculpm::journal_draft::self_entry_exists(&day_dir, since)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(secs: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-31T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
            + ChronoDuration::seconds(secs)
    }

    /// 설계 §3 — **초안 중복 방지**: 두 경로가 같은 구간에 걸려도 1건.
    #[test]
    fn two_paths_on_the_same_window_produce_one_claim() {
        let claims = DraftClaims::new();
        // 훅이 먼저 도착한다 (세션 09:00:00~09:05:00).
        assert_eq!(
            claims.try_claim(1, at(0), at(300), DraftPath::HookAgentExit, at(300)),
            ClaimVerdict::Claimed
        );
        // 정착 타이머가 같은 구간에 만료된다 — 진다.
        assert_eq!(
            claims.try_claim(1, at(60), at(320), DraftPath::Settle, at(320)),
            ClaimVerdict::Taken(DraftPath::HookAgentExit),
            "나중 쪽은 쓰지 않는다"
        );
        assert_eq!(claims.len(1), 1);
    }

    /// 진 쪽은 **사유와 함께** 물러난다 — 원장에 적히는 그 문장이다.
    #[test]
    fn the_loser_carries_a_reason_naming_the_winner() {
        assert_eq!(claim_skip_reason(ClaimVerdict::Claimed), None);
        assert!(
            claim_skip_reason(ClaimVerdict::Taken(DraftPath::HookAgentExit))
                .unwrap()
                .contains("훅")
        );
        assert!(claim_skip_reason(ClaimVerdict::Taken(DraftPath::Settle))
            .unwrap()
            .contains("정착"));
    }

    /// 순서가 반대여도 같다 — 먼저 온 쪽이 이긴다.
    #[test]
    fn the_first_arrival_wins_whichever_path_it_is() {
        let claims = DraftClaims::new();
        assert_eq!(
            claims.try_claim(1, at(0), at(300), DraftPath::Settle, at(300)),
            ClaimVerdict::Claimed
        );
        assert_eq!(
            claims.try_claim(1, at(120), at(400), DraftPath::HookAgentExit, at(400)),
            ClaimVerdict::Taken(DraftPath::Settle)
        );
    }

    #[test]
    fn separate_windows_and_projects_do_not_collide() {
        let claims = DraftClaims::new();
        claims.try_claim(1, at(0), at(300), DraftPath::Settle, at(300));
        // 겹치지 않는 다음 구간.
        assert_eq!(
            claims.try_claim(1, at(301), at(600), DraftPath::Settle, at(600)),
            ClaimVerdict::Claimed
        );
        // 다른 프로젝트는 남남이다.
        assert_eq!(
            claims.try_claim(2, at(0), at(300), DraftPath::Settle, at(300)),
            ClaimVerdict::Claimed
        );
    }

    #[test]
    fn touching_boundaries_count_as_the_same_work() {
        let claims = DraftClaims::new();
        claims.try_claim(1, at(0), at(300), DraftPath::HookAgentExit, at(300));
        assert_eq!(
            claims.try_claim(1, at(300), at(500), DraftPath::Settle, at(500)),
            ClaimVerdict::Taken(DraftPath::HookAgentExit)
        );
    }

    #[test]
    fn stale_claims_expire_so_the_registry_does_not_grow() {
        let claims = DraftClaims::new();
        claims.try_claim(1, at(0), at(300), DraftPath::Settle, at(300));
        // TTL 을 넘긴 뒤 같은 구간을 다시 청구하면 통과한다.
        let later = at(300) + CLAIM_TTL + ChronoDuration::seconds(1);
        assert_eq!(
            claims.try_claim(1, at(0), at(300), DraftPath::HookAgentExit, later),
            ClaimVerdict::Claimed
        );
        assert_eq!(claims.len(1), 1, "낡은 청구는 버려진다");
    }

    #[test]
    fn released_claims_free_the_window() {
        let claims = DraftClaims::new();
        claims.try_claim(1, at(0), at(300), DraftPath::Settle, at(300));
        claims.release(1, at(0), at(300));
        assert_eq!(
            claims.try_claim(1, at(0), at(300), DraftPath::HookAgentExit, at(310)),
            ClaimVerdict::Claimed
        );
    }

    #[test]
    fn reversed_bounds_collapse_instead_of_panicking() {
        let claims = DraftClaims::new();
        assert_eq!(
            claims.try_claim(1, at(300), at(0), DraftPath::Settle, at(300)),
            ClaimVerdict::Claimed
        );
        assert!(overlaps((at(0), at(10)), (at(5), at(20))));
        assert!(!overlaps((at(0), at(10)), (at(11), at(20))));
    }
}
