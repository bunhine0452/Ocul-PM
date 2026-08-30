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

#![allow(dead_code)] // Consumed by manager / commands / watcher in this PR
                     // and by PR4 (drift) / PR5 (compare) / PR7 (settings).

use std::path::{Path, PathBuf};

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
        let abs = root.join(adapter.adapter_path);
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
    AgentSyncResult {
        id: id.to_string(),
        action: "error".to_string(),
        error: Some(e.to_string()),
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

pub fn _absolute_for_test(root: &Path, adapter_id: &str) -> Option<PathBuf> {
    known_adapters()
        .iter()
        .find(|a| a.id == adapter_id)
        .map(|a| root.join(a.adapter_path))
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::spec::AgentsConfig;
    use tempfile::TempDir;

    fn config_with(active: &[&str]) -> OculpmConfig {
        let mut cfg = OculpmConfig::default_for_new_project();
        cfg.agents = AgentsConfig {
            active: active.iter().map(|s| s.to_string()).collect(),
            auto_reconcile: false,
            auto_journal_draft: false,
            rules_translate: vec![],
            template_language: "ko".into(),
        };
        cfg
    }

    fn setup() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        // Ensure .oculpm/ exists so ensure_master_template can write into it.
        std::fs::create_dir_all(dir.path().join(".oculpm").join("agents")).unwrap();
        dir
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    /// v2 U4 — 어댑터 테이블 계약: id/경로 유일, 신규 5종 존재, 모든 id 가
    /// config 검증(KNOWN_AGENT_IDS)에 수용됨.
    #[test]
    fn adapter_table_covers_v2_agents() {
        let adapters = known_adapters();
        let ids: Vec<&str> = adapters.iter().map(|a| a.id).collect();
        let unique_ids: std::collections::HashSet<&&str> = ids.iter().collect();
        assert_eq!(unique_ids.len(), ids.len(), "adapter ids must be unique");
        let paths: std::collections::HashSet<&str> =
            adapters.iter().map(|a| a.adapter_path).collect();
        assert_eq!(paths.len(), adapters.len(), "adapter paths must be unique");
        for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
            assert!(ids.contains(&id), "missing v2 adapter {id}");
        }
        for a in adapters {
            assert!(
                crate::oculpm::config::KNOWN_AGENT_IDS.contains(&a.id),
                "{} must be accepted by config validation",
                a.id
            );
        }
    }

    /// v2 U4 — 신규 어댑터 sync 왕복: 활성 시 파일/블록 생성, 비활성 시 제거,
    /// 2회 호출 멱등(unchanged).
    #[tokio::test]
    async fn v2_adapters_sync_roundtrip() {
        let dir = setup();
        let root = dir.path();
        let cfg = config_with(&["windsurf", "copilot", "aider", "cline", "zed"]);

        let first = sync_active(root, &cfg).await.unwrap();
        for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
            let r = first.results.iter().find(|r| r.id == id).unwrap();
            assert_eq!(r.action, "inserted", "{id} first sync must insert");
        }
        // Overwrite 모드는 파일 자체, ManagedBlock 은 marker 를 포함해야 한다.
        assert!(root.join(".windsurf/rules/ocul-pm.md").exists());
        assert!(root.join(".clinerules/ocul-pm.md").exists());
        assert!(read(&root.join(".github/copilot-instructions.md")).contains("oculpm:begin"));
        assert!(read(&root.join("CONVENTIONS.md")).contains("agent.id 는 `aider`"));
        assert!(read(&root.join(".rules")).contains("agent.id 는 `zed`"));

        let second = sync_active(root, &cfg).await.unwrap();
        for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
            let r = second.results.iter().find(|r| r.id == id).unwrap();
            assert_eq!(r.action, "unchanged", "{id} second sync must be idempotent");
        }

        // 비활성화 → Overwrite 파일 삭제 / ManagedBlock 블록 제거.
        let off = config_with(&[]);
        sync_active(root, &off).await.unwrap();
        assert!(!root.join(".windsurf/rules/ocul-pm.md").exists());
        assert!(!read(&root.join(".github/copilot-instructions.md")).contains("oculpm:begin"));
    }

    /// PR-PLN 2 — the Planner update protocol lives in the master so every
    /// agent inherits it via `AGENTS.md`. Guard against accidental removal.
    #[test]
    fn master_template_carries_planner_rules() {
        assert!(
            MASTER_KO.contains("Planner 갱신"),
            "master must keep the Planner section"
        );
        assert!(
            MASTER_KO.contains("oculpm:plan-log"),
            "master must document the plan-log managed block"
        );
        assert!(
            MASTER_KO.contains(".oculpm/planner/"),
            "master must point at the planner tree"
        );
    }

    /// PR-DISC 5 → TK1(v6): Discussion 프로토콜 전문은 on-demand 규격서
    /// (`discussion-spec.md`)로 이동했다 — 마스터는 트리거+포인터만 상시
    /// 유지하고, 규격서가 managed block 문법을 계속 보유해야 한다.
    #[test]
    fn master_template_carries_discussion_rules() {
        assert!(
            MASTER_KO.contains("문제 해결 문서"),
            "master must keep the Discussion trigger section"
        );
        assert!(
            MASTER_KO.contains(".oculpm/discussion/"),
            "master must point at the discussion tree"
        );
        for (name, spec) in [("ko", DISCUSSION_SPEC_KO), ("en", DISCUSSION_SPEC_EN)] {
            assert!(
                spec.contains("oculpm:discussion-log"),
                "{name} spec must document the discussion-log managed block"
            );
            assert!(
                spec.contains("oculpm_discussion: v1"),
                "{name} spec frontmatter"
            );
        }
        assert!(
            embedded_template_version() >= 6,
            "template_version must be bumped to 6 for the split spec"
        );
    }

    /// An `@path` import inside an adapter file resolves **relative to the file
    /// that contains it**, not to the project root — that is what the Claude
    /// Code memory docs specify. So an adapter written into a subdirectory must
    /// import `@../AGENTS.md`; a bare `@AGENTS.md` there points at e.g.
    /// `.claude/AGENTS.md`, which does not exist, and the import silently
    /// expands to nothing.
    ///
    /// That was the live bug (found 2026-07-30): `.claude/CLAUDE.md` shipped a
    /// bare `@AGENTS.md`, so Claude Code received only the ~565-byte stub and
    /// never the rules. It fails in the worst possible direction — silently,
    /// with the agent simply not knowing journals exist.
    #[test]
    fn adapter_agents_imports_resolve_to_the_root_agents_md() {
        for adapter in known_adapters() {
            let ctx = AgentContext {
                master_template: MASTER_KO.to_string(),
                per_agent_override: None,
            };
            let rendered = (adapter.render)(&ctx);
            let dir = Path::new(adapter.adapter_path)
                .parent()
                .unwrap_or(Path::new(""));
            let depth = dir.components().count();
            let expected = if depth == 0 {
                "AGENTS.md".to_string()
            } else {
                format!("{}AGENTS.md", "../".repeat(depth))
            };

            for line in rendered.lines() {
                let Some(import) = line.trim().strip_prefix('@') else {
                    continue;
                };
                if !import.ends_with("AGENTS.md") {
                    continue;
                }
                assert_eq!(
                    import, expected,
                    "adapter '{}' at '{}' imports '{import}' — from that directory it must be \
                     '{expected}' to reach the root AGENTS.md",
                    adapter.id, adapter.adapter_path
                );
            }
        }
    }

    /// TK1 — 템플릿 다이어트 회귀 가드. v5 는 8,031 chars(≈2,900 tok)가 전
    /// 추적 프로젝트의 전 세션에 상시 주입됐다 — 다시 자라면 그 비용이
    /// 그대로 돌아온다. 언어 변형은 버전·핵심 포인터가 항상 패리티여야 한다.
    ///
    /// 상한 이력 — 이 숫자는 **예산**이지 물리 한계가 아니다. 올릴 때는 무엇을
    /// 샀는지 여기 적는다 (조용히 올리면 가드가 무의미해진다):
    /// - v9 (2026-08-21): en 5,200 → 5,800. §0 "시작 전 과거를 먼저 찾는다"
    ///   (`journal_search`/`journal_read` 안내)를 샀다. 도구만 있고 규칙이
    ///   없으면 에이전트가 부르지 않아, 읽기 도구 추가의 절반은 이 문단이다.
    ///   ko 는 상한 그대로 두고도 들어갔다 (같은 내용에 영어가 문자를 더 쓴다).
    #[test]
    fn master_templates_stay_lean_and_in_parity() {
        let ko = MASTER_KO.chars().count();
        let en = MASTER_EN.chars().count();
        assert!(
            ko <= 4_800,
            "ko 마스터 {ko} chars — 토큰 다이어트 회귀 (상한 4,800)"
        );
        assert!(en <= 5_800, "en 마스터 {en} chars — 상한 5,800");
        assert_eq!(
            template_version(MASTER_KO),
            template_version(MASTER_EN),
            "ko/en 템플릿 버전은 항상 함께 bump"
        );
        for (name, t) in [("ko", MASTER_KO), ("en", MASTER_EN)] {
            assert!(t.contains("plan_create"), "{name}: MCP 쓰기 도구 안내 누락");
            assert!(
                t.contains("discussion-spec.md"),
                "{name}: §5 on-demand 포인터 누락"
            );
            // 읽기 도구는 "있다" 로 부족하고 **언제 부르는지** 가 있어야 실제로
            // 불린다 — §0 이 그 자리다.
            assert!(
                t.contains("journal_search"),
                "{name}: §0 과거 검색 안내 누락"
            );
            assert!(t.contains("journal_read"), "{name}: journal_read 안내 누락");
        }
        // wrapper 는 import 금지 — @import 를 확장하는 런타임에서 마스터가
        // 2중 주입되던 위험(v5)의 재발 방지.
        assert!(
            !CLAUDE_CODE_TPL.contains("@../AGENTS.md"),
            "claude wrapper 에 import 금지"
        );
        assert!(
            !CLAUDE_CODE_TPL.contains("@AGENTS.md"),
            "claude wrapper 에 import 금지"
        );
    }

    /// TK1 — 언어 변형 시드 + discussion-spec 은 앱 관리 파일(손상 시 다음
    /// sync 가 복원).
    #[tokio::test]
    async fn sync_seeds_language_variant_and_restores_discussion_spec() {
        let dir = setup();
        let root = dir.path();
        let mut cfg = config_with(&["agents-md"]);
        cfg.agents.template_language = "en".into();
        sync_active(root, &cfg).await.unwrap();

        let master = read(&root.join(".oculpm/agents/_template.md"));
        assert!(
            master.contains("work-journal rules"),
            "en 마스터가 시드돼야 한다"
        );
        let spec_path = root.join(".oculpm/agents/discussion-spec.md");
        assert!(read(&spec_path).contains("Discussion-doc spec"));

        std::fs::write(&spec_path, "깨진 내용").unwrap();
        sync_active(root, &cfg).await.unwrap();
        assert!(
            read(&spec_path).contains("Discussion-doc spec"),
            "관리 파일은 수렴 복원"
        );
    }

    #[test]
    fn template_version_parses_marker_and_defaults_to_one() {
        assert_eq!(template_version("<!-- template_version: 5 -->\n# x"), 5);
        assert_eq!(template_version("# no marker here\nbody"), 1);
        // The shipped master must be bumped past v1 (it carries the §7 + phase work).
        assert!(embedded_template_version() >= 2);
    }

    #[tokio::test]
    async fn master_upgrade_detected_and_applied() {
        let dir = setup();
        let root = dir.path();
        let tpl = root.join(".oculpm").join("agents").join("_template.md");
        // Seed an OLD master (no version marker → v1).
        std::fs::write(&tpl, "<!-- schema_version: 1 -->\n# old rules\n").unwrap();

        let up = master_upgrade_available(root).expect("upgrade available");
        assert_eq!(up.from_version, 1);
        assert_eq!(up.to_version, embedded_template_version());

        upgrade_master(root).expect("upgrade");
        // Up-to-date now + previous master backed up.
        assert!(master_upgrade_available(root).is_none());
        assert!(root
            .join(".oculpm")
            .join("agents")
            .join("_template.md.bak")
            .exists());
        // The on-disk master is now the embedded one (v6 — plan_create first).
        let now = std::fs::read_to_string(&tpl).unwrap();
        assert!(now.contains("plan_create"));
        // Upgrade also (re)seeds the on-demand discussion spec.
        assert!(root.join(".oculpm/agents/discussion-spec.md").exists());
    }

    // ─── sync_active — six matrix cases per PR2 §3 ─────────────────────────

    /// (PR2 §3 #1) active = ["cursor", "claude-code"] → overwrite file +
    /// managed-block insertion. Both adapters report "inserted" the first time.
    #[tokio::test]
    async fn sync_writes_overwrite_and_managed_block() {
        let dir = setup();
        let cfg = config_with(&["cursor", "claude-code"]);
        let report = sync_active(dir.path(), &cfg).await.unwrap();

        let by_id: std::collections::HashMap<_, _> = report
            .results
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect();
        assert_eq!(by_id["cursor"].action, "inserted");
        assert_eq!(by_id["claude-code"].action, "inserted");
        // Inactive adapters land as "unchanged" (no file to remove).
        assert_eq!(by_id["antigravity"].action, "unchanged");
        assert_eq!(by_id["gemini-cli"].action, "unchanged");

        let cursor_path = dir.path().join(".cursor/rules/ocul-pm.mdc");
        assert!(cursor_path.exists());
        let claude_path = dir.path().join(".claude/CLAUDE.md");
        let claude_text = read(&claude_path);
        assert!(claude_text.contains("<!-- oculpm:begin v1 -->"));
        assert!(claude_text.contains("<!-- oculpm:end -->"));
    }

    /// (PR2 §3 #2) Toggle cursor off → overwrite file disappears.
    #[tokio::test]
    async fn sync_remove_overwrite_adapter() {
        let dir = setup();
        let cfg_on = config_with(&["cursor"]);
        sync_active(dir.path(), &cfg_on).await.unwrap();
        assert!(dir.path().join(".cursor/rules/ocul-pm.mdc").exists());

        let cfg_off = config_with(&[]);
        let report = sync_active(dir.path(), &cfg_off).await.unwrap();
        let by_id: std::collections::HashMap<_, _> = report
            .results
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect();
        assert_eq!(by_id["cursor"].action, "removed");
        assert!(!dir.path().join(".cursor/rules/ocul-pm.mdc").exists());
    }

    /// (PR2 §3 #3) Pre-existing CLAUDE.md with user content → managed block
    /// is inserted/updated WITHOUT mutating any byte outside the markers.
    #[tokio::test]
    async fn sync_managed_block_preserves_user_content_byte_perfect() {
        let dir = setup();
        let claude_path = dir.path().join(".claude/CLAUDE.md");
        std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
        let user_header =
            "# My Project Conventions\n\n- prefer rg over grep\n- no emojis in commits\n";
        let user_footer = "\n## After ocul-pm\n\n- nothing yet\n";
        std::fs::write(&claude_path, format!("{user_header}{user_footer}")).unwrap();

        let cfg = config_with(&["claude-code"]);
        sync_active(dir.path(), &cfg).await.unwrap();

        let text = read(&claude_path);
        assert!(text.contains(user_header), "user header lost: {text:?}");
        assert!(
            text.contains(user_footer.trim()),
            "user footer lost: {text:?}"
        );
        assert!(text.contains("<!-- oculpm:begin v1 -->"));
        assert!(text.contains("<!-- oculpm:end -->"));
    }

    /// (PR2 §3 #4) Edit master → next sync propagates to every active
    /// adapter. Rendered output of an Overwrite adapter changes when the
    /// per-agent override is replaced (acts as proxy for master changes
    /// since the in-binary tpl is the same; the override path exercises
    /// the same code path used by master edits when PR4 makes render
    /// pull from the master).
    #[tokio::test]
    async fn sync_per_agent_override_propagates_to_active_adapter() {
        let dir = setup();
        let cfg = config_with(&["cursor"]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let before = read(&dir.path().join(".cursor/rules/ocul-pm.mdc"));

        // Override the cursor adapter content via per-agent file.
        let per_agent_path = dir.path().join(".oculpm/agents/per-agent/cursor.md");
        std::fs::create_dir_all(per_agent_path.parent().unwrap()).unwrap();
        std::fs::write(&per_agent_path, "OVERRIDDEN cursor adapter\n").unwrap();
        let report = sync_active(dir.path(), &cfg).await.unwrap();

        let cursor_result = report.results.iter().find(|r| r.id == "cursor").unwrap();
        assert_eq!(cursor_result.action, "updated");
        let after = read(&dir.path().join(".cursor/rules/ocul-pm.mdc"));
        assert_ne!(before, after);
        assert!(after.contains("OVERRIDDEN cursor adapter"));
    }

    /// (PR2 §3 #5) Idempotency: same inputs twice → second call reports
    /// every active adapter as "unchanged" and file mtimes don't move.
    #[tokio::test]
    async fn sync_is_idempotent_on_unchanged_inputs() {
        let dir = setup();
        let cfg = config_with(&["cursor", "claude-code"]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let cursor_mtime_1 = std::fs::metadata(dir.path().join(".cursor/rules/ocul-pm.mdc"))
            .unwrap()
            .modified()
            .unwrap();
        let claude_mtime_1 = std::fs::metadata(dir.path().join(".claude/CLAUDE.md"))
            .unwrap()
            .modified()
            .unwrap();

        let report = sync_active(dir.path(), &cfg).await.unwrap();
        let by_id: std::collections::HashMap<_, _> = report
            .results
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect();
        assert_eq!(by_id["cursor"].action, "unchanged");
        assert_eq!(by_id["claude-code"].action, "unchanged");

        let cursor_mtime_2 = std::fs::metadata(dir.path().join(".cursor/rules/ocul-pm.mdc"))
            .unwrap()
            .modified()
            .unwrap();
        let claude_mtime_2 = std::fs::metadata(dir.path().join(".claude/CLAUDE.md"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(
            cursor_mtime_1, cursor_mtime_2,
            "cursor file rewritten on no-op sync"
        );
        assert_eq!(
            claude_mtime_1, claude_mtime_2,
            "claude file rewritten on no-op sync"
        );
    }

    /// (PR2 §3 #6) First sync writes the master template to
    /// `.oculpm/agents/_template.md`. User-editable from then on.
    #[tokio::test]
    async fn sync_writes_master_template_on_first_run_only() {
        let dir = setup();
        let cfg = config_with(&[]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let master_path = dir.path().join(".oculpm/agents/_template.md");
        assert!(master_path.exists());

        // User edits the master.
        std::fs::write(&master_path, "USER EDITED MASTER\n").unwrap();

        // Next sync must NOT overwrite the user edit.
        sync_active(dir.path(), &cfg).await.unwrap();
        let after = read(&master_path);
        assert_eq!(after, "USER EDITED MASTER\n");
    }

    // ─── managed_block_write specifics (4 cases per PR2 §3) ────────────────

    /// (PR2 §3 managed #1) Brand-new CLAUDE.md → block inserted, only
    /// adapter content present.
    #[tokio::test]
    async fn managed_block_inserts_when_file_absent() {
        let dir = setup();
        let cfg = config_with(&["claude-code"]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let claude_path = dir.path().join(".claude/CLAUDE.md");
        let text = read(&claude_path);
        let begin = text.find("<!-- oculpm:begin v1 -->").unwrap();
        let end = text.find("<!-- oculpm:end -->").unwrap();
        assert!(begin < end);
    }

    /// (PR2 §3 managed #2) Orphan marker → sync surfaces the error per
    /// adapter rather than corrupting the file.
    #[tokio::test]
    async fn managed_block_orphan_marker_surfaces_as_error_result() {
        let dir = setup();
        let claude_path = dir.path().join(".claude/CLAUDE.md");
        std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
        std::fs::write(&claude_path, "<!-- oculpm:begin v1 -->\n stuck \n").unwrap();

        let cfg = config_with(&["claude-code"]);
        let report = sync_active(dir.path(), &cfg).await.unwrap();
        let claude = report
            .results
            .iter()
            .find(|r| r.id == "claude-code")
            .unwrap();
        assert_eq!(claude.action, "error");
        assert!(claude
            .error
            .as_ref()
            .unwrap()
            .to_lowercase()
            .contains("managed"));
    }

    /// (PR2 §3 managed #3) Both markers present with identical content →
    /// no rewrite, action = "unchanged".
    #[tokio::test]
    async fn managed_block_unchanged_when_content_matches() {
        let dir = setup();
        let cfg = config_with(&["claude-code"]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let report = sync_active(dir.path(), &cfg).await.unwrap();
        let claude = report
            .results
            .iter()
            .find(|r| r.id == "claude-code")
            .unwrap();
        assert_eq!(claude.action, "unchanged");
    }

    /// (PR2 §3 managed #4) CRLF source file → managed block uses CRLF EOLs.
    /// Re-asserts the atomic_io invariant on the adapter wiring.
    #[tokio::test]
    async fn managed_block_preserves_crlf_eol_from_source() {
        let dir = setup();
        let claude_path = dir.path().join(".claude/CLAUDE.md");
        std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
        std::fs::write(&claude_path, "user line 1\r\nuser line 2\r\n").unwrap();

        let cfg = config_with(&["claude-code"]);
        sync_active(dir.path(), &cfg).await.unwrap();
        let text = read(&claude_path);
        // At least one CRLF must be present in the managed block region
        // (find the begin marker and assert CRLF follows somewhere after).
        let begin_idx = text.find("<!-- oculpm:begin v1 -->").unwrap();
        let end_idx = text.find("<!-- oculpm:end -->").unwrap();
        let block_slice = &text[begin_idx..end_idx];
        assert!(
            block_slice.contains("\r\n"),
            "EOL not preserved: {block_slice:?}"
        );
    }

    // ─── detect — three cases per PR2 §3 ───────────────────────────────────

    /// (PR2 §3 detect #1) `.cursor/` exists without `.mdc` → Likely.
    #[test]
    fn detect_cursor_likely_when_only_directory_present() {
        let dir = setup();
        std::fs::create_dir_all(dir.path().join(".cursor")).unwrap();
        let result = detect(dir.path());
        let cursor = result.iter().find(|d| d.agent_id == "cursor").unwrap();
        assert_eq!(cursor.confidence, DetectConfidence::Likely);
        assert!(cursor.adjacent_marker_exists);
        assert!(!cursor.adapter_path_exists);
    }

    /// (PR2 §3 detect #2) `.claude/CLAUDE.md` exists → Present.
    #[test]
    fn detect_claude_present_when_adapter_path_exists() {
        let dir = setup();
        let path = dir.path().join(".claude/CLAUDE.md");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "anything").unwrap();
        let result = detect(dir.path());
        let claude = result.iter().find(|d| d.agent_id == "claude-code").unwrap();
        assert_eq!(claude.confidence, DetectConfidence::Present);
        assert!(claude.adapter_path_exists);
    }

    /// (PR2 §3 detect #3) Nothing on disk → Unknown for every adapter.
    #[test]
    fn detect_unknown_when_nothing_on_disk() {
        let dir = setup();
        let result = detect(dir.path());
        assert_eq!(result.len(), known_adapters().len());
        for d in &result {
            assert_eq!(d.confidence, DetectConfidence::Unknown, "{d:?}");
        }
    }
}
