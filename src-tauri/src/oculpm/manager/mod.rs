//! `OculpmManager` — orchestrator for per-project `.oculpm/` lifecycle.
//!
//! W1-PR6 scope: project init (mkdir + .schema-version + config.toml + lock
//! acquire), per-project status, and config get/set. The watcher, session
//! actor, and `on_project_opened` / `on_project_closed` hooks land in W2 and
//! W1-PR7 respectively.
//!
//! W2-PR4 added `recover_zombie_sessions` — runs after lock acquisition but
//! before the watcher boots, finalising any `ended_at == null` sessions from
//! the most recent workdays as `crash_recovered`.
//!
//! AppHandle is intentionally *not* stored here yet. We'll thread it in once
//! W2 needs to emit Tauri events — keeping it out for now means tests can
//! construct a real `OculpmManager` without a Wry runtime.

#![allow(dead_code)] // Most surface is consumed by W1-PR7 + W2 + W4 commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use regex::Regex;
use tokio::sync::RwLock;

use crate::db::Db;
use crate::oculpm::agents::{self, AgentDetection};
use crate::oculpm::atomic_io::{
    read_managed_block, write_atomic, write_managed_block, ManagedBlockResult,
};
use crate::oculpm::cache::{CacheReindexReport, EntryFilters, JournalCache, PathChangeKind};
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::{
    backfill_tz_offset, parse_frontmatter_and_body, write_frontmatter_and_body,
};
use crate::oculpm::index::IndexWriter;
use crate::oculpm::lock::{AcquirePolicy, LockAcquisition, LockGuard};
use crate::oculpm::markdown::parse_body;
use crate::oculpm::paths::{self, WorkdayResolver};
use crate::oculpm::redact::{
    build_forbidden_matcher, compile_redact_patterns, is_forbidden_path, redact_text,
};
use crate::oculpm::session::{self, SessionActor};
use crate::oculpm::spec::{
    AgentRef, AgentSyncReport, BackfillReport, CommentStyle, EndedReason, EntryStatus, EntryType,
    FileChangeEvent, FileOp, FileTouched, JournalEntry, JournalEntrySummary, JournalFrontmatter,
    LayerComparison, LockStateView, ManualEntryDraft, OculpmConfig, OculpmInitReport,
    OculpmOverviewStats, OculpmStatus, ReindexReport, Session, SessionEnd, Severity, Snapshot,
    SnapshotKind, WatcherStateView, WatcherStatus,
};
use crate::oculpm::watcher::ProjectWatcher;

/// `.gitignore` managed-block body. Matches `00-spec.md` §1.2.
/// `.oculpm/hooks/` — PR-CI0: Claude Code 훅 인박스. 이벤트 payload 에 대화
/// 내용(prompt / last_assistant_message)이 포함되므로 머신 로컬로만 남긴다.
const GITIGNORE_BLOCK_BODY: &str = "\
.oculpm/index/
.oculpm/hooks/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
";

/// A0a (#managed-block-versioning) — union of the canonical block body and the
/// lines already inside the on-disk block. An entry a newer app version added
/// (e.g. a future sensitive path) must survive this — possibly older — build
/// rewriting the block. Trade-offs, both locked by tests below: entries removed
/// from the canonical body linger for existing installs (harmless for ignore
/// paths), and unknown lines are appended AFTER the canonical set — so the
/// canonical body must stay order-independent (no `!` negation patterns).
/// Lines are kept verbatim: gitignore treats a backslash-quoted trailing space
/// as significant, so no trimming beyond the pure-whitespace emptiness check.
pub(crate) fn merged_gitignore_body(existing: Option<&str>) -> String {
    let mut lines: Vec<&str> = GITIGNORE_BLOCK_BODY.lines().collect();
    for line in existing.into_iter().flat_map(str::lines) {
        if !line.trim().is_empty() && !lines.contains(&line) {
            lines.push(line);
        }
    }
    let mut body = lines.join("\n");
    body.push('\n');
    body
}

/// Number of most-recent workdays to scan for zombie sessions on startup.
/// Kept as a named constant so W4's "full check" command can reference the
/// same default. See `docs/major_update/oculpm/W2/PR4-crash-recovery.md` §2.
pub const RECOVERY_WORKDAYS: usize = 3;

/// Process-wide orchestrator: holds one `ProjectEntry` per open project,
/// owns the lock guards + future watcher/session actors. Tauri `State`-managed.
#[derive(Default)]
pub struct OculpmManager {
    projects: RwLock<HashMap<u32, ProjectEntry>>,
    /// N4 — per-project serializer for plan-file writes. Every writer (in-app
    /// edits `plan_apply_edit`/`plan_set_status`/…, in-app `plan_ai_refresh`,
    /// and the background `reconcile`) holds this around its read-modify-write
    /// so concurrent writers can't clobber each other (last-writer-wins lost
    /// updates). Lazily created per project.
    plan_write_locks: RwLock<HashMap<u32, Arc<tokio::sync::Mutex<()>>>>,
    /// 이 프로세스가 쥔 락 하나가 **다른 인스턴스에게 인계당한** 순간 깨어난다.
    /// 감독관이 여기서 깨어나 그 프로젝트의 감시를 즉시 접는다 — 다음 정기
    /// 틱까지 기다리면 두 인스턴스가 같은 프로젝트를 함께 감시한다.
    lock_evicted: Arc<tokio::sync::Notify>,
}

/// Cloned view of a project's lazy-loaded state. Used by `overview_stats`
/// (and other callers) that need to do IO outside the manager's RwLock guard.
struct ProjectSnapshot {
    root: PathBuf,
    resolver: WorkdayResolver,
    config: OculpmConfig,
}

/// Per-project in-memory state. The `LockGuard` is the live ownership token —
/// `None` means another instance holds the on-disk lock, so we operate in
/// read-only mode (no journal writes from this process).
struct ProjectEntry {
    root: PathBuf,
    config: OculpmConfig,
    resolver: WorkdayResolver,
    lock: Option<LockGuard>,
    // W2-PR6: watcher/session lifecycle
    index_writer: Arc<IndexWriter>,
    session: Option<SessionActor>,
    watcher: Option<ProjectWatcher>,
}

mod agents_sync;
mod indexing;
mod journal;
mod lifecycle;
mod session_ops;

impl OculpmManager {
    /// Empty manager. Project entries are added by `init_project` on first open.
    pub fn new() -> Self {
        Self::default()
    }

    /// N4 — the per-project plan-write serializer (lazily created). Hold the
    /// returned mutex's guard around any read-modify-write of a
    /// `.oculpm/planner/*.md` so the in-app writers and the background
    /// `reconcile` never clobber each other.
    pub async fn plan_write_lock(&self, project_id: u32) -> Arc<tokio::sync::Mutex<()>> {
        {
            let map = self.plan_write_locks.read().await;
            if let Some(l) = map.get(&project_id) {
                return l.clone();
            }
        }
        let mut map = self.plan_write_locks.write().await;
        map.entry(project_id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// 이 프로세스의 락 하나가 인계당하면 깨어나는 채널 (감독관이 기다린다).
    pub fn lock_evicted_signal(&self) -> Arc<tokio::sync::Notify> {
        self.lock_evicted.clone()
    }

    /// Compile this project's `auto_redact_patterns` from its in-memory config
    /// for the cache-projection paths (reindex / cache-miss disk read). Empty
    /// when the project isn't registered (no config in memory) — callers then
    /// project without masking; the disk-rooted paths use
    /// [`redact::patterns_for_project`][crate::oculpm::redact::patterns_for_project]
    /// instead so they still mask for unregistered projects.
    async fn redact_patterns(&self, project_id: u32) -> Vec<Regex> {
        match self.get_config(project_id).await {
            Ok(cfg) => compile_redact_patterns(&cfg.git.auto_redact_patterns),
            Err(_) => Vec::new(),
        }
    }

    /// Resolve a project's timezone for read-time `created_at`/`updated_at`
    /// offset backfill (F7a-B). Falls back to UTC for an unregistered project
    /// or an unparseable tz, so projection never fails on the tz lookup.
    async fn tz_for(&self, project_id: u32) -> chrono_tz::Tz {
        match self.get_config(project_id).await {
            Ok(cfg) => cfg.workday.timezone.parse().unwrap_or(chrono_tz::UTC),
            Err(_) => chrono_tz::UTC,
        }
    }

    /// Snapshot of a project's lazy-loaded state (root + resolver + config).
    /// Cloned so the caller can drop the read lock before doing IO.
    async fn project_snapshot(&self, project_id: u32) -> Result<ProjectSnapshot, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(ProjectSnapshot {
            root: entry.root.clone(),
            resolver: entry.resolver.clone(),
            config: entry.config.clone(),
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// W3-PR3 helpers (file-private)
// ─────────────────────────────────────────────────────────────────────────────

use chrono::Timelike;

/// W4 dogfooding (2026-05-27) — mirror of `watcher::is_self_suppressed` +
/// `watcher::is_agent_state_path`, applied retroactively in `compare_layers`
/// so ndjson entries captured before the watcher fix don't keep showing up
/// as `journal 누락`. Keep this list in sync with the watcher's two helpers.
fn is_noise_path(p: &str) -> bool {
    if p.ends_with(".tmp") || p.contains(".tmp.") {
        return true;
    }
    if p.ends_with(".swp") || p.ends_with(".swo") || p.ends_with('~') {
        return true;
    }
    // macOS sandbox atomic writes — `<name>.sb-<hex>-<rand>`.
    if paths::is_macos_sandbox_temp(p) {
        return true;
    }
    let basename = p.rsplit('/').next().unwrap_or(p);
    if basename == ".DS_Store" || basename == "Thumbs.db" || basename.starts_with("._") {
        return true;
    }
    // A nested `.oculpm/` is another project's bookkeeping (see
    // `paths::is_nested_oculpm_path`). The root `.oculpm/` never reaches the
    // ndjson at all — the watcher routes it at steps 1-4.
    if paths::is_nested_oculpm_path(p) {
        return true;
    }
    // An adapter file itself (e.g., `.claude/CLAUDE.md`) lives in one of these
    // dirs — but adapters never enter the ndjson pipeline (watcher returns at
    // step 4.5), so any path that DID reach the index from inside `.claude/`
    // is by definition not the adapter file. Filtering the whole prefix is
    // safe and intentionally symmetric with the watcher.
    paths::AGENT_STATE_DIRS.iter().any(|d| p.starts_with(d)) || paths::is_nested_agent_state_path(p)
}

/// Fill each session's `linked_journal_entries` from the cache, using the same
/// attribution `compare_layers` uses (explicit id wins; synthetic ids resolve
/// by `created_at`).
///
/// **Derived on read, never persisted.** `sessions.json` is read-modify-written
/// by the SessionActor (`upsert_session` / `finalize_session` /
/// `unfinalize_session`), all from that project's single actor task. A second
/// writer on the watcher's journal path would race it and silently drop session
/// state on a lost update. Computing here is race-free, always fresh, and can
/// never drift from the audit — do not "optimize" this into a disk write.
///
/// Best-effort: a cache error leaves the lists empty rather than failing the
/// whole session listing, which several screens depend on.
async fn attach_journal_links(db: &Db, project_id: u32, workday: &str, sessions: &mut [Session]) {
    if sessions.is_empty() {
        return;
    }
    let cache = JournalCache::new(db);
    let Ok(rows) = cache
        .entries_for_workday_attribution(project_id, workday)
        .await
    else {
        return;
    };
    // Snapshot before mutating — resolution must see every session's
    // `started_at`, not a half-updated slice.
    let snapshot: Vec<Session> = sessions.to_vec();
    for session in sessions.iter_mut() {
        session.linked_journal_entries = rows
            .iter()
            .filter(|(_, sid, created_at)| {
                if session::is_watcher_session_id(sid) {
                    sid == &session.id
                } else {
                    session::resolve_session_for_timestamp(&snapshot, created_at).as_deref()
                        == Some(session.id.as_str())
                }
            })
            .map(|(rel, _, _)| rel.clone())
            .collect();
    }
}

/// W4-PR5 — bucket jaccard into the three-level severity. `union_count == 0`
/// (no activity at all on either side) collapses to `Ok` regardless of the
/// `1.0` jaccard we synthesised, so the UI doesn't trumpet a useless "in
/// sync" alert for sessions where nothing happened.
fn severity_from_jaccard(jaccard: f32, union_count: usize) -> Severity {
    if union_count == 0 {
        return Severity::Ok;
    }
    if jaccard >= 0.8 {
        Severity::Ok
    } else if jaccard >= 0.5 {
        Severity::Warning
    } else {
        Severity::Critical
    }
}

/// Spec §2.1 — kebab-case ASCII, 1..=60 chars.
fn validate_slug(slug: &str) -> Result<(), OculpmError> {
    if slug.is_empty() || slug.len() > 60 {
        return Err(OculpmError::InvalidConfig(format!(
            "slug must be 1..=60 characters (got {})",
            slug.len()
        )));
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(OculpmError::InvalidConfig(
            "slug must match [a-z0-9-] (kebab-case, ASCII)".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn entry_type_filename_token(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "bug",
        EntryType::Feature => "feature",
        EntryType::Error => "error",
        EntryType::Refactor => "refactor",
        EntryType::Chore => "chore",
    }
}

pub(crate) fn category_subdir(t: EntryType) -> &'static str {
    match t {
        EntryType::Bug => "Bugs",
        EntryType::Feature => "Features_to_add",
        EntryType::Error => "Errors",
        EntryType::Refactor => "Refactors",
        EntryType::Chore => "Chores",
    }
}

/// Resolve a non-conflicting file path: `base.md` first, then `base__2.md`,
/// `base__3.md`, …. Returns the absolute path and the chosen file name.
pub(crate) fn pick_nonconflicting_path(dir: &Path, base: &str) -> (PathBuf, String) {
    let initial = format!("{base}.md");
    let first = dir.join(&initial);
    if !first.exists() {
        return (first, initial);
    }
    for n in 2..=999 {
        let name = format!("{base}__{n}.md");
        let p = dir.join(&name);
        if !p.exists() {
            return (p, name);
        }
    }
    // Theoretical fallback — collisions beyond 999 are absurd. Use timestamp.
    let name = format!(
        "{base}__{}.md",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    let p = dir.join(&name);
    (p, name)
}

/// Extract the project tz from a `WorkdayResolver` for local-time
/// formatting. `WorkdayResolver` exposes `tz` as a public field.
fn chrono_tz_from(resolver: &WorkdayResolver) -> chrono_tz::Tz {
    resolver.tz
}

// ─── F5 git-backfill helpers ────────────────────────────────────────────────

/// Infer an entry type from a (conventional-commit) subject prefix.
fn infer_entry_type(subject: &str) -> EntryType {
    let prefix: String = subject
        .trim_start()
        .split([':', '(', ' ', '/'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match prefix.as_str() {
        "feat" | "feature" => EntryType::Feature,
        "fix" | "bug" | "bugfix" | "hotfix" => EntryType::Bug,
        "refactor" | "perf" | "style" => EntryType::Refactor,
        _ => EntryType::Chore,
    }
}

/// Build a valid `[a-z0-9-]{1,60}` slug from a commit subject (stripping a
/// conventional-commit `type(scope): ` prefix), falling back to
/// `commit-<short_sha>` when the subject is non-ASCII (e.g. Korean) or yields
/// nothing. Always satisfies [`validate_slug`].
fn slug_from_subject(subject: &str, short_sha: &str) -> String {
    let body = subject.split_once(':').map(|x| x.1).unwrap_or(subject);
    let mut out = String::new();
    let mut dash = false;
    for c in body.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        format!("commit-{short_sha}")
    } else {
        s
    }
}

/// Heuristic agent attribution from a commit body's trailers / co-author lines.
fn infer_agent_id(body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    // v2 U4 — 짧거나 흔한 이름(zed⊂optimized, cline⊂decline 등)은 부분 문자열
    // 매치가 오탐하므로 단어 단위로 본다.
    let has_word = |w: &str| {
        lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|t| t == w)
    };
    if lower.contains("claude") {
        "claude-code".to_string()
    } else if lower.contains("cursor") {
        "cursor".to_string()
    } else if lower.contains("antigravity") {
        "antigravity".to_string()
    } else if lower.contains("gemini") {
        "gemini-cli".to_string()
    } else if has_word("copilot") {
        "copilot".to_string()
    } else if has_word("codex") {
        "codex".to_string()
    } else if has_word("windsurf") {
        "windsurf".to_string()
    } else if has_word("aider") {
        "aider".to_string()
    } else if has_word("cline") {
        "cline".to_string()
    } else if has_word("zed") {
        "zed".to_string()
    } else {
        "git".to_string()
    }
}

/// Map a git name-status code to a journal `FileOp`.
fn status_to_op(status: char) -> FileOp {
    match status {
        'A' | 'C' => FileOp::Create,
        'D' => FileOp::Delete,
        'R' => FileOp::Rename,
        _ => FileOp::Update,
    }
}

fn reindex_report_to_spec(project_id: u32, r: CacheReindexReport) -> ReindexReport {
    let _ = r.elapsed_ms; // captured in tracing log; not part of spec shape
    let _ = r.parse_errors; // surfaced via integrity events, not the public report
    ReindexReport {
        project_id,
        inserted: r.inserted,
        updated: r.updated,
        deleted: r.deleted,
        skipped: r.skipped_unchanged,
        completed_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// 프로젝트 하나의 "실시간 갱신이 살아 있는가" 스냅샷.
#[derive(Debug, Clone)]
pub struct WatcherHealth {
    pub project_id: u32,
    pub root: PathBuf,
    /// 이 프로세스가 쓰기 주인인가. 아니면 감시를 켤 수 없다 (읽기 전용).
    pub has_lock: bool,
    /// 살아 있는 워처가 지금까지 처리 루프로 받은 이벤트 수. 워처가 없거나
    /// 태스크가 죽었으면 `None` — 그대로 재무장 대상이다.
    pub events_seen: Option<u32>,
}

fn lock_state_from_guard(guard: &Option<LockGuard>) -> LockStateView {
    match guard {
        Some(_) => LockStateView::Healthy,
        None => LockStateView::HeldByOther,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
