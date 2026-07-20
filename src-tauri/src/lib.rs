mod ast;
mod commands;
// W5-PR8 — `db` and `oculpm` are made public so `src-tauri/tests/`
// integration tests can drive the manager directly with a temp DB. None
// of the other modules are needed at the integration layer.
pub mod db;
mod embedding;
mod error;
// `git::diff_patch` is exercised by the `local_diff` integration suite (PR11).
pub mod git;
mod indexer;
mod llm;
mod notion;
pub mod oculpm;
mod secrets;

use std::path::PathBuf;
use std::sync::OnceLock;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// W4 dogfooding follow-up (2026-05-26) — `oculpm_get_log_dir` returns this so
/// the Settings UI can reveal it in Finder. Set once during `setup_logging`
/// before any project-level code runs. `OnceLock` keeps the read lock-free on
/// the hot path (every "로그 폴더 열기" click).
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Path to the directory containing rotating `oculpm.log.YYYY-MM-DD` files.
/// Returns `None` if logging was initialised stdout-only (test runs).
pub fn log_dir() -> Option<&'static PathBuf> {
    LOG_DIR.get()
}

/// Initialise dual-output tracing: stdout (for `tauri dev`) + daily-rotated
/// file under `<data_dir>/logs/`. Falls back to stdout-only when the data dir
/// can't be created. Idempotent — calling twice silently keeps the first init.
///
/// We init this before `tauri::Builder` so any boot-time errors (db open,
/// plugin registration) also land in the file. Path is captured in `LOG_DIR`
/// so the `oculpm_get_log_dir` command can return it without re-deriving.
fn setup_logging() {
    use tracing_subscriber::{fmt, EnvFilter};

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    // Resolve `<app_data>/logs` via the same `directories` crate Tauri uses
    // underneath app_data_dir(). On macOS this is
    // `~/Library/Application Support/com.kimhyunbin.ai-pm/logs/`.
    let log_dir = directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm")
        .map(|p| p.data_dir().join("logs"));

    let stdout_layer = fmt::layer().with_target(true).with_thread_ids(false);

    match log_dir.as_ref().and_then(|d| {
        std::fs::create_dir_all(d).ok()?;
        Some(d.clone())
    }) {
        Some(dir) => {
            // Daily rotation so the file stays grep-friendly. Non-blocking
            // writer keeps the watcher's hot path off disk-flush latency.
            // v2 U5 — retention 상한 14개(2주): 일별 로그가 무한 누적되던 것을
            // 회전 시점에 오래된 파일부터 정리. 빌더 실패 시 기존 무제한
            // daily 로 폴백(로깅이 앱을 못 죽인다).
            let appender = tracing_appender::rolling::RollingFileAppender::builder()
                .rotation(tracing_appender::rolling::Rotation::DAILY)
                .filename_prefix("oculpm.log")
                .max_log_files(14)
                .build(&dir)
                .unwrap_or_else(|_| tracing_appender::rolling::daily(&dir, "oculpm.log"));
            // Leak the guard intentionally — we want the writer to live for
            // the whole process lifetime. Dropping it would flush + close the
            // file, silently dropping later logs.
            let (non_blocking, guard) = tracing_appender::non_blocking(appender);
            Box::leak(Box::new(guard));

            let file_layer = fmt::layer()
                .with_target(true)
                .with_ansi(false)
                .with_writer(non_blocking);

            let _ = tracing_subscriber::registry()
                .with(env_filter)
                .with(stdout_layer)
                .with(file_layer)
                .try_init();
            let _ = LOG_DIR.set(dir.clone());
            tracing::info!(
                target: "oculpm::boot",
                log_dir = %dir.display(),
                "[FLOW] tracing initialised — stdout + daily-rotated file"
            );
        }
        None => {
            let _ = tracing_subscriber::registry()
                .with(env_filter)
                .with(stdout_layer)
                .try_init();
            tracing::warn!(
                target: "oculpm::boot",
                "[FLOW] tracing file appender unavailable — stdout only"
            );
        }
    }
}

use crate::commands::{
    chat, chat_message_append, chat_message_list, chat_stream, clear_project_index,
    conversation_create, conversation_delete, conversation_list, conversation_rename,
    conversation_set_context,
    // W5 — action proposal apply-state
    record_conversation_action, list_conversation_actions, create_project, delete_project, rename_project, db_health,
    index_project, list_projects, project_stats,
    search_chunks, search_text, search_symbols, secret_delete, secret_has, secret_set, secret_verify, select_project_folder, settings_get,
    settings_set, settings_get_all, settings_set_many, app_info, clear_all_data,
    // Planner Upgrade (PR-PLN 0/1/5) — file-based Plan read + write + AI/migration
    plan_list, plan_get, plan_item_history, plan_create, plan_apply_edit,
    plan_ai_refresh, plan_migrate_goals, plan_recent_updates, plan_set_status,
    plan_rename, plan_delete,
    get_file_symbols, get_code_graph, get_change_impact, get_file_calls,
    open_devtools, open_terminal_window,
    read_project_file, read_file_range,
    // 문서(docs) 뷰어 — docs/ 트리 + 마크다운 읽기 + 이미지 자산
    docs_tree, docs_read, docs_asset,
    // 문제 해결(Discussion) — 읽기(PR-DISC 0) + 쓰기(PR-DISC 1) + 첨부(2) + 승격(4)
    discussion_list, discussion_get,
    discussion_create, discussion_write, discussion_read_raw, discussion_set_status,
    discussion_rename, discussion_delete,
    discussion_attach, discussion_attach_via_dialog, discussion_asset, discussion_detach,
    discussion_promote_to_plan,
    start_pty_session, write_to_pty, resize_pty, kill_pty_session,
    git_log, git_graph, git_status, git_head_status_brief,
    reindex_paths, compute_diff, resnapshot_paths, git_uncommitted_changes,
    git_last_commit_changes, open_in_editor, open_url,
    // G2 — Project Overview + Daily Brief
    get_project_overview, generate_project_overview, refresh_project_overview_if_stale,
    update_project_overview, daily_brief,
    // G4 — Greenfield (W6)
    save_blueprint, get_blueprint, list_blueprints, delete_blueprint,
    check_cli_available, create_greenfield_project, generate_seed_goals,
    // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
    oculpm_init, oculpm_get_status, oculpm_get_config, oculpm_set_config,
    oculpm_start_session_manual, oculpm_end_session_manual,
    oculpm_list_sessions, oculpm_get_file_changes,
    oculpm_watcher_start, oculpm_watcher_stop,
    oculpm_list_journal_entries, oculpm_get_journal_entry, oculpm_get_entry_diffs,
    oculpm_group_changes, oculpm_set_journal_verified, oculpm_search_entities,
    oculpm_workday_brief,
    oculpm_reindex_cache, oculpm_create_manual_entry, oculpm_update_entry_meta,
    oculpm_coerce_entry_on_disk,
    oculpm_agents_sync_active, oculpm_agents_detect, oculpm_agents_get_master_template,
    oculpm_agents_check_master_upgrade, oculpm_agents_apply_master_upgrade,
    oculpm_compare_layers, oculpm_get_log_dir, oculpm_log,
    oculpm_update_entry_body, oculpm_open_entry_in_editor,
    // W5-PR5 — Overview stats
    oculpm_overview_stats,
    // F5 — git-history backfill
    oculpm_backfill_from_git,
    // F4 — 회고/인사이트 (+ PR-CI6 eval 추이)
    retro_signals, get_retro, generate_retro, eval_signals,
    // v2 U10 (C1) — 스탠드업·PR 본문·주간 보고
    oculpm_generate_summary,
    // C2 — 일지 내보내기
    oculpm_export_digest,
    // 스킬 관리 — 프로젝트/전역 Claude Code 스킬(.claude/skills) CRUD·토글·복사
    skills_list, skills_read, skills_save, skills_delete, skills_set_enabled, skills_copy,
    // PR-CI3 — 규칙 허브 (CLAUDE.md·.claude/rules CRUD + Cursor 미러 번역)
    rules_list, rules_read, rules_save, rules_delete, rules_sync_translations,
    // PR-CI4 — 실패→규칙 승격 (결정적 후보 + 옵인 LLM 초안; 저장은 rules_save 승인 경로만)
    rule_candidates, rule_draft_generate,
    // PR-CI0 — Claude Code 훅 브리지 (settings.local.json 설치/제거/상태)
    claude_hooks_status, claude_hooks_install, claude_hooks_uninstall,
    // PR-CI2 — oculpm-mcp 서버 등록 (.mcp.json / Desktop 스니펫)
    mcp_status, mcp_register, mcp_unregister,
    // PR-CI7 — Notion 내보내기 (키체인 토큰 + REST 페이지 생성)
    notion_status, notion_verify_token, notion_set_parent, notion_export,
};
use crate::db::Db;
use crate::embedding::Embedder;

/// Build the specta Builder with every command + event registered. Extracted
/// so the W5-PR3 `export_bindings` test can regenerate `src/lib/bindings.ts`
/// without spawning the full Tauri runtime. Each call returns a fresh Builder
/// (the `.export(...)` consumes `self`).
fn build_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        db_health,
        settings_set,
        settings_get,
        settings_get_all,
        settings_set_many,
        app_info,
        clear_all_data,
        secret_set,
        secret_has,
        secret_delete,
        secret_verify,
        chat,
        chat_stream,
        select_project_folder,
        list_projects,
        create_project,
        delete_project,
        rename_project,
        project_stats,
        index_project,
        search_chunks,
        search_text,
        search_symbols,
        get_file_symbols,
        get_code_graph,
        get_change_impact,
        get_file_calls,
        clear_project_index,
        // Planner Upgrade (PR-PLN 0/1) — file-based Plan read + write
        plan_list,
        plan_get,
        plan_item_history,
        plan_create,
        plan_apply_edit,
        plan_ai_refresh,
        plan_migrate_goals,
        plan_recent_updates,
        plan_set_status,
        plan_rename,
        plan_delete,
        // M2-3 — Chat history
        conversation_create,
        conversation_list,
        conversation_rename,
        conversation_set_context,
        conversation_delete,
        chat_message_append,
        chat_message_list,
        record_conversation_action,
        list_conversation_actions,
        // M5 — Window & File Operations
        open_devtools,
        open_terminal_window,
        read_project_file,
        read_file_range,
        // 문서(docs) 뷰어
        docs_tree,
        docs_read,
        docs_asset,
        // 문제 해결(Discussion) — PR-DISC 0/1/2/4
        discussion_list,
        discussion_get,
        discussion_create,
        discussion_write,
        discussion_read_raw,
        discussion_set_status,
        discussion_rename,
        discussion_delete,
        discussion_attach,
        discussion_attach_via_dialog,
        discussion_asset,
        discussion_detach,
        discussion_promote_to_plan,
        // Terminal
        start_pty_session,
        write_to_pty,
        resize_pty,
        kill_pty_session,
        // M7 — Git / GitHub
        git_log,
        git_graph,
        git_status,
        git_head_status_brief,
        // Lite-W6 PR6 — LocalDiffView backend
        reindex_paths,
        compute_diff,
        resnapshot_paths,
        git_uncommitted_changes,
        git_last_commit_changes,
        open_in_editor,
        open_url,
        // G2 — Project Overview + Daily Brief
        get_project_overview,
        generate_project_overview,
        refresh_project_overview_if_stale,
        update_project_overview,
        daily_brief,
        // G4 — Greenfield (W6)
        save_blueprint,
        get_blueprint,
        list_blueprints,
        delete_blueprint,
        check_cli_available,
        create_greenfield_project,
        generate_seed_goals,
        // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
        oculpm_init,
        oculpm_get_status,
        oculpm_get_config,
        oculpm_set_config,
        oculpm_start_session_manual,
        oculpm_end_session_manual,
        oculpm_list_sessions,
        oculpm_get_file_changes,
        oculpm_watcher_start,
        oculpm_watcher_stop,
        oculpm_list_journal_entries,
        oculpm_get_journal_entry,
        oculpm_get_entry_diffs,
        oculpm_group_changes,
        oculpm_set_journal_verified,
        oculpm_search_entities,
        oculpm_workday_brief,
        oculpm_reindex_cache,
        oculpm_create_manual_entry,
        oculpm_update_entry_meta,
        oculpm_coerce_entry_on_disk,
        oculpm_agents_sync_active,
        oculpm_agents_detect,
        oculpm_agents_get_master_template,
        oculpm_agents_check_master_upgrade,
        oculpm_agents_apply_master_upgrade,
        oculpm_compare_layers,
        oculpm_get_log_dir,
        oculpm_log,
        oculpm_update_entry_body,
        oculpm_open_entry_in_editor,
        // W5-PR5 — Overview stats
        oculpm_overview_stats,
        // F5 — git-history backfill
        oculpm_backfill_from_git,
        // F4 — 회고/인사이트 (+ PR-CI6 eval 추이)
        retro_signals,
        oculpm_generate_summary,
        get_retro,
        generate_retro,
        eval_signals,
        // C2 — 일지 내보내기
        oculpm_export_digest,
        // 스킬 관리 — 프로젝트/전역 Claude Code 스킬(.claude/skills)
        skills_list,
        skills_read,
        skills_save,
        skills_delete,
        skills_set_enabled,
        skills_copy,
        // PR-CI3 — 규칙 허브
        rules_list,
        rules_read,
        rules_save,
        rules_delete,
        rules_sync_translations,
        // PR-CI4 — 실패→규칙 승격
        rule_candidates,
        rule_draft_generate,
        // PR-CI0 — Claude Code 훅 브리지
        claude_hooks_status,
        claude_hooks_install,
        claude_hooks_uninstall,
        // PR-CI2 — oculpm-mcp 서버 등록
        mcp_status,
        mcp_register,
        mcp_unregister,
        // PR-CI7 — Notion 내보내기
        notion_status,
        notion_verify_token,
        notion_set_parent,
        notion_export,
    ])
    .events(collect_events![
        // .oculpm/ subsystem (W1-PR2)
        crate::oculpm::spec::OculpmSessionStarted,
        crate::oculpm::spec::OculpmSessionEnded,
        crate::oculpm::spec::OculpmFileChanged,
        crate::oculpm::spec::OculpmJournalAdded,
        crate::oculpm::spec::OculpmJournalUpdated,
        crate::oculpm::spec::OculpmIntegrityWarning,
        crate::oculpm::spec::OculpmPlanReconciled,
        crate::oculpm::spec::OculpmAgentDrift,
        crate::oculpm::spec::OculpmAgentsTemplateChanged,
        crate::oculpm::spec::OculpmJournalPathChanged,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_logging();

    let builder = build_specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // --- macOS: titleBarStyle Overlay + hidden title (MASTER-GUIDE §6.2) ---
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("ocul-pm.db");
            let db = tauri::async_runtime::block_on(Db::open(db_path))
                .expect("failed to open database");
            app.manage(db);
            // Pin the embedding model cache to an absolute, writable dir. The
            // packaged .app runs with CWD `/`, so fastembed's relative default
            // would fail to retrieve `onnx/model.onnx`.
            let embed_cache = app_data.join("fastembed_cache");
            app.manage(Embedder::new(app.handle().clone(), embed_cache));
            app.manage(crate::commands::terminal::PtyState::default());
            // .oculpm/ subsystem (W1-PR6)
            app.manage(crate::oculpm::manager::OculpmManager::new());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // .oculpm/ subsystem (W1-PR7): release every project's lock on graceful
    // shutdown. RAII via `LockGuard::drop` is the safety net if the
    // best-effort sync drain here loses a race.
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(manager) = app_handle
                .try_state::<crate::oculpm::manager::OculpmManager>()
            {
                manager.shutdown_all_blocking();
            }
        }
    });
}

#[cfg(test)]
mod bindings_export_test {
    use super::*;

    /// Regenerate `src/lib/bindings.ts` whenever `cargo test` runs.
    ///
    /// The normal path goes through `pub fn run()` which we can't trigger
    /// from a unit test (it spins up the Tauri runtime). Keeping this as a
    /// test means bindings stay in sync without a hand-managed `pnpm
    /// bindings:gen` script — the CI / dev loop already runs `cargo test`.
    #[test]
    fn export_bindings_typescript() {
        let builder = build_specta_builder();
        builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/lib/bindings.ts",
            )
            .expect("export bindings");
    }
}

