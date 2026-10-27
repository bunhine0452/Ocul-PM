//! best-results-round `{#scorecard-cmd}` — 「약속 성적표」의 일지 쪽 숫자.
//!
//! `docs/PROMISE.md` 의 측정 목표 표를 Today 가 **느낌 대신 숫자로** 보여 주기 위한
//! 데이터원이다 (METR 2025/2026: 개발자는 AI 로 20% 빨라졌다고 느꼈고 실측은 그 반대
//! 였다 — 느낌은 지표가 아니다). 정의는 `docs/launch/agent-report-card.py` 와 **같은
//! 계약**이다: 한쪽만 고치면 성적표 스크립트와 앱이 다른 숫자를 말한다.
//!
//! - **증거 비율**: 창 안의 bug/feature/refactor 일지 중 `evidence == 2`(검증 칸에
//!   명령 증거) 인 비율. error/chore 는 세지 않는다 — 실패 기록과 잡일에 바깥 심판을
//!   요구하지 않는다(`journal_write` 의 경고도 같은 셋이다).
//! - **7일 재수정**: 창 안의 bug/error 일지 중, 그 앞 7일 안에 feature/refactor 일지가
//!   **같은 파일**을 만진 비율. 허브 파일(전 기간 일지의 3% 이상에 등장, 최소 3건)과
//!   `.oculpm/` 은 겹침에서 뺀다 — 다들 지나가는 파일은 재수정 신호가 아니다.
//!
//! 집계는 DB 없이 테스트할 수 있게 순수 함수(`compute`)로 뺐다.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset};

use super::*;

/// 일지 한 줄 — `compute` 의 입력.
#[derive(Debug, Clone)]
pub struct ScoreRow {
    pub relative_path: String,
    pub entry_type: String,
    pub workday: String,
    pub created_at: String,
    pub evidence: u8,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, specta::Type)]
pub struct JournalScore {
    /// 창 안의 bug/feature/refactor 일지 수 — 증거 비율의 분모.
    pub judged_entries: u32,
    /// 그중 검증 칸에 명령 증거(`evidence == 2`)가 있는 수.
    pub evidence_entries: u32,
    /// 창 안의 bug/error 일지 수 — 재수정 비율의 분모.
    pub bug_entries: u32,
    /// 그중 앞 7일 안에 feature/refactor 가 같은 파일을 만진 수.
    pub rework_within_7d: u32,
    /// 허브 판정 문턱(이 수 이상의 일지에 등장하면 허브) — 카드가 각주로 쓴다.
    pub hub_cut: u32,
}

const BUG_TYPES: &[&str] = &["bug", "error"];
const BUILD_TYPES: &[&str] = &["feature", "refactor"];
const JUDGED_TYPES: &[&str] = &["bug", "feature", "refactor"];

fn recorded_scope(file: &str) -> bool {
    !file.starts_with(".oculpm/")
}

/// `rows` 는 프로젝트 전 기간(앞 7일의 build 일지가 창 밖일 수 있다), 비율의 분모는
/// `workday >= since_workday` 인 일지만. `files` 는 (일지 경로, 파일 경로).
pub fn compute(rows: &[ScoreRow], files: &[(String, String)], since_workday: &str) -> JournalScore {
    let mut by_entry: HashMap<&str, HashSet<&str>> = HashMap::new();
    let mut df: HashMap<&str, u32> = HashMap::new();
    for (rel, file) in files {
        if !recorded_scope(file) {
            continue;
        }
        by_entry
            .entry(rel.as_str())
            .or_default()
            .insert(file.as_str());
        *df.entry(file.as_str()).or_default() += 1;
    }
    let hub_cut = ((rows.len() as f64) * 0.03).floor().max(3.0) as u32;
    let hubs: HashSet<&str> = df
        .iter()
        .filter(|(_, c)| **c >= hub_cut)
        .map(|(f, _)| *f)
        .collect();

    let ts = |r: &ScoreRow| DateTime::<FixedOffset>::parse_from_rfc3339(&r.created_at).ok();
    let builds: Vec<(DateTime<FixedOffset>, &HashSet<&str>)> = rows
        .iter()
        .filter(|r| BUILD_TYPES.contains(&r.entry_type.as_str()))
        .filter_map(|r| Some((ts(r)?, by_entry.get(r.relative_path.as_str())?)))
        .collect();

    let mut out = JournalScore {
        hub_cut,
        ..Default::default()
    };
    for r in rows.iter().filter(|r| r.workday.as_str() >= since_workday) {
        if JUDGED_TYPES.contains(&r.entry_type.as_str()) {
            out.judged_entries += 1;
            if r.evidence >= 2 {
                out.evidence_entries += 1;
            }
        }
        if !BUG_TYPES.contains(&r.entry_type.as_str()) {
            continue;
        }
        out.bug_entries += 1;
        let (Some(bts), Some(own)) = (ts(r), by_entry.get(r.relative_path.as_str())) else {
            continue;
        };
        let own: HashSet<&str> = own.iter().copied().filter(|f| !hubs.contains(f)).collect();
        if own.is_empty() {
            continue;
        }
        let hit = builds.iter().any(|(ets, efiles)| {
            let gap = bts - *ets;
            gap > chrono::Duration::zero()
                && gap <= chrono::Duration::days(7)
                && efiles.iter().any(|f| own.contains(f))
        });
        if hit {
            out.rework_within_7d += 1;
        }
    }
    out
}

impl Db {
    /// 일지 쪽 성적표 — 창은 `since_workday`(포함) 이후. 행은 전 기간을 읽는다
    /// (재수정 판정에 창 앞 7일의 build 일지가 필요하다).
    pub async fn journal_score(
        &self,
        project_id: u32,
        since_workday: String,
    ) -> Result<JournalScore> {
        let pid = project_id as i64;
        let rows: Vec<ScoreRow> = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, type, workday, created_at, evidence
                     FROM oculpm_journal WHERE project_id = ?1 AND parse_ok = 1",
                )?;
                let out = stmt
                    .query_map(params![pid], |r| {
                        Ok(ScoreRow {
                            relative_path: r.get(0)?,
                            entry_type: r.get(1)?,
                            workday: r.get(2)?,
                            created_at: r.get(3)?,
                            evidence: r.get::<_, i64>(4).unwrap_or(0).clamp(0, 2) as u8,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        let files: Vec<(String, String)> = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, file_path FROM oculpm_journal_files WHERE project_id = ?1",
                )?;
                let out = stmt
                    .query_map(params![pid], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(compute(&rows, &files, &since_workday))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, ty: &str, day: &str, hour: u32, evidence: u8) -> ScoreRow {
        ScoreRow {
            relative_path: path.to_string(),
            entry_type: ty.to_string(),
            workday: day.to_string(),
            created_at: format!(
                "{}-{}-{}T{hour:02}:00:00+09:00",
                &day[..4],
                &day[4..6],
                &day[6..]
            ),
            evidence,
        }
    }

    /// 성적표 스크립트와 같은 답이 나와야 한다: 7일 안 같은 파일 → 재수정, 8일 전은
    /// 아니고, 허브 파일만 겹치는 것도 아니다. 증거 비율은 bug/feature/refactor 만 센다.
    #[test]
    fn rework_and_evidence_follow_the_report_card_definitions() {
        let rows = vec![
            row(
                "20261001/Features_to_add/a.md",
                "feature",
                "20261001",
                10,
                2,
            ),
            row("20261005/Bugs/b.md", "bug", "20261005", 10, 2), // 4일 뒤 같은 파일 → 재수정
            row("20261012/Bugs/c.md", "bug", "20261012", 10, 1), // 11일 뒤·다른 파일 → 아님
            row("20261013/Bugs/d.md", "bug", "20261013", 10, 0), // 허브 파일만 겹침 → 아님
            row("20261014/Errors/e.md", "error", "20261014", 10, 0), // 증거 분모 아님, bug 분모임
            row("20261015/Chores/f.md", "chore", "20261015", 10, 0), // 어느 분모도 아님
        ];
        let mut files: Vec<(String, String)> = vec![
            ("20261001/Features_to_add/a.md".into(), "src/x.rs".into()),
            ("20261001/Features_to_add/a.md".into(), "src/lib.rs".into()),
            ("20261005/Bugs/b.md".into(), "src/x.rs".into()),
            ("20261012/Bugs/c.md".into(), "src/y.rs".into()),
            ("20261013/Bugs/d.md".into(), "src/lib.rs".into()),
            ("20261014/Errors/e.md".into(), ".oculpm/planner/p.md".into()),
        ];
        // lib.rs 를 허브로 — 문턱은 max(3, 6*0.03)=3 건.
        files.push(("20261012/Bugs/c.md".into(), "src/lib.rs".into()));
        let s = compute(&rows, &files, "20261001");
        assert_eq!(s.hub_cut, 3);
        assert_eq!(s.judged_entries, 4, "feature 1 + bug 3");
        assert_eq!(s.evidence_entries, 2);
        assert_eq!(s.bug_entries, 4, "bug 3 + error 1");
        assert_eq!(s.rework_within_7d, 1);

        // 창을 좁히면 분모만 줄고 창 밖 build 일지는 여전히 재수정 판정에 쓰인다.
        let s = compute(&rows, &files, "20261005");
        assert_eq!(s.judged_entries, 3);
        assert_eq!(s.rework_within_7d, 1);
        assert_eq!(
            compute(&[], &[], "20260101"),
            JournalScore {
                hub_cut: 3,
                ..Default::default()
            }
        );
    }
}
