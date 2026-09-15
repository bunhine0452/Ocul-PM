//! 워처 단위 테스트 — see `docs/major_update/oculpm/W2/PR3-watcher-notify.md` §7.
//! 실제 notify 를 띄우는 통합형(임시 디렉터리 + 150ms 디바운스)과 `classify` 의
//! 순수 술어를 무는 표 테스트가 섞여 있다.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tempfile::TempDir;
use tokio::time::sleep;

use crate::oculpm::a2a::A2aChangeKind;
use crate::oculpm::cache::PathChangeKind;
use crate::oculpm::history;
use crate::oculpm::index::IndexWriter;
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::session::SessionActor;
use crate::oculpm::spec::{FileOp, OculpmConfig, OculpmDataArea, WatcherStateView};

use super::classify::{
    a2a_change_kind, data_area_for_path, is_agent_state_path, is_journal_entry_path,
    is_self_suppressed, resolve_path_change_kind,
};
use super::ProjectWatcher;

/// A2A 원장 세 갈래를 가려내고, **그 밖의 `agents/` 는 건드리지 않는다.**
///
/// 이 분류가 캐스케이드보다 먼저 도는 것이 요점이다 — 순서가 뒤집히면
/// 메시지 한 통마다 모든 어댑터의 AGENTS.md 가 다시 쓰인다.
#[test]
fn a2a_ledger_paths_are_classified_before_the_agents_cascade() {
    assert_eq!(
        a2a_change_kind(".oculpm/agents/live/codex-app.json"),
        Some(A2aChangeKind::Participants)
    );
    assert_eq!(
        a2a_change_kind(".oculpm/agents/inbox/codex-app/2026.json"),
        Some(A2aChangeKind::Message)
    );
    assert_eq!(
        a2a_change_kind(".oculpm/agents/tasks/2026-abc.ndjson"),
        Some(A2aChangeKind::Task)
    );
    // 마스터 템플릿·어댑터는 예전 길(캐스케이드)로 계속 가야 한다.
    assert_eq!(a2a_change_kind(".oculpm/agents/_template.md"), None);
    assert_eq!(a2a_change_kind(".oculpm/journal/x.md"), None);
}

/// Most tests use a 150ms debounce + 350ms wait to keep wall-clock short.
fn fast_config() -> OculpmConfig {
    let mut cfg = OculpmConfig::default_for_new_project();
    cfg.watcher.debounce_ms = 150;
    // Make sure node_modules / .git are in the default ignore set.
    cfg
}

fn today_workday(resolver: &WorkdayResolver) -> String {
    resolver.workday_of(Utc::now())
}

struct Setup {
    dir: TempDir,
    resolver: WorkdayResolver,
    writer: Arc<IndexWriter>,
    actor: SessionActor,
    watcher: ProjectWatcher,
}

async fn setup_with_config(cfg: OculpmConfig) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let writer = Arc::new(IndexWriter::new(dir.path().to_path_buf(), resolver.clone()));
    let actor = SessionActor::spawn(
        1,
        resolver.clone(),
        writer.clone(),
        cfg.session.clone(),
        None,
    );
    let watcher = ProjectWatcher::start(
        1,
        dir.path().to_path_buf(),
        actor.clone(),
        writer.clone(),
        cfg,
        None,
    )
    .await
    .unwrap();

    // Give notify a moment to install the FSEvents subscription on macOS.
    sleep(Duration::from_millis(150)).await;

    Setup {
        dir,
        resolver,
        writer,
        actor,
        watcher,
    }
}

async fn setup() -> Setup {
    setup_with_config(fast_config()).await
}

async fn settle() {
    sleep(Duration::from_millis(450)).await;
}

/// Case 1 — five distinct files modified → five ndjson events emitted.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn five_file_modifications_produce_five_ndjson_events() {
    let s = setup().await;
    for i in 0..5 {
        std::fs::write(
            s.dir.path().join(format!("file_{i}.rs")),
            format!("content-{i}"),
        )
        .unwrap();
    }
    settle().await;
    // Stop the watcher cleanly before reading (drains queued events).
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let paths: std::collections::HashSet<_> = events.iter().map(|e| e.path.as_str()).collect();
    for i in 0..5 {
        assert!(
            paths.contains(format!("file_{i}.rs").as_str()),
            "missing file_{i}.rs in {paths:?}"
        );
    }
}

/// Case 2 — node_modules is gitignored by default; events there must not
/// produce ndjson rows.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gitignored_paths_are_ignored() {
    // We need a project .gitignore that excludes node_modules. Build the
    // config first so respect_gitignore=true picks it up at watcher start.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();
    std::fs::create_dir_all(dir.path().join("node_modules")).unwrap();

    let resolver = WorkdayResolver::new("UTC", "00:00").unwrap();
    let writer = Arc::new(IndexWriter::new(dir.path().to_path_buf(), resolver.clone()));
    let cfg = fast_config();
    let actor = SessionActor::spawn(
        1,
        resolver.clone(),
        writer.clone(),
        cfg.session.clone(),
        None,
    );
    let watcher = ProjectWatcher::start(
        1,
        dir.path().to_path_buf(),
        actor.clone(),
        writer.clone(),
        cfg,
        None,
    )
    .await
    .unwrap();
    sleep(Duration::from_millis(150)).await;

    std::fs::write(dir.path().join("node_modules/foo.js"), "data").unwrap();
    settle().await;
    watcher.stop().await.unwrap();
    actor.shutdown().await.unwrap();

    let events = writer
        .read_file_changes(&today_workday(&resolver), None)
        .await
        .unwrap();
    let in_node_modules: Vec<_> = events
        .iter()
        .filter(|e| e.path.starts_with("node_modules/"))
        .collect();
    assert!(
        in_node_modules.is_empty(),
        "node_modules events leaked: {in_node_modules:?}"
    );
}

/// Case 3 — `.env` is in `forbid_journal_for_paths` by default; the path
/// is masked + hash fields are nulled.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forbidden_paths_are_masked() {
    let mut cfg = fast_config();
    cfg.git.forbid_journal_for_paths = vec![".env".into(), ".env.*".into()];
    let s = setup_with_config(cfg).await;
    std::fs::write(s.dir.path().join(".env"), "API_KEY=secret").unwrap();
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let env_event = events
        .iter()
        .find(|e| e.path.starts_with("**redacted/sensitive**:"))
        .expect("a redacted entry must exist for .env");
    assert!(env_event.hash_after.is_none(), "hash must be nulled");
    // No raw `.env` should appear.
    assert!(events.iter().all(|e| e.path != ".env"));
}

/// Case 4 — five rapid writes to the same file → debouncer collapses to
/// one ndjson event (path appears once).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rapid_writes_to_same_file_debounced_to_one() {
    // 창을 넉넉히 잡는다 (2026-09-02). 쓰기 다섯이 100ms 에 걸쳐 있는데
    // 기본 창이 150ms 면 여유가 50ms 뿐이라, 러너가 한 번 멈칫하는 것만으로
    // 배치가 갈려 이벤트가 둘이 된다 — CI 에서 실제로 났다. 여기서 재는 것은
    // **연속 쓰기가 한 판으로 접히는가**지 스케줄러의 정확도가 아니다.
    let mut cfg = fast_config();
    cfg.watcher.debounce_ms = 400;
    let s = setup_with_config(cfg).await;
    let target = s.dir.path().join("hot.rs");
    for i in 0..5 {
        std::fs::write(&target, format!("v{i}")).unwrap();
        sleep(Duration::from_millis(20)).await;
    }
    // 창(400ms)보다 확실히 길게 — `settle()` 은 기본 창 기준이다.
    sleep(Duration::from_millis(1_000)).await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let hot: Vec<_> = events.iter().filter(|e| e.path == "hot.rs").collect();
    assert_eq!(hot.len(), 1, "expected debouncer to coalesce; got {hot:?}");
}

/// Case 5 — the session actor's own writes to `.oculpm/index/` must not
/// boomerang back into ndjson via the watcher. After a single user-file
/// write we expect exactly one event for that file (no `.oculpm/`-derived
/// extras).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn self_writes_are_suppressed() {
    let s = setup().await;
    std::fs::write(s.dir.path().join("user.rs"), "content").unwrap();
    settle().await;
    // Let any spurious .oculpm/ events have a second chance.
    sleep(Duration::from_millis(300)).await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    // No event should reference a .oculpm/ path — the watcher must have
    // self-suppressed our own ndjson + sessions.json writes.
    for ev in &events {
        assert!(
            !ev.path.starts_with(".oculpm/"),
            "self-write leaked: {}",
            ev.path
        );
    }
    assert!(
        events.iter().any(|e| e.path == "user.rs"),
        "user.rs event must be present"
    );
}

/// Case 6 — a 9 MB file exceeds `HASH_BYTE_CAP` (8 MB) so `hash_after`
/// stays `None`; `bytes` still reflects the size.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn large_files_skip_hashing() {
    let s = setup().await;
    let payload = vec![0u8; 9 * 1024 * 1024];
    std::fs::write(s.dir.path().join("big.bin"), &payload).unwrap();
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let big = events
        .iter()
        .find(|e| e.path == "big.bin")
        .expect("big.bin event must exist");
    assert!(big.hash_after.is_none(), "large file must skip hashing");
    assert!(big.bytes >= 9 * 1024 * 1024, "bytes must reflect size");
}

/// Bonus — `status()` reflects running state + accumulated counters.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_reports_running_with_counters() {
    let s = setup().await;
    std::fs::write(s.dir.path().join("a.rs"), "data").unwrap();
    settle().await;
    let st = s.watcher.status();
    assert!(matches!(st.state, WatcherStateView::Running));
    assert!(st.events_seen_total >= 1);
    assert!(st.last_event_at.is_some());

    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();
}

// ─── W2-PR5 — Tauri event emit paths ───────────────────────────────────

/// PR5 test 1 — `.oculpm/agents/_template.md` change triggers the
/// agents_template_changed emit path (no panic with `app_handle: None`,
/// not routed to session ndjson).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn agents_template_change_emits_without_panic() {
    let s = setup().await;
    std::fs::create_dir_all(s.dir.path().join(".oculpm/agents")).unwrap();
    std::fs::write(
        s.dir.path().join(".oculpm/agents/_template.md"),
        "# template\n",
    )
    .unwrap();
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    // agents/ changes must NOT appear in ndjson.
    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let agents_events: Vec<_> = events
        .iter()
        .filter(|e| e.path.contains("agents"))
        .collect();
    assert!(
        agents_events.is_empty(),
        "agents/ events must be emit-only, not in ndjson: {agents_events:?}"
    );
}

/// PR5 test 2 — `.oculpm/journal/<workday>/Bugs/foo.md` change triggers
/// the journal_path_changed emit path (no panic, not routed to ndjson).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn journal_change_emits_without_panic() {
    let s = setup().await;
    let journal_dir = s.dir.path().join(".oculpm/journal/20260523/Bugs");
    std::fs::create_dir_all(&journal_dir).unwrap();
    std::fs::write(journal_dir.join("foo.md"), "# Bug report\n").unwrap();
    settle().await;
    s.watcher.stop().await.unwrap();
    s.actor.shutdown().await.unwrap();

    let events = s
        .writer
        .read_file_changes(&today_workday(&s.resolver), None)
        .await
        .unwrap();
    let journal_events: Vec<_> = events
        .iter()
        .filter(|e| e.path.contains("journal"))
        .collect();
    assert!(
        journal_events.is_empty(),
        "journal/ events must be emit-only, not in ndjson: {journal_events:?}"
    );
}

// ─── F-2 fix — kind resolution + path filtering ────────────────────────

#[test]
fn resolve_path_change_kind_uses_filesystem_truth() {
    // The macOS FSEvents quirk: a Modify(Any) on a deleted file must
    // still drop the cache row. Same for Create races and explicit Delete.
    assert_eq!(
        resolve_path_change_kind(FileOp::Delete, false),
        PathChangeKind::Removed
    );
    assert_eq!(
        resolve_path_change_kind(FileOp::Update, false),
        PathChangeKind::Removed,
    );
    assert_eq!(
        resolve_path_change_kind(FileOp::Create, false),
        PathChangeKind::Removed,
    );
    // File exists → Create stays Created, everything else collapses to
    // Modified so the cache re-reads. A "Delete but the file still
    // exists" event (rare race) re-syncs as Modified, which is safe.
    assert_eq!(
        resolve_path_change_kind(FileOp::Create, true),
        PathChangeKind::Created
    );
    assert_eq!(
        resolve_path_change_kind(FileOp::Update, true),
        PathChangeKind::Modified
    );
    assert_eq!(
        resolve_path_change_kind(FileOp::Delete, true),
        PathChangeKind::Modified,
    );
}

/// W4 dogfooding (2026-05-27) — atomic write tmp filenames and editor
/// noise must never reach the ndjson, regardless of project config. This
/// is what was tanking jaccard from ~3/3 to 3/18 in the LayerComparison
/// modal — `game.js.tmp.5C0aH-rJ` and `.DS_Store` were rotting the index.
#[test]
fn is_self_suppressed_catches_atomic_write_tmps_and_editor_noise() {
    // Originals (already covered).
    assert!(is_self_suppressed(".oculpm/index/foo.ndjson"));
    assert!(is_self_suppressed(".oculpm/.lock"));
    assert!(is_self_suppressed(".oculpm/oculpm.log"));
    assert!(is_self_suppressed("scratch.tmp"));

    // npm `write-file-atomic` / similar — `<dest>.tmp.<rand>`.
    assert!(is_self_suppressed("game.js.tmp.5C0aH-rJ"));
    assert!(is_self_suppressed("src/lib.rs.tmp.abc123"));
    assert!(is_self_suppressed("nested/dir/game.js.tmp.xyz"));

    // Vim swap + backup.
    assert!(is_self_suppressed("src/main.rs.swp"));
    assert!(is_self_suppressed("src/main.rs.swo"));
    assert!(is_self_suppressed("README.md~"));

    // OS metadata.
    assert!(is_self_suppressed(".DS_Store"));
    assert!(is_self_suppressed("nested/.DS_Store"));
    assert!(is_self_suppressed("Thumbs.db"));
    assert!(is_self_suppressed("nested/._foo.txt"));

    // Dogfooding (2026-06-07) — `!`-bearing transient/cache files.
    assert!(is_self_suppressed("!scratch"));
    assert!(is_self_suppressed("cache/data!cadb26c2"));
    assert!(is_self_suppressed("nested/dir/foo.bak!"));

    // Legit files must still pass through.
    assert!(!is_self_suppressed("game.js"));
    assert!(!is_self_suppressed("src/lib.rs"));
    assert!(!is_self_suppressed("docs/architecture.md"));
    // Adapter files live under agent dirs but pass self-suppress (the
    // agent-state filter is a separate gate, applied after the
    // adapter-lookup return).
    assert!(!is_self_suppressed(".claude/CLAUDE.md"));
}

/// W4 dogfooding (2026-05-27) — `.claude/settings.json` and friends
/// were polluting the index because step 4.5 only matched the *exact*
/// adapter path (`.claude/CLAUDE.md`) and let peer files through.
#[test]
fn is_agent_state_path_catches_peer_files_not_adapter_files() {
    // Claude Code peers.
    assert!(is_agent_state_path(".claude/settings.json"));
    assert!(is_agent_state_path(".claude/settings.local.json"));
    assert!(is_agent_state_path(".claude/projects/some-snapshot.json"));
    // Cursor / Gemini / Antigravity peers.
    assert!(is_agent_state_path(".cursor/history.json"));
    assert!(is_agent_state_path(".gemini/cache/foo"));
    assert!(is_agent_state_path(".agent/sessions/abc.json"));
    // The adapter file itself technically matches this prefix, but the
    // watcher returns earlier via `lookup_adapter_by_path` so we never
    // reach this filter for `.claude/CLAUDE.md` — matching it here is
    // safe but unused. Document the prefix match explicitly.
    assert!(is_agent_state_path(".claude/CLAUDE.md"));
    // User code untouched.
    assert!(!is_agent_state_path("src/main.rs"));
    assert!(!is_agent_state_path("game.js"));
    assert!(!is_agent_state_path("AGENTS.md")); // root adapter, not a state dir
}

#[test]
fn local_history_writes_never_re_trigger_the_watcher() {
    // B5 의 저장 위치가 워처 자기 억제 안에 있다는 것이 그 설계의 전제다
    // (`entry_diffs` 와 같은 이유로 `.oculpm/index/` 아래를 골랐다).
    // 여기가 깨지면 캡처가 이벤트를 낳고 그 이벤트가 다시 캡처를 부른다.
    let dir = history::dir_for(Path::new("/p"), "src/main.rs");
    let rel = dir
        .strip_prefix("/p")
        .unwrap()
        .to_string_lossy()
        .to_string();
    assert!(is_self_suppressed(&rel));
    assert!(is_self_suppressed(&format!("{rel}/meta.json")));
}

#[test]
fn is_journal_entry_path_matches_walk_journal_skip_rules() {
    // Real entries — must pass.
    assert!(is_journal_entry_path("20260524/Bugs/0925_bug_a.md"));
    assert!(is_journal_entry_path(
        "20260524/Features_to_add/1000_feature.md"
    ));

    // Skipped by cache::walk_journal — must fail.
    assert!(!is_journal_entry_path("_template.md"));
    assert!(!is_journal_entry_path("20260524/_attachments/note.md"));
    assert!(!is_journal_entry_path("20260524/Bugs/.draft.md"));
    assert!(!is_journal_entry_path("20260524/Bugs/0925_bug_a.txt"));
    assert!(!is_journal_entry_path("20260524/Bugs/"));
}

#[test]
fn data_area_for_path_routes_planner_and_discussion_only() {
    assert_eq!(
        data_area_for_path(".oculpm/planner/post-1.17-round.md"),
        Some(OculpmDataArea::Planner)
    );
    assert_eq!(
        data_area_for_path(".oculpm/discussion/live-refresh/doc.md"),
        Some(OculpmDataArea::Discussion)
    );

    // 일지는 캐시 무효화 경로가 따로 있어 여기로 오면 안 된다.
    assert_eq!(
        data_area_for_path(".oculpm/journal/20260821/Bugs/a.md"),
        None
    );
    // 접두사에 `/` 를 넣은 이유 — 이웃 디렉터리를 삼키지 않는다.
    // 회고 화면 삭제 (2026-09-08) — 데이터 영역이 아니고 `is_agent_state_path` 가 삼킨다.
    assert_eq!(data_area_for_path(".oculpm/retro/w.md"), None);
    assert_eq!(data_area_for_path(".oculpm/planner-backup/old.md"), None);
    assert_eq!(data_area_for_path(".oculpm/discussions.md"), None);
    // 프로젝트 소스에 같은 이름의 디렉터리가 있어도 무관해야 한다.
    assert_eq!(data_area_for_path("src/planner/index.ts"), None);
}
