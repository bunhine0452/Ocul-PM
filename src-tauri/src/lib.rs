mod commands;
mod db;
mod error;
mod secrets;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

use crate::commands::{
    db_health, greet, secret_delete, secret_has, secret_set, settings_get, settings_set,
};
use crate::db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .try_init();

    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        greet,
        db_health,
        settings_set,
        settings_get,
        secret_set,
        secret_has,
        secret_delete,
    ]);

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("ai-pm.db");
            let db = tauri::async_runtime::block_on(Db::open(db_path))
                .expect("failed to open database");
            app.manage(db);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
