//! Lite-W6 PR0 — regression safety net for the cut phases (PR2 ~ PR5).
//!
//! Each test pins one master-prompt §3 invariant against the integration
//! boundary. The deep semantic coverage already lives in the per-module
//! `#[cfg(test)] mod tests` blocks and in the `oculpm_agents_compare`
//! integration suite — this file's job is narrower: catch a
//! cut PR that accidentally removes or renames a load-bearing public API, or
//! weakens a behaviour the Lite-W6 removal plan relies on.
//!
//! A fail here is almost always actionable as "PR<N> changed the public
//! surface; either restore it or update this test in the same commit and
//! call it out in the PR description."
//!
//! Mapping (master-prompt §3 → this file):
//!   #1  watcher ndjson append-only             → invariant_01_*
//!   #2  emit payload surface                   → invariant_02_*
//!   #3  frontmatter parser fail-soft           → invariant_03_*
//!   #4  .oculpm/index/.lock single-instance    → invariant_04_*
//!   #6  planner CRUD round-trip                → invariant_06_*
//!   #7  project lifecycle                      → invariant_07_*

use chrono::{SecondsFormat, Utc};

use ocul_pm_lib::db::Db;
use ocul_pm_lib::oculpm::frontmatter::parse_frontmatter_and_body;
use ocul_pm_lib::oculpm::index::IndexWriter;
use ocul_pm_lib::oculpm::lock::{LockAcquisition, LockGuard};
use ocul_pm_lib::oculpm::paths::WorkdayResolver;
use ocul_pm_lib::oculpm::spec::{
    FileChangeEvent, FileOp, IntegrityWarning, OculpmIntegrityWarning,
};

// ─── shared helpers ────────────────────────────────────────────────────────

fn resolver() -> WorkdayResolver {
    WorkdayResolver::new("Asia/Seoul", "00:00").expect("WorkdayResolver::new")
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

// (fresh_project 헬퍼는 v1.18.0 고아 goal/subtask 정리에서 소비자를 잃고
//  경고만 내던 잔재 — 완벽 라운드(2026-07-16)에서 제거.)

// ─── #1 — IndexWriter.append_file_change is append-only ────────────────────
//
// Cut risk: PR4 prunes db.rs of changelog query methods and could nick
// IndexWriter call sites. PR3 removes Session UI and may dead-code its
// upstream emitters. This test guarantees a freshly-constructed writer can
// persist 3 events in order and read them back.

#[tokio::test]
async fn invariant_01_index_writer_appends_ndjson_lines() {
    let dir = tempfile::tempdir().unwrap();
    let writer = IndexWriter::new(dir.path().to_path_buf(), resolver());
    let workday = resolver().workday_of(Utc::now());
    writer
        .ensure_workday_dirs(&workday)
        .await
        .expect("ensure_workday_dirs");

    let make_ev = |path: &str| FileChangeEvent {
        ts: now_iso(),
        session_id: format!("{}-001", &workday),
        op: FileOp::Update,
        path: path.to_string(),
        hash_before: None,
        hash_after: None,
        bytes: 0,
    };

    for p in ["src/a.rs", "src/b.rs", "src/c.rs"] {
        writer
            .append_file_change(&make_ev(p))
            .await
            .expect("append_file_change");
    }

    let read = writer
        .read_file_changes(&workday, None)
        .await
        .expect("read_file_changes");
    assert_eq!(
        read.len(),
        3,
        "append_file_change must persist every event in order"
    );
    assert_eq!(read[0].path, "src/a.rs");
    assert_eq!(read[2].path, "src/c.rs");
}

// ─── #2 — emit payload surface remains addressable ─────────────────────────
//
// The watcher/index/session emit call sites
// (watcher.rs:453/464/476/555/684/697, index.rs:416, session.rs:690/708)
// construct payload structs and call `.emit(handle)`. If a Lite-W6 cut
// removes either struct the entire emit pipeline goes dark — and so does
// every Today-screen update derived from it. Compile-time reference is
// enough: a removal would fail this file's build, not just this test.

#[test]
fn invariant_02_event_payload_surface_present() {
    let _ = std::any::type_name::<IntegrityWarning>();
    let _ = std::any::type_name::<OculpmIntegrityWarning>();
}

// ─── #3 — frontmatter parser is fail-soft ──────────────────────────────────
//
// Lite-W6 removes a lot of UI but keeps the journal pipeline. A regression
// in `parse_frontmatter_and_body` would silently break Today's renders.
// Four corner cases cover the documented behaviour matrix.

#[test]
fn invariant_03_frontmatter_parser_fail_soft() {
    // A — no fence: body preserved verbatim, no warnings.
    let (pf, body) = parse_frontmatter_and_body("just body, no fence");
    assert!(pf.parsed.is_none());
    assert_eq!(body, "just body, no fence");
    assert!(pf.parse_warnings.is_empty());

    // B — opening fence with no closing: input preserved as body, warning emitted.
    let (pf, body) = parse_frontmatter_and_body("---\nkey: value\n(no close)");
    assert!(pf.parsed.is_none());
    assert!(body.starts_with("---"));
    assert!(!pf.parse_warnings.is_empty());

    // C — malformed YAML inside fences: raw_yaml populated, parsed=None.
    let (pf, _body) = parse_frontmatter_and_body("---\n: : : not yaml\n---\nbody\n");
    assert!(pf.parsed.is_none());
    assert!(!pf.raw_yaml.is_empty());
    assert!(!pf.parse_warnings.is_empty());

    // D — well-formed YAML with every required field: parsed Some, body intact.
    //     Raw string keeps the `---` fences at column 0 so the parser's
    //     `split_closing_fence` recognises them.
    let well = r#"---
schema_version: 1
type: chore
slug: x
status: done
created_at: "2026-05-29T10:00:00+09:00"
session_id: "20260529-001"
agent:
  id: manual
language: ko
verified_by_user: false
files_touched: []
related: []
tags: []
---
body
"#;
    let (pf, body) = parse_frontmatter_and_body(well);
    assert!(
        pf.parsed.is_some(),
        "well-formed frontmatter must parse (warnings: {:?})",
        pf.parse_warnings
    );
    assert!(body.contains("body"));
}

// ─── #4 — single-instance lock detects a second acquirer ───────────────────
//
// PR5 moves GitPanel to legacy and rewires BottomDrawer; PR4 prunes db init.
// A stray init-time refactor could remove the lock acquire site or change
// the LockAcquisition enum shape. This test confirms the basic happy/held
// branches still discriminate.

#[tokio::test]
async fn invariant_04_lock_guard_detects_second_acquirer() {
    let dir = tempfile::tempdir().unwrap();
    let lock_path = dir.path().join(".lock");

    let first = LockGuard::acquire(&lock_path)
        .await
        .expect("first acquire");
    assert!(matches!(first, LockAcquisition::Acquired(_)));

    let second = LockGuard::acquire(&lock_path)
        .await
        .expect("second acquire call");
    match second {
        LockAcquisition::Held { .. } => { /* expected — first guard still alive */ }
        // `acquire` 는 양보 정책이다 — 가져오기(`TakeOver`)는 앱이 새로 뜰 때만
        // 쓰는 별도 경로이므로 여기서 나오면 정책이 뒤집힌 것이다.
        LockAcquisition::Acquired(_)
        | LockAcquisition::Recovered { .. }
        | LockAcquisition::TakenOver { .. } => {
            panic!("second LockGuard::acquire must see Held while first lives");
        }
    }
    // `first` drops at scope exit, releasing the lock.
}

// ─── #6 — legacy goal read/create round-trip via Db ────────────────────────
//
// The goals/subtasks tables are legacy (planner-unify moved the live Plan to
// file-based `.oculpm/planner/*.md`), but `create_goal`/`list_goals`/`get_goal`
// /`list_subtasks` are RETAINED — `plan_migrate_goals` (one-time import) and
// greenfield `generate_seed_goals` still use them. This guards they stay
// reachable. The write-side methods (update_goal / delete_goal / *_subtask
// mutators) were orphaned after planner-unify and removed, so they're no
// longer exercised here.

#[tokio::test]
async fn invariant_06_planner_goal_crud_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();
    let project_id = db
        .create_project(
            "planner".into(),
            dir.path().to_string_lossy().into_owned(),
        )
        .await
        .unwrap();

    let g = db
        .create_goal(
            Some(project_id),
            "ship 1.0".into(),
            Some("dogfood".into()),
            1,
            None,
        )
        .await
        .expect("create_goal");
    assert_eq!(g.title, "ship 1.0");

    let listed = db.list_goals(Some(project_id), None).await.unwrap();
    assert!(listed.iter().any(|x| x.id == g.id));

    let got = db.get_goal(g.id).await.unwrap();
    assert_eq!(got.id, g.id);
    assert_eq!(got.project_id, Some(project_id));

    // subtask read path stays reachable (used by plan_migrate_goals).
    let subs = db.list_subtasks(g.id).await.unwrap();
    assert!(subs.is_empty());
}

// ─── #7 — project lifecycle ────────────────────────────────────────────────
//
// PR4/PR5 routinely poke at project tables (changelog ↔ project FK,
// project ↔ workspace key). create / get / rename / list / delete must all
// stay reachable through the public Db surface.

#[tokio::test]
async fn invariant_07_project_lifecycle_complete() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("ocul-pm.db")).await.unwrap();

    let pid = db
        .create_project("orig".into(), "/tmp/p".into())
        .await
        .unwrap();
    let got = db.get_project(pid).await.unwrap();
    assert_eq!(got.name, "orig");
    assert_eq!(got.root_path, "/tmp/p");

    db.rename_project(pid, "renamed".into()).await.unwrap();
    let got = db.get_project(pid).await.unwrap();
    assert_eq!(got.name, "renamed");

    let listed = db.list_projects().await.unwrap();
    assert!(listed.iter().any(|p| p.id == pid));

    db.delete_project(pid).await.unwrap();
    let listed = db.list_projects().await.unwrap();
    assert!(listed.iter().all(|p| p.id != pid));
}

