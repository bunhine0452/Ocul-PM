//! 쓰기 경로 — 일지 업서트·삭제, 줄수 기록, 경로 변경 반영.
//!
//! `cache/mod.rs` 의 단일 `impl JournalCache` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl<'a> JournalCache<'a> {

    // ────────── single-entry operations ──────────

    /// Insert or replace one journal entry. Cheap when `body_md_hash`
    /// matches the existing row: only the `file_mtime` column changes,
    /// avoiding a wholesale rewrite of the tags/files child tables.
    ///
    /// `full_text` is the original on-disk markdown (frontmatter + body) —
    /// it drives the content hash used by the mtime-only fast path. Hashing
    /// only `body.raw` would miss frontmatter-only edits like the
    /// `verified_by_user` toggle.
    pub async fn upsert_entry(
        &self,
        project_id: u32,
        relative_path: &str,
        parsed: &ParsedFrontmatter,
        body: &ParsedBody,
        file_mtime: i64,
        full_text: &str,
    ) -> Result<UpsertOutcome, OculpmError> {
        let snapshot = CacheRowSnapshot::from(parsed, body, relative_path, full_text, self.tz)?;
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let snap = snapshot.clone();

        let outcome = self
            .db
            .conn()
            .call(move |c| {
                #[allow(clippy::type_complexity)]
                let existing: Option<(String, i64, String, Option<String>, String, Option<String>, i64, i64)> = c
                    .query_row(
                        "SELECT body_md_hash, file_mtime, created_at, updated_at, slug,
                                parse_warnings, parse_ok, coercion_version
                         FROM oculpm_journal
                         WHERE project_id = ?1 AND relative_path = ?2",
                        params![pid, &rp],
                        |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, i64>(1)?,
                                r.get::<_, String>(2)?,
                                r.get::<_, Option<String>>(3)?,
                                r.get::<_, String>(4)?,
                                r.get::<_, Option<String>>(5)?,
                                r.get::<_, i64>(6)?,
                                r.get::<_, i64>(7)?,
                            ))
                        },
                    )
                    .optional()?;

                if let Some((
                    ref existing_hash,
                    existing_mtime,
                    ref ex_created,
                    ref ex_updated,
                    ref ex_slug,
                    ref ex_warnings,
                    ex_parse_ok,
                    ex_coercion_version,
                )) = existing
                {
                    if existing_hash == &snap.body_md_hash {
                        // Full on-disk text identical — the wholesale rewrite below
                        // is avoidable. BUT the cache's *coerced* columns (F7a-B)
                        // may be stale if they were written by an older coercion
                        // than `snap` (a row cached before tz-backfill / Unicode
                        // slug normalize shipped). Self-heal those cheap
                        // frontmatter-derived columns + stamp the coercion version
                        // when the row is version-stale OR the values drift; else
                        // fall through to the mtime-only / no-op fast path.
                        let coerced_drift = ex_created != &snap.created_at
                            || ex_updated != &snap.updated_at
                            || ex_slug != &snap.slug
                            || ex_warnings != &snap.parse_warnings
                            || ex_parse_ok != snap.parse_ok as i64;
                        if coerced_drift || ex_coercion_version != COERCION_VERSION {
                            c.execute(
                                "UPDATE oculpm_journal SET
                                   file_mtime = ?1, created_at = ?2, updated_at = ?3,
                                   slug = ?4, parse_warnings = ?5, parse_ok = ?6,
                                   coercion_version = ?7
                                 WHERE project_id = ?8 AND relative_path = ?9",
                                params![
                                    file_mtime,
                                    &snap.created_at,
                                    &snap.updated_at,
                                    &snap.slug,
                                    &snap.parse_warnings,
                                    snap.parse_ok as i64,
                                    COERCION_VERSION,
                                    pid,
                                    &rp,
                                ],
                            )?;
                            return Ok(UpsertOutcomeRaw::MtimeOnly);
                        }
                        if existing_mtime != file_mtime {
                            c.execute(
                                "UPDATE oculpm_journal SET file_mtime = ?1
                                 WHERE project_id = ?2 AND relative_path = ?3",
                                params![file_mtime, pid, &rp],
                            )?;
                            return Ok(UpsertOutcomeRaw::MtimeOnly);
                        }
                        return Ok(UpsertOutcomeRaw::SkippedUnchanged);
                    }
                }

                let tx = c.transaction()?;
                // Wholesale rewrite of the entry + child tables.
                tx.execute(
                    "INSERT INTO oculpm_journal
                     (project_id, relative_path, workday, type, slug, status, difficulty,
                      title, checkbox, session_id, agent_id, agent_version, language,
                      verified_by_user, created_at, updated_at, file_mtime, body_markdown,
                      body_md_hash, parse_ok, parse_warnings, coercion_version)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
                     ON CONFLICT(project_id, relative_path) DO UPDATE SET
                       workday = excluded.workday,
                       type = excluded.type,
                       slug = excluded.slug,
                       status = excluded.status,
                       difficulty = excluded.difficulty,
                       title = excluded.title,
                       checkbox = excluded.checkbox,
                       session_id = excluded.session_id,
                       agent_id = excluded.agent_id,
                       agent_version = excluded.agent_version,
                       language = excluded.language,
                       verified_by_user = excluded.verified_by_user,
                       created_at = excluded.created_at,
                       updated_at = excluded.updated_at,
                       file_mtime = excluded.file_mtime,
                       body_markdown = excluded.body_markdown,
                       body_md_hash = excluded.body_md_hash,
                       parse_ok = excluded.parse_ok,
                       parse_warnings = excluded.parse_warnings,
                       coercion_version = excluded.coercion_version",
                    params![
                        pid,
                        &rp,
                        &snap.workday,
                        &snap.entry_type,
                        &snap.slug,
                        &snap.status,
                        &snap.difficulty,
                        &snap.title,
                        snap.checkbox,
                        &snap.session_id,
                        &snap.agent_id,
                        &snap.agent_version,
                        &snap.language,
                        snap.verified_by_user as i64,
                        &snap.created_at,
                        &snap.updated_at,
                        file_mtime,
                        &snap.body_markdown,
                        &snap.body_md_hash,
                        snap.parse_ok as i64,
                        &snap.parse_warnings,
                        COERCION_VERSION,
                    ],
                )?;

                tx.execute(
                    "DELETE FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                for f in &snap.files {
                    tx.execute(
                        "INSERT INTO oculpm_journal_files
                         (project_id, relative_path, file_path, op, bytes_added, bytes_removed)
                         VALUES (?1,?2,?3,?4,?5,?6)",
                        params![pid, &rp, &f.path, &f.op, f.bytes_added, f.bytes_removed],
                    )?;
                }

                tx.execute(
                    "DELETE FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                for t in &snap.tags {
                    tx.execute(
                        "INSERT OR IGNORE INTO oculpm_journal_tags
                         (project_id, relative_path, tag)
                         VALUES (?1,?2,?3)",
                        params![pid, &rp, t],
                    )?;
                }
                tx.commit()?;
                Ok(if existing.is_some() {
                    UpsertOutcomeRaw::Updated
                } else {
                    UpsertOutcomeRaw::Inserted
                })
            })
            .await
            .map_err(map_sqlite_err)?;

        Ok(outcome.into())
    }

    /// Remove an entry. Idempotent — deleting a non-existent row is `Ok(())`
    /// with no side effects.
    pub async fn delete_entry(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<bool, OculpmError> {
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        let removed = self
            .db
            .conn()
            .call(move |c| {
                let tx = c.transaction()?;
                let removed = tx.execute(
                    "DELETE FROM oculpm_journal
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_files
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_journal_tags
                     WHERE project_id = ?1 AND relative_path = ?2",
                    params![pid, &rp],
                )?;
                tx.commit()?;
                Ok(removed > 0)
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(removed)
    }

    /// Store the per-file line churn derived from an entry's diff sidecar. Rows
    /// are matched by `file_path`; a path in the sidecar that is no longer in
    /// `files_touched` simply updates nothing.
    pub async fn set_line_counts(
        &self,
        project_id: u32,
        relative_path: &str,
        counts: Vec<crate::oculpm::entry_diffs::FileLineCounts>,
    ) -> Result<(), OculpmError> {
        if counts.is_empty() {
            return Ok(());
        }
        let pid = project_id as i64;
        let rp = relative_path.to_string();
        self.db
            .conn()
            .call(move |c| {
                let tx = c.transaction()?;
                for f in &counts {
                    tx.execute(
                        "UPDATE oculpm_journal_files
                            SET lines_added = ?1, lines_removed = ?2
                          WHERE project_id = ?3 AND relative_path = ?4 AND file_path = ?5",
                        params![f.added, f.removed, pid, &rp, &f.path],
                    )?;
                }
                tx.commit()?;
                Ok(())
            })
            .await
            .map_err(map_sqlite_err)
    }

    /// Handle a single path-level change event from the watcher (W2-PR5).
    /// Created/Modified are coalesced — the cache always reads the latest
    /// on-disk state rather than trusting the event payload.
    ///
    /// Returns `(outcome, redacted_spans)`. The outcome lets the caller (watcher)
    /// decide whether to emit `OculpmJournalAdded` (new row → toast + optimistic
    /// UI add) vs `OculpmJournalUpdated` (row mutated → silent refresh) vs
    /// nothing (mtime-only / unchanged hash). For `Removed`, the outcome is
    /// `None` and the watcher emits via `oculpm-journal-path-changed` only.
    /// `redacted_spans` is how many secrets this cache (when built with
    /// [`with_redaction`][Self::with_redaction]) masked on projection — the
    /// watcher turns a non-zero count into an integrity warning.
    pub async fn apply_path_change(
        &self,
        project_id: u32,
        journal_root: &Path,
        relative_path: &str,
        kind: PathChangeKind,
    ) -> Result<(Option<UpsertOutcome>, usize), OculpmError> {
        match kind {
            PathChangeKind::Removed => {
                self.delete_entry(project_id, relative_path).await?;
                Ok((None, 0))
            }
            PathChangeKind::Created | PathChangeKind::Modified => {
                let abs = journal_root.join(relative_path);
                let meta = std::fs::metadata(&abs).map_err(|source| OculpmError::Io {
                    path: abs.clone(),
                    source,
                })?;
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or_else(|| Utc::now().timestamp());
                let raw = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
                    path: abs,
                    source,
                })?;
                let (parsed, body, full, redacted) = self.project_text(&raw);
                let outcome = self
                    .upsert_entry(project_id, relative_path, &parsed, &body, mtime, &full)
                    .await?;
                Ok((Some(outcome), redacted))
            }
        }
    }
}
