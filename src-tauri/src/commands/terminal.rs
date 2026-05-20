use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::Write;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, MasterPty};
use tauri::{State, Emitter};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[tauri::command]
#[specta::specta]
pub async fn start_pty_session(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    #[cfg(target_os = "windows")]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    if !cwd.is_empty() {
        cmd.cwd(cwd);
    }

    let _child = pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    let reader = pair.master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair.master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let session = PtySession {
        writer,
        master: pair.master,
    };

    state.sessions.lock().unwrap().insert(session_id.clone(), session);

    let session_id_clone = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut local_buf = [0u8; 4096];
            loop {
                match reader.read(&mut local_buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&local_buf[..n]).to_string();
                        let _ = app.emit(&format!("pty-data-{}", session_id_clone), text);
                    }
                    Err(_) => break,
                }
            }
            let _ = app.emit(&format!("pty-exit-{}", session_id_clone), ());
        }).await;
    });

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn write_to_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {e}"))?;
        session.writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn kill_pty_session(
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(_session) = sessions.remove(&session_id) {
        // PtySession dropped here: master will close, sending SIGHUP/SIGKILL to child.
    }
    Ok(())
}
