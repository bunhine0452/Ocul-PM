//! 일지 CRUD — 경로 해석·조회·검증·메타/본문 수정·수동 작성.
//!
//! `manager/mod.rs` 의 단일 `impl OculpmManager` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

/// 일지 상대경로 → 절대경로. 절대경로·`..`·빈 경로를 거부하고 결과가
/// `journal_root` 아래인지 한 번 더 확인한다.
///
/// 이 경로는 모바일 브리지(`mobile_bridge/dispatch.rs`)가 페어링된 기기에 그대로
/// 노출하는 인자다 — `Path::join` 은 절대경로를 받으면 base 를 통째로 버리므로
/// 가드 없이는 `.oculpm/journal` 밖의 `.md` 를 읽고 덮어쓸 수 있었다
/// (2026-08-30 감사). `entry_diffs::sidecar_path` 와 같은 규칙이다.
pub(crate) fn resolve_entry_path(
    journal_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, OculpmError> {
    let rel = Path::new(relative_path);
    let well_formed = !relative_path.is_empty()
        && !rel.is_absolute()
        && rel
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
    if !well_formed {
        return Err(OculpmError::InvalidPath(relative_path.to_string()));
    }
    let abs = journal_root.join(rel);
    if !abs.starts_with(journal_root) {
        return Err(OculpmError::InvalidPath(relative_path.to_string()));
    }
    Ok(abs)
}

impl OculpmManager {
    // ─── W3-PR3: journal cache + manual entry coordination ──────────────────

    /// Resolve a project's `.oculpm/journal/` absolute root. Used by the
    /// journal commands to drive `JournalCache` calls.
    pub async fn journal_root(&self, project_id: u32) -> Result<PathBuf, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.resolver.journal_root(&entry.root))
    }

    /// Resolve a project's repository root — the directory that holds `.oculpm/`.
    /// Used to drive git (per-entry diff capture) against the working tree.
    pub async fn project_root(&self, project_id: u32) -> Result<PathBuf, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.root.clone())
    }

    /// List cached journal entries for `(project_id, workday?)` with
    /// arbitrary filters. Thin wrapper over [`JournalCache::list_entries`].
    pub async fn list_journal_entries(
        &self,
        db: &Db,
        project_id: u32,
        workday: Option<String>,
        filters: EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError> {
        JournalCache::new(db)
            .list_entries(project_id, workday.as_deref(), &filters)
            .await
    }

    /// Get a single cached entry. Falls back to an on-demand disk read +
    /// upsert if the row is missing but the file exists.
    pub async fn get_journal_entry(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
    ) -> Result<Option<JournalEntry>, OculpmError> {
        let cache = JournalCache::new(db);
        if let Some(entry) = cache.get_entry(project_id, &relative_path).await? {
            return Ok(Some(entry));
        }
        // Cache miss — check disk.
        let journal_root = self.journal_root(project_id).await?;
        let abs = resolve_entry_path(&journal_root, &relative_path)?;
        if !abs.exists() {
            return Ok(None);
        }
        // Project the disk file with on-read masking so a secret in an
        // agent-authored entry never reaches the cache (→ AI context). Compiled
        // only on the (rare) miss path, not on the cache-hit fast path above.
        let redact = self.redact_patterns(project_id).await;
        let redacting =
            JournalCache::with_redaction(db, redact).with_tz(self.tz_for(project_id).await);
        redacting
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Created,
            )
            .await?;
        redacting.get_entry(project_id, &relative_path).await
    }

    /// Toggle `verified_by_user` on a journal entry. Reads the disk file,
    /// mutates the frontmatter only, atomic-writes it back, then upserts the
    /// cache so the UI sees the change before the next watcher event lands.
    pub async fn set_journal_verified(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        verified: bool,
    ) -> Result<(), OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let abs = resolve_entry_path(&journal_root, &relative_path)?;
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, body) = parse_frontmatter_and_body(&text);
        let Some(mut fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot verify entry with broken frontmatter".to_string(),
            ));
        };
        fm.verified_by_user = verified;
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        // Re-project through the redacting cache (same path the watcher uses):
        // disk keeps the agent's original body (SSOT), the cache row is masked
        // on projection. This re-reads the just-written file, so the frontmatter
        // edit and the body masking are both reflected. R1 — closes the cache
        // re-pollution bypass where a frontmatter-only edit re-inserted an
        // agent body's plaintext secret into the cache (→ AI context).
        let redact = self.redact_patterns(project_id).await;
        JournalCache::with_redaction(db, redact)
            .with_tz(self.tz_for(project_id).await)
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
            )
            .await?;
        Ok(())
    }

    /// Update one or both of `difficulty` / `status` on an existing entry.
    /// Mirrors [`set_journal_verified`] — read → parse → mutate frontmatter →
    /// atomic-write → cache upsert — but operates on the W3 inline-edit
    /// fields. `None` for a field means "leave unchanged", so callers can
    /// edit either independently or both in one round-trip.
    ///
    /// Returns the freshly-upserted `JournalEntry` so the frontend can render
    /// the updated detail pane without a second `get_journal_entry` call.
    pub async fn update_journal_entry_meta(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        difficulty: Option<Option<crate::oculpm::spec::Difficulty>>,
        status: Option<crate::oculpm::spec::EntryStatus>,
    ) -> Result<JournalEntry, OculpmError> {
        if difficulty.is_none() && status.is_none() {
            return Err(OculpmError::InvalidConfig(
                "update_journal_entry_meta called with no fields to change".to_string(),
            ));
        }
        let journal_root = self.journal_root(project_id).await?;
        let abs = resolve_entry_path(&journal_root, &relative_path)?;
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, body) = parse_frontmatter_and_body(&text);
        let Some(mut fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot edit entry with broken frontmatter".to_string(),
            ));
        };
        if let Some(new_diff) = difficulty {
            fm.difficulty = new_diff;
        }
        if let Some(new_status) = status {
            fm.status = new_status;
        }
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        // Re-project through the redacting cache (disk keeps the agent's body;
        // the cache row is masked on projection — R1, mirrors set_journal_verified).
        let redact = self.redact_patterns(project_id).await;
        let cache = JournalCache::with_redaction(db, redact).with_tz(self.tz_for(project_id).await);
        cache
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
            )
            .await?;
        // Return the hydrated entry so the UI can update without a second
        // fetch — keeps optimistic UI in sync with cache truth.
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(format!("entry vanished after upsert: {relative_path}"))
            })
    }

    /// F7a-B Unit B — write the tz-offset backfill into the on-disk frontmatter
    /// once, on explicit user request. This is the **only** path that
    /// intentionally modifies the agent's source file (every other coercion is
    /// cache/display-only). Scope is timestamps (`created_at`/`updated_at`)
    /// only: the slug is deliberately left alone because it's coupled to the
    /// filename, and rewriting one without the other would desync them. Errors
    /// when there's nothing to coerce. Returns the re-projected entry.
    pub async fn coerce_journal_entry_timestamps_on_disk(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
    ) -> Result<JournalEntry, OculpmError> {
        let tz = self.tz_for(project_id).await;
        let journal_root = self.journal_root(project_id).await?;
        let abs = resolve_entry_path(&journal_root, &relative_path)?;
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, body) = parse_frontmatter_and_body(&text);
        let Some(mut fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot edit entry with broken frontmatter".to_string(),
            ));
        };
        let mut changed = false;
        if let Some(fixed) = backfill_tz_offset(&fm.created_at, tz) {
            fm.created_at = fixed;
            changed = true;
        }
        if let Some(u) = fm.updated_at.clone() {
            if let Some(fixed) = backfill_tz_offset(&u, tz) {
                fm.updated_at = Some(fixed);
                changed = true;
            }
        }
        if !changed {
            return Err(OculpmError::InvalidConfig(
                "Nothing to fix (it already has an offset, or it is not a time value).".to_string(),
            ));
        }
        let new_text = write_frontmatter_and_body(&fm, &body);
        write_atomic(&abs, new_text.as_bytes())?;

        // Re-project (masked + tz) so the cache reflects the now-offset source.
        let redact = self.redact_patterns(project_id).await;
        let cache = JournalCache::with_redaction(db, redact).with_tz(tz);
        cache
            .apply_path_change(
                project_id,
                &journal_root,
                &relative_path,
                PathChangeKind::Modified,
            )
            .await?;
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(format!("entry vanished after coerce: {relative_path}"))
            })
    }

    /// Replace the body markdown of an existing entry, keeping the YAML
    /// frontmatter intact. Same atomic-write + cache-upsert pattern as
    /// `update_journal_entry_meta`.
    pub async fn update_journal_entry_body(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: String,
        new_body: String,
    ) -> Result<JournalEntry, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        let abs = resolve_entry_path(&journal_root, &relative_path)?;
        let text = std::fs::read_to_string(&abs).map_err(|source| OculpmError::Io {
            path: abs.clone(),
            source,
        })?;
        let (mut parsed, _body) = parse_frontmatter_and_body(&text);
        let Some(fm) = parsed.parsed.take() else {
            return Err(OculpmError::InvalidConfig(
                "cannot edit body of entry with broken frontmatter".to_string(),
            ));
        };
        // R1 — mask secrets in the edited body before writing. We author this
        // write, so at-write masking keeps both the disk file and the cache
        // (upserted from `new_text` below) free of plaintext keys.
        let redact = self.redact_patterns(project_id).await;
        let (new_body, _hits) = redact_text(&new_body, &redact);
        let new_text = write_frontmatter_and_body(&fm, &new_body);
        write_atomic(&abs, new_text.as_bytes())?;

        let (parsed2, body2) = parse_frontmatter_and_body(&new_text);
        let body_parsed = parse_body(&body2);
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        // .with_tz mirrors update_journal_entry_meta — keep the cache row's
        // backfilled created_at offset consistent on a body edit (F7a-B). The
        // body is already masked at-write above, so no redaction needed here.
        let cache = JournalCache::new(db).with_tz(self.tz_for(project_id).await);
        cache
            .upsert_entry(
                project_id,
                &relative_path,
                &parsed2,
                &body_parsed,
                mtime,
                &new_text,
            )
            .await?;
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(format!("entry vanished after upsert: {relative_path}"))
            })
    }

    /// Resolve a journal-relative path to its absolute on-disk location so
    /// the commands layer can open it natively (sidestepping the opener
    /// plugin's scope check that has bitten dogfooding twice).
    pub async fn resolve_journal_absolute(
        &self,
        project_id: u32,
        relative_path: &str,
    ) -> Result<PathBuf, OculpmError> {
        let journal_root = self.journal_root(project_id).await?;
        resolve_entry_path(&journal_root, relative_path)
    }

    /// Write a manual journal entry the user authored via the modal. Resolves
    /// session_id (existing active session → draft override → sentinel),
    /// constructs frontmatter, writes the file atomically with the spec's
    /// `<HHMM>_<type>_<slug>.md` naming, and upserts the cache.
    pub async fn create_manual_journal_entry(
        &self,
        db: &Db,
        project_id: u32,
        draft: ManualEntryDraft,
    ) -> Result<JournalEntry, OculpmError> {
        validate_slug(&draft.slug)?;

        // Snapshot the per-project state we need without holding the lock
        // across disk IO.
        let (root, resolver, language, forbid_patterns, redact_strings) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.root.clone(),
                entry.resolver.clone(),
                "ko".to_string(), // No top-level language field yet; default per spec.
                entry.config.git.forbid_journal_for_paths.clone(),
                entry.config.git.auto_redact_patterns.clone(),
            )
        };

        // W4-PR3 — reject the whole entry if any declared file_touched path is
        // in `git.forbid_journal_for_paths`. We check before any disk write so
        // a forbidden draft never produces a partial entry on disk; the
        // command layer is expected to translate this into an
        // `OculpmIntegrityWarning` toast for the user.
        if !forbid_patterns.is_empty() && !draft.files_touched.is_empty() {
            let matcher = build_forbidden_matcher(&root, &forbid_patterns);
            let hits: Vec<String> = draft
                .files_touched
                .iter()
                .filter(|ft| is_forbidden_path(&matcher, &ft.path))
                .map(|ft| ft.path.clone())
                .collect();
            if !hits.is_empty() {
                return Err(OculpmError::ForbiddenJournalPath { paths: hits });
            }
        }
        // 시각. `draft.created_at` 이 있으면 **그때 일어난 일**로 적는다
        // (Phase 7 임포트가 원본 대화 날짜를 보존하는 자리). 파싱 못 하면
        // 지금으로 떨어진다 — 날짜 하나 때문에 임포트 전체를 죽이지 않는다.
        let now_utc = draft
            .created_at
            .as_deref()
            .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(chrono::Utc::now);
        let workday = resolver.workday_of(now_utc);
        let local_now = now_utc.with_timezone(&chrono_tz_from(&resolver));
        let hhmm = format!("{:02}{:02}", local_now.hour(), local_now.minute());

        // Resolve session_id: explicit → active → sentinel.
        let session_id = if let Some(sid) = draft.session_id.clone() {
            sid
        } else if let Ok(Some(sess)) = self.get_current_session(project_id).await {
            sess.id
        } else {
            // 시(時)까지 두 자리로 — 예전 포맷은 10시 전에 한 글자 짧았다.
            crate::oculpm::session_id::SessionId::manual(&workday, local_now).into_string()
        };

        // Build the frontmatter.
        let fm = JournalFrontmatter {
            schema_version: 1,
            entry_type: draft.entry_type,
            slug: draft.slug.clone(),
            status: draft.status.unwrap_or(EntryStatus::Planned),
            difficulty: draft.difficulty,
            created_at: local_now.to_rfc3339(),
            updated_at: None,
            session_id,
            // PR-CI1 — 자동 초안(journal_draft)이 실측 에이전트를 넘긴다;
            // None(수동 모달)이면 기존 의미("manual", 사용자 검증 완료) 유지.
            agent: draft.agent.clone().unwrap_or(AgentRef {
                id: "manual".to_string(),
                version: None,
                session: None,
            }),
            language,
            verified_by_user: draft.verified_by_user.unwrap_or(true),
            files_touched: draft.files_touched.clone(),
            related: Vec::new(),
            tags: draft.tags.clone(),
        };

        // Compose body: first-line title with [ ] / [x] marker derived from
        // status (done → [x], else [ ]).
        let marker = if matches!(fm.status, EntryStatus::Done) {
            "[x]"
        } else {
            "[ ]"
        };
        let body = if draft.body_markdown.is_empty() {
            format!("{marker} {}\n", draft.title)
        } else {
            format!("{marker} {}\n\n{}", draft.title, draft.body_markdown)
        };
        // R1 — mask any secret the user pasted into the modal *before* it touches
        // disk, so a manual entry never persists a plaintext key (committing
        // `.oculpm/` to git would otherwise leak it). We author this file, so
        // at-write masking is correct here — unlike agent-authored entries, which
        // we mask only on cache projection to preserve their on-disk SSOT. The
        // returned entry carries the masked body, surfacing the redaction in the
        // modal without a separate toast. Frontmatter is left untouched (paths /
        // session_id never match a secret pattern; masking only the body avoids
        // any risk of corrupting the YAML).
        let redact = compile_redact_patterns(&redact_strings);
        let (body, _hits) = redact_text(&body, &redact);
        let text = write_frontmatter_and_body(&fm, &body);

        // Resolve target path + write atomically. On filename collision we
        // suffix `__2`, `__3`, … per spec §2.1.
        let category_dir = resolver.journal_dir(&root, &workday, draft.entry_type);
        std::fs::create_dir_all(&category_dir).map_err(|source| OculpmError::Io {
            path: category_dir.clone(),
            source,
        })?;
        let type_str = entry_type_filename_token(draft.entry_type);
        let base_name = format!("{hhmm}_{type_str}_{}", draft.slug);
        let (abs, file_name) = pick_nonconflicting_path(&category_dir, &base_name);
        write_atomic(&abs, text.as_bytes())?;

        // Upsert into the cache so the caller can re-read immediately.
        let relative_path = format!(
            "{workday}/{}/{file_name}",
            category_subdir(draft.entry_type)
        );
        let mtime = std::fs::metadata(&abs)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|| now_utc.timestamp());
        let (parsed, body_text) = parse_frontmatter_and_body(&text);
        let body_parsed = parse_body(&body_text);
        let cache = JournalCache::new(db);
        cache
            .upsert_entry(
                project_id,
                &relative_path,
                &parsed,
                &body_parsed,
                mtime,
                &text,
            )
            .await?;
        cache
            .get_entry(project_id, &relative_path)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(
                    "manual entry was written but cache hydration failed".to_string(),
                )
            })
    }
}
