//! 신호 원장 — `journal-missing.jsonl` 을 **쓰고 읽는** 한 자리.
//!
//! 판정([`super::judge`])의 산출물이다. 쓰는 쪽과 읽는 쪽이 갈라져 있으면
//! 포맷 계약이 문자열 단언으로만 묶이는데, 이 저장소는 그 방식으로 이미 한
//! 번 데었다 (셸이 쓰고 Rust 가 읽던 시절의 "printf 템플릿 변경 금지" 단언).
//! 그래서 둘을 붙였다.
//!
//! 줄은 **세그먼트**마다 하나씩 나가고, 읽는 쪽이 **대화** 단위로 접는다.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use super::{Undecided, Verdict};
use crate::oculpm::file_guard::{FileGuard, GuardPolicy};

/// 플러그인 SessionEnd 훅이 "일지 없이 끝난 세션"을 append 하는 신호 파일
/// (프로젝트 루트 기준). 근거: benchmarks/agentic 실측 — 규칙·도구가 주입돼도
/// 헤드리스 단발 세션의 기록 준수 0/12. 훅이 200줄 초과 시 최근 100줄로 자체
/// 트림하므로 **오프셋 소비가 불가** — 항상 전체를 읽고 시간으로 필터한다.
pub const JOURNAL_MISSING_REL: &str = ".oculpm/hooks/journal-missing.jsonl";

/// 일지 없이 끝난 **대화** 1건. `ts` 는 훅이 기록한 UTC ISO 문자열 그대로 —
/// 로컬 시각 변환은 UI 몫이다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct JournalMissingSignal {
    pub ts: String,
    /// 에이전트의 **대화** id (`CLAUDE_CODE_SESSION_ID`). 이름이 `session_id`
    /// 인 것은 훅 payload 의 필드명을 그대로 물려받았기 때문이고, 세는 단위는
    /// 세그먼트가 아니라 대화다 (용어: `oculpm::verdict`).
    pub session_id: String,
    /// 이 대화가 낸 신호 **세그먼트** 수. resume 마다 마커가 새로 열려 한
    /// 대화가 여러 줄을 남긴다 — 실측(2026-09-05) 원장 164행이 고유 대화
    /// 117개였던 이유다. 카드가 세는 것은 대화 하나, 이 값은 그 안의 횟수.
    pub segments: u32,
}

/// 신호 라인의 관용 파싱형 — 필드 누락은 기본값으로 흡수하고 검증은
/// [`parse_journal_missing`] 이 한다.
#[derive(Debug, Deserialize)]
struct RawJournalMissingLine {
    #[serde(default)]
    ts: String,
    #[serde(default)]
    session_id: String,
    /// `oculpm-mcp verdict --ledger` 가 적는 판정. 없으면 **옛 셸 판정**이
    /// 남긴 줄이다. `kind` 는 읽지 않는다 — 구·신 훅이 서로 다른 값을 쓰고,
    /// 신호 여부를 가르는 것은 이 필드 하나다.
    #[serde(default)]
    verdict: String,
}

/// 신호 파일 내용에서 `cutoff` 이후의 **미기록** 판정만 추린다 (최신 우선,
/// 대화 단위로 접힘).
///
/// 깨진 JSON / ts 파싱 불가 / 빈 session_id 는 조용히 건너뛴다 — 한 줄 오염이
/// 카드 전체를 막으면 안 된다 (인박스 파서와 동일 철학).
///
/// **판정 불가(`undecided`) 줄은 신호가 아니다.** 그리고 `verdict` 필드가
/// 아예 없는 옛 줄도 신호로 세지 않는다: 그 줄들을 만든 판정이 바로 이번에
/// 걷어낸 프로젝트 전역 mtime 근사이고, 실측(2026-09-05) 대조에서 진짜
/// 미기록은 164행 중 2건뿐이었다. 없앤 판정의 산출물을 계속 경고로 띄우면
/// 카드가 소음이 된다.
pub fn parse_journal_missing(
    content: &str,
    cutoff: chrono::DateTime<chrono::Utc>,
) -> Vec<JournalMissingSignal> {
    let mut rows: Vec<(chrono::DateTime<chrono::Utc>, String, String)> = content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let raw: RawJournalMissingLine = serde_json::from_str(trimmed).ok()?;
            if raw.verdict != "missing" {
                return None;
            }
            if raw.session_id.is_empty() {
                return None;
            }
            let dt = chrono::DateTime::parse_from_rfc3339(&raw.ts)
                .ok()?
                .with_timezone(&chrono::Utc);
            (dt >= cutoff).then_some((dt, raw.ts, raw.session_id))
        })
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.0));

    // 세그먼트 → 대화. 가장 최근 줄의 ts 를 대표로 삼는다.
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for (_, _, sid) in &rows {
        *counts.entry(sid.clone()).or_default() += 1;
    }
    rows.into_iter()
        .filter(|(_, _, sid)| seen.insert(sid.clone()))
        .map(|(_, ts, session_id)| JournalMissingSignal {
            segments: counts.get(&session_id).copied().unwrap_or(1),
            ts,
            session_id,
        })
        .collect()
}

/// 프로젝트 root 의 신호 파일을 읽어 최근 `days`일 내 미기록 대화를 반환한다.
/// 파일 없음/읽기 실패는 빈 배열 (신호는 옵인 플러그인 훅 전용 — 없는 게
/// 정상 상태다).
pub fn journal_missing_signals(root: &Path, days: u32) -> Vec<JournalMissingSignal> {
    let path = root.join(JOURNAL_MISSING_REL);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let days = i64::from(days.clamp(1, 365));
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days);
    let signals = parse_journal_missing(&content, cutoff);
    if signals.is_empty() {
        return signals;
    }

    // 해소 필터 — 신호가 난 **그 대화**의 일지가 나중에 생겼으면 낡은 경고다
    // (사후 수동 기록·앱의 auto_journal_draft 초안).
    //
    // 종전에는 "프로젝트에 신호보다 새 일지가 하나라도 있으면 전부 해소"였다.
    // 옆 대화가 부지런하면 이 대화의 미기록이 통째로 가려지고, 반대로 아무도
    // 안 쓰면 남의 미기록이 내 카드에 남았다 — 카드가 깨끗함과 가려짐을
    // 구조적으로 구별하지 못한 자리다. 이제는 일지 프론트매터의
    // `agent.session`(대화 id)으로만 해소한다. 근거가 없으면 **신호를 남긴다**:
    // 판정 불가는 원장에서 이미 걸러졌고, 여기 남은 줄은 신호가 났을 때
    // 증거가 살아 있는 상태에서 미기록으로 판정된 것들이다.
    let recorded: BTreeSet<String> = crate::oculpm::verdict::collect_journal_conversations(
        root,
        (chrono::Utc::now() - chrono::Duration::days(days)).timestamp(),
    );
    signals
        .into_iter()
        .filter(|s| !recorded.contains(&s.session_id))
        .collect()
}

/// 원장이 이 줄 수를 넘으면 최근 절반만 남긴다. 신호는 최근성이 전부다.
const LEDGER_MAX_LINES: usize = 400;

/// 신호 원장에 한 줄. **판정 불가도 적는다** — 미기록과 구별해서 적어야
/// 사후에 둘을 갈라 셀 수 있다 (실측 2026-09-05: 옛 원장 164행 중 55%가
/// 사후 재판정 불가였다. 증거를 안 적었기 때문이다).
///
/// 세그먼트마다 한 줄이 나간다. 대화 단위 집계는 읽는 쪽
/// (`claude_hooks::journal_missing_signals`)이 `session_id` 로 접는다.
pub fn append(root: &Path, conversation: &str, verdict: &Verdict, now: DateTime<Utc>) {
    let (kind, detail) = match verdict {
        // 기록한 세션은 원장에 남기지 않는다 — 신호 원장이지 감사 로그가 아니다.
        Verdict::Clear(_) => return,
        Verdict::Objection(o) => ("missing", format!(r#","changed":{}"#, o.changed.len())),
        Verdict::Undecided(u) => (
            "undecided",
            format!(
                r#","basis":"{}""#,
                match u {
                    Undecided::NoSegmentMarker => "no_segment_marker",
                    Undecided::LivePeers { .. } => "live_peers",
                    Undecided::NoWorkingTree => "no_working_tree",
                }
            ),
        ),
    };
    let path = root.join(JOURNAL_MISSING_REL);
    let Some(dir) = path.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    // 회전(읽고-자르고-바꾸기)은 append 와 달리 원자적이지 않다. 병렬 세션이
    // 동시에 끝나는 일이 실제로 있으므로 공용 문지기로 구간을 지킨다 —
    // 못 잡으면 이번 줄은 버린다 (무해가 계약이다).
    let lock = dir.join(".journal-missing.lock");
    let Ok(_guard) = FileGuard::acquire(&lock, now, GuardPolicy::waiting(300)) else {
        return;
    };
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let line = format!(
        r#"{{"ts":"{}","session_id":"{}","kind":"session_verdict","verdict":"{kind}"{detail}}}"#,
        now.to_rfc3339_opts(SecondsFormat::Secs, true),
        conversation.replace('"', ""),
    );
    let lines: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).collect();
    let kept = if lines.len() >= LEDGER_MAX_LINES {
        lines[lines.len() - LEDGER_MAX_LINES / 2..].to_vec()
    } else {
        lines
    };
    let mut out = kept.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&line);
    out.push('\n');
    // 인라인 훅의 `cat >>` 가 개행을 안 붙여 깨진 줄을 남긴 전례가 있다
    // (실측: 5건). 여기서는 항상 개행으로 닫는다.
    let _ = crate::oculpm::atomic_io::write_atomic(&path, out.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn line(s: &str) -> String {
        format!("{s}\n")
    }

    // ─── H3b — 미기록 세션 신호 파싱 ────────────────────────────────────────

    fn cutoff(s: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn journal_missing_parses_valid_lines_newest_first() {
        let mut buf = String::new();
        buf.push_str(&line(
            r#"{"ts":"2026-07-29T01:00:00Z","session_id":"aaa11111","kind":"session_verdict","verdict":"missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T02:30:00Z","session_id":"bbb22222","kind":"session_verdict","verdict":"missing"}"#,
        ));
        let rows = parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z"));
        assert_eq!(rows.len(), 2);
        // 최신 우선.
        assert_eq!(rows[0].session_id, "bbb22222");
        assert_eq!(rows[0].ts, "2026-07-30T02:30:00Z");
        assert_eq!(rows[1].session_id, "aaa11111");
    }

    #[test]
    fn journal_missing_skips_broken_and_foreign_lines() {
        let mut buf = String::new();
        buf.push_str(&line("not-json"));
        buf.push_str(&line(
            r#"{"ts":"garbage","session_id":"x","verdict":"missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"","verdict":"missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"ok-sid","kind":"session_verdict","verdict":"missing","changed":3}"#,
        ));
        buf.push('\n'); // 빈 줄 허용
        let rows = parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "ok-sid");
    }

    /// **판정 불가는 신호가 아니다.** 미기록과 뭉뚱그리면 오탐이 되살아난다.
    #[test]
    fn undecided_rows_are_not_signals() {
        let buf = line(
            r#"{"ts":"2026-07-30T00:00:00Z","session_id":"u1","kind":"session_verdict","verdict":"undecided","basis":"live_peers"}"#,
        );
        assert!(parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z")).is_empty());
    }

    /// `verdict` 가 없는 옛 줄(프로젝트 전역 mtime 판정의 산출물)은 세지
    /// 않는다 — 실측 대조에서 164행 중 진짜 미기록은 2건이었다.
    #[test]
    fn legacy_rows_without_a_verdict_are_not_signals() {
        let buf =
            line(r#"{"ts":"2026-07-30T00:00:00Z","session_id":"legacy","kind":"journal_missing"}"#);
        assert!(parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z")).is_empty());
    }

    /// 원장은 **세그먼트**마다 한 줄이 나가지만 카드가 세는 것은 **대화**다.
    /// 164행 vs 고유 117 의 차이가 이것이다.
    #[test]
    fn segments_of_one_conversation_fold_into_one_row() {
        let mut buf = String::new();
        for ts in [
            "2026-07-30T01:00:00Z",
            "2026-07-30T02:00:00Z",
            "2026-07-30T03:00:00Z",
        ] {
            buf.push_str(&line(&format!(
                r#"{{"ts":"{ts}","session_id":"conv-a","kind":"session_verdict","verdict":"missing"}}"#
            )));
        }
        buf.push_str(&line(
            r#"{"ts":"2026-07-30T04:00:00Z","session_id":"conv-b","kind":"session_verdict","verdict":"missing"}"#,
        ));
        let rows = parse_journal_missing(&buf, cutoff("2026-07-01T00:00:00Z"));
        assert_eq!(rows.len(), 2, "대화 2개로 접혀야 한다");
        assert_eq!(rows[0].session_id, "conv-b");
        assert_eq!(rows[0].segments, 1);
        assert_eq!(rows[1].session_id, "conv-a");
        assert_eq!(rows[1].segments, 3, "세그먼트 수는 살아 있어야 한다");
        // 대표 ts 는 가장 최근 세그먼트.
        assert_eq!(rows[1].ts, "2026-07-30T03:00:00Z");
    }

    #[test]
    fn journal_missing_filters_by_cutoff() {
        let mut buf = String::new();
        buf.push_str(&line(
            r#"{"ts":"2026-07-10T00:00:00Z","session_id":"old","kind":"session_verdict","verdict":"missing"}"#,
        ));
        buf.push_str(&line(
            r#"{"ts":"2026-07-29T00:00:00Z","session_id":"recent","kind":"session_verdict","verdict":"missing"}"#,
        ));
        let rows = parse_journal_missing(&buf, cutoff("2026-07-23T00:00:00Z"));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "recent");
    }

    #[test]
    fn journal_missing_signals_missing_file_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(journal_missing_signals(tmp.path(), 7).is_empty());
    }

    #[test]
    fn journal_missing_signals_reads_recent_from_disk() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join(".oculpm/hooks");
        std::fs::create_dir_all(&dir).unwrap();
        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::hours(1)).to_rfc3339();
        let stale = (now - chrono::Duration::days(30)).to_rfc3339();
        std::fs::write(
            tmp.path().join(JOURNAL_MISSING_REL),
            format!(
                "{}\n{}\n",
                format_args!(
                    r#"{{"ts":"{stale}","session_id":"stale","kind":"session_verdict","verdict":"missing"}}"#
                ),
                format_args!(
                    r#"{{"ts":"{recent}","session_id":"fresh","kind":"session_verdict","verdict":"missing"}}"#
                ),
            ),
        )
        .unwrap();
        let rows = journal_missing_signals(tmp.path(), 7);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_id, "fresh");
    }

    /// 원장 줄을 쓰는 쪽이 이제 Rust 다 (`verdict::cli` 의 `--ledger`).
    /// 그 포맷과 이 파서가 어긋나지 않는지를 문자열로 못박는다 — 실제로 써서
    /// 읽는 왕복은 `tests/session_verdict.rs` 가 본다.
    #[test]
    fn parses_the_exact_ledger_line_the_writer_emits() {
        let line = "{\"ts\":\"2026-07-31T12:00:00Z\",\"session_id\":\"abc-123\",\"kind\":\"session_verdict\",\"verdict\":\"missing\",\"changed\":2}\n";
        let cutoff = chrono::Utc::now() - chrono::Duration::days(365);
        let got = parse_journal_missing(line, cutoff);
        assert_eq!(got.len(), 1, "원장 라인이 파싱돼야 한다");
        assert_eq!(got[0].session_id, "abc-123");
        assert_eq!(got[0].segments, 1);
    }

    /// 해소 필터는 **그 대화의 일지**로만 열린다.
    ///
    /// 종전에는 프로젝트에 신호보다 새 일지가 하나만 있으면 전부 해소됐다 —
    /// 부지런한 옆 대화가 이 대화의 미기록을 통째로 가리는 자리였다.
    #[test]
    fn only_a_journal_from_that_conversation_resolves_its_signal() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".oculpm/hooks")).unwrap();
        let jdir = root.join(".oculpm/journal/20260731/Chores");
        std::fs::create_dir_all(&jdir).unwrap();

        let ts = (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        let ledger = |sid: &str| {
            format!(
                "{{\"ts\":\"{ts}\",\"session_id\":\"{sid}\",\"kind\":\"session_verdict\",\"verdict\":\"missing\"}}\n"
            )
        };
        std::fs::write(root.join(JOURNAL_MISSING_REL), ledger("conv-a")).unwrap();

        // 옆 대화(conv-b)의 일지는 conv-a 를 해소하지 못한다.
        std::fs::write(
            jdir.join("0001_chore_peer.md"),
            "---\nschema_version: 1\ntype: chore\nslug: peer\nstatus: done\ndifficulty: low\ncreated_at: 2026-07-31T10:00:00+09:00\nsession_id: 20260731-001\nagent:\n  id: claude-code\n  session: conv-b\n---\n[x] 옆 대화\n",
        )
        .unwrap();
        let got = journal_missing_signals(root, 7);
        assert_eq!(got.len(), 1, "옆 대화의 일지가 이 대화를 면죄했다");
        assert_eq!(got[0].session_id, "conv-a");

        // 그 대화 자신의 일지가 나면 해소된다.
        std::fs::write(
            jdir.join("0002_chore_mine.md"),
            "---\nschema_version: 1\ntype: chore\nslug: mine\nstatus: done\ndifficulty: low\ncreated_at: 2026-07-31T11:00:00+09:00\nsession_id: 20260731-001\nagent:\n  id: claude-code\n  session: conv-a\n---\n[x] 내 일지\n",
        )
        .unwrap();
        assert!(
            journal_missing_signals(root, 7).is_empty(),
            "사후 기록이 신호를 해소해야 한다"
        );
    }
}
