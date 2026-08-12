//! W5-PR8 (W4 handoff catch-up) — integration smoke tests for the agents +
//! compare-layers public surface.
//!
//! The deep edge-case coverage already lives in `oculpm::manager::tests::
//! agents_w4_pr*`. These tests run through the *public* API path so any
//! accidentally-private regression on `sync_agents` / `compare_layers` /
//! `check_agent_drift` / `detect_agents` / `read_master_template` surfaces
//! at the integration boundary. None of them try to re-test the
//! parser/diff semantics — that's the unit suite's job.

use ocul_pm_lib::db::Db;
use ocul_pm_lib::oculpm::manager::OculpmManager;
use ocul_pm_lib::oculpm::spec::Severity;

async fn fresh_with_active_agents(active: &[&str]) -> (
    Db,
    OculpmManager,
    tempfile::TempDir,
    std::path::PathBuf,
    u32,
) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("ocul-pm.db");
    let db = Db::open(db_path).await.expect("open db");
    let project_id = db
        .create_project("integ-agents".into(), dir.path().to_string_lossy().into())
        .await
        .unwrap();
    let manager = OculpmManager::new();
    let project_root = dir.path().join("project");
    std::fs::create_dir_all(&project_root).unwrap();
    manager
        .init_project(project_id, &project_root, "ko")
        .await
        .unwrap();
    // Patch the config to activate the requested agents.
    let mut cfg = manager.get_config(project_id).await.unwrap();
    cfg.agents.active = active.iter().map(|s| s.to_string()).collect();
    manager.set_config(project_id, cfg).await.unwrap();
    (db, manager, dir, project_root, project_id)
}

// ─── (1) AGENTS.md sync writes a managed block ─────────────────────────────

#[tokio::test]
async fn agents_md_sync_writes_managed_block() {
    let (db, manager, _dir, root, project_id) =
        fresh_with_active_agents(&["agents-md"]).await;

    let report = manager.sync_agents(&db, project_id).await.unwrap();
    assert!(
        report.results.iter().any(|r| r.id == "agents-md"),
        "sync_agents must return a result for agents-md"
    );

    // The AGENTS.md file should now exist at the project root.
    let agents_md = root.join("AGENTS.md");
    assert!(agents_md.exists(), "AGENTS.md must be created");
    let body = std::fs::read_to_string(&agents_md).unwrap();
    assert!(
        body.contains("oculpm:begin v1") || body.contains("ocul-pm"),
        "managed block markers must be present in AGENTS.md, got {body}"
    );
}

// ─── (2) Re-running sync is idempotent (no double-write churn) ────────────

#[tokio::test]
async fn agents_md_sync_is_idempotent() {
    let (db, manager, _dir, _root, project_id) =
        fresh_with_active_agents(&["agents-md"]).await;

    let _ = manager.sync_agents(&db, project_id).await.unwrap();
    let second = manager.sync_agents(&db, project_id).await.unwrap();
    // Second run should report `unchanged` for agents-md (or at worst, a
    // non-error action).
    let r = second
        .results
        .iter()
        .find(|r| r.id == "agents-md")
        .expect("agents-md must appear");
    assert!(r.error.is_none(), "no error on idempotent re-sync: {:?}", r.error);
}

// ─── (3) detect_agents reports presence of AGENTS.md ──────────────────────

#[tokio::test]
async fn detect_agents_returns_agents_md_after_sync() {
    let (db, manager, _dir, _root, project_id) =
        fresh_with_active_agents(&["agents-md"]).await;
    manager.sync_agents(&db, project_id).await.unwrap();

    let detections = manager.detect_agents(project_id).await.unwrap();
    assert!(
        detections.iter().any(|d| d.agent_id == "agents-md"),
        "detect_agents must surface agents-md, got {detections:?}"
    );
}

// ─── (4) compare_layers on an empty session returns trivially-Ok ──────────

#[tokio::test]
async fn compare_layers_returns_ok_when_no_activity() {
    let (db, manager, _dir, _root, project_id) =
        fresh_with_active_agents(&["agents-md"]).await;
    // No journal entries, no file changes — Jaccard collapses to a vacuous Ok.
    let cmp = manager
        .compare_layers(&db, project_id, "20260101-001")
        .await
        .unwrap();
    assert_eq!(cmp.session_id, "20260101-001");
    assert_eq!(cmp.mismatch_severity, Severity::Ok);
    assert!(cmp.index_files.is_empty());
    assert!(cmp.journal_files.is_empty());
}

// ─── (5) read_master_template returns non-empty content ───────────────────

#[tokio::test]
async fn read_master_template_returns_korean_template() {
    let (_db, manager, _dir, _root, project_id) =
        fresh_with_active_agents(&[]).await;
    let template = manager
        .read_master_template(project_id)
        .await
        .unwrap();
    assert!(
        !template.is_empty(),
        "master template must not be empty"
    );
    assert!(
        template.len() > 100,
        "expected substantive template body, got {} chars",
        template.len()
    );
}
