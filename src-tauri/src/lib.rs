mod commands;
mod db;
mod embedding;
mod error;
mod indexer;
mod llm;
mod secrets;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

use crate::commands::{
    chat, chat_stream, clear_project_index, create_project, db_health, index_project,
    list_projects, project_stats, search_chunks, secret_delete, secret_has, secret_set,
    select_project_folder, settings_get, settings_set,
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
        secret_set,
        secret_has,
        secret_delete,
        chat,
        chat_stream,
        select_project_folder,
        list_projects,
        create_project,
        project_stats,
        index_project,
        search_chunks,
        clear_project_index,
    ]);

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("ai-pm.db");
            let db = tauri::async_runtime::block_on(Db::open(db_path))
                .expect("failed to open database");
            app.manage(db);
            app.manage(Embedder::new());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
