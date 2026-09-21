//! journal-scale-round `{#hotspot-query}` — "재발·반복 수정" 신호.
//!
//! `oculpm_journal_files` × `oculpm_journal` 을 파일 단위로 묶으면, 같은 파일에
//! bug/error 타입 일지가 몰린 파일이 드러난다. 이 저장소만 해도 bug 일지가
//! 5건 이상 붙은 파일이 31개인데, 지금 어느 화면에도 이 신호가 없다.
//!
//! **잡음 제거**: `lib.rs` · `package.json` · `Cargo.toml` · `src/i18n/ko.ts` 처럼
//! *모든* 작업이 `files_touched` 에 무심코 걸어 두는 허브 파일은 `total_entries`
//! 는 크지만 그중 bug/error 비율은 낮다 — 그건 "이 파일이 자주 재발한다" 는
//! 신호가 아니라 "다들 이 파일을 지나간다" 는 배경 소음이다. 그래서
//! `(bug_count + error_count)` 가 `total_entries` 의 **20% 미만**인 파일은
//! 제외한다 (아래 `HAVING` 절의 `* 5 >=`). bug+error 가 1건뿐인 파일도 "재발"
//! 이라 부르기엔 이르므로 최소 2건을 요구한다.

use super::*;

/// 파일 하나의 재발 신호 — Today 의 `HotspotCard` (`{#hotspot-card}`) 가
/// 상위 5개를 보여준다.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FileHotspot {
    pub file_path: String,
    pub bug_count: u32,
    pub error_count: u32,
    pub total_entries: u32,
    /// 이 파일을 건드린 가장 최근 일지의 workday (YYYYMMDD).
    pub last_workday: String,
    /// 그 일지의 캐시 키 — 그대로 일지 화면 점프에 쓴다.
    pub last_entry_path: String,
    pub last_entry_title: String,
}

impl Db {
    /// 파일별 bug/error 재발 집계. `since_workday` 가 있으면 그 workday
    /// (포함) 이후 일지만 센다 — 커맨드 레이어(`commands::hotspot`)가
    /// `days` 를 이 문자열로 바꿔 넘긴다. 테스트가 고정 문자열을 직접 줄 수
    /// 있도록 "오늘" 계산은 여기서 하지 않는다.
    ///
    /// bug+error 내림차순 → total_entries 내림차순 → file_path 오름차순
    /// (동점을 결정적으로 만든다).
    pub async fn file_hotspots(
        &self,
        project_id: u32,
        since_workday: Option<String>,
        limit: u32,
    ) -> Result<Vec<FileHotspot>> {
        let lim = limit.clamp(1, 50) as i64;
        let rows = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "WITH joined AS (
                       SELECT f.file_path       AS file_path,
                              j.type             AS type,
                              j.workday          AS workday,
                              j.relative_path    AS relative_path,
                              j.title            AS title,
                              j.created_at       AS created_at
                       FROM oculpm_journal_files f
                       JOIN oculpm_journal j
                         ON j.project_id = f.project_id
                        AND j.relative_path = f.relative_path
                       WHERE f.project_id = ?1
                         AND (?2 IS NULL OR j.workday >= ?2)
                     ),
                     agg AS (
                       SELECT file_path,
                              SUM(type = 'bug')   AS bug_count,
                              SUM(type = 'error') AS error_count,
                              COUNT(*)            AS total_entries,
                              MAX(workday)        AS last_workday
                       FROM joined
                       GROUP BY file_path
                     ),
                     ranked AS (
                       SELECT file_path, relative_path, title,
                              ROW_NUMBER() OVER (
                                PARTITION BY file_path ORDER BY created_at DESC
                              ) AS rn
                       FROM joined
                     )
                     SELECT a.file_path, a.bug_count, a.error_count, a.total_entries,
                            a.last_workday, r.relative_path, r.title
                     FROM agg a
                     JOIN ranked r ON r.file_path = a.file_path AND r.rn = 1
                     WHERE (a.bug_count + a.error_count) >= 2
                       AND (a.bug_count + a.error_count) * 5 >= a.total_entries
                     ORDER BY (a.bug_count + a.error_count) DESC,
                              a.total_entries DESC,
                              a.file_path ASC
                     LIMIT ?3",
                )?;
                let out = stmt
                    .query_map(params![project_id as i64, since_workday, lim], |r| {
                        Ok(FileHotspot {
                            file_path: r.get(0)?,
                            bug_count: r.get::<_, i64>(1)? as u32,
                            error_count: r.get::<_, i64>(2)? as u32,
                            total_entries: r.get::<_, i64>(3)? as u32,
                            last_workday: r.get(4)?,
                            last_entry_path: r.get(5)?,
                            last_entry_title: r.get(6)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(out)
            })
            .await?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 시드 헬퍼 — `oculpm_journal`/`oculpm_journal_files` 의 필수 컬럼을 채운
    /// 최소 행 하나. 실제 캐시가 쓰는 값(session_id 등)은 이 쿼리와 무관해
    /// 더미로 둔다.
    fn seed_entry(
        c: &rusqlite::Connection,
        project_id: i64,
        relative_path: &str,
        workday: &str,
        entry_type: &str,
        title: &str,
        created_at: &str,
        files: &[&str],
    ) {
        c.execute(
            "INSERT INTO oculpm_journal
               (project_id, relative_path, workday, type, slug, status, title,
                session_id, agent_id, language, verified_by_user, created_at,
                file_mtime, body_markdown, body_md_hash)
             VALUES (?1, ?2, ?3, ?4, 'slug', 'done', ?5,
                     'manual-x', 'claude-code', 'ko', 0, ?6,
                     0, '', 'h')",
            params![
                project_id,
                relative_path,
                workday,
                entry_type,
                title,
                created_at
            ],
        )
        .unwrap();
        for f in files {
            c.execute(
                "INSERT INTO oculpm_journal_files (project_id, relative_path, file_path, op)
                 VALUES (?1, ?2, ?3, 'update')",
                params![project_id, relative_path, f],
            )
            .unwrap();
        }
    }

    /// 재발 파일(5건 bug)은 상위에, 허브 파일(20건 중 bug 2건 = 10%)은 20%
    /// 문턱에 걸려 빠진다. bug 1건뿐인 파일도 최소 2건 문턱에 걸려 빠진다.
    #[tokio::test]
    async fn ranks_recurring_files_and_excludes_hub_noise() {
        let dir = tempdir().unwrap();
        let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
        db.conn()
            .call(|c| -> Result<()> {
                c.execute_batch(
                    "INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');",
                )?;

                // 재발 파일 — bug 5건, 전부 이 파일 하나.
                for i in 0..5 {
                    seed_entry(
                        c,
                        1,
                        &format!("2026090{i}/Bugs/x.md"),
                        &format!("2026090{i}"),
                        "bug",
                        &format!("watcher 버그 {i}"),
                        &format!("2026-09-0{}T10:00:00+09:00", i + 1),
                        &["src/watcher.rs"],
                    );
                }

                // 재발 파일보다 약한 파일 — bug 2건, total 2건 (100%, 문턱 통과).
                for i in 0..2 {
                    seed_entry(
                        c,
                        1,
                        &format!("2026091{i}/Bugs/y.md"),
                        &format!("2026091{i}"),
                        "bug",
                        &format!("small 버그 {i}"),
                        &format!("2026-09-1{}T10:00:00+09:00", i),
                        &["src/small.rs"],
                    );
                }

                // 허브 파일 — bug 2건 + chore/feature 18건 = 총 20건, 비율 10% < 20%.
                for i in 0..20 {
                    let ty = if i < 2 { "bug" } else { "chore" };
                    seed_entry(
                        c,
                        1,
                        &format!("2026092{i:02}/Chores/z.md"),
                        "20260920",
                        ty,
                        &format!("허브 변경 {i}"),
                        &format!("2026-09-20T{:02}:00:00+09:00", 10 + (i % 13)),
                        &["package.json"],
                    );
                }

                // bug 1건뿐 — 최소 2건 문턱에 걸려 빠진다.
                seed_entry(
                    c,
                    1,
                    "20260930/Bugs/w.md",
                    "20260930",
                    "bug",
                    "외톨이 버그",
                    "2026-09-30T10:00:00+09:00",
                    &["src/lonely.rs"],
                );

                Ok(())
            })
            .await
            .unwrap();

        let hotspots = db.file_hotspots(1, None, 10).await.unwrap();
        let paths: Vec<&str> = hotspots.iter().map(|h| h.file_path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["src/watcher.rs", "src/small.rs"],
            "허브·외톨이 파일은 빠지고, bug+error 내림차순으로 정렬돼야 한다"
        );

        let watcher = &hotspots[0];
        assert_eq!(watcher.bug_count, 5);
        assert_eq!(watcher.error_count, 0);
        assert_eq!(watcher.total_entries, 5);
        assert_eq!(watcher.last_workday, "20260904");
        assert_eq!(
            watcher.last_entry_title, "watcher 버그 4",
            "최신 created_at 의 일지여야 한다"
        );
    }

    /// `since_workday` 는 그 workday 를 포함해 이후 일지만 센다 — 옛 재발은
    /// 창 밖으로 밀려나 사라지고, 창 안의 파일만 남는다.
    #[tokio::test]
    async fn since_workday_narrows_to_the_window() {
        let dir = tempdir().unwrap();
        let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
        db.conn()
            .call(|c| -> Result<()> {
                c.execute_batch(
                    "INSERT INTO projects (id, name, root_path) VALUES (1, 'p', '/tmp/p');",
                )?;
                for i in 0..3 {
                    seed_entry(
                        c,
                        1,
                        &format!("2025010{i}/Bugs/old.md"),
                        "20250101",
                        "bug",
                        &format!("옛 버그 {i}"),
                        &format!("2025-01-0{}T10:00:00+09:00", i + 1),
                        &["src/old.rs"],
                    );
                }
                for i in 0..2 {
                    seed_entry(
                        c,
                        1,
                        &format!("2026090{i}/Bugs/new.md"),
                        "20260901",
                        "bug",
                        &format!("새 버그 {i}"),
                        &format!("2026-09-0{}T10:00:00+09:00", i + 1),
                        &["src/new.rs"],
                    );
                }
                Ok(())
            })
            .await
            .unwrap();

        let all = db.file_hotspots(1, None, 10).await.unwrap();
        assert_eq!(all.len(), 2, "창 없이는 옛 파일도 보인다");

        let windowed = db
            .file_hotspots(1, Some("20260101".to_string()), 10)
            .await
            .unwrap();
        assert_eq!(
            windowed
                .iter()
                .map(|h| h.file_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/new.rs"],
            "20250101 일지는 창(20260101~) 밖이라 빠져야 한다"
        );
    }
}
