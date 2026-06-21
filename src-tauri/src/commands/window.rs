use tauri::{AppHandle, WebviewWindowBuilder, WebviewUrl};

#[tauri::command]
#[specta::specta]
pub async fn open_devtools(webview: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        webview.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = webview;
        Err("DevTools is only available in development builds.".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn open_terminal_window(app: AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(
        &app,
        "terminal_detached",
        WebviewUrl::App("/?window=terminal".into()),
    )
    .title("Ocul-PM Terminal")
    .inner_size(800.0, 500.0)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
