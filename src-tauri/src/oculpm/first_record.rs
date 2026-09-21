//! 첫 기록 원장 — "이 프로젝트에서 **어느 대화**가 무엇을 기록했는가"를
//! 대화 단위로 편다 (docs/product-direction-2026-09-21 Phase 1, 플랜
//! `first-record-loop` {#p1-ledger}).
//!
//! [`verdict`](crate::oculpm::verdict) 가 "이 대화가 자기 작업을 기록했는가"를
//! **한 대화**에 대해 답한다면, 여기는 창 안의 대화 **전부**를 한 표로 편다.
//! Today 의 「첫 기록」 카드가 읽는다.
//!
//! # 원칙 — 총 일지 수로 성공을 말하지 않는다
//!
//! 그동안 Today 가 "기록이 시작됐다"를 아는 유일한 방법은 `total_entries` 였다.
//! 그 숫자는 git 백필로도, 옆 대화의 일지로도, 손으로 쓴 일지로도 오른다 —
//! 방금 돌린 에이전트가 기록했는지는 말하지 못한다. 그래서 여기서는 **대화
//! id(`agent.session`)로만 귀속**한다. 대화 id 가 없는 일지는 "귀속 불명"으로
//! 따로 세고, 어느 대화의 성공으로도 치지 않는다 — 백필·수동 기록을 에이전트
//! 자동 기록 성공으로 집계하지 않는다는 보고서 §7 의 규칙이 그대로다.
//!
//! # 순수 + IO
//!
//! [`assemble`] 은 파일시스템을 읽지 않는다. 수집은 [`collect`] 가 하고,
//! 테스트는 [`LedgerInput`] 을 손으로 지어 조립만 시험한다 (`verdict` 와 같은
//! 분리).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use specta::Type;

use crate::oculpm::cache::ConversationJournalRow;
use crate::oculpm::claude_hooks::INBOX_REL;
use crate::oculpm::verdict::{self, ledger, MarkerTrace, WorkdaySession, PEER_LIVE_WINDOW_SECS};

// ─────────────────────────────────────────────────────────────────────────────
// 출력 — 프론트가 읽는 표
// ─────────────────────────────────────────────────────────────────────────────

/// 한 대화의 **첫** 일지 — 카드가 제목과 열기 링크로 쓴다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct FirstJournal {
    pub relative_path: String,
    pub title: String,
    pub created_at: String,
    pub agent_id: String,
}

/// 대화 하나의 흔적. 어느 표면이 남겼는지는 묻지 않는다 — 셸 훅과 앱 안 ACP
/// 가 같은 마커·같은 프론트매터 키를 쓴다 ([`verdict::markers`] 의 계약).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ConversationTrace {
    /// 대화 id (`agent.session` / 훅 payload 의 `session_id`).
    pub conversation: String,
    /// 세그먼트 마커가 있다 — 시작했고 아직 SessionEnd 를 못 받았다.
    pub segment_open: bool,
    /// 생존 흔적이 창 안이다 — **지금** 살아 있다고 볼 근거.
    pub live: bool,
    /// 시작 시각 (RFC3339 UTC). 마커 > 작업 세션 시작 > 첫 일지 순으로 잡는다.
    /// 작업 세션에서 온 값은 그 대화가 속한 세션의 시작이라 **근사**다.
    pub started_at: Option<String>,
    /// 마지막 활동 (생존 흔적·마커·마지막 일지 중 최신). 정렬 키.
    pub last_activity_at: Option<String>,
    /// 이 대화가 남긴 첫 일지. `None` = 아직 없다 (판정 불가가 아니라 "없다").
    pub first_journal: Option<FirstJournal>,
    pub journal_count: u32,
    /// 미기록 신호 원장에 `missing` 으로 남아 있고 그 뒤 일지도 없다.
    pub missing_signal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct FirstRecordLedger {
    /// 최근 활동 순.
    pub conversations: Vec<ConversationTrace>,
    /// 창 안 일지 중 대화 id 가 **없는** 것 — 귀속 불명 (플러그인 없이 쓴
    /// 에이전트, git 백필, 수동 기록, 037 이전 일지).
    pub unattributed_recent: u32,
    /// 훅이 이 프로젝트에 한 번이라도 닿았다 (마커·인박스·신호 원장 중 하나가
    /// 있다). "설정이 있다"와 "실제로 연결됐다"를 가르는 유일한 관측 근거.
    pub hooks_seen: bool,
    pub window_days: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// 입력 — 조립에 쓰이는 사실 전부
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct LedgerInput {
    pub markers: BTreeMap<String, MarkerTrace>,
    pub sessions: Vec<WorkdaySession>,
    pub journals: Vec<ConversationJournalRow>,
    /// 신호 원장이 `missing` 으로 남긴 대화 (해소 필터 뒤).
    pub missing: BTreeSet<String>,
    pub hooks_seen: bool,
    /// unix 초.
    pub now: i64,
    pub window_days: u32,
}

/// 표에 실을 대화 수 상한 — 그 뒤는 화면이 어차피 못 보여 준다.
const MAX_CONVERSATIONS: usize = 50;

#[derive(Default)]
struct Acc<'a> {
    segment_started_at: Option<i64>,
    live_at: Option<i64>,
    session_started_at: Option<i64>,
    journals: Vec<&'a ConversationJournalRow>,
}

/// 사실들을 대화별로 접는다. 아무것도 읽지 않는다.
pub fn assemble(input: &LedgerInput) -> FirstRecordLedger {
    let mut acc: BTreeMap<String, Acc<'_>> = BTreeMap::new();

    for (id, m) in &input.markers {
        let a = acc.entry(id.clone()).or_default();
        a.segment_started_at = m.segment_started_at;
        a.live_at = m.live_at;
    }
    for s in &input.sessions {
        for conv in &s.agent_sessions {
            let conv = conv.trim();
            if conv.is_empty() {
                continue;
            }
            let a = acc.entry(conv.to_string()).or_default();
            a.session_started_at = Some(
                a.session_started_at
                    .map_or(s.started_at, |t| t.min(s.started_at)),
            );
        }
    }
    let mut unattributed_recent = 0u32;
    for j in &input.journals {
        match &j.agent_session {
            Some(conv) => acc.entry(conv.clone()).or_default().journals.push(j),
            None => unattributed_recent += 1,
        }
    }

    let mut conversations: Vec<(Option<i64>, ConversationTrace)> = acc
        .into_iter()
        .map(|(conversation, a)| {
            let mut journals = a.journals;
            journals.sort_by_key(|j| parse_ts(&j.created_at).unwrap_or(0));
            let first_journal = journals.first().map(|j| FirstJournal {
                relative_path: j.relative_path.clone(),
                title: j.title.clone(),
                created_at: j.created_at.clone(),
                agent_id: j.agent_id.clone(),
            });
            let first_journal_ts = journals.first().and_then(|j| parse_ts(&j.created_at));
            let last_journal_ts = journals.last().and_then(|j| parse_ts(&j.created_at));

            // 생존 흔적은 **창 안**일 때만 살아 있다 — 마커의 존재는 크래시 잔여가
            // 7일을 버티므로 생사를 말하지 못한다 (verdict 와 같은 창).
            let live = a
                .live_at
                .is_some_and(|t| input.now - t <= PEER_LIVE_WINDOW_SECS);
            let started_at = a
                .segment_started_at
                .or(a.session_started_at)
                .or(first_journal_ts);
            let last_activity = [a.live_at, a.segment_started_at, last_journal_ts]
                .into_iter()
                .flatten()
                .max();
            let missing_signal = first_journal.is_none() && input.missing.contains(&conversation);
            let trace = ConversationTrace {
                conversation,
                segment_open: a.segment_started_at.is_some(),
                live,
                started_at: started_at.map(fmt_ts),
                last_activity_at: last_activity.map(fmt_ts),
                first_journal,
                journal_count: journals.len() as u32,
                missing_signal,
            };
            (last_activity, trace)
        })
        .collect();

    // 최근 활동이 새로운 것부터 — 시각을 모르는 것은 뒤로.
    conversations
        .sort_by(|(a, ta), (b, tb)| b.cmp(a).then_with(|| ta.conversation.cmp(&tb.conversation)));
    conversations.truncate(MAX_CONVERSATIONS);

    FirstRecordLedger {
        conversations: conversations.into_iter().map(|(_, t)| t).collect(),
        unattributed_recent,
        hooks_seen: input.hooks_seen,
        window_days: input.window_days,
    }
}

/// 디스크에서 조립 입력을 모은다. 일지 행은 캐시가 주므로 인자로 받는다 —
/// 이 모듈은 DB 를 모른다.
pub fn collect(
    root: &Path,
    journals: Vec<ConversationJournalRow>,
    days: u32,
    now: DateTime<Utc>,
) -> LedgerInput {
    let hooks = verdict::markers::hooks_dir(root);
    let markers = verdict::marker_traces(&hooks);
    let sessions = verdict::workday_sessions(root);
    let missing: BTreeSet<String> = ledger::journal_missing_signals(root, days)
        .into_iter()
        .map(|s| s.session_id)
        .collect();
    let hooks_seen = !markers.is_empty()
        || root.join(INBOX_REL).is_file()
        || root.join(ledger::JOURNAL_MISSING_REL).is_file();
    LedgerInput {
        markers,
        sessions,
        journals,
        missing,
        hooks_seen,
        now: now.timestamp(),
        window_days: days,
    }
}

fn parse_ts(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| t.timestamp())
}

fn fmt_ts(t: i64) -> String {
    DateTime::<Utc>::from_timestamp(t, 0)
        .map(|d| d.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn row(path: &str, created_at: &str, session: Option<&str>) -> ConversationJournalRow {
        ConversationJournalRow {
            relative_path: path.to_string(),
            workday: path[..8].to_string(),
            title: format!("title of {path}"),
            created_at: created_at.to_string(),
            agent_id: "claude-code".into(),
            agent_session: session.map(str::to_string),
        }
    }

    fn iso(t: i64) -> String {
        fmt_ts(t)
    }

    fn input() -> LedgerInput {
        LedgerInput {
            now: NOW,
            window_days: 7,
            ..Default::default()
        }
    }

    /// 살아 있는 대화는 일지가 없어도 표에 선다 — 그래야 카드가 「실행 중 ·
    /// 기록은 아직」을 말할 수 있다. 성공은 아니다.
    #[test]
    fn a_live_conversation_without_a_journal_is_running_not_recorded() {
        let mut inp = input();
        inp.markers.insert(
            "c1".into(),
            MarkerTrace {
                segment_started_at: Some(NOW - 600),
                live_at: Some(NOW - 30),
            },
        );
        let out = assemble(&inp);
        assert_eq!(out.conversations.len(), 1);
        let c = &out.conversations[0];
        assert!(c.live && c.segment_open);
        assert!(c.first_journal.is_none());
        assert_eq!(c.started_at.as_deref(), Some(iso(NOW - 600).as_str()));
        assert!(!c.missing_signal);
    }

    /// 창 밖의 생존 흔적은 죽은 것으로 본다 — 크래시 잔여 마커가 「실행 중」을
    /// 영원히 띄우면 안 된다.
    #[test]
    fn a_stale_live_trace_is_not_live() {
        let mut inp = input();
        inp.markers.insert(
            "c1".into(),
            MarkerTrace {
                segment_started_at: Some(NOW - 2 * 24 * 3600),
                live_at: Some(NOW - PEER_LIVE_WINDOW_SECS - 1),
            },
        );
        let out = assemble(&inp);
        assert!(out.conversations[0].segment_open);
        assert!(!out.conversations[0].live);
    }

    /// **대화 id 로만 귀속한다.** 같은 창에 옆 대화의 일지·백필·수동 일지가
    /// 있어도 이 대화의 첫 일지는 자기 id 를 적은 것뿐이고, id 없는 일지는
    /// 귀속 불명으로 따로 센다.
    #[test]
    fn attribution_uses_the_conversation_id_only() {
        let mut inp = input();
        inp.markers.insert(
            "mine".into(),
            MarkerTrace {
                segment_started_at: Some(NOW - 900),
                live_at: Some(NOW - 10),
            },
        );
        inp.journals = vec![
            row(
                "20260921/Chores/1000_chore_backfill.md",
                &iso(NOW - 800),
                None,
            ),
            row(
                "20260921/Bugs/1010_bug_peer.md",
                &iso(NOW - 700),
                Some("peer"),
            ),
            row(
                "20260921/Bugs/1020_bug_second.md",
                &iso(NOW - 100),
                Some("mine"),
            ),
            row(
                "20260921/Bugs/1015_bug_first.md",
                &iso(NOW - 300),
                Some("mine"),
            ),
        ];
        let out = assemble(&inp);
        assert_eq!(out.unattributed_recent, 1, "백필은 귀속 불명이다");
        let mine = out
            .conversations
            .iter()
            .find(|c| c.conversation == "mine")
            .unwrap();
        assert_eq!(mine.journal_count, 2);
        assert_eq!(
            mine.first_journal.as_ref().unwrap().relative_path,
            "20260921/Bugs/1015_bug_first.md",
            "첫 일지는 created_at 이 가장 이른 것이다"
        );
        let peer = out
            .conversations
            .iter()
            .find(|c| c.conversation == "peer")
            .unwrap();
        assert_eq!(peer.journal_count, 1);
        assert!(!peer.live && !peer.segment_open, "일지로만 아는 대화다");
        assert_eq!(
            peer.started_at.as_deref(),
            Some(iso(NOW - 700).as_str()),
            "마커·세션이 없으면 첫 일지 시각이 시작이다"
        );
    }

    /// 미기록 신호는 **그 뒤 일지가 없을 때만** 남는다. 신호가 났다가 사후에
    /// 기록한 대화는 기록한 대화다.
    #[test]
    fn a_missing_signal_is_cleared_by_a_later_journal() {
        let mut inp = input();
        inp.missing.insert("gone".into());
        inp.missing.insert("fixed".into());
        inp.journals = vec![row(
            "20260921/Bugs/1100_bug_x.md",
            &iso(NOW - 50),
            Some("fixed"),
        )];
        let out = assemble(&inp);
        let gone = out.conversations.iter().find(|c| c.conversation == "gone");
        assert!(
            gone.is_none(),
            "신호만 있고 마커·세션·일지가 없는 대화는 표에 없다 — 신호 원장은 카드 아래 별도 카드가 센다"
        );
        let fixed = out
            .conversations
            .iter()
            .find(|c| c.conversation == "fixed")
            .unwrap();
        assert!(!fixed.missing_signal);
    }

    /// 세션이 끝나 마커가 지워진 대화는 `sessions.json` 이 기억한다 — 시작
    /// 시각은 그 작업 세션의 것이라 근사이고, 신호가 있으면 미기록으로 선다.
    #[test]
    fn an_ended_conversation_comes_from_sessions_json() {
        let mut inp = input();
        inp.sessions.push(WorkdaySession {
            id: "20260921-001".into(),
            agent_sessions: vec!["ended".into(), " ".into()],
            started_at: NOW - 5000,
            ended_at: Some(NOW - 1000),
        });
        inp.missing.insert("ended".into());
        let out = assemble(&inp);
        assert_eq!(out.conversations.len(), 1, "빈 id 는 대화가 아니다");
        let c = &out.conversations[0];
        assert_eq!(c.conversation, "ended");
        assert!(!c.live && !c.segment_open);
        assert!(c.missing_signal);
        assert_eq!(c.started_at.as_deref(), Some(iso(NOW - 5000).as_str()));
    }

    /// 최근 활동 순 — 방금 친 대화가 맨 위.
    #[test]
    fn conversations_are_ordered_by_last_activity() {
        let mut inp = input();
        inp.markers.insert(
            "old".into(),
            MarkerTrace {
                segment_started_at: Some(NOW - 9000),
                live_at: Some(NOW - 8000),
            },
        );
        inp.markers.insert(
            "new".into(),
            MarkerTrace {
                segment_started_at: Some(NOW - 3000),
                live_at: Some(NOW - 5),
            },
        );
        inp.journals = vec![row(
            "20260921/Bugs/1200_bug_late.md",
            &iso(NOW - 1),
            Some("old"),
        )];
        let out = assemble(&inp);
        let ids: Vec<&str> = out
            .conversations
            .iter()
            .map(|c| c.conversation.as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["old", "new"],
            "옛 대화라도 방금 일지를 냈으면 위다"
        );
    }

    /// 수집은 추적 폴더가 없어도 무해하다 — 빈 표와 「훅 본 적 없음」.
    #[test]
    fn collect_on_an_empty_root_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        let inp = collect(dir.path(), Vec::new(), 7, Utc::now());
        assert!(inp.markers.is_empty());
        assert!(!inp.hooks_seen);
        let out = assemble(&inp);
        assert!(out.conversations.is_empty());
        assert_eq!(out.window_days, 7);
    }

    /// 마커가 하나라도 있으면 훅이 닿은 것이다 — 설정 존재가 아니라 실제 연결.
    #[test]
    fn hooks_seen_comes_from_markers_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
        verdict::markers::open_segment(dir.path(), "c1");
        let inp = collect(dir.path(), Vec::new(), 7, Utc::now());
        assert!(inp.hooks_seen);
        let out = assemble(&inp);
        assert_eq!(out.conversations.len(), 1);
        assert!(out.conversations[0].live);
    }
}
