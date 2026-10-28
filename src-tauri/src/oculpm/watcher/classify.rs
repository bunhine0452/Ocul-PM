//! 경로·이벤트 종류를 가르는 순수 술어 — 자기 억제, 에이전트 내부 상태,
//! 데이터 영역(계획·논의·자동화), 규칙 파일, 옛 A2A 원장 자리, 디렉터리 이벤트.
//! I/O 도 상태도 없어 소비자와 `watcher_queue::PreFilter` 가 같은 판정을 나눠 쓴다.

use notify::EventKind;

use crate::oculpm::cache::PathChangeKind;
use crate::oculpm::paths;
use crate::oculpm::spec::{FileOp, OculpmDataArea};

/// Paths the watcher must never report — either our own writes that would
/// boomerang, or universal editor/OS noise that no journal will ever record.
///
/// W4 dogfooding (2026-05-27) — pre-fix, `LayerComparison` flagged things
/// like `game.js.tmp.5C0aH-rJ` (npm `write-file-atomic` random-suffix tmp)
/// and `.DS_Store` as `journal 누락`, tanking jaccard. Real-world atomic
/// writes use `<dest>.tmp.<rand>` or `<dest>.<rand>.tmp`, so an exact
/// `.tmp` ending isn't enough — we also catch `.tmp.` infix.
pub(crate) fn is_self_suppressed(rel_str: &str) -> bool {
    if rel_str.starts_with(".oculpm/index/")
        || rel_str == ".oculpm/.lock"
        || rel_str == ".oculpm/oculpm.log"
    {
        return true;
    }
    // Dogfooding (2026-08-20) — the checks above are root-anchored, so a
    // *nested* `.oculpm/` (a spike fixture, a vendored sample project) walked
    // straight past them into the ndjson and then into 정직성 감사 as
    // `docs/acp-panel/spike/.oculpm/hooks/claude-events.jsonl`. That tree is
    // another project's bookkeeping — never this project's tracked source.
    if paths::is_nested_oculpm_path(rel_str) {
        return true;
    }
    // Atomic-write temp files.
    if rel_str.ends_with(".tmp") || rel_str.contains(".tmp.") {
        return true;
    }
    // macOS sandbox atomic writes — `<name>.sb-<hex>-<rand>`.
    if paths::is_macos_sandbox_temp(rel_str) {
        return true;
    }
    // Vim swap / backup.
    if rel_str.ends_with(".swp") || rel_str.ends_with(".swo") || rel_str.ends_with('~') {
        return true;
    }
    let basename = rel_str.rsplit('/').next().unwrap_or(rel_str);
    // macOS / Windows metadata.
    if basename == ".DS_Store" || basename == "Thumbs.db" || basename.starts_with("._") {
        return true;
    }
    // Dogfooding (2026-06-07) — transient tool/cache files leaked into the 변경
    // diff list. Tools write scratch files whose basename carries a `!`
    // (lockfile/backup conventions, JetBrains `___…`, etc.); these blink in and
    // out and are never journaled. A real source file almost never has `!` in
    // its name, so suppress any basename containing one.
    if basename.contains('!') {
        return true;
    }
    false
}

/// True when the event explicitly describes a *directory* rather than a file.
///
/// Only trusts what notify states outright. Platforms that collapse a folder
/// remove into `RemoveKind::Any` stay ambiguous here — we deliberately do not
/// guess from the path shape, because extension-less source files
/// (`Makefile`, `LICENSE`, `Dockerfile`) are common and wrongly dropping a
/// real deletion is worse than the phantom row this catches.
pub(super) fn is_directory_event(kind: &EventKind) -> bool {
    use notify::event::{CreateKind, RemoveKind};
    matches!(
        kind,
        EventKind::Remove(RemoveKind::Folder) | EventKind::Create(CreateKind::Folder)
    )
}

/// True when `rel_str` lives inside a known LLM-agent state directory but is
/// NOT the adapter file itself (those return earlier via
/// `agents::lookup_adapter_by_path`). The agent dir list is intentionally
/// hard-coded rather than derived from `known_adapters()` because adapters
/// also write peer files outside their declared adapter_path
/// (`.claude/settings.json`, `.cursor/history/*`, `.agent/sessions.json`)
/// — those are agent internal state, not user code.
pub(super) fn is_agent_state_path(rel_str: &str) -> bool {
    paths::AGENT_STATE_DIRS
        .iter()
        .any(|d| rel_str.starts_with(d))
        // Dogfooding (2026-08-20) — monorepos and fixture trees put agent
        // state below the root (`packages/web/.claude/settings.json`); the
        // root-prefix check alone let those through.
        || paths::is_nested_agent_state_path(rel_str)
        // 회고 화면은 갔어도 마크다운은 남는다 — 안 삼키면 감사에 가짜 "누락" 이 뜬다.
        || rel_str.starts_with(".oculpm/retro/")
}

/// Map a notify [`FileOp`] + disk-existence into a [`PathChangeKind`] that
/// the cache layer can act on. We trust the filesystem over the event:
///
/// - **macOS FSEvents** frequently collapses removes into `EventKind::Modify(Any)`
///   (especially when the deleted file's parent dir mutates in the same
///   debounce window). Trusting `op` alone leaves stale cache rows when the
///   user deletes a journal file from Finder.
/// - A race where Create fires for a path that was immediately deleted
///   (`exists == false`) also resolves to `Removed` — the cache delete is
///   idempotent so a no-op is the worst case.
///
/// When the file does exist, `Create` keeps its semantics and everything
/// else (Update / Delete-but-still-there / Rename / Correct) becomes
/// `Modified` so the cache re-reads the new content.
pub(super) fn resolve_path_change_kind(op: FileOp, exists: bool) -> PathChangeKind {
    if !exists {
        return PathChangeKind::Removed;
    }
    match op {
        FileOp::Create => PathChangeKind::Created,
        _ => PathChangeKind::Modified,
    }
}

/// True when `entry_rel` (relative to `.oculpm/journal/`) names a real
/// journal entry — matches the skip rules in `cache::walk_journal` so the
/// watcher never tries to insert `_template.md`, `_attachments/`, or hidden
/// files into the SQLite cache.
pub(super) fn is_journal_entry_path(entry_rel: &str) -> bool {
    if !entry_rel.ends_with(".md") {
        return false;
    }
    if entry_rel.starts_with('_') {
        return false;
    }
    if entry_rel.contains("/_attachments/") {
        return false;
    }
    if entry_rel.split('/').any(|seg| seg.starts_with('.')) {
        return false;
    }
    true
}

/// `.oculpm/` 안에서 "읽을 때 투영" 하는 데이터 영역을 가려낸다.
///
/// 디렉터리 접두사만 보고 판정한다 — 어떤 파일이 실제 계획/논의 문서인지는
/// 투영 단계(`plan_*` / `discussion_*`)가 이미 판단하므로, 워처는 그 트리에
/// 무슨 일이 났다는 사실만 전달하면 된다. 접두사에 `/` 를 포함시켜
/// `.oculpm/planner-backup/` 같은 이웃 디렉터리를 삼키지 않게 한다.
pub(super) fn data_area_for_path(rel_str: &str) -> Option<OculpmDataArea> {
    if rel_str.starts_with(".oculpm/planner/") {
        return Some(OculpmDataArea::Planner);
    }
    // 논의 화면은 4.0 에서 걷었지만 사용자의 `.oculpm/discussion/**` 파일은 디스크에
    // 그대로 남는다 — 그 편집이 코드 변경 파이프라인(ndjson·히스토리)으로 흘러
    // 들어가지 않도록 영역 분류는 둔다. 듣는 화면은 더는 없다.
    if rel_str.starts_with(".oculpm/discussion/") {
        return Some(OculpmDataArea::Discussion);
    }
    None
}

/// 규칙 허브가 그리는 파일들 — `oculpm::rules` 의 표면과 같다.
pub(crate) fn is_rules_path(rel_str: &str) -> bool {
    rel_str.starts_with(".claude/rules/")
        || rel_str.starts_with(".cursor/rules/")
        || matches!(
            rel_str,
            "CLAUDE.md" | ".claude/CLAUDE.md" | "CLAUDE.local.md"
        )
}

pub(super) fn classify_journal_op(kind: &EventKind) -> FileOp {
    match kind {
        EventKind::Create(_) => FileOp::Create,
        EventKind::Remove(_) => FileOp::Delete,
        _ => FileOp::Update,
    }
}

pub(super) fn short_hash_of(input: &str) -> String {
    let full = blake3::hash(input.as_bytes()).to_hex().to_string();
    full[..8].to_string()
}

/// 걷은 기능이 남긴 `.oculpm/` 자리 — 읽는 화면이 없고 코드 변경 파이프라인에도
/// 들어가면 안 된다 (`.md` 하나가 ndjson·히스토리 캡처로 새면 정직성 감사에 가짜
/// 「누락」이 생긴다). 사용자의 파일이라 지우지 않고 **무시만** 한다.
///
/// - `.oculpm/automation/` — 자동화 정의 (4.0 에서 자동화와 함께 걷었다)
/// - `.oculpm/rollups/` — 주간 요약과 그 문지기 락 파일(`.2026-W38.md.lock`)
///   (4.0 에서 롤업과 함께 걷었다)
pub(super) fn is_retired_area(rel_str: &str) -> bool {
    rel_str.starts_with(".oculpm/automation/") || rel_str.starts_with(".oculpm/rollups/")
}

/// 화면이 볼 것이 없지만 **캐스케이드도 타면 안 되는** 경로.
///
/// 지금은 걷어낸 A2A 원장의 옛 자리들이다 (참여자 카드·우편함·태스크·임대·
/// 그룹·감사 로그). 기능은 없어졌지만 업데이트 전의 플러그인 MCP 서버가 아직
/// 여기에 쓸 수 있다 — 하트비트 한 줄마다 모든 어댑터의 AGENTS.md 를 다시
/// 쓰는 증폭 루프가 그 대가라, 캐스케이드보다 **먼저** 걸러 버린다.
pub(super) fn is_agents_noise(rel_str: &str) -> bool {
    const LEGACY_LEDGER: [&str; 6] = ["live/", "inbox/", "tasks/", "leases/", "groups/", "audit/"];
    rel_str
        .strip_prefix(".oculpm/agents/")
        .is_some_and(|rest| LEGACY_LEDGER.iter().any(|dir| rest.starts_with(dir)))
}
