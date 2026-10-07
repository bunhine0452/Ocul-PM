//! Adapter renderer + sync + detect — W4-PR2.
//!
//! Renders the in-binary templates from `templates/` to the known adapter
//! paths according to `config.agents.active`. Drives:
//! - `OculpmManager::sync_agents` (init / Greenfield wizard / Settings save)
//! - `OculpmManager::detect_agents` (Settings "감지" button)
//! - watcher's `.oculpm/agents/**` change handler (master edit → cascading
//!   re-render of every active adapter)
//!
//! Idempotency is load-bearing: the watcher will fire the agents path on
//! every save of an adapter file we just wrote ourselves. If `sync_active`
//! weren't byte-stable per call, every save would amplify into another save,
//! drowning out the drift detector PR4 is going to build on top of this.
//!
//! See `docs/major_update/oculpm/W4/PR2-agents-renderer.md`.
//!
//! Three templates embedded as `.tpl` strings — they ship with the binary
//! and `init_project` copies the master to `.oculpm/agents/_template.md` on
//! first run (user-editable from then on). Per-agent overrides live in
//! `.oculpm/agents/per-agent/{id}.md`.

// and by PR4 (drift) / PR5 (compare) / PR7 (settings).

use std::path::Path;

use crate::oculpm::atomic_io::{
    read_managed_block, remove_managed_block, write_atomic, write_managed_block, ManagedBlockResult,
};
use crate::oculpm::error::OculpmError;
use crate::oculpm::spec::{AgentSyncReport, AgentSyncResult, CommentStyle, OculpmConfig};

// ─── Templates (PR1) ─────────────────────────────────────────────────────────

pub const MASTER_KO: &str = include_str!("templates/master_ko.md.tpl");
/// TK1 (template v6) — 영어 변형. 버전 마커는 ko 와 항상 동일해야 한다
/// (패리티 테스트가 강제).
pub const MASTER_EN: &str = include_str!("templates/master_en.md.tpl");
/// TK1 — §5 가 가리키는 on-demand 문제 해결 문서 규격. `.oculpm/agents/`
/// 에 앱 관리 파일로 동기화된다 (상시 컨텍스트 비용 0, 필요할 때만 Read).
const DISCUSSION_SPEC_KO: &str = include_str!("templates/discussion_spec_ko.md.tpl");
const DISCUSSION_SPEC_EN: &str = include_str!("templates/discussion_spec_en.md.tpl");
const CURSOR_TPL: &str = include_str!("templates/cursor.mdc.tpl");
const CLAUDE_CODE_TPL: &str = include_str!("templates/claude_code.md.tpl");
const ANTIGRAVITY_TPL: &str = include_str!("templates/antigravity.md.tpl");
const GEMINI_TPL: &str = include_str!("templates/gemini.md.tpl");
// v2 U4 (docs/20260706_v2/02-features-spec.md §4) — 어댑터 확대. Codex CLI 는
// AGENTS.md 를 네이티브로 읽으므로 별도 어댑터가 없다 (git 백필 귀속만 지원).
const WINDSURF_TPL: &str = include_str!("templates/windsurf.md.tpl");
const COPILOT_TPL: &str = include_str!("templates/copilot.md.tpl");
const AIDER_TPL: &str = include_str!("templates/aider.md.tpl");
const CLINE_TPL: &str = include_str!("templates/cline.md.tpl");
const ZED_TPL: &str = include_str!("templates/zed.md.tpl");

/// `block_id` for ManagedBlock-mode adapters. Matches `atomic_io` convention.
const BLOCK_ID: &str = "oculpm";

// ─── Adapter table ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Whole file ours — safe to overwrite or delete on its own.
    Overwrite,
    /// File may also be hand-edited by the user; only the marker block
    /// belongs to us.
    ManagedBlock,
}

/// Static metadata for one known adapter. Function pointer for rendering
/// keeps dispatch zero-cost and avoids the `Box<dyn Fn>` allocation that
/// would otherwise touch every sync call.
#[derive(Debug, Clone, Copy)]
pub struct AgentAdapter {
    pub id: &'static str,
    pub adapter_path: &'static str,
    pub write_mode: WriteMode,
    pub render: fn(&AgentContext) -> String,
}

/// Render-time context. `master_template` is the on-disk
/// `.oculpm/agents/_template.md` (user-editable) if present, falling back to
/// the in-binary `MASTER_KO`. `per_agent_override` is the optional
/// `.oculpm/agents/per-agent/{id}.md`. Both default to the embedded `.tpl`
/// in the current PR — PR4/PR7 may extend the render to actually merge the
/// master + per-agent override (today the adapter `.tpl` files are
/// self-contained, so we just emit them verbatim).
#[derive(Debug, Clone)]
pub struct AgentContext {
    pub master_template: String,
    pub per_agent_override: Option<String>,
}

/// All adapters we know how to render. Order matters for `sync_active`'s
/// `AgentSyncReport` output (deterministic per-call ordering).
pub fn known_adapters() -> &'static [AgentAdapter] {
    &[
        // W4 dogfooding finding (2026-05-25) — 외부 LLM 들이 `.oculpm/agents/_template.md`
        // 를 자발적으로 읽지 않음. 루트 `AGENTS.md` 를 1차 surface 로 삼아 마스터 콘텐츠를
        // 그대로 배포하고, 어댑터별 파일은 `@AGENTS.md` 위임 stub 으로 축소했음.
        // ManagedBlock 모드: 사용자가 AGENTS.md 에 다른 규칙도 적어둘 수 있어 블록 밖
        // 콘텐츠는 보존.
        AgentAdapter {
            id: "agents-md",
            adapter_path: "AGENTS.md",
            write_mode: WriteMode::ManagedBlock,
            render: render_agents_md,
        },
        AgentAdapter {
            id: "cursor",
            adapter_path: ".cursor/rules/ocul-pm.mdc",
            write_mode: WriteMode::Overwrite,
            render: render_cursor,
        },
        AgentAdapter {
            id: "claude-code",
            adapter_path: ".claude/CLAUDE.md",
            write_mode: WriteMode::ManagedBlock,
            render: render_claude_code,
        },
        AgentAdapter {
            id: "antigravity",
            adapter_path: ".agent/rules/ocul-pm.md",
            write_mode: WriteMode::Overwrite,
            render: render_antigravity,
        },
        AgentAdapter {
            id: "gemini-cli",
            adapter_path: "GEMINI.md",
            write_mode: WriteMode::ManagedBlock,
            render: render_gemini,
        },
        // ── v2 U4 확대분 — 전부 `@AGENTS.md` 위임 stub (기존 패턴 유지) ──
        AgentAdapter {
            id: "windsurf",
            adapter_path: ".windsurf/rules/ocul-pm.md",
            write_mode: WriteMode::Overwrite,
            render: render_windsurf,
        },
        AgentAdapter {
            // GitHub Copilot (VS Code / coding agent) — 사용자가 자기 지침을
            // 함께 적는 파일이라 marker block 만 소유한다.
            id: "copilot",
            adapter_path: ".github/copilot-instructions.md",
            write_mode: WriteMode::ManagedBlock,
            render: render_copilot,
        },
        AgentAdapter {
            // aider 의 관례 컨벤션 파일. 루트 공용 문서라 marker block.
            id: "aider",
            adapter_path: "CONVENTIONS.md",
            write_mode: WriteMode::ManagedBlock,
            render: render_aider,
        },
        AgentAdapter {
            id: "cline",
            adapter_path: ".clinerules/ocul-pm.md",
            write_mode: WriteMode::Overwrite,
            render: render_cline,
        },
        AgentAdapter {
            // Zed 는 루트 `.rules` 를 읽는다 — 사용자 규칙과 공존해야 하므로
            // marker block.
            id: "zed",
            adapter_path: ".rules",
            write_mode: WriteMode::ManagedBlock,
            render: render_zed,
        },
    ]
}

fn render_agents_md(ctx: &AgentContext) -> String {
    // AGENTS.md is the canonical content surface. Precedence:
    //   1. per-agent override (`.oculpm/agents/per-agent/agents-md.md`)
    //   2. on-disk master template (`.oculpm/agents/_template.md`, populated
    //      from MASTER_KO on first init) — so user edits to the master flow
    //      into AGENTS.md verbatim.
    if let Some(override_text) = &ctx.per_agent_override {
        return override_text.clone();
    }
    if ctx.master_template.is_empty() {
        // Defensive: ensure_master_template should always populate this, but if
        // a future caller forgets, fall back to the embedded master.
        return MASTER_KO.to_string();
    }
    ctx.master_template.clone()
}

fn render_cursor(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| CURSOR_TPL.to_string())
}

fn render_claude_code(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| CLAUDE_CODE_TPL.to_string())
}

fn render_antigravity(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| ANTIGRAVITY_TPL.to_string())
}

fn render_gemini(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| GEMINI_TPL.to_string())
}

fn render_windsurf(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| WINDSURF_TPL.to_string())
}

fn render_copilot(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| COPILOT_TPL.to_string())
}

fn render_aider(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| AIDER_TPL.to_string())
}

fn render_cline(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| CLINE_TPL.to_string())
}

fn render_zed(ctx: &AgentContext) -> String {
    ctx.per_agent_override
        .clone()
        .unwrap_or_else(|| ZED_TPL.to_string())
}

// ─── sync_active ─────────────────────────────────────────────────────────────

/// Sync every known adapter to disk based on `config.agents.active`:
/// - active → render and write (ManagedBlock or Overwrite per adapter)
/// - inactive → remove our footprint (block deletion or file unlink)
///
/// Idempotent — running twice with the same inputs leaves the disk
/// untouched on the second call (each adapter reports `Unchanged` / no-op).
///
/// Master template handling: on first call (no
/// `.oculpm/agents/_template.md` on disk), the embedded `MASTER_KO` is
/// atomically written there so the user can edit it going forward. Later
/// calls always read the on-disk master so user edits persist.
/// ⚠️ 이 함수 본문에 실제 `.await`(특히 tokio 기반)를 넣지 말 것 — oculpm-mcp
/// 바이너리의 `project_init` 이 tokio 런타임 없이 `futures::executor::block_on`
/// 으로 호출한다. await 이 생기면 테스트(#[tokio::test])는 통과하고 필드의
/// MCP 호출에서만 패닉하는 함정이 된다. async 서명은 호출부 일관성용.
pub async fn sync_active(
    root: &Path,
    config: &OculpmConfig,
) -> Result<AgentSyncReport, OculpmError> {
    let lang = config.agents.template_language.as_str();
    let master_template = ensure_master_template(root, lang)?;
    // discussion-spec 은 앱 관리 파일 — 항상 임베디드 내용으로 수렴시킨다.
    ensure_discussion_spec(root, lang)?;
    let per_agent_dir = root.join(".oculpm").join("agents").join("per-agent");

    let active: std::collections::HashSet<&str> =
        config.agents.active.iter().map(|s| s.as_str()).collect();

    let mut results = Vec::with_capacity(known_adapters().len());
    for adapter in known_adapters() {
        // 어댑터 파일은 읽고 → 합쳐 → 쓴다. 그 자리나 위 폴더가 링크면 손대지
        // 않는다 (`path_guard::secure_join_managed`, 보안 피드백 2차). 따라가면
        // `AGENTS.md -> ~/.zshrc` 는 대상 내용을 프로젝트 파일로 복사하고,
        // `.claude -> ~/.claude` 는 쓰기 자체가 프로젝트 밖 — 모든 프로젝트에
        // 실리는 전역 Claude 지침 — 에 떨어진다. 이 동기는 프로젝트를 열 때마다
        // 돈다. 쓰지 않는 어댑터 자리의 링크는 조용히 지나간다.
        let abs = match crate::path_guard::secure_join_managed(root, adapter.adapter_path) {
            Ok(abs) => abs,
            Err(reason) if active.contains(adapter.id) => {
                results.push(refused_result(adapter.id, reason));
                continue;
            }
            Err(_) => {
                results.push(action_result(adapter.id, "unchanged", None));
                continue;
            }
        };
        let per_agent_override = read_per_agent_override(&per_agent_dir, adapter.id);
        let ctx = AgentContext {
            master_template: master_template.clone(),
            per_agent_override,
        };

        let result = if active.contains(adapter.id) {
            apply_write(adapter, &abs, &ctx)
        } else {
            apply_remove(adapter, &abs)
        };
        results.push(result);
    }

    Ok(AgentSyncReport { results })
}

fn apply_write(adapter: &AgentAdapter, abs: &Path, ctx: &AgentContext) -> AgentSyncResult {
    let rendered = (adapter.render)(ctx);
    let outcome = match adapter.write_mode {
        WriteMode::Overwrite => write_overwrite(abs, &rendered),
        WriteMode::ManagedBlock => {
            write_managed_block(abs, BLOCK_ID, &rendered, CommentStyle::Markdown)
        }
    };
    match outcome {
        Ok(ManagedBlockResult::Inserted) => {
            action_result(adapter.id, "inserted", post_write_hash(adapter, abs))
        }
        Ok(ManagedBlockResult::Updated) => {
            action_result(adapter.id, "updated", post_write_hash(adapter, abs))
        }
        Ok(ManagedBlockResult::Unchanged) => {
            action_result(adapter.id, "unchanged", post_write_hash(adapter, abs))
        }
        Ok(ManagedBlockResult::SkippedNewer) => {
            // A newer app version owns this block — leave it, and report
            // "unchanged" with the on-disk hash so the drift comparator
            // accepts the newer content as legitimate (not user tampering).
            tracing::warn!(
                adapter = adapter.id,
                path = %abs.display(),
                "managed block has a newer version — write skipped (downgrade guard)"
            );
            action_result(adapter.id, "unchanged", post_write_hash(adapter, abs))
        }
        Err(e) => error_result(adapter.id, &e),
    }
}

fn apply_remove(adapter: &AgentAdapter, abs: &Path) -> AgentSyncResult {
    let outcome: Result<bool, OculpmError> = match adapter.write_mode {
        WriteMode::Overwrite => match std::fs::remove_file(abs) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(source) => Err(OculpmError::Io {
                path: abs.to_path_buf(),
                source,
            }),
        },
        WriteMode::ManagedBlock => {
            // Detect whether the block was present so we can distinguish
            // "removed" from "unchanged" without rewriting the file.
            let had_block = matches!(
                read_managed_block(abs, BLOCK_ID, CommentStyle::Markdown),
                Ok(Some(_))
            );
            remove_managed_block(abs, BLOCK_ID, CommentStyle::Markdown).map(|()| had_block)
        }
    };
    match outcome {
        Ok(true) => action_result(adapter.id, "removed", None),
        Ok(false) => action_result(adapter.id, "unchanged", None),
        Err(e) => error_result(adapter.id, &e),
    }
}

/// Read the bytes we own on `abs` right after a successful write and return
/// their blake3 hex. For Overwrite adapters that's the whole file; for
/// ManagedBlock adapters it's the inner content the next `read_managed_block`
/// will return. Hashing post-write (rather than hashing `rendered` directly)
/// keeps the comparator honest about any normalisation `atomic_io` did —
/// notably CRLF preservation in managed-block writes.
fn post_write_hash(adapter: &AgentAdapter, abs: &Path) -> Option<String> {
    match adapter.write_mode {
        WriteMode::Overwrite => match std::fs::read(abs) {
            Ok(bytes) => Some(blake3::hash(&bytes).to_hex().to_string()),
            Err(_) => None,
        },
        WriteMode::ManagedBlock => {
            match read_managed_block(abs, BLOCK_ID, CommentStyle::Markdown) {
                Ok(Some(inner)) => {
                    Some(blake3::hash(inner.content.as_bytes()).to_hex().to_string())
                }
                _ => None,
            }
        }
    }
}

/// Recompute the same hash `post_write_hash` recorded — used by the watcher
/// drift check so the comparator sees identical normalisation.
pub fn current_disk_hash(adapter: &AgentAdapter, abs: &Path) -> Option<String> {
    post_write_hash(adapter, abs)
}

/// Look up an adapter by its `agent_id`. Returns `None` for unknown ids so
/// the watcher can fall back to "treat as user file" rather than panic.
pub fn lookup_adapter(agent_id: &str) -> Option<&'static AgentAdapter> {
    known_adapters().iter().find(|a| a.id == agent_id)
}

/// Inverse of `lookup_adapter` — given a project-relative path that the
/// watcher saw change, return the matching adapter if it's one of ours.
pub fn lookup_adapter_by_path(relative_path: &str) -> Option<&'static AgentAdapter> {
    known_adapters()
        .iter()
        .find(|a| a.adapter_path == relative_path)
}

/// Overwrite-mode write reuses `write_atomic` and reports a synthetic
/// ManagedBlockResult so the calling code can branch the same way for both
/// write modes (Inserted = file didn't exist; Updated = different content;
/// Unchanged = identical bytes already on disk).
fn write_overwrite(abs: &Path, rendered: &str) -> Result<ManagedBlockResult, OculpmError> {
    let existed = abs.exists();
    if existed {
        if let Ok(current) = std::fs::read(abs) {
            if current == rendered.as_bytes() {
                return Ok(ManagedBlockResult::Unchanged);
            }
        }
    }
    write_atomic(abs, rendered.as_bytes())?;
    Ok(if existed {
        ManagedBlockResult::Updated
    } else {
        ManagedBlockResult::Inserted
    })
}

fn action_result(id: &str, action: &str, last_hash: Option<String>) -> AgentSyncResult {
    AgentSyncResult {
        id: id.to_string(),
        action: action.to_string(),
        error: None,
        last_hash,
    }
}

fn error_result(id: &str, e: &OculpmError) -> AgentSyncResult {
    refused_result(id, e.to_string())
}

/// 쓰지 않고 멈춘 어댑터 — 오류와 같은 모양으로 화면에 사유가 뜬다.
fn refused_result(id: &str, reason: String) -> AgentSyncResult {
    AgentSyncResult {
        id: id.to_string(),
        action: "error".to_string(),
        error: Some(reason),
        last_hash: None,
    }
}

/// 언어별 임베디드 마스터. 미지의 값은 ko 로 폴백 (config 손편집 방어).
pub fn embedded_master(lang: &str) -> &'static str {
    match lang {
        "en" => MASTER_EN,
        _ => MASTER_KO,
    }
}

fn embedded_discussion_spec(lang: &str) -> &'static str {
    match lang {
        "en" => DISCUSSION_SPEC_EN,
        _ => DISCUSSION_SPEC_KO,
    }
}

fn ensure_master_template(root: &Path, lang: &str) -> Result<String, OculpmError> {
    let dir = root.join(".oculpm").join("agents");
    let path = dir.join("_template.md");
    let embedded = embedded_master(lang);
    match std::fs::read_to_string(&path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            write_atomic(&path, embedded.as_bytes())?;
            Ok(embedded.to_string())
        }
        Err(source) => Err(OculpmError::Io { path, source }),
    }
}

/// `.oculpm/agents/discussion-spec.md` 를 임베디드 내용으로 수렴시킨다.
/// `_template.md` 와 달리 사용자 편집을 보존하지 않는 **앱 관리 파일**이다 —
/// 마스터 §5 가 "필요할 때 읽으라" 고 가리키는 규격서라 항상 최신이어야 한다.
fn ensure_discussion_spec(root: &Path, lang: &str) -> Result<(), OculpmError> {
    let path = root
        .join(".oculpm")
        .join("agents")
        .join("discussion-spec.md");
    let embedded = embedded_discussion_spec(lang);
    match std::fs::read(&path) {
        Ok(cur) if cur == embedded.as_bytes() => Ok(()),
        _ => write_atomic(&path, embedded.as_bytes()),
    }
}

// ─── master template versioning (upgrade existing projects) ──────────────────

/// An available master-template upgrade for a project.
#[derive(Debug, Clone, Copy, serde::Serialize, specta::Type)]
pub struct MasterUpgrade {
    pub from_version: u32,
    pub to_version: u32,
}

/// Parse `<!-- template_version: N -->`. Templates without the marker (the
/// original v1, shipped before versioning) resolve to `1`.
pub fn template_version(master: &str) -> u32 {
    for line in master.lines().take(8) {
        if let Some(rest) = line.trim().strip_prefix("<!-- template_version:") {
            if let Some(num) = rest.trim_end_matches("-->").split_whitespace().next() {
                if let Ok(v) = num.parse::<u32>() {
                    return v;
                }
            }
        }
    }
    1
}

/// Version of the master template embedded in this binary.
pub fn embedded_template_version() -> u32 {
    template_version(MASTER_KO)
}

/// `Some((on_disk, embedded))` when the project's on-disk master is older than
/// the embedded one. `None` when up-to-date, or when no master exists on disk
/// (init seeds the latest, so there's nothing to upgrade).
pub fn master_upgrade_available(root: &Path) -> Option<MasterUpgrade> {
    let path = root.join(".oculpm").join("agents").join("_template.md");
    let on_disk = std::fs::read_to_string(&path).ok()?;
    let from = template_version(&on_disk);
    let to = embedded_template_version();
    (from < to).then_some(MasterUpgrade {
        from_version: from,
        to_version: to,
    })
}

/// `Some((on_disk, known))` when the project's master template is **newer**
/// than this app version knows — the mirror image of [`master_upgrade_available`].
///
/// 이 방향은 여태 조용히 무시됐다: `master_upgrade_available` 이 `from < to`
/// 일 때만 무엇을 돌려주므로, 새 ocul-pm 이 쓴 템플릿을 옛 앱이 열면 아무
/// 말도 없이 **모르는 규칙을 못 지킨 채** 동기화한다. 「선언됐지만 아직
/// 이행하지 않음」(Phase 6 #not-honored-notice)이 가리키는 자리다.
///
/// 고치지는 않는다 — 앱을 업데이트하는 것 말고 할 수 있는 일이 없다. 대신
/// 말한다.
pub fn master_ahead_of_app(root: &Path) -> Option<MasterUpgrade> {
    let path = root.join(".oculpm").join("agents").join("_template.md");
    let on_disk = std::fs::read_to_string(&path).ok()?;
    let from = template_version(&on_disk);
    let to = embedded_template_version();
    (from > to).then_some(MasterUpgrade {
        from_version: from,
        to_version: to,
    })
}

/// Replace the on-disk master with the embedded one, backing up the previous
/// master to `_template.md.bak` first (user customizations stay recoverable).
/// The caller re-syncs adapters afterward so AGENTS.md etc. re-render.
pub fn upgrade_master(root: &Path) -> Result<(), OculpmError> {
    let dir = root.join(".oculpm").join("agents");
    let path = dir.join("_template.md");
    if let Ok(old) = std::fs::read_to_string(&path) {
        let _ = write_atomic(&dir.join("_template.md.bak"), old.as_bytes());
    }
    let lang_cfg = OculpmConfig::load(&root.join(".oculpm").join("config.toml"))
        .map(|c| c.agents.template_language)
        .unwrap_or_else(|_| "ko".to_string());
    let lang = lang_cfg.as_str();
    ensure_discussion_spec(root, lang)?;
    write_atomic(&path, embedded_master(lang).as_bytes())
}

fn read_per_agent_override(per_agent_dir: &Path, id: &str) -> Option<String> {
    let path = per_agent_dir.join(format!("{id}.md"));
    std::fs::read_to_string(path).ok()
}

// ─── detect ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DetectConfidence {
    /// The adapter path itself exists — either we wrote it before, or a user
    /// (or another tool) is already aware of the adapter.
    Present,
    /// An adjacent marker (`.cursor/`, `.claude/`, `.agent/`, `.gemini/`)
    /// exists but the adapter path doesn't — the user clearly uses this LLM
    /// even if our adapter isn't installed yet.
    Likely,
    /// No signal at all.
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AgentDetection {
    pub agent_id: String,
    pub confidence: DetectConfidence,
    pub adapter_path_exists: bool,
    pub adjacent_marker_exists: bool,
}

/// Heuristically detect which adapters are likely to be useful for this
/// project. Read-only — touches no files. Used by Settings (PR7) and the
/// Greenfield wizard (W3-PR10) to pre-populate `config.agents.active`.
pub fn detect(root: &Path) -> Vec<AgentDetection> {
    known_adapters()
        .iter()
        .map(|adapter| {
            let adapter_path_exists = root.join(adapter.adapter_path).exists();
            let adjacent_marker_exists = adjacent_marker_for(adapter.id, root);
            let confidence = if adapter_path_exists {
                DetectConfidence::Present
            } else if adjacent_marker_exists {
                DetectConfidence::Likely
            } else {
                DetectConfidence::Unknown
            };
            AgentDetection {
                agent_id: adapter.id.to_string(),
                confidence,
                adapter_path_exists,
                adjacent_marker_exists,
            }
        })
        .collect()
}

fn adjacent_marker_for(adapter_id: &str, root: &Path) -> bool {
    let candidates: &[&str] = match adapter_id {
        // agents-md is universal — any AI-tool footprint counts as a hint that
        // the project would benefit from it. AGENTS.md itself isn't here because
        // adapter_path_exists handles it directly.
        "agents-md" => &[
            ".claude",
            ".cursor",
            ".agent",
            ".gemini",
            "GEMINI.md",
            "CLAUDE.md",
            ".windsurf",
            ".clinerules",
            ".aider",
            ".zed",
        ],
        "cursor" => &[".cursor"],
        "claude-code" => &[".claude"],
        "antigravity" => &[".agent"],
        "gemini-cli" => &[".gemini", "GEMINI.md"],
        // v2 U4 — 확대분.
        "windsurf" => &[".windsurf", ".windsurfrules"],
        "aider" => &[".aider", ".aider.conf.yml"],
        "cline" => &[".clinerules"],
        "zed" => &[".zed"],
        // copilot 은 신뢰할 인접 마커가 없다 (.github 은 모든 저장소에 있음) —
        // adapter_path 존재 여부로만 판단.
        _ => &[],
    };
    candidates.iter().any(|c| root.join(c).exists())
}

// ─── helpers exposed for tests ───────────────────────────────────────────────

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
