//! Type definitions for the `.oculpm/` subsystem.
//!
//! **Per-type doc comments are intentionally omitted.** Each public type here
//! is a direct port of a section in `docs/major_update/oculpm/00-spec.md` (§3
//! frontmatter, §4 sessions/ndjson/snapshot, §5 config, §7 reports) and
//! `01-backend.md` §4. Adding `///` paraphrases would duplicate the spec and
//! drift out of sync — the spec is the SSOT for semantics; this file is the
//! SSOT for wire shape (specta TS export).
//!
//! Every type is part of the specta-exported public surface — changing a
//! field is a breaking change for the TypeScript bindings.
//!
//! Naming: top-level types stay unprefixed (`Session`, `JournalEntry`, ...)
//! since they're within the oculpm namespace conceptually. The TypeScript side
//! sees them as distinct symbols — we grep-checked main has no collisions
//! (only `FileChange` exists, which is different from our `FileChangeEvent`).

#![allow(dead_code)] // Many fields are consumed by sibling modules landing in
                     // W1-PR3..W1-PR8 and W2+; this PR establishes the surface.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Bug,
    Feature,
    Error,
    Refactor,
    Chore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryStatus {
    Planned,
    InProgress,
    Done,
    Abandoned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    Superhigh,
    High,
    Medium,
    Low,
    Verylow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FileOp {
    Create,
    Update,
    Delete,
    Rename,
    Correct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Ok,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotKind {
    Open,
    Close,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WriteMode {
    ManagedBlock,
    Overwrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EndedReason {
    InactivityTimeout,
    AppQuit,
    WorkdayBoundary,
    Manual,
    CrashRecovered,
    /// W5 — session synthesized from migrated SQLite changelog entries.
    SyntheticMigrated,
    /// PR-CI0 — external agent hook reported the session ended (Claude Code
    /// SessionEnd). Precise close, unlike the InactivityTimeout heuristic.
    AgentExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CommentStyle {
    Markdown,
    Hash,
    DoubleSlash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LockStateView {
    Healthy,
    HeldByOther,
    Recovered,
    Uninitialized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WatcherStateView {
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DetectionConfidence {
    Present,
    Likely,
    Unknown,
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal frontmatter / entries
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentRef {
    /// e.g. `claude-code`, `cursor`, `antigravity`, `gemini-cli`, `pi`,
    /// `windsurf`, `copilot`, `codex`, `aider`, `cline`, `zed`, `manual`
    /// (자유 문자열 — 미지의 id 도 저장은 된다).
    pub id: String,
    /// The model the agent ran on, e.g. `"Opus 4.8"` / `"Gemini 3 Pro"`.
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct FileTouched {
    pub path: String,
    pub op: FileOp,
    pub bytes_added: Option<u32>,
    pub bytes_removed: Option<u32>,
    pub rename_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RelatedRef {
    /// Path relative to `.oculpm/journal/` (e.g. `20260522/Bugs/2050_bug_X.md`).
    #[serde(rename = "ref")]
    pub ref_path: String,
    /// One of `blocks`, `blocked_by`, `followup`, `duplicate`.
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct JournalFrontmatter {
    pub schema_version: u32,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub slug: String,
    pub status: EntryStatus,
    pub difficulty: Option<Difficulty>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub session_id: String,
    pub agent: AgentRef,
    /// Two-letter ISO 639-1, e.g. `ko` or `en`.
    pub language: String,
    pub verified_by_user: bool,
    pub files_touched: Vec<FileTouched>,
    pub related: Vec<RelatedRef>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JournalEntry {
    /// `<workday>/<Category>/<file>.md` — relative to `.oculpm/journal/`.
    pub relative_path: String,
    pub frontmatter: JournalFrontmatter,
    /// First non-blank line after frontmatter, with the `[ ]`/`[x]` prefix stripped.
    pub title: String,
    /// `None` when first line lacks a checkbox; `Some(true)` for `[x]`, `Some(false)` for `[ ]`.
    pub checkbox: Option<bool>,
    pub body_markdown: String,
    /// u32 (not u64) for specta BigInt-export compatibility — see
    /// docs/2026521/Errors/2026-05-21-specta-bigint-export.md. Caps at 4 GB
    /// which no realistic journal entry will hit.
    pub byte_size: u32,
    pub mtime: String,
    /// False when the YAML frontmatter failed to parse (the row is still cached
    /// as a synthesized chore). Drives a ⚠ reliability badge (F7a).
    pub parse_ok: bool,
    /// Non-fatal parse warnings (missing tz offset, agent-as-string, bad op, …).
    pub parse_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JournalEntrySummary {
    pub relative_path: String,
    pub workday: String,
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub slug: String,
    pub status: EntryStatus,
    pub difficulty: Option<Difficulty>,
    pub title: String,
    pub checkbox: Option<bool>,
    pub session_id: String,
    pub agent_id: String,
    /// The model the agent reported (frontmatter `agent.version`), e.g.
    /// `"Opus 4.8"` / `"Gemini 3 Pro"`. `None` when not reported.
    pub agent_version: Option<String>,
    pub verified_by_user: bool,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub tags: Vec<String>,
    pub files_count: u32,
    pub parse_ok: bool,
    pub parse_warnings: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions / file_changes / snapshots
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Session {
    /// `YYYYMMDD-NNN`.
    pub id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub ended_reason: Option<EndedReason>,
    /// u32 — caps at ~49 days of continuous active time. A single session
    /// will never approach this.
    pub active_window_ms: u32,
    pub file_event_count: u32,
    pub files_unique: u32,
    pub git_head_at_start: Option<String>,
    pub git_head_at_end: Option<String>,
    pub agent_label_guess: Option<String>,
    /// Paths relative to `.oculpm/journal/<workday>/`.
    pub linked_journal_entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionEnd {
    pub ended_at: String,
    pub ended_reason: EndedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileChangeEvent {
    pub ts: String,
    pub session_id: String,
    pub op: FileOp,
    pub path: String,
    pub hash_before: Option<String>,
    pub hash_after: Option<String>,
    /// u32 — caps at 4 GB per file. Larger files skip hashing anyway
    /// (`tags: ["large-file-hash-skipped"]`) so the value will be clamped.
    pub bytes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SnapshotGit {
    pub head_sha: String,
    pub branch: String,
    pub dirty_files: Vec<String>,
    pub untracked_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SnapshotTree {
    pub total_tracked_files: u32,
    /// `blake3:<hex>` — merkle root of sorted blake3 hashes of tracked files.
    pub merkle_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Snapshot {
    pub schema_version: u32,
    pub captured_at: String,
    pub git: SnapshotGit,
    pub tree_summary: SnapshotTree,
}

/// W4-PR5 — diff between the watcher's ndjson (index, ground truth) and
/// the union of `files_touched[].path` from journal entries that name a
/// given `session_id`. See `docs/major_update/oculpm/W4/PR5-compare-layers.md`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LayerComparison {
    pub session_id: String,
    pub workday: String,
    /// Distinct project-relative paths from `file_changes.ndjson` for this
    /// session, after stripping forbidden + `**redacted/sensitive**:*` paths.
    pub index_files: Vec<String>,
    /// Union of `files_touched[].path` across every journal entry that names
    /// this session, after the same forbidden / redacted strip.
    pub journal_files: Vec<String>,
    pub matched: Vec<String>,
    /// In the index but not the journal — likely *missing narrative*.
    pub only_in_index: Vec<String>,
    /// In the journal but not the index — likely *hallucinated path*.
    pub only_in_journal: Vec<String>,
    pub mismatch_severity: Severity,
    /// `|matched| / |union|`. `1.0` when both sets are empty (treated as
    /// trivially in sync — no activity, nothing to disagree on).
    pub jaccard_index: f32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Config (mirrors config.toml — see 00-spec.md §5)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WorkdayConfig {
    /// IANA timezone name (e.g. `Asia/Seoul`).
    pub timezone: String,
    /// `HH:MM` 24-hour. Late-night coders may use `03:00`.
    pub day_starts_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct SessionConfig {
    pub inactivity_timeout_minutes: u32,
    pub auto_close_on_workday_boundary: bool,
    pub auto_close_on_app_quit: bool,
    pub crash_recovery_grace_minutes: u32,
    /// W4 dogfooding fix — minutes within which new activity after an
    /// InactivityTimeout finalize will REOPEN the most recent
    /// inactivity-closed session instead of starting a new one. Bounded by
    /// today's workday (we never resurrect sessions across the workday
    /// boundary). `0` disables resume entirely. Defaults to 15 minutes.
    #[serde(default = "default_session_resume_grace_minutes")]
    pub session_resume_grace_minutes: u32,
}

fn default_session_resume_grace_minutes() -> u32 {
    15
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct GitConfig {
    pub journal_committed: bool,
    pub forbid_journal_for_paths: Vec<String>,
    pub auto_redact_patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WatcherConfig {
    pub ignore: Vec<String>,
    pub respect_gitignore: bool,
    pub debounce_ms: u32,
    pub batch_max_events: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentsConfig {
    /// Subset of `config::KNOWN_AGENT_IDS` — `agents-md` + 도구별 어댑터
    /// (claude-code/cursor/antigravity/gemini-cli/windsurf/copilot/aider/cline/zed).
    pub active: Vec<String>,
    pub auto_detect_on_open: bool,
    pub auto_sync_adapters: bool,
    /// F1 — when on, the watcher reconciles the single active plan against each
    /// newly-written journal entry via a background LLM call (`auto:<provider>`
    /// attribution). Opt-in (default `false`): it triggers automatic, billable
    /// LLM requests that send journal/plan text to the configured provider.
    /// `#[serde(default)]` so pre-F1 `config.toml` files parse to `false`.
    #[serde(default)]
    pub auto_reconcile: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct OculpmConfig {
    pub schema_version: u32,
    pub workday: WorkdayConfig,
    pub session: SessionConfig,
    pub git: GitConfig,
    pub watcher: WatcherConfig,
    pub agents: AgentsConfig,
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / reports
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OculpmStatus {
    pub initialized: bool,
    pub config_valid: bool,
    pub lock_state: LockStateView,
    pub current_workday: String,
    pub watcher_state: WatcherStateView,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OculpmInitReport {
    /// Project-relative paths that were created.
    pub created_dirs: Vec<String>,
    pub wrote_config: bool,
    pub wrote_gitignore: bool,
    pub lock_state: LockStateView,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WatcherStatus {
    pub state: WatcherStateView,
    /// u32 cumulative counters — wrap at 4.29B (≈ 1k events/sec for 50 days).
    /// Practical workloads stay far below this; watcher resets on restart.
    pub events_seen_total: u32,
    pub events_ignored_total: u32,
    pub last_event_at: Option<String>,
    pub debounce_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentDetection {
    pub id: String,
    pub confidence: DetectionConfidence,
    /// Project-relative adapter path (e.g. `.cursor/rules/ocul-pm.mdc`).
    pub adapter_path: String,
    pub mtime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentSyncResult {
    pub id: String,
    /// One of `inserted`, `updated`, `unchanged`, `removed`, `error`.
    pub action: String,
    pub error: Option<String>,
    /// blake3 hex of the bytes we own on disk after this sync. For
    /// `Overwrite` adapters it's the file hash; for `ManagedBlock` adapters
    /// it's the hash of the inner block content (between the markers). Used
    /// by W4-PR4 to seed the drift comparator. `None` when the adapter was
    /// removed / errored / left untouched without a file present.
    pub last_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentSyncReport {
    pub results: Vec<AgentSyncResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct IntegrityWarning {
    /// One of `frontmatter_parse`, `schema_mismatch`, `orphan_session`, `narrative_mismatch`, `lock_recovered`, ...
    pub kind: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ManualEntryDraft {
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub slug: String,
    pub title: String,
    pub difficulty: Option<Difficulty>,
    pub body_markdown: String,
    /// `None` → use the active session if any, else fall back to a
    /// `manual-<workday>-<HHMMSS>` sentinel id.
    pub session_id: Option<String>,
    pub files_touched: Vec<FileTouched>,
    /// `None` → defaults to `planned`. Spec §3.1.
    pub status: Option<EntryStatus>,
    pub tags: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview stats (W5-PR5)
// ─────────────────────────────────────────────────────────────────────────────

/// One day's worth of activity data for the heatmap. `score` is a UI-friendly
/// derived value (entries weighted higher than file events).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct HeatmapCell {
    pub workday: String,
    pub entry_count: u32,
    pub file_event_count: u32,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DifficultyMix {
    pub verylow: u32,
    pub low: u32,
    pub medium: u32,
    pub high: u32,
    pub superhigh: u32,
    /// Entries that didn't specify a difficulty in frontmatter.
    pub null_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentCount {
    pub agent_id: String,
    pub entry_count: u32,
    /// `entry_count / total_entries`. `0.0` when no entries.
    pub share: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionDailyAgg {
    pub workday: String,
    pub session_count: u32,
    pub total_active_seconds: u32,
    pub files_unique: u32,
    pub journal_entry_count: u32,
    /// `journal_entry_count / sessions_with_file_events`. `0.0` when no
    /// sessions have file events (avoids NaN). UI shows as percentage.
    pub narrative_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OculpmOverviewStats {
    pub generated_at: String,
    pub window_days: u32,
    /// Every workday in the window (entries=0 days included as empty cells).
    pub heatmap_cells: Vec<HeatmapCell>,
    pub difficulty_mix: DifficultyMix,
    pub agent_breakdown: Vec<AgentCount>,
    /// Up to 50 unfinished entries, most recent first.
    pub unfinished_entries: Vec<JournalEntrySummary>,
    /// Up to 30 days of session aggregates, most recent first.
    pub recent_sessions: Vec<SessionDailyAgg>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReindexReport {
    pub project_id: u32,
    pub inserted: u32,
    pub updated: u32,
    pub deleted: u32,
    pub skipped: u32,
    pub completed_at: String,
}

/// Result of a git-history backfill (F5): one synthesised journal entry per
/// commit. `skipped` counts commits already backfilled (idempotent re-runs).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BackfillReport {
    pub project_id: u32,
    pub scanned: u32,
    pub created: u32,
    pub skipped: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri events — emitted by the backend, listened on the frontend.
// All carry `project_id` so multi-project listeners can filter.
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmSessionStarted {
    pub project_id: u32,
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmSessionEnded {
    pub project_id: u32,
    pub session: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmFileChanged {
    pub project_id: u32,
    pub event: FileChangeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmJournalAdded {
    pub project_id: u32,
    pub summary: JournalEntrySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmJournalUpdated {
    pub project_id: u32,
    pub summary: JournalEntrySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmIntegrityWarning {
    pub project_id: u32,
    pub warning: IntegrityWarning,
}

/// F1 — emitted after auto-reconcile applies status flips to a plan, so the UI
/// can toast ("AI 가 N개 항목을 자동 갱신") and refresh the planner. Only fired on
/// an actual change (≥1 applied); skips/no-ops stay silent.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmPlanReconciled {
    pub project_id: u32,
    pub plan_id: String,
    /// Number of item statuses changed.
    pub applied: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmAgentDrift {
    pub project_id: u32,
    pub agent_id: String,
    pub expected_hash: String,
    pub actual_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmAgentsTemplateChanged {
    pub project_id: u32,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmJournalPathChanged {
    pub project_id: u32,
    pub relative_path: String,
    pub op: FileOp,
}
