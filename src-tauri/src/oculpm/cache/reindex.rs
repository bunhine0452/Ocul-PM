//! 재색인 — 전체/증분 리빌드와 알려진 mtime 로드.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl<'a> JournalCache<'a> {

    // ────────── reindex ──────────

    /// Drop every cached row for `project_id` and rebuild from disk. Use
    /// after manual SQLite tampering or schema migration. O(journal-size).
    pub async fn reindex_full(
        &self,
        project_id: u32,
        journal_root: &Path,
    ) -> Result<CacheReindexReport, OculpmError> {
        let started = Instant::now();
        // Drop everything for this project — three tables, one tx.
        let pid = project_id as i64;
        self.db
            .conn()
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM oculpm_journal WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_files WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_tags WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.commit()?;
                Ok(())
            })
            .await
            .map_err(map_sqlite_err)?;

        let mut report = CacheReindexReport {
            inserted: 0,
            updated: 0,
            deleted: 0,
            skipped_unchanged: 0,
            parse_errors: 0,
            elapsed_ms: 0,
        };

        for (relative_path, mtime) in walk_journal(journal_root) {
            let abs = journal_root.join(&relative_path);
            let raw = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue, // file deleted between walk and read
            };
            let (parsed, body, full, _redacted) = self.project_text(&raw);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &full)
                .await
            {
                Ok(UpsertOutcome::Inserted) => report.inserted += 1,
                Ok(UpsertOutcome::Updated) => report.updated += 1,
                Ok(UpsertOutcome::MtimeOnly | UpsertOutcome::SkippedUnchanged) => {
                    report.skipped_unchanged += 1
                }
                Err(e) => {
                    tracing::warn!(target: "oculpm::cache", path = %relative_path, error = %e, "reindex upsert failed");
                    report.parse_errors += 1;
                }
            }
        }

        report.elapsed_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(report)
    }

    /// Incremental rebuild — only re-parse files whose `file_mtime` differs
    /// from the cached value, and delete rows whose underlying file is
    /// gone. O(walk + changed-files).
    ///
    /// R1 redaction caveat (dev-report §2): masking is applied as files are
    /// re-projected, but an mtime-unchanged file is skipped *before* masking.
    /// So a secret that was already projected into the cache by a pre-redaction
    /// build is NOT scrubbed by an incremental pass — only a content edit (mtime
    /// bump) or a full reindex (the manual "재인덱스" button → [`reindex_full`],
    /// which always re-projects with masking) clears it. New projects are fully
    /// covered: redaction is on by default from creation, so every first
    /// projection is masked. Scrubbing stale pre-R1 rows is a follow-up.
    ///
    /// [`reindex_full`]: Self::reindex_full
    pub async fn reindex_incremental(
        &self,
        project_id: u32,
        journal_root: &Path,
    ) -> Result<CacheReindexReport, OculpmError> {
        let started = Instant::now();
        let known = self.load_known_mtimes(project_id).await?;
        let mut report = CacheReindexReport {
            inserted: 0,
            updated: 0,
            deleted: 0,
            skipped_unchanged: 0,
            parse_errors: 0,
            elapsed_ms: 0,
        };

        let mut seen: HashMap<String, ()> = HashMap::new();
        for (relative_path, mtime) in walk_journal(journal_root) {
            seen.insert(relative_path.clone(), ());
            // Skip only when the file is unchanged AND already coerced at the
            // current version — a coercion-logic bump (COERCION_VERSION) forces a
            // one-time re-projection of otherwise-unchanged rows (F7a-B follow-up).
            if let Some((cached_mtime, cached_version)) = known.get(&relative_path).copied() {
                if cached_mtime == mtime && cached_version == COERCION_VERSION {
                    report.skipped_unchanged += 1;
                    continue;
                }
            }
            let abs = journal_root.join(&relative_path);
            let raw = match std::fs::read_to_string(&abs) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let (parsed, body, full, _redacted) = self.project_text(&raw);
            if parsed.parsed.is_none() {
                report.parse_errors += 1;
            }
            match self
                .upsert_entry(project_id, &relative_path, &parsed, &body, mtime, &full)
                .await
            {
                Ok(UpsertOutcome::Inserted) => report.inserted += 1,
                Ok(UpsertOutcome::Updated) => report.updated += 1,
                Ok(UpsertOutcome::MtimeOnly | UpsertOutcome::SkippedUnchanged) => {
                    report.skipped_unchanged += 1
                }
                Err(e) => {
                    tracing::warn!(target: "oculpm::cache", path = %relative_path, error = %e, "incremental upsert failed");
                    report.parse_errors += 1;
                }
            }
        }

        // Anything in the cache that we didn't observe on disk is gone.
        for path in known.keys() {
            if !seen.contains_key(path) && self.delete_entry(project_id, path).await? {
                report.deleted += 1;
            }
        }

        report.elapsed_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(report)
    }

    /// Per-row `(file_mtime, coercion_version)` for the incremental skip check.
    /// A row is skipped only when BOTH match the disk mtime and the current
    /// `COERCION_VERSION` — so a coercion-logic bump re-projects stale rows once.
    async fn load_known_mtimes(
        &self,
        project_id: u32,
    ) -> Result<HashMap<String, (i64, i64)>, OculpmError> {
        let pid = project_id as i64;
        let map = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, file_mtime, coercion_version FROM oculpm_journal
                     WHERE project_id = ?1",
                )?;
                let mut out: HashMap<String, (i64, i64)> = HashMap::new();
                let rows = stmt.query_map(params![pid], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
                })?;
                for row in rows {
                    let (k, mtime, ver) = row?;
                    out.insert(k, (mtime, ver));
                }
                Ok(out)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(map)
    }
}
