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
    /// In the index but not the journal **of this exact session**.
    ///
    /// Only meaningful when the agent stamps the watcher's own `session_id`
    /// scheme. Agents that mint their own (`manual-20260820-205400`) make this
    /// equal to `index_files` — use [`Self::unrecorded`] to judge honesty.
    pub only_in_index: Vec<String>,
    /// In the journal but not the index — likely *hallucinated path*.
    pub only_in_journal: Vec<String>,
    pub mismatch_severity: Severity,
    /// `|matched| / |union|`. `1.0` when both sets are empty (treated as
    /// trivially in sync — no activity, nothing to disagree on).
    pub jaccard_index: f32,
    /// Changed in this session and named by **no journal entry anywhere in
    /// the workday** — the honest "미기록" set, immune to session-id dialect
    /// mismatches. This is what 정직성 감사 renders.
    pub unrecorded: Vec<String>,
    /// Severity of [`Self::unrecorded`], bucketed from the share of this
    /// session's changed files that *are* covered by some journal entry.
    /// `Ok` when the session changed nothing.
    pub unrecorded_severity: Severity,
}

/// 워크데이 하나의 정직성 감사 (완성도 라운드 Phase 3, 2026-08-30).
///
/// [`LayerComparison`] 은 세션 하나를 보지만 Today 는 그날 세션 전부를 물어야
/// 해서 세션 수만큼 IPC 를 날리고, 뒤에서는 같은 `file_changes.ndjson` 을
/// 세션 수만큼 다시 파싱했다. 이 구조체는 ndjson 을 **한 번** 읽고 세션별로
/// 갈라 `unrecorded` 만 낸다 — Today 가 읽는 것은 그것뿐이다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkdayComparison {
    pub workday: String,
    /// 그날 index 에 변경을 남긴 세션들 (변경이 없는 세션은 없다). `unrecorded`
    /// 가 빈 세션도 들어 있다 — 화면이 거른다.
    pub sessions: Vec<SessionUnrecorded>,
    /// 세션 전체에 걸친 `unrecorded` 의 합 (중복 경로는 세션마다 센다).
    pub unrecorded_total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionUnrecorded {
    pub session_id: String,
    /// 이 세션이 바꿨는데 그날 어떤 일지도 적지 않은 파일 — [`LayerComparison::unrecorded`] 와 같은 판정.
    pub unrecorded: Vec<String>,
    pub unrecorded_severity: Severity,
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
    // `auto_close_on_workday_boundary` · `auto_close_on_app_quit` ·
    // `crash_recovery_grace_minutes` 는 2026-08-30 에 뺐다 — 어떤 코드도 읽지
    // 않는 키였는데(경계 종료·앱 종료 정리는 무조건 동작) 설정 화면에 토글로
    // 노출돼 "끄면 안 닫힌다" 는 거짓 믿음을 줬다. 디스크의 옛 키는 무시된다
    // (미지 키 허용).
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
    // `journal_committed` 는 2026-08-30 에 뺐다 — git commit 을 부르는 코드가 없는
    // 죽은 플래그였다.
    pub forbid_journal_for_paths: Vec<String>,
    pub auto_redact_patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct WatcherConfig {
    pub ignore: Vec<String>,
    pub respect_gitignore: bool,
    pub debounce_ms: u32,
    /// Phase 2 `#responsiveness-tiers` — 디바운스를 **이름 있는 정책**으로
    /// (`fast|balanced|patient|relaxed|deferred|extended`). 값이 있으면
    /// `debounce_ms` 대신 쓰이고, 없으면 숫자가 그대로 산다 (커스텀 하위호환).
    /// OS 디바운서에 실제로 걸리는 창은 언제나 `balanced` 로 잘린다 —
    /// `automation::tiers::os_debounce_ms`.
    #[serde(default)]
    pub responsiveness: Option<String>,
    // `batch_max_events` 는 2026-08-30 에 뺐다 — 워처 배치는 디바운스 창으로만
    // 잘리고 이 상한을 읽는 코드가 없었다.
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentsConfig {
    /// Subset of `config::KNOWN_AGENT_IDS` — `agents-md` + 도구별 어댑터
    /// (claude-code/cursor/antigravity/gemini-cli/windsurf/copilot/aider/cline/zed).
    pub active: Vec<String>,
    // `auto_detect_on_open` · `auto_sync_adapters` 는 2026-08-30 에 뺐다 — 감지와
    // 동기화는 프로젝트를 열 때 무조건 돌고(`oculpm_init` 2단계) 두 플래그를
    // 읽는 코드가 없었다.
    /// F1 — when on, the watcher reconciles the single active plan against each
    /// newly-written journal entry via a background LLM call (`auto:<provider>`
    /// attribution). Opt-in (default `false`): it triggers automatic, billable
    /// LLM requests that send journal/plan text to the configured provider.
    /// `#[serde(default)]` so pre-F1 `config.toml` files parse to `false`.
    #[serde(default)]
    pub auto_reconcile: bool,
    /// PR-CI1 — when on, a hook-detected Claude Code session end (AgentExit)
    /// triggers a background LLM summary of the session transcript into ONE
    /// journal draft (skipped if the agent wrote its own entry). Opt-in
    /// (default `false`): billable, and sends transcript excerpts to the
    /// configured provider.
    #[serde(default)]
    pub auto_journal_draft: bool,
    /// PR-CI3 — 규칙 크로스툴 번역 타깃 (`rules::TRANSLATE_TARGETS` 의 부분집합,
    /// v1: "cursor"). 켜져 있으면 `.claude/rules/*.md` 저장 시 해당 도구의
    /// 규칙 파일로 병행 배포한다. `#[serde(default)]` 라 기존 config 는 빈
    /// 배열(off)로 파싱된다.
    #[serde(default)]
    pub rules_translate: Vec<String>,
    /// TK1 (template v6) — 마스터 템플릿 언어 (`ko` | `en`). 기존 config 는
    /// default 로 `ko` 파싱. 변경은 다음 템플릿 시드/업그레이드부터 반영된다
    /// (이미 시드된 `_template.md` 는 사용자 소유라 자동 교체하지 않음).
    #[serde(default = "default_template_language")]
    pub template_language: String,
}

fn default_template_language() -> String {
    "ko".to_string()
}

/// Osaurus 라운드 Phase 0 (Decision 4) — 자동화의 전역 스위치.
///
/// **전부 옵인, 기본 off.** `#[serde(default)]` 라 `[automation]` 섹션이 없는
/// 기존 `config.toml` 은 전부 꺼진 상태로 파싱된다. `.oculpm/automation/` 은
/// 신규 디렉터리라 기존 온디스크 스펙이 불변이고 `schema_version` 을 올리지
/// 않는다 (`auto_reconcile`·`auto_journal_draft` 선례).
///
/// 개별 정의 파일의 `enabled` 와는 **AND** 다 — 여기가 꺼져 있으면 켜 둔
/// 정의가 있어도 돌지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AutomationConfig {
    /// 스케줄 집행 전역 스위치.
    #[serde(default)]
    pub schedules: bool,
    /// 워처 자동화 전역 스위치.
    #[serde(default)]
    pub watchers: bool,
    /// 한 워크데이에 자동화가 부를 수 있는 LLM 호출 상한 (폭주 가드).
    /// `0` = 전면 정지. 드롭·스킵은 과금되지 않았으므로 세지 않는다.
    #[serde(default = "default_daily_run_budget")]
    pub daily_run_budget: u32,
}

fn default_daily_run_budget() -> u32 {
    20
}

/// `#[serde(default)]` 로 통째로 빠진 `[automation]` 과, 부분만 적힌
/// `[automation]` 이 **같은 값**을 내야 한다 — 그래서 파생 `Default` 를 쓰지
/// 않고 필드별 serde 기본값과 손으로 맞춘다 (`automation_defaults_agree` 테스트).
impl Default for AutomationConfig {
    fn default() -> Self {
        Self {
            schedules: false,
            watchers: false,
            daily_run_budget: default_daily_run_budget(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct OculpmConfig {
    pub schema_version: u32,
    pub workday: WorkdayConfig,
    pub session: SessionConfig,
    pub git: GitConfig,
    pub watcher: WatcherConfig,
    pub agents: AgentsConfig,
    #[serde(default)]
    pub automation: AutomationConfig,
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
    /// Agent rule files (`AGENTS.md`, `CLAUDE.md`, …) that `sync_agents`
    /// inserted or updated during this init — project-relative. Empty on the
    /// idempotent re-open path, so a non-empty list means "this is the first
    /// time ocul-pm wrote into this repo" (Today's first-run card keys off it).
    pub agent_files: Vec<String>,
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
    /// PR-CI1 — `None` → `manual` (수동 모달의 기존 의미). 훅 기반 자동 초안은
    /// 실측 에이전트(`claude-code` + transcript 의 model)를 넣는다.
    #[serde(default)]
    pub agent: Option<AgentRef>,
    /// PR-CI1 — `None` → `true` (수동 모달 = 사용자가 직접 씀). 자동 초안은
    /// `Some(false)` — 사용자가 UI 에서 검토 후 토글한다.
    #[serde(default)]
    pub verified_by_user: Option<bool>,
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

/// 다른 ocul-pm 인스턴스가 이 프로젝트의 락을 가져가, 이 창은 실시간 갱신을
/// 놓았다 (2026-08-23). 예전에는 이런 일이 로그에만 남아, 사용자는 화면이 왜
/// 안 바뀌는지 알 길이 없었다.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmWatchYielded {
    pub project_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmAgentDrift {
    pub project_id: u32,
    pub agent_id: String,
    pub expected_hash: String,
    pub actual_hash: String,
}

/// 워크데이가 넘어갔다 (완성도 라운드 Phase 4 #events-over-polling). 활성
/// 세션의 경계 타이머와 감독관의 분당 틱이 낸다 — 화면은 60초마다 상태를
/// 다시 묻는 대신 이걸 듣는다. (`OculpmAgentsTemplateChanged` 는 듣는 곳이
/// 없어 같은 라운드에 지웠다.)
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmWorkdayChanged {
    pub project_id: u32,
    pub workday: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmJournalPathChanged {
    pub project_id: u32,
    pub relative_path: String,
    pub op: FileOp,
}

/// `.oculpm/` 안에서 일지가 **아닌** 데이터 영역이 디스크에서 바뀌었음을 알린다
/// (계획 · 논의). 이 영역들은 읽을 때마다 파일에서 다시 투영되므로 캐시 무효화가
/// 필요 없고, UI 가 "다시 읽어라" 신호만 받으면 된다.
///
/// 이 이벤트가 없던 동안 계획/논의 화면은 마운트 때 한 번만 읽었다 — 에이전트가
/// `.oculpm/planner/*.md` 를 고쳐도 사용자가 직접 새로고침하기 전까지 화면은
/// 옛 내용을 그대로 보여줬다 (도그푸딩 2026-08-21).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OculpmDataArea {
    Planner,
    Discussion,
    /// `.claude/rules/**` · `.cursor/rules/**` · CLAUDE.md 슬롯 — 규칙 허브가
    /// 다시 읽는다 (Phase 4). 예전엔 `.claude/**` 가 에이전트 내부 상태로 통째로
    /// 버려져 어떤 신호도 나가지 않았다.
    Rules,
    /// `.oculpm/retro/**` — 회고 화면이 다시 읽는다 (Phase 4). 예전엔 코드 변경
    /// 파이프라인으로 새어 들어갔다.
    Retro,
    /// `.oculpm/automation/**` — 자동화 탭이 다시 읽는다 (Osaurus Phase 2).
    /// 정의는 사람이 손으로 고치고 git 에 올릴 수 있는 파일이라 UI 가 그
    /// 변경을 봐야 한다. 동시에 자동화 **트리거 원인에서는 제외**된다
    /// (`automation::settle::is_excluded_cause` — 증폭 루프 가드 R1).
    Automation,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OculpmDataChanged {
    pub project_id: u32,
    pub area: OculpmDataArea,
    pub relative_path: String,
    pub op: FileOp,
}
