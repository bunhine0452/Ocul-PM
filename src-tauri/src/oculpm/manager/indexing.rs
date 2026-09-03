//! 인덱싱·백필 — 캐시 재색인, entry_diffs·line_counts·git 백필, 집계.
//!
//! `manager/mod.rs` 의 단일 `impl OculpmManager` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl OculpmManager {
    /// Backfill per-entry diff sidecars for entries that never got one — written
    /// before this feature shipped, or imported via reindex (app closed when the
    /// entry was authored) rather than seen by the live watcher. Idempotent and
    /// best-effort: entries that already have a sidecar are skipped with no git
    /// work, so this is cheap on every project open after the first pass. The
    /// git-history fallback in [`entry_diffs`] reconstructs diffs even for
    /// already-committed entries. Returns how many sidecars were newly written.
    pub async fn backfill_entry_diffs(&self, db: &Db, project_id: u32) -> Result<u32, OculpmError> {
        use crate::oculpm::entry_diffs;
        let root = self.project_root(project_id).await?;
        // R1 — compile redaction once; each diff sidecar is masked at capture.
        let redact = crate::oculpm::redact::patterns_for_project(&root);
        let journal_root = self.journal_root(project_id).await?;
        let cache = JournalCache::new(db);
        let mut captured = 0u32;
        for (relative_path, _mtime) in crate::oculpm::cache::walk_journal(&journal_root) {
            if entry_diffs::sidecar_exists(&root, &relative_path) {
                continue;
            }
            let touched = match cache.get_entry(project_id, &relative_path).await {
                Ok(Some(e)) => e.frontmatter.files_touched,
                _ => continue,
            };
            if touched.is_empty() {
                continue;
            }
            // Prefetch last-indexed baselines so the blocking capture can run the
            // snapshot fallback (tier 2) without touching the async Db itself.
            let mut snapshots: HashMap<String, Vec<u8>> = HashMap::new();
            for f in &touched {
                if let Ok(Some(snap)) = db.get_file_snapshot(project_id, f.path.clone()).await {
                    snapshots.insert(f.path.clone(), snap.content);
                }
            }
            let root2 = root.clone();
            let rel2 = relative_path.clone();
            let redact2 = redact.clone();
            let res = tokio::task::spawn_blocking(move || {
                entry_diffs::capture_entry_diffs(&root2, &rel2, &touched, &snapshots, &redact2)
            })
            .await;
            match res {
                Ok(Ok(_)) => {
                    if entry_diffs::sidecar_exists(&root, &relative_path) {
                        captured += 1;
                    }
                }
                Ok(Err(e)) => tracing::warn!(
                    target: "oculpm::manager",
                    project_id, path = %relative_path, error = %e,
                    "entry-diff backfill: sidecar write failed"
                ),
                Err(e) => tracing::warn!(
                    target: "oculpm::manager",
                    project_id, path = %relative_path, error = %e,
                    "entry-diff backfill: blocking task panicked"
                ),
            }
        }
        Ok(captured)
    }

    /// Fill in per-file line churn (Today 히어로의 「라인 변화」) for entries whose
    /// cache rows don't have it yet, counting `+`/`-` lines in the entry's diff
    /// sidecar. Run right after [`Self::backfill_entry_diffs`] so a sidecar
    /// captured in that pass is counted in the same project-open.
    ///
    /// Idempotent and cheap: the work-list is a single indexed query, and each
    /// entry drops off it once counted. Entries with no sidecar stay on the list
    /// (one `read` attempt each) — they have no recorded diff to count, and get
    /// picked up whenever one is finally captured. Returns the entries counted.
    pub async fn backfill_line_counts(&self, db: &Db, project_id: u32) -> Result<u32, OculpmError> {
        use crate::oculpm::entry_diffs;
        let root = self.project_root(project_id).await?;
        let cache = JournalCache::new(db);
        let mut counted = 0u32;
        for relative_path in cache.entries_missing_line_counts(project_id).await? {
            let root2 = root.clone();
            let rel2 = relative_path.clone();
            let counts =
                match tokio::task::spawn_blocking(move || entry_diffs::line_counts(&root2, &rel2))
                    .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::warn!(
                            target: "oculpm::manager",
                            project_id, path = %relative_path, error = %e,
                            "line-count backfill: blocking read panicked"
                        );
                        continue;
                    }
                };
            if counts.is_empty() {
                continue;
            }
            match cache
                .set_line_counts(project_id, &relative_path, counts)
                .await
            {
                Ok(()) => counted += 1,
                Err(e) => tracing::warn!(
                    target: "oculpm::manager",
                    project_id, path = %relative_path, error = %e,
                    "line-count backfill: cache update failed"
                ),
            }
        }
        Ok(counted)
    }

    /// Read an entry's recorded diffs, lazily reconstructing them on a cache miss.
    ///
    /// `oculpm_get_entry_diffs` used to be a pure sidecar read, so an entry whose
    /// sidecar was never written — committed *after* the journal, imported via
    /// reindex, or authored before this feature — showed "기록된 변경 없음" until
    /// the next project-open backfill ran. That's the case the user hits when
    /// they open an entry having committed in between. This reconstructs on
    /// demand with the same 3-tier capture the watcher/backfill use, so the diff
    /// appears immediately (and the sidecar is persisted for next time). A clean
    /// (truly empty) result still reads back as `[]` — capture writes no sidecar.
    pub async fn read_or_reconstruct_entry_diffs(
        &self,
        db: &Db,
        project_id: u32,
        root: PathBuf,
        relative_path: String,
    ) -> Result<Vec<crate::oculpm::entry_diffs::EntryFileDiff>, OculpmError> {
        use crate::oculpm::entry_diffs;
        // `root` is resolved by the caller from the DB (not `self.project_root`),
        // so reconstruction works even when the project isn't registered in the
        // manager — the journal screen reads straight from the SQLite cache and
        // a project can be browsed without an active watcher.
        let existing = entry_diffs::read_entry_diffs(&root, &relative_path);
        if !existing.is_empty() {
            return Ok(existing);
        }
        // Cache miss → reconstruct from the entry's files_touched, mirroring
        // `backfill_entry_diffs` for a single entry.
        let cache = JournalCache::new(db);
        let touched = match cache.get_entry(project_id, &relative_path).await {
            Ok(Some(e)) => e.frontmatter.files_touched,
            _ => return Ok(Vec::new()),
        };
        if touched.is_empty() {
            return Ok(Vec::new());
        }
        let mut snapshots: HashMap<String, Vec<u8>> = HashMap::new();
        for f in &touched {
            if let Ok(Some(snap)) = db.get_file_snapshot(project_id, f.path.clone()).await {
                snapshots.insert(f.path.clone(), snap.content);
            }
        }
        // R1 — `root` may be an unregistered project (browsed from the cache),
        // so load redaction from disk rather than the in-memory config.
        let redact = crate::oculpm::redact::patterns_for_project(&root);
        let root2 = root.clone();
        let rel2 = relative_path.clone();
        let _ = tokio::task::spawn_blocking(move || {
            entry_diffs::capture_entry_diffs(&root2, &rel2, &touched, &snapshots, &redact)
        })
        .await;
        Ok(entry_diffs::read_entry_diffs(&root, &relative_path))
    }

    /// Rebuild the cache from `.oculpm/journal/` ground truth. Drops every
    /// row for the project and re-walks. Returns the user-facing report
    /// shape from `spec::ReindexReport` (project_id + completed_at included).
    pub async fn reindex_journal_cache(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<ReindexReport, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let redact = self.redact_patterns(project_id).await;
        let report = JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .reindex_full(project_id, &journal_root)
            .await?;
        Ok(reindex_report_to_spec(project_id, report))
    }

    /// W4 dogfooding follow-up (2026-05-26) — mtime-keyed incremental reindex.
    /// Cheap to call on every project open: files whose mtime matches the
    /// cached row are skipped (no parse, no upsert). Surfaces files that were
    /// created on disk while the app was closed (external LLM ran without the
    /// watcher running) so they appear in TodayScreen without the user having
    /// to click "재인덱스".
    ///
    /// Returns the report shape so the caller can decide whether to surface
    /// a "X entries imported" toast or log only.
    pub async fn reindex_journal_cache_incremental(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<ReindexReport, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let redact = self.redact_patterns(project_id).await;
        let report = JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .reindex_incremental(project_id, &journal_root)
            .await?;
        Ok(reindex_report_to_spec(project_id, report))
    }

    // ─── F5: git-history backfill ───────────────────────────────────────────

    /// Synthesise one journal entry per recent git commit so a repo with rich
    /// history but an empty `.oculpm/journal/` isn't a blank wall on day 1
    /// (the cold-start cliff). Idempotent: a durable sidecar of processed
    /// commit SHAs (`.oculpm/index/git-backfill.json`) means re-running only
    /// adds new commits. Each entry's per-file diff is captured via
    /// `entry_diffs` — its tier-3 nearest-commit path finds exactly this
    /// commit — and masked; the narrative body is redacted at write.
    /// `max_commits` caps the scan (clamped to 1..=2000).
    pub async fn backfill_from_git(
        &self,
        db: &Db,
        project_id: u32,
        max_commits: u32,
    ) -> Result<BackfillReport, OculpmError> {
        use std::collections::{HashMap, HashSet};

        let (root, resolver, language, redact_strings) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.root.clone(),
                entry.resolver.clone(),
                "ko".to_string(),
                entry.config.git.auto_redact_patterns.clone(),
            )
        };

        let cap = max_commits.clamp(1, 2000);
        let root2 = root.clone();
        let commits =
            tokio::task::spawn_blocking(move || crate::git::commits_for_backfill(&root2, cap))
                .await
                .map_err(|e| {
                    OculpmError::InvalidConfig(format!("git backfill task panicked: {e}"))
                })?
                .map_err(OculpmError::InvalidConfig)?;

        let redact = compile_redact_patterns(&redact_strings);
        let tz = chrono_tz_from(&resolver);

        // Durable processed-SHA set for idempotency.
        let sidecar = root.join(".oculpm").join("index").join("git-backfill.json");
        let mut processed: HashSet<String> = std::fs::read(&sidecar)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
            .map(|v| v.into_iter().collect())
            .unwrap_or_default();

        let cache = JournalCache::new(db);
        let scanned = commits.len() as u32;
        let mut created = 0u32;
        let mut skipped = 0u32;

        // Oldest → newest so on-disk filenames read chronologically.
        for c in commits.iter().rev() {
            if processed.contains(&c.sha) {
                skipped += 1;
                continue;
            }
            let Some(commit_utc) = chrono::DateTime::from_timestamp(c.timestamp as i64, 0) else {
                continue;
            };
            let local = commit_utc.with_timezone(&tz);
            let workday = resolver.workday_of(commit_utc);
            let hhmm = format!("{:02}{:02}", local.hour(), local.minute());
            let entry_type = infer_entry_type(&c.subject);
            let slug = slug_from_subject(&c.subject, &c.short_sha);

            let files_touched: Vec<FileTouched> = c
                .files
                .iter()
                .map(|f| FileTouched {
                    path: f.path.clone(),
                    op: status_to_op(f.status),
                    bytes_added: None,
                    bytes_removed: None,
                    rename_from: f.rename_from.clone(),
                })
                .collect();

            let fm = JournalFrontmatter {
                schema_version: 1,
                entry_type,
                slug: slug.clone(),
                status: EntryStatus::Done,
                difficulty: None,
                created_at: local.to_rfc3339(),
                updated_at: None,
                session_id: crate::oculpm::session_id::SessionId::git_backfill(&workday)
                    .into_string(),
                agent: AgentRef {
                    id: infer_agent_id(&c.body),
                    version: None,
                    session: None,
                },
                language: language.clone(),
                verified_by_user: false,
                files_touched: files_touched.clone(),
                related: Vec::new(),
                tags: vec!["git-backfill".to_string(), c.short_sha.clone()],
            };

            let title = c.subject.trim();
            let (body_masked, _hits) = redact_text(&c.body, &redact);
            let body_md = if body_masked.trim().is_empty() {
                format!("[x] {title}\n")
            } else {
                format!("[x] {title}\n\n{}\n", body_masked.trim())
            };
            let text = write_frontmatter_and_body(&fm, &body_md);

            let category_dir = resolver.journal_dir(&root, &workday, entry_type);
            if std::fs::create_dir_all(&category_dir).is_err() {
                continue;
            }
            let base = format!("{hhmm}_{}_{}", entry_type_filename_token(entry_type), slug);
            let (abs, file_name) = pick_nonconflicting_path(&category_dir, &base);
            if write_atomic(&abs, text.as_bytes()).is_err() {
                continue;
            }

            let relative_path = format!("{workday}/{}/{file_name}", category_subdir(entry_type));
            let mtime = std::fs::metadata(&abs)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or_else(|| commit_utc.timestamp());
            let (parsed, body_text) = parse_frontmatter_and_body(&text);
            let body_parsed = parse_body(&body_text);
            let _ = cache
                .upsert_entry(
                    project_id,
                    &relative_path,
                    &parsed,
                    &body_parsed,
                    mtime,
                    &text,
                )
                .await;

            // Capture this commit's per-file diff (entry_diffs tier-3) + mask.
            let root3 = root.clone();
            let rel3 = relative_path.clone();
            let touched3 = files_touched.clone();
            let redact3 = redact.clone();
            let _ = tokio::task::spawn_blocking(move || {
                crate::oculpm::entry_diffs::capture_entry_diffs(
                    &root3,
                    &rel3,
                    &touched3,
                    &HashMap::new(),
                    &redact3,
                )
            })
            .await;

            processed.insert(c.sha.clone());
            created += 1;
        }

        // Persist the processed set (best-effort).
        if let Some(parent) = sidecar.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let list: Vec<String> = processed.into_iter().collect();
        if let Ok(json) = serde_json::to_vec(&list) {
            let _ = std::fs::write(&sidecar, json);
        }

        Ok(BackfillReport {
            project_id,
            scanned,
            created,
            skipped,
        })
    }

    // ─── W5-PR6: Observed agent ids ─────────────────────────────────────────

    /// Distinct agents that have actually written an entry. Drives the
    /// agent dropdown in `CategoryFilterBar`. Tolerant of uninitialized
    /// projects — returns `Ok(vec![])`.
    pub async fn observed_agent_ids(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<Vec<String>, OculpmError> {
        JournalCache::new(db).observed_agent_ids(project_id).await
    }

    // ─── W5-PR5: Overview stats ─────────────────────────────────────────────

    /// Single-shot Overview widgets fetch. `window_days` clamps to 1..=365 —
    /// the heatmap caps at ~90, but we allow 365 so a future "1년 보기" toggle
    /// works without a backend change.
    pub async fn overview_stats(
        &self,
        db: &Db,
        project_id: u32,
        window_days: u32,
    ) -> Result<OculpmOverviewStats, OculpmError> {
        let snapshot = self.project_snapshot(project_id).await?;
        let current_workday = snapshot.resolver.workday_of(chrono::Utc::now());
        let window = window_days.clamp(1, 365);
        JournalCache::new(db)
            .overview_stats(project_id, window, &current_workday)
            .await
    }
}
