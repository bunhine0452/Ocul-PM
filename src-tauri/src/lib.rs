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
mod github;
mod indexer;
mod llm;
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
            let appender = tracing_appender::rolling::daily(&dir, "oculpm.log");
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
    record_conversation_action, list_conversation_actions, create_project, delete_project, rename_project, dashboard_stats, db_health, goal_create,
    goal_delete, goal_get, goal_list, goal_update, index_project, list_projects, project_stats,
    search_chunks, search_text, search_symbols, secret_delete, secret_has, secret_set, secret_verify, select_project_folder, settings_get,
    settings_set, settings_get_all, settings_set_many, app_info, clear_all_data,
    subtask_create, subtask_delete, subtask_list, subtask_toggle,
    // Planner Upgrade (PR-PLN 0/1/5) — file-based Plan read + write + AI/migration
    plan_list, plan_get, plan_item_history, plan_create, plan_apply_edit,
    plan_ai_refresh, plan_migrate_goals, plan_recent_updates, plan_set_status,
    get_dependency_graph, get_file_symbols,
    minimize_window, toggle_maximize_window, close_window, open_devtools, open_terminal_window,
    open_ai_window,
    list_project_files, list_project_tree, read_project_file, write_project_file,
    detect_file_changes, list_file_changes, generate_edit_prompt,
    // G3 — Clarify (W5)
    clarify_edit_intent, generate_edit_prompt_with_answers,
    start_pty_session, write_to_pty, resize_pty, kill_pty_session,
    git_log, git_remotes, git_status, git_head_status_brief, github_verify,
    git_tags, git_log_range, read_changelog, github_releases,
    reindex_paths, compute_diff, resnapshot_paths, open_in_editor,
    // G2 — Project Overview + Daily Brief
    get_project_overview, generate_project_overview, refresh_project_overview_if_stale,
    update_project_overview, daily_brief,
    // G4 — Greenfield (W6)
    save_blueprint, get_blueprint, list_blueprints, delete_blueprint,
    check_cli_available, create_greenfield_project, generate_seed_goals,
    // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
    oculpm_init, oculpm_get_status, oculpm_get_config, oculpm_set_config,
    oculpm_get_current_session, oculpm_start_session_manual, oculpm_end_session_manual,
    oculpm_list_sessions, oculpm_get_file_changes, oculpm_get_index_snapshot,
    oculpm_watcher_start, oculpm_watcher_stop, oculpm_watcher_status,
    oculpm_list_journal_entries, oculpm_get_journal_entry, oculpm_get_entry_diffs,
    oculpm_group_changes, oculpm_set_journal_verified,
    oculpm_reindex_cache, oculpm_create_manual_entry, oculpm_update_entry_meta,
    oculpm_agents_sync_active, oculpm_agents_detect, oculpm_agents_get_master_template,
    oculpm_agents_check_master_upgrade, oculpm_agents_apply_master_upgrade,
    oculpm_compare_layers, oculpm_get_log_dir, oculpm_log,
    oculpm_update_entry_body, oculpm_open_entry_in_editor,
    // W5-PR3 — Migration from legacy SQLite changelog
    oculpm_migration_dry_run, oculpm_migrate_from_sqlite, oculpm_migration_rollback,
    oculpm_open_backup_dir,
    // W5-PR5 — Overview stats
    oculpm_overview_stats,
    // W5-PR6 — Agent filter
    oculpm_observed_agent_ids,
    // W5-PR7 — Migration history + legacy delete
    oculpm_get_migration_history, oculpm_delete_legacy_changelog,
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
        get_dependency_graph,
        get_file_symbols,
        clear_project_index,
        // M4 — Planner
        goal_create,
        goal_list,
        goal_get,
        goal_update,
        goal_delete,
        dashboard_stats,
        subtask_create,
        subtask_list,
        subtask_toggle,
        subtask_delete,
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
        minimize_window,
        toggle_maximize_window,
        close_window,
        open_devtools,
        open_terminal_window,
        open_ai_window,
        list_project_files,
        list_project_tree,
        read_project_file,
        write_project_file,
        // M6 — AI Assist
        detect_file_changes,
        list_file_changes,
        generate_edit_prompt,
        // G3 — Clarify (W5)
        clarify_edit_intent,
        generate_edit_prompt_with_answers,
        // Terminal
        start_pty_session,
        write_to_pty,
        resize_pty,
        kill_pty_session,
        // M7 — Git / GitHub
        git_log,
        git_remotes,
        git_status,
        git_head_status_brief,
        github_verify,
        git_tags,
        git_log_range,
        read_changelog,
        github_releases,
        // Lite-W6 PR6 — LocalDiffView backend
        reindex_paths,
        compute_diff,
        resnapshot_paths,
        open_in_editor,
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
        oculpm_get_current_session,
        oculpm_start_session_manual,
        oculpm_end_session_manual,
        oculpm_list_sessions,
        oculpm_get_file_changes,
        oculpm_get_index_snapshot,
        oculpm_watcher_start,
        oculpm_watcher_stop,
        oculpm_watcher_status,
        oculpm_list_journal_entries,
        oculpm_get_journal_entry,
        oculpm_get_entry_diffs,
        oculpm_group_changes,
        oculpm_set_journal_verified,
        oculpm_reindex_cache,
        oculpm_create_manual_entry,
        oculpm_update_entry_meta,
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
        // W5-PR3 — Migration
        oculpm_migration_dry_run,
        oculpm_migrate_from_sqlite,
        oculpm_migration_rollback,
        // W5-PR4 — Migration modal helpers
        oculpm_open_backup_dir,
        // W5-PR5 — Overview stats
        oculpm_overview_stats,
        // W5-PR6 — Agent filter
        oculpm_observed_agent_ids,
        // W5-PR7 — Migration history + legacy delete
        oculpm_get_migration_history,
        oculpm_delete_legacy_changelog,
    ])
    .events(collect_events![
        // .oculpm/ subsystem (W1-PR2)
        crate::oculpm::spec::OculpmSessionStarted,
        crate::oculpm::spec::OculpmSessionEnded,
        crate::oculpm::spec::OculpmFileChanged,
        crate::oculpm::spec::OculpmJournalAdded,
        crate::oculpm::spec::OculpmJournalUpdated,
        crate::oculpm::spec::OculpmIntegrityWarning,
        crate::oculpm::spec::OculpmAgentDrift,
        crate::oculpm::spec::OculpmAgentsTemplateChanged,
        crate::oculpm::spec::OculpmJournalPathChanged,
        // W5-PR3 — Migration progress stream
        crate::oculpm::spec::OculpmMigrationProgress,
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
            app.manage(Embedder::new(embed_cache));
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

