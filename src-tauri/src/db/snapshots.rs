//! diff 기준선 스냅샷 (`file_snapshots`, PR6.6 / Lite-W6).
//!
//! git 이 `HEAD` 로 기준선을 주지 못하는 파일(HEAD 없는 저장소 · git 아닌 프로젝트 ·
//! 추적 안 된 파일)의 「마지막으로 본 내용」 한 장. 읽는 쪽은 `commands::diff`
//! (`compute_diff` 의 스냅샷 폴백)와 일지별 diff 캡처(`oculpm::entry_diffs` 의 2단계)다.
//!
//! 예전에는 `db/code_index.rs` 의 한 조각이었고 쓰는 쪽이 코드 색인이었다. 4.0 에서
//! 색인을 걷으며 표와 접근자는 그대로 이 파일로 옮겼고, 쓰기는 워처의 기준선 동기
//! (`crate::baseline`)가 맡는다.

use super::*;

impl Db {
    /// Upsert the snapshot row for a single path.
    pub async fn upsert_file_snapshot(
        &self,
        project_id: u32,
        path: String,
        content: Vec<u8>,
        hash: String,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO file_snapshots (project_id, path, content, hash, captured_at)
                     VALUES (?1, ?2, ?3, ?4, unixepoch())
                     ON CONFLICT(project_id, path) DO UPDATE SET
                       content = excluded.content,
                       hash = excluded.hash,
                       captured_at = excluded.captured_at",
                    params![project_id as i64, &path, &content, &hash],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 한 경로의 스냅샷을 지운다 — 파일이 HEAD 에 들어간 순간 그 기준선은
    /// git 이 갖는다 (`{#snapshot-git-dup}`).
    pub async fn delete_file_snapshot(&self, project_id: u32, path: String) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM file_snapshots WHERE project_id = ?1 AND path = ?2",
                    params![project_id as i64, &path],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// 사라진 경로 하나와 **그 아래의 모든 스냅샷**을 지운다.
    ///
    /// 폴더를 휴지통으로 옮기거나(`mv`) FSEvents 가 폴더 하나로 접어 보고하면 안의
    /// 파일마다 Remove 가 오지 않는다 (2026-10-18 실측: 한 프로젝트 64행 중 50행이
    /// 통째로 사라진 폴더 아래). 호출자는 경로가 디스크에 **없을 때만** 부른다.
    pub async fn delete_file_snapshots_under(&self, project_id: u32, path: String) -> Result<u32> {
        let removed = self
            .conn
            .call(move |c| {
                let prefix = format!("{}/", path.trim_end_matches('/'));
                let plen = prefix.chars().count() as i64;
                let n = c.execute(
                    "DELETE FROM file_snapshots WHERE project_id = ?1
                       AND (path = ?2 OR substr(path, 1, ?4) = ?3)",
                    params![project_id as i64, &path, &prefix, plen],
                )? as u32;
                Ok(n)
            })
            .await?;
        Ok(removed)
    }

    /// 파일 하나의 기준선 동기 — HEAD 가 서빙하면 지우고, 아니면 찍는다
    /// (`{#snapshot-git-dup}`). 방금 커밋된 파일의 옛 스냅샷이 남지 않게.
    pub async fn sync_file_snapshot(
        &self,
        project_id: u32,
        path: &str,
        content: &[u8],
        hash: &str,
        in_head: bool,
    ) -> Result<()> {
        if in_head {
            self.delete_file_snapshot(project_id, path.to_string())
                .await
        } else {
            self.upsert_file_snapshot(
                project_id,
                path.to_string(),
                content.to_vec(),
                hash.to_string(),
            )
            .await
        }
    }

    /// `keep` 에 없는 이 프로젝트의 스냅샷을 전부 지운다 (`{#snapshot-git-dup}`).
    /// `keep` 은 **HEAD 에 없는** 파일들이다 — 그러면 git 이 HEAD 로 서빙하는 파일의
    /// 복사본과 디스크에서 사라진 고아가 함께 빠진다.
    pub async fn retain_file_snapshots(&self, project_id: u32, keep: Vec<String>) -> Result<u32> {
        let removed = self
            .conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute_batch(
                    "CREATE TEMP TABLE IF NOT EXISTS snapshot_keep (path TEXT PRIMARY KEY);
                     DELETE FROM snapshot_keep;",
                )?;
                {
                    let mut ins =
                        tx.prepare("INSERT OR IGNORE INTO snapshot_keep (path) VALUES (?1)")?;
                    for path in &keep {
                        ins.execute(params![path])?;
                    }
                }
                let n = tx.execute(
                    "DELETE FROM file_snapshots
                     WHERE project_id = ?1
                       AND path NOT IN (SELECT path FROM snapshot_keep)",
                    params![project_id as i64],
                )? as u32;
                tx.execute_batch("DELETE FROM snapshot_keep;")?;
                tx.commit()?;
                Ok(n)
            })
            .await?;
        Ok(removed)
    }

    /// 이 프로젝트의 스냅샷 경로 전부 — 기동 정리(`baseline::prune`)가 디스크·HEAD 와
    /// 대조한다. 내용(블롭)은 읽지 않는다.
    pub async fn snapshot_paths(&self, project_id: u32) -> Result<Vec<String>> {
        let paths = self
            .conn
            .call(move |c| {
                let mut stmt =
                    c.prepare("SELECT path FROM file_snapshots WHERE project_id = ?1")?;
                let rows = stmt.query_map([project_id as i64], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .await?;
        Ok(paths)
    }

    /// 한 경로의 스냅샷 해시만 — 같은 내용이면 다시 쓰지 않으려고 (`baseline::sync_one`).
    pub async fn snapshot_hash(&self, project_id: u32, path: String) -> Result<Option<String>> {
        let hash = self
            .conn
            .call(move |c| {
                c.query_row(
                    "SELECT hash FROM file_snapshots WHERE project_id = ?1 AND path = ?2",
                    params![project_id as i64, &path],
                    |r| r.get::<_, String>(0),
                )
                .optional()
            })
            .await?;
        Ok(hash)
    }

    /// Fetch the snapshot row for a path. Returns `None` when no snapshot has
    /// been captured yet — `compute_diff` surfaces this as
    /// `DiffSource::SnapshotsUnavailable`.
    pub async fn get_file_snapshot(
        &self,
        project_id: u32,
        path: String,
    ) -> Result<Option<FileSnapshot>> {
        let snapshot = self
            .conn
            .call(move |c| {
                let row = c
                    .query_row(
                        "SELECT id, project_id, path, content, hash, captured_at
                         FROM file_snapshots WHERE project_id = ?1 AND path = ?2",
                        params![project_id as i64, &path],
                        |r| {
                            Ok(FileSnapshot {
                                id: r.get::<_, i64>(0)? as u32,
                                project_id: r.get::<_, i64>(1)? as u32,
                                path: r.get(2)?,
                                content: r.get(3)?,
                                hash: r.get(4)?,
                                captured_at: r.get::<_, i64>(5)? as u32,
                            })
                        },
                    )
                    .optional()?;
                Ok(row)
            })
            .await?;
        Ok(snapshot)
    }
}
