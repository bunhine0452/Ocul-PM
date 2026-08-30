//! AGENTS.md 동기 — 템플릿 동기/업그레이드·드리프트·레이어 비교·에이전트 탐지.
//!
//! `manager/mod.rs` 의 단일 `impl OculpmManager` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;
use crate::oculpm::spec::{SessionUnrecorded, WorkdayComparison};

impl OculpmManager {
    // ─── W4-PR2: agent adapter sync + detect ────────────────────────────────

    /// Sync every known adapter to disk based on the current
    /// `config.agents.active`. Idempotent; safe to call from init, Settings
    /// save, and watcher-driven master-template change notifications.
    ///
    /// W4-PR4: after each adapter write the per-adapter blake3 hash is
    /// upserted into `oculpm_agent_state` so the watcher's drift detector
    /// can tell "we just wrote this" (no drift) from "user/tool wrote this"
    /// (emit). Hashes are best-effort: a None `last_hash` (removed / error
    /// / unhashable) leaves the previous row in place — the watcher will
    /// either find no row (no drift comparison possible) or the stale row,
    /// which the next successful sync overwrites.
    pub async fn sync_agents(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<AgentSyncReport, OculpmError> {
        let (root, config) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (entry.root.clone(), entry.config.clone())
        };
        let report = agents::sync_active(&root, &config).await?;
        for r in &report.results {
            if let Some(hash) = r.last_hash.clone() {
                if let Err(e) = db
                    .oculpm_agent_state_upsert(project_id, r.id.clone(), hash)
                    .await
                {
                    tracing::warn!(
                        target: "oculpm::manager",
                        project_id,
                        agent_id = %r.id,
                        error = %e,
                        "oculpm_agent_state upsert failed (drift detection may emit a false positive)"
                    );
                }
            }
        }
        Ok(report)
    }

    /// Is a newer master template available than the one on disk? (Surfaced as
    /// an "update agent rules" prompt for projects initialized before a
    /// template bump.)
    pub async fn check_master_upgrade(
        &self,
        project_id: u32,
    ) -> Result<Option<agents::MasterUpgrade>, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?
                .root
                .clone()
        };
        Ok(agents::master_upgrade_available(&root))
    }

    /// Upgrade the on-disk master to the embedded one (backing up the old) and
    /// re-sync all active adapters so AGENTS.md etc. pick up the new rules.
    pub async fn apply_master_upgrade(
        &self,
        db: &Db,
        project_id: u32,
    ) -> Result<AgentSyncReport, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?
                .root
                .clone()
        };
        agents::upgrade_master(&root)?;
        self.sync_agents(db, project_id).await
    }

    /// Compare the on-disk adapter file at `relative_path` against the last
    /// hash we recorded for the matching agent. Returns
    /// `Some((agent_id, expected, actual))` when they differ — the watcher
    /// then emits `OculpmAgentDrift`. Returns `None` when the path isn't an
    /// adapter we know about, when there's no prior hash to compare, or
    /// when current and stored hashes match. See `W4-PR4` docs.
    pub async fn check_agent_drift(
        &self,
        db: &Db,
        project_id: u32,
        relative_path: &str,
    ) -> Result<Option<(String, String, String)>, OculpmError> {
        let Some(adapter) = agents::lookup_adapter_by_path(relative_path) else {
            return Ok(None);
        };
        let root = {
            let projects = self.projects.read().await;
            let Some(entry) = projects.get(&project_id) else {
                return Ok(None);
            };
            entry.root.clone()
        };
        let abs = root.join(adapter.adapter_path);
        let Some(actual) = agents::current_disk_hash(adapter, &abs) else {
            return Ok(None);
        };
        let Some((expected, _ts)) = db
            .oculpm_agent_state_get(project_id, adapter.id.to_string())
            .await
            .map_err(|e| OculpmError::Sqlite(e.to_string()))?
        else {
            return Ok(None);
        };
        if actual == expected {
            Ok(None)
        } else {
            Ok(Some((adapter.id.to_string(), expected, actual)))
        }
    }

    // ─── W4-PR5: compare_layers ─────────────────────────────────────────────

    /// Diff a session's `file_changes.ndjson` (ground truth) against the
    /// union of `files_touched[].path` from every journal entry stamped with
    /// that `session_id`. (Lite-W6 PR3 retired the DiffVsNarrative UI; the
    /// data is still produced for backend introspection.)
    ///
    /// Forbidden + already-redacted paths are stripped from BOTH sides before
    /// the comparison so they never count as mismatches (a `.env` change is
    /// excluded from the index per W4-PR3 and can't appear in a journal
    /// either; symmetry keeps jaccard from artificially tanking).
    ///
    /// Two sets come out, and they answer different questions:
    /// - `only_in_index` / `jaccard_index` — session-exact. Precise, but only
    ///   when the agent speaks the watcher's `session_id` dialect.
    /// - `unrecorded` / `unrecorded_severity` — workday-scoped coverage. This
    ///   is the honest "no journal mentions this file" set and what 정직성
    ///   감사 renders (dogfooding 2026-08-20).
    pub async fn compare_layers(
        &self,
        db: &Db,
        project_id: u32,
        session_id: &str,
    ) -> Result<LayerComparison, OculpmError> {
        // workday = session_id 의 첫 8자 ("20260524-001" → "20260524").
        // 끝의 - 가 없거나 형식이 다를 경우 session_id 전체를 workday 로 사용
        // → cache 쿼리가 빈 결과 반환하면 호출자에게 자연스러운 신호.
        let workday = session_id
            .split_once('-')
            .map(|(w, _)| w.to_string())
            .unwrap_or_else(|| session_id.to_string());

        let (writer, forbid_patterns, root) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.index_writer.clone(),
                entry.config.git.forbid_journal_for_paths.clone(),
                entry.root.clone(),
            )
        };

        let forbidden = build_forbidden_matcher(&root, &forbid_patterns);
        let is_excluded = |p: &str| -> bool {
            p.starts_with("**redacted/sensitive**:")
                || is_forbidden_path(&forbidden, p)
                // W4 dogfooding (2026-05-27) — the watcher now drops these at
                // capture time, but historical ndjson written before the
                // suppression fix still contains them. Filtering here keeps
                // `LayerComparison` honest across the upgrade boundary.
                || is_noise_path(p)
        };

        let file_changes = writer.read_file_changes(&workday, None).await?;
        let index_set: std::collections::BTreeSet<String> = file_changes
            .into_iter()
            .filter(|ev| ev.session_id == session_id)
            .map(|ev| ev.path)
            .filter(|p| !is_excluded(p))
            .collect();

        let cache = JournalCache::new(db);
        // Session attribution, in two additive arms:
        //
        // 1. Exact `session_id` match — deliberately workday-free (a watcher id
        //    is globally unique, and requiring the caller to know the *cache
        //    row's* workday would drift whenever frontmatter workday and the
        //    id prefix disagree). Unchanged from W4-PR5.
        // 2. Synthetic ids (`manual-…` / `mcp-…`) resolved by `created_at`.
        //    Agents that write the file directly can't know the watcher's
        //    session number, so before this arm `matched` / `only_in_journal` /
        //    `jaccard_index` were dead numbers — every entry on 2026-08-20
        //    carried a `manual-…` id and the join matched nothing.
        let mut journal_paths = cache.files_for_session(project_id, session_id).await?;
        let sessions = writer.list_sessions(&workday).await?;
        let resolved_entries: Vec<String> = cache
            .entries_for_workday_attribution(project_id, &workday)
            .await?
            .into_iter()
            .filter(|(_, sid, created_at)| {
                // Arm 1 already covered real ids; only synthetic ones need
                // resolving, and a synthetic id must never steal an entry that
                // truthfully names a different session.
                !session::is_watcher_session_id(sid)
                    && session::resolve_session_for_timestamp(&sessions, created_at).as_deref()
                        == Some(session_id)
            })
            .map(|(rel, _, _)| rel)
            .collect();
        journal_paths.extend(
            cache
                .files_for_entry_paths(project_id, &resolved_entries)
                .await?,
        );
        let journal_set: std::collections::BTreeSet<String> = journal_paths
            .into_iter()
            .filter(|p| !is_excluded(p))
            .collect();

        let matched: Vec<String> = index_set.intersection(&journal_set).cloned().collect();
        let only_in_index: Vec<String> = index_set.difference(&journal_set).cloned().collect();
        let only_in_journal: Vec<String> = journal_set.difference(&index_set).cloned().collect();

        let union_count = index_set.union(&journal_set).count();
        let jaccard = if union_count == 0 {
            1.0
        } else {
            matched.len() as f32 / union_count as f32
        };
        let severity = severity_from_jaccard(jaccard, union_count);

        // Dogfooding (2026-08-20) — the honesty question is "did *any* entry
        // today write this file down?", so it is judged against the whole
        // workday. Joining on session_id alone made the audit unusable: agents
        // stamp their own ids (`manual-20260820-205400`) that never equal the
        // watcher's (`20260820-002`), so `journal_set` was empty and all 65
        // changed files were reported as 미기록 when only 3 actually were.
        let workday_paths = cache.files_for_workday(project_id, &workday).await?;
        let workday_journal_set: std::collections::BTreeSet<String> = workday_paths
            .into_iter()
            .filter(|p| !is_excluded(p))
            .collect();
        let unrecorded: Vec<String> = index_set
            .difference(&workday_journal_set)
            .cloned()
            .collect();
        // Coverage, not jaccard: entries legitimately mention files this
        // session never touched, so the journal side must not count against us.
        let covered = index_set.len().saturating_sub(unrecorded.len());
        let coverage = if index_set.is_empty() {
            1.0
        } else {
            covered as f32 / index_set.len() as f32
        };
        let unrecorded_severity = severity_from_jaccard(coverage, index_set.len());

        Ok(LayerComparison {
            session_id: session_id.to_string(),
            workday,
            index_files: index_set.into_iter().collect(),
            journal_files: journal_set.into_iter().collect(),
            matched,
            only_in_index,
            only_in_journal,
            mismatch_severity: severity,
            jaccard_index: jaccard,
            unrecorded,
            unrecorded_severity,
        })
    }

    /// 워크데이 하나의 정직성 감사 — `compare_layers` 의 `unrecorded` 절반을
    /// 세션 전부에 대해 **한 번에** (완성도 라운드 Phase 3).
    ///
    /// ndjson 을 한 번 읽고 세션별로 가르며, 그날 일지가 적은 파일 집합도 한 번만
    /// 뽑는다. 세션 정확도가 필요한 `matched`/`jaccard` 는 여기 없다 — Today
    /// 정직성 감사는 그것을 읽지 않는다 (2026-08-20 도그푸딩).
    pub async fn compare_workday(
        &self,
        db: &Db,
        project_id: u32,
        workday: &str,
    ) -> Result<WorkdayComparison, OculpmError> {
        let (writer, forbid_patterns, root) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            (
                entry.index_writer.clone(),
                entry.config.git.forbid_journal_for_paths.clone(),
                entry.root.clone(),
            )
        };
        let forbidden = build_forbidden_matcher(&root, &forbid_patterns);
        let is_excluded = |p: &str| -> bool {
            p.starts_with("**redacted/sensitive**:")
                || is_forbidden_path(&forbidden, p)
                || is_noise_path(p)
        };

        // 세션 → 그 세션이 바꾼 경로. BTreeMap 이라 출력 순서가 결정적이다.
        let mut by_session: std::collections::BTreeMap<String, std::collections::BTreeSet<String>> =
            std::collections::BTreeMap::new();
        for ev in writer.read_file_changes(workday, None).await? {
            if is_excluded(&ev.path) {
                continue;
            }
            by_session.entry(ev.session_id).or_default().insert(ev.path);
        }

        let cache = JournalCache::new(db);
        let workday_journal_set: std::collections::BTreeSet<String> = cache
            .files_for_workday(project_id, workday)
            .await?
            .into_iter()
            .filter(|p| !is_excluded(p))
            .collect();

        let mut unrecorded_total = 0u32;
        let sessions: Vec<SessionUnrecorded> = by_session
            .into_iter()
            .map(|(session_id, index_set)| {
                let unrecorded: Vec<String> = index_set
                    .difference(&workday_journal_set)
                    .cloned()
                    .collect();
                let covered = index_set.len().saturating_sub(unrecorded.len());
                let coverage = if index_set.is_empty() {
                    1.0
                } else {
                    covered as f32 / index_set.len() as f32
                };
                unrecorded_total += unrecorded.len() as u32;
                SessionUnrecorded {
                    session_id,
                    unrecorded_severity: severity_from_jaccard(coverage, index_set.len()),
                    unrecorded,
                }
            })
            .collect();

        Ok(WorkdayComparison {
            workday: workday.to_string(),
            sessions,
            unrecorded_total,
        })
    }

    /// Read-only adapter heuristic — backs the Settings "감지" button + the
    /// Greenfield wizard's default active set.
    pub async fn detect_agents(&self, project_id: u32) -> Result<Vec<AgentDetection>, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            entry.root.clone()
        };
        Ok(agents::detect(&root))
    }

    /// Return the on-disk master template (`.oculpm/agents/_template.md`).
    /// Falls back to the embedded `MASTER_KO` if the file is missing — this
    /// lets the UI's "프롬프트 복사" action work even before the first sync
    /// has written the template to disk.
    pub async fn read_master_template(&self, project_id: u32) -> Result<String, OculpmError> {
        let root = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            entry.root.clone()
        };
        let path = root.join(".oculpm").join("agents").join("_template.md");
        match tokio::fs::read_to_string(&path).await {
            Ok(text) => Ok(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(agents::MASTER_KO.to_string()),
            Err(source) => Err(OculpmError::Io { path, source }),
        }
    }
}
