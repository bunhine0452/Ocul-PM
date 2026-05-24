mod ast;
mod commands;
mod db;
mod embedding;
mod error;
mod git;
mod github;
mod indexer;
mod llm;
mod oculpm;
mod secrets;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};

use crate::commands::{
    chat, chat_message_append, chat_message_list, chat_stream, clear_project_index,
    conversation_create, conversation_delete, conversation_list, conversation_rename,
    conversation_set_context,
    // W5 — action proposal apply-state
    record_conversation_action, list_conversation_actions, create_project, delete_project, rename_project, dashboard_stats, db_health, goal_create,
    goal_delete, goal_get, goal_list, goal_update, index_project, list_projects, project_stats,
    search_chunks, secret_delete, secret_has, secret_set, secret_verify, select_project_folder, settings_get,
    settings_set, settings_get_all, settings_set_many, app_info, clear_all_data,
    subtask_create, subtask_delete, subtask_list, subtask_toggle,
    get_dependency_graph, get_file_symbols,
    minimize_window, toggle_maximize_window, close_window, open_devtools, open_terminal_window,
    list_project_files, read_project_file, write_project_file,
    detect_file_changes, list_file_changes, generate_edit_prompt,
    // G3 — Clarify (W5)
    clarify_edit_intent, generate_edit_prompt_with_answers,
    start_pty_session, write_to_pty, resize_pty, kill_pty_session,
    git_log, git_remotes, git_status, github_verify,
    git_tags, git_log_range, read_changelog, github_releases,
    // G1 — Changelog
    commit_changelog_entry, list_changelog, list_changelog_by_day, get_changelog_detail,
    update_changelog, delete_changelog, pin_changelog, export_changelog_markdown,
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
    oculpm_list_journal_entries, oculpm_get_journal_entry, oculpm_set_journal_verified,
    oculpm_reindex_cache, oculpm_create_manual_entry,
};
use crate::db::Db;
use crate::embedding::Embedder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .try_init();

    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
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
        list_project_files,
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
        github_verify,
        git_tags,
        git_log_range,
        read_changelog,
        github_releases,
        // G1 — Changelog
        commit_changelog_entry,
        list_changelog,
        list_changelog_by_day,
        get_changelog_detail,
        update_changelog,
        delete_changelog,
        pin_changelog,
        export_changelog_markdown,
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
        oculpm_set_journal_verified,
        oculpm_reindex_cache,
        oculpm_create_manual_entry,
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
    ]);


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
            let db_path = app_data.join("ai-pm.db");
            let db = tauri::async_runtime::block_on(Db::open(db_path))
                .expect("failed to open database");
            app.manage(db);
            app.manage(Embedder::new());
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

