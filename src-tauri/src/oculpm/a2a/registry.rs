//! Phase 1 — 참여자 레지스트리 (마스터플랜 §4).
//!
//! 각 에이전트가 카드 하나를 `.oculpm/agents/live/<agent_id>.json` 에 둔다.
//! **파일인 이유**는 앱과 앱 밖 CLI 세션이 서로 다른 프로세스라 공유 메모리가
//! 없고, 데몬을 새로 띄우지 않고 둘 다 볼 수 있는 것이 디스크뿐이기 때문이다.
//! `.oculpm/hooks/` 와 같은 규약을 따른다 — gitignore 되지만 **워처는 본다**.
//!
//! ## 살아 있음을 어떻게 아는가
//!
//! TTL 하나로 판정하면 양쪽으로 틀린다: 짧게 잡으면 사람이 붙어 있는 CLI
//! 세션이 몇 십 분 조용하다는 이유로 죽은 것이 되고(위임이 허공으로 간다),
//! 길게 잡으면 죽은 세션이 목록에 남는다. 그래서 **pid 를 먼저 본다** —
//! 프로세스가 없으면 하트비트가 아무리 새것이어도 죽은 것이다. pid 가 살아
//! 있으면 하트비트는 "얼마나 오래 조용했나"의 참고값일 뿐이고, pid 재사용을
//! 감안해 아주 오래된 것만 죽은 것으로 본다.
//!
//! ## 모름은 죽음이 아니다 (플랜 `ledger-and-liveness-honesty`)
//!
//! 판정은 **셋** 이다 — [`Liveness::Live`] · [`Liveness::Dead`] · 그리고
//! [`Liveness::Unknown`]. 예전에는 `bool` 이라 "판정할 수 없다"를 적을 자리가
//! 없었고, 모름이 전부 죽음으로 흘러갔다. 그 값을 [`sweep`] 과
//! [`leases::expired`](super::leases) 가 읽으므로, **살아 있는 세션의 작업 구역을
//! 뺏는** 길이 열려 있었다. 이제 걷는 것은 `Dead` 뿐이다.
//!
//! 모름이 나오는 자리는 셋이다: 윈도우(값싼 pid 확인 수단이 없다), 하트비트
//! 시각을 파싱하지 못한 카드, `kill(2)` 가 `ESRCH`·`EPERM` 도 아닌 오류를 낸
//! 경우. 셋 다 "아직 모른다"이지 "없다"가 아니다.
//!
//! 그리고 이 판정은 **화면과 청소를 위한 가드이지 분산 락이 아니다.** 카드가
//! 살아 있다고 해서 그 프로세스가 지금 무엇을 하는지 알 수 없고, 죽었다고 해서
//! 그 순간 죽었다는 보장도 없다. 임대의 진짜 안전장치는 기한이다.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::error::OculpmError;

/// 카드가 사는 곳 (프로젝트 루트 기준). gitignore 관리 블록에 포함된다.
pub const LIVE_SUBDIR: &str = ".oculpm/agents/live";

/// pid 가 살아 있어도 이만큼 조용하면 죽은 것으로 본다 — pid 재사용 방어.
/// 사람이 붙어 있는 CLI 세션은 몇 시간씩 조용할 수 있어 넉넉히 잡는다.
pub const STALE_AFTER_HOURS: i64 = 12;

/// pid 를 확인할 수 없는 참여자(원격)의 TTL. 하트비트가 이보다 오래면 죽은 것.
pub const REMOTE_TTL_MINUTES: i64 = 30;

/// agent_id 최대 길이 (파일명이 된다).
const MAX_ID_LEN: usize = 64;

/// 카드가 어디서 도는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentSurface {
    /// 앱 안의 ACP 패널. 앱이 대신 등록하고 앱이 지운다.
    App,
    /// 앱 안팎의 터미널에서 도는 CLI 세션. 스스로 등록한다.
    Terminal,
    /// 로컬 프로세스가 아니다 (Phase 6 의 HTTP 문으로 들어온다).
    Remote,
}

/// A2A Agent Card + 우리 확장.
///
/// 표준 필드(`name`·`description`·`version`·`skills`)를 그대로 두는 이유는
/// Phase 6 에서 이 구조체가 `/.well-known/agent-card.json` 의 본문이 되기
/// 때문이다 — 그때 이름을 바꾸지 않으려고 지금부터 표준을 따른다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct AgentCard {
    /// 주소이자 파일명. `claude-app` · `codex-app` · `claude-term-a1b2c3d4`.
    pub agent_id: String,
    /// 사람이 읽는 이름 (ACP 핸드셰이크가 준 것 그대로).
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    /// 이 에이전트가 할 수 있다고 광고하는 것. v1 은 비워 둔다.
    #[serde(default)]
    pub skills: Vec<String>,
    /// 기록에 남는 이름 (`.oculpm` 일지의 `agent.id`) — `claude-code` · `codex`.
    pub provider: String,
    pub surface: AgentSurface,
    /// ocul-pm 세션 id (있으면). 일지 귀속과 이어 붙일 때 쓴다.
    pub session_id: Option<String>,
    /// 로컬 프로세스면 그 pid. 살아 있음 판정의 1차 신호다.
    pub pid: Option<u32>,
    pub project_root: String,
    /// 마지막으로 살아 있다고 말한 시각 (RFC3339).
    pub heartbeat_at: String,
    /// **이 신원을 우리가 준 것인가** (플랜 `session-shim-cli`).
    ///
    /// 앱이 띄운 세션은 심 디렉터리의 토큰으로 자기를 증명한다. 토큰 없이
    /// 등록한 세션은 이름이 **자칭**이다 — 막지는 않고(앱 밖 세션도 참여해야
    /// 한다) 화면이 그 차이를 말한다. 옛 카드에는 이 필드가 없으므로 기본은
    /// `false`: 모르는 것을 검증됨으로 올리지 않는다.
    #[serde(default)]
    pub verified: bool,
}

impl AgentCard {
    /// 하트비트 시각을 파싱한다. 못 읽으면 `None` — 그 카드는 시각을 모르는
    /// 것이지 죽은 것이 아니다 (pid 가 살아 있으면 살아 있다고 본다).
    fn beat(&self) -> Option<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&self.heartbeat_at)
            .ok()
            .map(|t| t.with_timezone(&Utc))
    }
}

/// 파일명이 될 수 있는 id 인가. 경로 구분자·`..` 를 막는 것이 요점이다 —
/// 카드는 앱 밖 에이전트가 직접 주는 값이라 그대로 붙이면 경로 탈출이 된다.
pub fn is_valid_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

pub fn live_dir(root: &Path) -> PathBuf {
    root.join(LIVE_SUBDIR)
}

fn card_path(root: &Path, agent_id: &str) -> PathBuf {
    live_dir(root).join(format!("{agent_id}.json"))
}

/// 카드를 등록한다 (같은 id 면 갈아 끼운다 — 재시작이 멱등해야 한다).
pub fn register(root: &Path, card: &AgentCard) -> Result<(), OculpmError> {
    if !is_valid_agent_id(&card.agent_id) {
        return Err(OculpmError::Io {
            path: live_dir(root),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("invalid agent_id: {}", card.agent_id),
            ),
        });
    }
    let body = serde_json::to_vec_pretty(card).map_err(|e| OculpmError::Io {
        path: card_path(root, &card.agent_id),
        source: std::io::Error::other(e),
    })?;
    write_atomic(&card_path(root, &card.agent_id), &body)
}

/// 살아 있다고 말한다. 카드가 없으면 아무 일도 하지 않는다 (`false`) —
/// 하트비트가 등록을 대신하면 지워진 참여자가 되살아난다.
pub fn heartbeat(root: &Path, agent_id: &str, now: DateTime<Utc>) -> Result<bool, OculpmError> {
    let Some(mut card) = read_card(&card_path(root, agent_id)) else {
        return Ok(false);
    };
    card.heartbeat_at = now.to_rfc3339();
    register(root, &card)?;
    Ok(true)
}

/// 등록을 지운다. 없으면 `false`.
pub fn unregister(root: &Path, agent_id: &str) -> bool {
    if !is_valid_agent_id(agent_id) {
        return false;
    }
    std::fs::remove_file(card_path(root, agent_id)).is_ok()
}

fn read_card(path: &Path) -> Option<AgentCard> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 디렉터리에 있는 카드 전부 (죽은 것 포함, 파일명 순).
///
/// 깨진 파일은 **조용히 건너뛴다** — 남이 쓴 파일을 읽는 자리라 하나가 깨졌다고
/// 목록 전체가 실패하면 안 된다 (transcript·hooks 와 같은 방어 규율).
pub fn read_all(root: &Path) -> Vec<AgentCard> {
    let Ok(entries) = std::fs::read_dir(live_dir(root)) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    paths.iter().filter_map(|p| read_card(p)).collect()
}

/// 지금 살아 있는 참여자만.
pub fn list_live(root: &Path, now: DateTime<Utc>) -> Vec<AgentCard> {
    read_all(root)
        .into_iter()
        .filter(|card| is_live(card, now))
        .collect()
}

/// 죽은 카드를 지운다. 지운 개수를 돌려준다.
///
/// **`Dead` 만 걷는다.** `!is_live` 로 쓰면 모름까지 지워져, 판정할 수 없는
/// 세션(윈도우·시각이 깨진 카드)이 목록에서 사라지고 그 임대가 풀린다.
pub fn sweep(root: &Path, now: DateTime<Utc>) -> usize {
    read_all(root)
        .into_iter()
        .filter(|card| liveness(card, now) == Liveness::Dead)
        .filter(|card| unregister(root, &card.agent_id))
        .count()
}

/// 참여자가 살아 있는가 — **모름이 셋째 상태다** (모듈 문서 참조).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Liveness {
    /// 근거를 갖고 살아 있다.
    Live,
    /// 근거를 갖고 죽었다. **이것만 걷는다.**
    Dead,
    /// 판정할 수 없다. 오프라인이 아니다.
    Unknown,
}

/// 이 카드의 생사 (판정 규칙은 모듈 문서에).
pub fn liveness(card: &AgentCard, now: DateTime<Utc>) -> Liveness {
    let beat = card.beat();
    match card.pid {
        // 로컬 프로세스 — pid 가 1차 신호.
        Some(pid) => match pid_state(pid) {
            Liveness::Dead => Liveness::Dead,
            // pid 재사용 방어: 살아 있는 pid 인데 아주 오래 조용하면 남의 pid 다.
            Liveness::Live => match beat {
                Some(beat) if now - beat >= Duration::hours(STALE_AFTER_HOURS) => Liveness::Dead,
                // 시각을 못 읽어도 pid 는 살아 있다 — 그것만으로 충분한 근거다.
                _ => Liveness::Live,
            },
            // pid 를 못 물어본다(윈도우 등) — 하트비트가 새것이면 살아 있다고
            // 보고, 아니면 **모른다.** 죽었다고 단정할 근거가 없다.
            Liveness::Unknown => match beat {
                Some(beat) if now - beat < Duration::minutes(REMOTE_TTL_MINUTES) => Liveness::Live,
                _ => Liveness::Unknown,
            },
        },
        // pid 를 모르는 참여자(원격)는 하트비트 TTL 로만 판정한다.
        None => match beat {
            Some(beat) if now - beat < Duration::minutes(REMOTE_TTL_MINUTES) => Liveness::Live,
            Some(_) => Liveness::Dead,
            // 시각을 파싱하지 못한 카드 — 읽지 못한 것은 죽은 것이 아니다.
            None => Liveness::Unknown,
        },
    }
}

/// 이 카드가 **확실히** 살아 있는가.
///
/// "누구에게 일을 넘길 수 있나" 처럼 근거를 요구하는 자리용이다. 청소하는 쪽은
/// 이것의 부정을 쓰면 안 된다 — 모름까지 죽음으로 삼킨다. [`liveness`] 를 쓸 것.
pub fn is_live(card: &AgentCard, now: DateTime<Utc>) -> bool {
    liveness(card, now) == Liveness::Live
}

/// 이 pid 로 도는 프로세스가 있는가.
///
/// 유닉스는 `kill(pid, 0)` 이 정답이다 — 시그널을 보내지 않고 존재만 묻는다
/// (권한이 없으면 `EPERM` 인데, 그것도 "있다"는 뜻이라 살아 있는 것으로 친다).
/// 윈도우에는 값싼 대응물이 없어 **모른다 = 살아 있다**로 두고 하트비트에
/// 맡긴다 — 죽은 것을 산 것으로 잠깐 보는 편이, 산 것을 죽었다고 지워
/// 위임을 허공으로 보내는 것보다 낫다.
#[cfg(unix)]
fn pid_state(pid: u32) -> Liveness {
    if pid == 0 {
        return Liveness::Dead;
    }
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if rc == 0 {
        return Liveness::Live;
    }
    match std::io::Error::last_os_error().raw_os_error() {
        // 남의 소유 프로세스 — 시그널은 못 보내지만 **있다.**
        Some(libc::EPERM) => Liveness::Live,
        Some(libc::ESRCH) => Liveness::Dead,
        // EINVAL 같은 그 밖의 오류는 pid 의 생사를 말해 주지 않는다.
        _ => Liveness::Unknown,
    }
}

#[cfg(not(unix))]
fn pid_state(_pid: u32) -> Liveness {
    // 윈도우에는 값싼 대응물이 없다. 예전에는 여기서 `true`(살아 있음)를
    // 돌려줬는데, 그건 모르는 것을 아는 척한 것이다. 모른다고 말하고 하트비트로
    // 넘긴다 — 그래도 청소는 `Dead` 만 걷으므로 산 것을 지우지 않는다.
    Liveness::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, pid: Option<u32>, beat: DateTime<Utc>) -> AgentCard {
        AgentCard {
            agent_id: id.to_string(),
            name: "Claude Code".to_string(),
            description: None,
            version: "0.73.0".to_string(),
            skills: Vec::new(),
            provider: "claude-code".to_string(),
            surface: AgentSurface::App,
            session_id: None,
            pid,
            project_root: "/tmp/p".to_string(),
            heartbeat_at: beat.to_rfc3339(),
            verified: false,
        }
    }

    #[test]
    fn agent_id_must_be_a_filename_not_a_path() {
        assert!(is_valid_agent_id("claude-app"));
        assert!(is_valid_agent_id("codex_term_a1b2"));
        // 카드는 앱 밖 에이전트가 주는 값이다 — 경로 탈출을 막는 것이 요점.
        assert!(!is_valid_agent_id("../../etc/passwd"));
        assert!(!is_valid_agent_id("a/b"));
        assert!(!is_valid_agent_id(".."));
        assert!(!is_valid_agent_id(""));
        assert!(!is_valid_agent_id(&"x".repeat(MAX_ID_LEN + 1)));
    }

    #[test]
    fn register_then_list_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let mine = std::process::id();

        register(dir.path(), &card("claude-app", Some(mine), now)).unwrap();
        let live = list_live(dir.path(), now);
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].agent_id, "claude-app");
        assert_eq!(live[0].provider, "claude-code");

        assert!(unregister(dir.path(), "claude-app"));
        assert!(list_live(dir.path(), now).is_empty());
    }

    /// 등록이 멱등해야 한다 — 앱이 재시작하며 같은 id 로 다시 쓴다.
    #[test]
    fn re_registering_replaces_instead_of_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let mine = std::process::id();

        register(dir.path(), &card("codex-app", Some(mine), now)).unwrap();
        let mut second = card("codex-app", Some(mine), now);
        second.version = "1.8.0".to_string();
        register(dir.path(), &second).unwrap();

        let live = list_live(dir.path(), now);
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].version, "1.8.0");
    }

    /// 죽은 pid 는 하트비트가 새것이어도 죽은 것이다.
    ///
    /// TTL 만 봤다면 방금 죽은 세션이 30분 동안 목록에 남아, 그리로 넘긴 작업이
    /// 허공으로 간다 (마스터플랜 R2).
    #[test]
    fn a_dead_pid_is_dead_however_fresh_the_heartbeat() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        // 확실히 없는 pid — 예약 범위 밖의 큰 값.
        let ghost = card("claude-term-ghost", Some(4_000_000_000), now);
        register(dir.path(), &ghost).unwrap();

        assert!(!is_live(&ghost, now));
        assert!(list_live(dir.path(), now).is_empty());
        assert_eq!(sweep(dir.path(), now), 1);
        assert!(read_all(dir.path()).is_empty());
    }

    /// **판정할 수 없는 카드를 죽었다고 부르지 않는다** (플랜
    /// `ledger-and-liveness-honesty`).
    ///
    /// pid 가 없고 하트비트 시각도 못 읽으면 남은 근거가 없다. 예전에는 그것이
    /// `false`(죽음)로 흘러 `sweep` 이 카드를 지웠고, 그 세션이 쥔 작업 구역이
    /// 함께 풀렸다.
    #[test]
    fn a_card_we_cannot_judge_is_unknown_not_dead() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let mut blind = card("remote-blind", None, now);
        blind.heartbeat_at = "언제인지 모를 시각".to_string();
        register(dir.path(), &blind).unwrap();

        assert_eq!(liveness(&blind, now), Liveness::Unknown);
        // 확실한 근거를 요구하는 자리에는 나서지 않는다.
        assert!(!is_live(&blind, now));
        // 그러나 **지워지지도 않는다.**
        assert_eq!(sweep(dir.path(), now), 0);
        assert_eq!(read_all(dir.path()).len(), 1);
    }

    /// 하트비트가 오래된 원격 참여자는 근거를 갖고 죽은 것이다 — 모름이 아니다.
    #[test]
    fn a_stale_remote_heartbeat_is_dead_with_evidence() {
        let now = Utc::now();
        let stale = card(
            "remote-stale",
            None,
            now - Duration::minutes(REMOTE_TTL_MINUTES + 1),
        );
        assert_eq!(liveness(&stale, now), Liveness::Dead);
    }

    /// 살아 있는 pid 인데 아주 오래 조용하면 pid 재사용으로 본다.
    #[test]
    fn a_live_pid_gone_quiet_for_ages_is_treated_as_recycled() {
        let now = Utc::now();
        let mine = std::process::id();
        let ancient = card(
            "claude-term-old",
            Some(mine),
            now - Duration::hours(STALE_AFTER_HOURS + 1),
        );
        assert!(!is_live(&ancient, now));

        let recent = card("claude-term-new", Some(mine), now - Duration::hours(1));
        assert!(is_live(&recent, now));
    }

    /// pid 가 없는 참여자(원격)는 TTL 로만 판정한다.
    #[test]
    fn a_pidless_card_lives_by_ttl_alone() {
        let now = Utc::now();
        let fresh = card("remote-a", None, now - Duration::minutes(1));
        let stale = card(
            "remote-b",
            None,
            now - Duration::minutes(REMOTE_TTL_MINUTES + 1),
        );
        assert!(is_live(&fresh, now));
        assert!(!is_live(&stale, now));
    }

    /// 하트비트는 **등록을 대신하지 않는다** — 지워진 참여자를 되살리면
    /// "닫은 세션이 목록에 돌아오는" 유령이 된다.
    #[test]
    fn heartbeat_does_not_resurrect_an_unregistered_agent() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        assert!(!heartbeat(dir.path(), "claude-app", now).unwrap());
        assert!(read_all(dir.path()).is_empty());

        register(
            dir.path(),
            &card("claude-app", Some(std::process::id()), now),
        )
        .unwrap();
        assert!(heartbeat(dir.path(), "claude-app", now).unwrap());
    }

    /// 남이 쓴 파일을 읽는 자리다 — 하나가 깨져도 나머지는 보여야 한다.
    #[test]
    fn a_corrupt_card_does_not_take_the_list_down() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        register(
            dir.path(),
            &card("codex-app", Some(std::process::id()), now),
        )
        .unwrap();
        std::fs::write(live_dir(dir.path()).join("broken.json"), "{ not json").unwrap();
        // json 이 아닌 파일도 섞여 있을 수 있다.
        std::fs::write(live_dir(dir.path()).join("README.txt"), "ignore me").unwrap();

        let live = list_live(dir.path(), now);
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].agent_id, "codex-app");
    }
}
