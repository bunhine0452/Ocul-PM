//! 회상 관련도 통계 (`035_context_recall.sql` · Phase 5 `#recall-decay`).
//!
//! **파생 캐시다.** 비워도 기능이 유지되고(균등 점수로 되돌아간다) 사용자
//! 콘텐츠가 들어가지 않는다 — 경로와 숫자뿐이다.
//!
//! 감쇠는 배경 작업이 아니라 **읽을 때 계산**한다: 저장된 `score` 는
//! `last_used` 시점의 값이고, 지금 값은 반감기 30일로 깎는다. 스케줄러를 하나
//! 더 만들지 않으려는 선택이며 결과는 같고 결정적이다.

use super::*;

/// 반감기 (일). 30일 쓰이지 않으면 점수가 절반이 된다.
pub const HALF_LIFE_DAYS: f64 = 30.0;
/// 주입될 때마다 올려 주는 양. 1.0 을 넘지 않는다.
const USE_BOOST: f64 = 0.25;
/// 처음 기록될 때의 점수 — 균등 기본값과 같은 자리에서 출발한다.
const SEED_SCORE: f64 = 0.5;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct RecallStat {
    pub kind: String,
    pub ref_: String,
    /// 지금 시점의 감쇠 반영 점수 (0..1).
    pub score: f64,
    pub use_count: u32,
    pub last_used: Option<String>,
}

/// 저장된 점수를 경과 시간으로 깎는다. `last_used` 가 없으면 그대로.
pub fn decayed(score: f64, last_used: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> f64 {
    let Some(stamp) = last_used else { return score };
    let Ok(then) = chrono::DateTime::parse_from_rfc3339(stamp) else {
        return score;
    };
    let days = (now - then.with_timezone(&chrono::Utc)).num_seconds() as f64 / 86_400.0;
    if days <= 0.0 {
        return score;
    }
    let factor = 0.5_f64.powf(days / HALF_LIFE_DAYS);
    (score * factor).clamp(0.0, 1.0)
}

impl Db {
    /// 관련도 상위 N. 감쇠를 반영한 뒤 내림차순으로 준다.
    pub async fn recall_top(&self, project_id: u32, limit: u32) -> Result<Vec<RecallStat>> {
        let now = chrono::Utc::now();
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT kind, ref, score, use_count, last_used
                     FROM recall_stats WHERE project_id = ?1",
                )?;
                let rows = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(RecallStat {
                            kind: r.get(0)?,
                            ref_: r.get(1)?,
                            score: r.get(2)?,
                            use_count: r.get::<_, i64>(3)? as u32,
                            last_used: r.get(4)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;

        let mut out: Vec<RecallStat> = rows
            .into_iter()
            .map(|mut s| {
                s.score = decayed(s.score, s.last_used.as_deref(), now);
                s
            })
            .collect();
        out.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out.truncate(limit as usize);
        Ok(out)
    }

    /// 주입됐다 — `use_count += 1`, 점수 회복, `last_used` 갱신.
    ///
    /// 회복은 **감쇠를 반영한 뒤**에 더한다. 그러지 않으면 오래 안 쓰인 항목이
    /// 한 번 쓰였다고 예전 점수를 그대로 되찾는다.
    pub async fn recall_touch(
        &self,
        project_id: u32,
        kind: String,
        reference: String,
    ) -> Result<()> {
        let now = chrono::Utc::now();
        let stamp = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        self.conn
            .call(move |c| {
                let existing: Option<(f64, Option<String>)> = c
                    .query_row(
                        "SELECT score, last_used FROM recall_stats
                         WHERE project_id = ?1 AND kind = ?2 AND ref = ?3",
                        rusqlite::params![project_id as i64, &kind, &reference],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                let next = match &existing {
                    Some((score, last)) => {
                        (decayed(*score, last.as_deref(), now) + USE_BOOST).min(1.0)
                    }
                    None => SEED_SCORE,
                };
                c.execute(
                    "INSERT INTO recall_stats (project_id, kind, ref, score, use_count, last_used)
                     VALUES (?1, ?2, ?3, ?4, 1, ?5)
                     ON CONFLICT(project_id, kind, ref) DO UPDATE SET
                       score = ?4, use_count = use_count + 1, last_used = ?5",
                    rusqlite::params![project_id as i64, &kind, &reference, next, &stamp],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 한 항목을 잊는다 (행 삭제). 없던 행이면 `false`.
    pub async fn recall_forget(
        &self,
        project_id: u32,
        kind: String,
        reference: String,
    ) -> Result<bool> {
        let n = self
            .conn
            .call(move |c| {
                let n = c.execute(
                    "DELETE FROM recall_stats WHERE project_id = ?1 AND kind = ?2 AND ref = ?3",
                    rusqlite::params![project_id as i64, &kind, &reference],
                )?;
                Ok(n)
            })
            .await?;
        Ok(n > 0)
    }

    /// 이 프로젝트의 통계를 전부 지운다 (위험 구역). 지워도 무해하다.
    pub async fn recall_reset(&self, project_id: u32) -> Result<u32> {
        let n = self
            .conn
            .call(move |c| {
                let n = c.execute(
                    "DELETE FROM recall_stats WHERE project_id = ?1",
                    [project_id as i64],
                )?;
                Ok(n)
            })
            .await?;
        Ok(n as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decay_halves_every_thirty_days() {
        let now = chrono::Utc::now();
        let ago = |days: i64| (now - chrono::Duration::days(days)).to_rfc3339();

        // 갓 쓰인 것은 그대로.
        assert!((decayed(1.0, Some(&ago(0)), now) - 1.0).abs() < 0.01);
        // 30일 → 절반, 60일 → 사분의 일 (반감 2회).
        assert!((decayed(1.0, Some(&ago(30)), now) - 0.5).abs() < 0.01);
        assert!((decayed(1.0, Some(&ago(60)), now) - 0.25).abs() < 0.01);
        // 한 번도 안 쓰인 것은 깎지 않는다.
        assert!((decayed(0.5, None, now) - 0.5).abs() < f64::EPSILON);
        // 깨진 타임스탬프에 당황하지 않는다.
        assert!((decayed(0.5, Some("not-a-date"), now) - 0.5).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn touch_seeds_then_recovers_after_decay() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path().join("t.db")).await.unwrap();

        db.recall_touch(1, "journal".into(), "a.md".into())
            .await
            .unwrap();
        let first = db.recall_top(1, 10).await.unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].use_count, 1);
        assert!((first[0].score - 0.5).abs() < 0.01);

        // 다시 쓰이면 올라간다 (상한 1.0).
        db.recall_touch(1, "journal".into(), "a.md".into())
            .await
            .unwrap();
        let second = db.recall_top(1, 10).await.unwrap();
        assert_eq!(second[0].use_count, 2);
        assert!(second[0].score > 0.7);
    }

    #[tokio::test]
    async fn forget_and_reset_are_safe_to_call_twice() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path().join("t.db")).await.unwrap();
        db.recall_touch(1, "plan".into(), "p1".into())
            .await
            .unwrap();
        db.recall_touch(1, "plan".into(), "p2".into())
            .await
            .unwrap();

        assert!(db
            .recall_forget(1, "plan".into(), "p1".into())
            .await
            .unwrap());
        assert!(!db
            .recall_forget(1, "plan".into(), "p1".into())
            .await
            .unwrap());
        assert_eq!(db.recall_reset(1).await.unwrap(), 1);
        assert_eq!(db.recall_reset(1).await.unwrap(), 0);
        assert!(db.recall_top(1, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn top_ranks_by_decayed_score_not_stored_score() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path().join("t.db")).await.unwrap();
        // 오래된 고득점 vs 최근 저득점 — 최근이 이겨야 한다.
        let long_ago = (chrono::Utc::now() - chrono::Duration::days(120)).to_rfc3339();
        db.conn()
            .call(move |c| {
                c.execute(
                    "INSERT INTO recall_stats (project_id, kind, ref, score, use_count, last_used)
                     VALUES (1, 'journal', 'old.md', 1.0, 9, ?1)",
                    [&long_ago],
                )?;
                Ok::<(), tokio_rusqlite::Error>(())
            })
            .await
            .unwrap();
        db.recall_touch(1, "journal".into(), "new.md".into())
            .await
            .unwrap();

        let top = db.recall_top(1, 10).await.unwrap();
        assert_eq!(top[0].ref_, "new.md");
    }
}
