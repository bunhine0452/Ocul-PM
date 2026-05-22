mod ast;
mod commands;
mod db;
mod embedding;
mod error;
mod git;
mod github;
mod indexer;
mod llm;
mod secrets;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

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
    ]);


    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

