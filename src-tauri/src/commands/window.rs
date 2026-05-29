use tauri::{Window, AppHandle, Manager, WebviewWindowBuilder, WebviewUrl};

#[tauri::command]
#[specta::specta]
pub async fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_maximize_window(window: Window) -> Result<(), String> {
    if let Ok(maximized) = window.is_maximized() {
        if maximized {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

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

/// Lite-W6 PR9 — open the AI workbench in a standalone window so the user
/// can park it on a second monitor next to Today / Plan. Idempotent: if the
/// window already exists, we focus + unminimise instead of erroring.
/// `tauri-plugin-window-state` restores the position + size automatically.
#[tauri::command]
#[specta::specta]
pub async fn open_ai_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("ai_detached") {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "ai_detached",
        WebviewUrl::App("/?window=ai".into()),
    )
    .title("Ocul-PM · AI")
    .inner_size(720.0, 640.0)
    .min_inner_size(420.0, 360.0)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
