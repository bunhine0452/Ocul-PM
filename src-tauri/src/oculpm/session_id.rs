//! 세션 id 뉴타입 (완성도 라운드 Phase 4, 2026-08-30).
//!
//! 문자열 하나에 네 가지 방언이 살고 있었다 — 워처 `20260820-002`, 에이전트가
//! 직접 쓰는 `manual-20260820-205400`, 앱 없이 도는 MCP 의 `mcp-20260820-205400`,
//! git 백필의 `20260624-git`. 어느 것인지 가리는 코드가 네 군데에 각각 있었고
//! (`index.rs`·`session.rs`·`journal_draft.rs`·`agents_sync.rs`), 실패 모양이
//! 셋(Result/Option/skip)이었으며, 하나는 `manual-…` 의 워크데이를 `"manual"`
//! 로 잘못 읽었다. 여기 한 타입이 분류·발급·워크데이 파생을 전부 맡는다.
//!
//! 직렬화는 **투명**하다 — `sessions.json`·`file_changes.ndjson`·프런트매터·
//! 바인딩 어디에도 모양이 바뀌지 않는다 (`"id": "20260820-002"` 그대로).

use std::fmt;

use chrono::Timelike;
use serde::{Deserialize, Serialize};
use specta::Type;

/// 워처가 아닌 곳이 만든 id 의 접두 — 에이전트(`AGENTS.md` 규칙) 와 MCP 도구.
pub const MANUAL_PREFIX: &str = "manual-";
pub const MCP_PREFIX: &str = "mcp-";
/// 자동화가 만든 id 의 접두 (Osaurus 라운드 Phase 0, Decision 8).
/// `<workday>-sNN` 같은 접미 방언을 쓰면 [`SessionId::kind`] 가 tail 을 숫자로
/// 읽지 못해 `Unknown` 으로 떨어진다 — [`SessionId::workday`] 는 관용적으로
/// 통과시키므로 **색인은 되는데 분류만 조용히 죽는다**. 그래서 `manual-`/`mcp-`
/// 와 같은 접두형이다.
pub const SCHEDULE_PREFIX: &str = "sched-";
pub const AUTOMATION_PREFIX: &str = "auto-";
/// 외부 대화 임포트가 만든 id 의 접두 (Osaurus 라운드 Phase 7).
/// 접두형인 이유는 위와 같다 — 들여온 기록은 **원본 날짜**의 워크데이 폴더로
/// 들어가므로 접미 방언을 쓰면 그 날짜를 세션 id 에서 못 읽는다.
pub const IMPORT_PREFIX: &str = "import-";
/// git 백필 세션의 접미 — reconcile 의 비용 가드와 백필 작성기가 같은 값을 본다.
pub const GIT_BACKFILL_SUFFIX: &str = "-git";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SessionKind {
    /// `YYYYMMDD-NNN` — 워처가 발급. 유일하게 `sessions.json` 에 실린다.
    Watcher,
    /// `manual-YYYYMMDD-HHMMSS` — 에이전트가 파일을 직접 쓸 때.
    Manual,
    /// `mcp-YYYYMMDD-HHMMSS` — 앱 없이 도는 MCP `journal_write`.
    Mcp,
    /// `sched-YYYYMMDD-HHMMSS` — 시각 자동화(Schedules)가 발동한 작업.
    Schedule,
    /// `auto-YYYYMMDD-HHMMSS` — 감시 자동화(Watchers)·정착 트리거가 발동한 작업.
    Automation,
    /// `import-YYYYMMDD-HHMMSS` — 외부 대화(Claude export 등)를 들여온 일지.
    Imported,
    /// `YYYYMMDD-git` — 커밋 히스토리에서 합성한 일지.
    GitBackfill,
    /// 알 수 없는 모양 (프론트매터가 비었거나 손으로 적은 값).
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct SessionId(String);

fn is_digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

impl SessionId {
    pub fn new(raw: impl Into<String>) -> Self {
        Self(raw.into())
    }

    // ── 발급 ────────────────────────────────────────────────────────────────

    pub fn watcher(workday: &str, counter: u32) -> Self {
        Self(format!("{workday}-{counter:03}"))
    }

    /// `HHMMSS` 는 항상 0 으로 채운다 — 예전 수동 발급은 시(時)를 안 채워
    /// 10시 전엔 한 글자 짧은 id 가 나왔다.
    pub fn manual(workday: &str, local: impl Timelike) -> Self {
        Self(format!(
            "{MANUAL_PREFIX}{workday}-{:02}{:02}{:02}",
            local.hour(),
            local.minute(),
            local.second()
        ))
    }

    pub fn mcp(workday: &str, local: impl Timelike) -> Self {
        Self(format!(
            "{MCP_PREFIX}{workday}-{:02}{:02}{:02}",
            local.hour(),
            local.minute(),
            local.second()
        ))
    }

    /// 스케줄 발동 세션. `manual`/`mcp` 와 같은 모양이라 `kind()`·`workday()`
    /// 가 별도 규칙 없이 읽는다.
    pub fn schedule(workday: &str, local: impl Timelike) -> Self {
        Self(format!(
            "{SCHEDULE_PREFIX}{workday}-{:02}{:02}{:02}",
            local.hour(),
            local.minute(),
            local.second()
        ))
    }

    /// 감시(정착) 발동 세션.
    pub fn automation(workday: &str, local: impl Timelike) -> Self {
        Self(format!(
            "{AUTOMATION_PREFIX}{workday}-{:02}{:02}{:02}",
            local.hour(),
            local.minute(),
            local.second()
        ))
    }

    /// 임포트 세션. `workday` 는 **원본 대화의 날짜**다 — 들여온 시각이 아니라.
    pub fn imported(workday: &str, local: impl Timelike) -> Self {
        Self(format!(
            "{IMPORT_PREFIX}{workday}-{:02}{:02}{:02}",
            local.hour(),
            local.minute(),
            local.second()
        ))
    }

    pub fn git_backfill(workday: &str) -> Self {
        Self(format!("{workday}{GIT_BACKFILL_SUFFIX}"))
    }

    // ── 읽기 ────────────────────────────────────────────────────────────────

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }

    pub fn kind(&self) -> SessionKind {
        let s = self.0.as_str();
        if let Some(rest) = s.strip_prefix(MANUAL_PREFIX) {
            return if rest.len() >= 9 && is_digits(&rest[..8], 8) && rest.as_bytes()[8] == b'-' {
                SessionKind::Manual
            } else {
                SessionKind::Unknown
            };
        }
        if let Some(rest) = s.strip_prefix(MCP_PREFIX) {
            return if rest.len() >= 9 && is_digits(&rest[..8], 8) && rest.as_bytes()[8] == b'-' {
                SessionKind::Mcp
            } else {
                SessionKind::Unknown
            };
        }
        if let Some(rest) = s.strip_prefix(SCHEDULE_PREFIX) {
            return if rest.len() >= 9 && is_digits(&rest[..8], 8) && rest.as_bytes()[8] == b'-' {
                SessionKind::Schedule
            } else {
                SessionKind::Unknown
            };
        }
        if let Some(rest) = s.strip_prefix(AUTOMATION_PREFIX) {
            return if rest.len() >= 9 && is_digits(&rest[..8], 8) && rest.as_bytes()[8] == b'-' {
                SessionKind::Automation
            } else {
                SessionKind::Unknown
            };
        }
        if let Some(rest) = s.strip_prefix(IMPORT_PREFIX) {
            return if rest.len() >= 9 && is_digits(&rest[..8], 8) && rest.as_bytes()[8] == b'-' {
                SessionKind::Imported
            } else {
                SessionKind::Unknown
            };
        }
        let Some((head, tail)) = s.split_once('-') else {
            return SessionKind::Unknown;
        };
        if !is_digits(head, 8) {
            return SessionKind::Unknown;
        }
        if tail == &GIT_BACKFILL_SUFFIX[1..] {
            SessionKind::GitBackfill
        } else if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) {
            SessionKind::Watcher
        } else {
            SessionKind::Unknown
        }
    }

    /// 이 id 가 속한 워크데이(`YYYYMMDD`). 어느 방언이든 8자리 날짜가 들어 있으면
    /// 그것을 돌려준다 — `Unknown` 이라도 앞 8자가 숫자면 관용한다 (예전 IndexWriter
    /// 규약과 같아서 `20260624-m01` 같은 옛 합성 id 가 계속 읽힌다).
    pub fn workday(&self) -> Option<&str> {
        let s = self.0.as_str();
        match self.kind() {
            SessionKind::Manual => Some(&s[MANUAL_PREFIX.len()..MANUAL_PREFIX.len() + 8]),
            SessionKind::Mcp => Some(&s[MCP_PREFIX.len()..MCP_PREFIX.len() + 8]),
            SessionKind::Schedule => Some(&s[SCHEDULE_PREFIX.len()..SCHEDULE_PREFIX.len() + 8]),
            SessionKind::Automation => {
                Some(&s[AUTOMATION_PREFIX.len()..AUTOMATION_PREFIX.len() + 8])
            }
            SessionKind::Imported => Some(&s[IMPORT_PREFIX.len()..IMPORT_PREFIX.len() + 8]),
            SessionKind::Watcher | SessionKind::GitBackfill => Some(&s[..8]),
            SessionKind::Unknown => (s.len() >= 8 && is_digits(&s[..8], 8)).then(|| &s[..8]),
        }
    }

    pub fn is_watcher(&self) -> bool {
        self.kind() == SessionKind::Watcher
    }

    pub fn is_git_backfill(&self) -> bool {
        self.kind() == SessionKind::GitBackfill
    }

    /// 자동화가 만든 세션인가 (스케줄·워처 발동). 배경 작업이 자기 산출물을
    /// 원인으로 다시 도는 것을 막는 판정이다 — 증폭 루프 가드 R1 의 일부.
    pub fn is_automation_source(&self) -> bool {
        matches!(self.kind(), SessionKind::Schedule | SessionKind::Automation)
    }

    /// 워처 id 의 일련번호(`NNN`). 다른 방언은 `None`.
    pub fn watcher_counter(&self) -> Option<u32> {
        if !self.is_watcher() {
            return None;
        }
        self.0.split_once('-').and_then(|(_, n)| n.parse().ok())
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for SessionId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for SessionId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl AsRef<str> for SessionId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl PartialEq<str> for SessionId {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for SessionId {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl PartialEq<String> for SessionId {
    fn eq(&self, other: &String) -> bool {
        &self.0 == other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_every_dialect() {
        assert_eq!(SessionId::new("20260820-002").kind(), SessionKind::Watcher);
        assert_eq!(
            SessionId::new("manual-20260820-205400").kind(),
            SessionKind::Manual
        );
        assert_eq!(
            SessionId::new("mcp-20260820-205400").kind(),
            SessionKind::Mcp
        );
        assert_eq!(
            SessionId::new("20260624-git").kind(),
            SessionKind::GitBackfill
        );
        assert_eq!(
            SessionId::new("sched-20260831-170000").kind(),
            SessionKind::Schedule
        );
        assert_eq!(
            SessionId::new("auto-20260831-170000").kind(),
            SessionKind::Automation
        );
        assert_eq!(
            SessionId::new("import-20250714-113000").kind(),
            SessionKind::Imported
        );
        assert_eq!(SessionId::new("20260624-m01").kind(), SessionKind::Unknown);
        assert_eq!(SessionId::new("").kind(), SessionKind::Unknown);
        assert_eq!(SessionId::new("manual-x").kind(), SessionKind::Unknown);
        assert_eq!(SessionId::new("sched-x").kind(), SessionKind::Unknown);
        assert_eq!(SessionId::new("auto-x").kind(), SessionKind::Unknown);
        assert_eq!(SessionId::new("import-x").kind(), SessionKind::Unknown);
    }

    /// D8 회귀 — 접미 방언(`<workday>-sNN`)은 색인은 통과하되 분류가 죽는다.
    /// 이 테스트는 "그래서 접두형을 쓴다" 는 결정을 코드에 못박는다.
    #[test]
    fn suffix_dialect_would_lose_its_classification() {
        let suffixed = SessionId::new("20260831-s01");
        assert_eq!(suffixed.kind(), SessionKind::Unknown);
        assert_eq!(suffixed.workday(), Some("20260831")); // 색인은 통과 — 그래서 조용하다

        let t = chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap();
        assert_eq!(
            SessionId::schedule("20260831", t).kind(),
            SessionKind::Schedule
        );
        assert_eq!(
            SessionId::automation("20260831", t).kind(),
            SessionKind::Automation
        );
    }

    #[test]
    fn workday_comes_out_of_every_dialect() {
        assert_eq!(SessionId::new("20260820-002").workday(), Some("20260820"));
        assert_eq!(
            SessionId::new("manual-20260820-205400").workday(),
            Some("20260820")
        );
        assert_eq!(
            SessionId::new("mcp-20260820-205400").workday(),
            Some("20260820")
        );
        assert_eq!(
            SessionId::new("sched-20260831-170000").workday(),
            Some("20260831")
        );
        assert_eq!(
            SessionId::new("auto-20260831-170000").workday(),
            Some("20260831")
        );
        // 임포트는 **원본 대화의 날짜**를 싣는다 — 들여온 날이 아니라.
        assert_eq!(
            SessionId::new("import-20250714-113000").workday(),
            Some("20250714")
        );
        assert_eq!(SessionId::new("20260624-git").workday(), Some("20260624"));
        // 옛 합성 id 도 앞 8자가 숫자면 읽힌다 (IndexWriter 규약 유지).
        assert_eq!(SessionId::new("20260624-m01").workday(), Some("20260624"));
        assert_eq!(SessionId::new("manual").workday(), None);
        assert_eq!(SessionId::new("").workday(), None);
    }

    #[test]
    fn minting_pads_and_round_trips() {
        let t = chrono::NaiveTime::from_hms_opt(9, 5, 4).unwrap();
        assert_eq!(
            SessionId::manual("20260830", t).as_str(),
            "manual-20260830-090504"
        );
        assert_eq!(
            SessionId::mcp("20260830", t).as_str(),
            "mcp-20260830-090504"
        );
        assert_eq!(SessionId::watcher("20260830", 7).as_str(), "20260830-007");
        assert_eq!(SessionId::watcher("20260830", 7).watcher_counter(), Some(7));
        assert_eq!(
            SessionId::schedule("20260830", t).as_str(),
            "sched-20260830-090504"
        );
        assert_eq!(
            SessionId::automation("20260830", t).as_str(),
            "auto-20260830-090504"
        );
        assert_eq!(
            SessionId::imported("20250714", t).as_str(),
            "import-20250714-090504"
        );
        assert_eq!(SessionId::git_backfill("20260830").as_str(), "20260830-git");
        assert!(SessionId::git_backfill("20260830").is_git_backfill());
        assert_eq!(SessionId::manual("20260830", t).watcher_counter(), None);
    }

    #[test]
    fn serde_is_transparent() {
        let id = SessionId::new("20260820-002");
        assert_eq!(serde_json::to_string(&id).unwrap(), "\"20260820-002\"");
        let back: SessionId = serde_json::from_str("\"manual-20260820-205400\"").unwrap();
        assert_eq!(back.kind(), SessionKind::Manual);
    }
}
