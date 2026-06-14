//! Launch the user's preferred external editor on a project file (Lite-W6 PR8 Part 2).
//!
//! The frontend sends a *command template* (Settings → `externalEditorCommand`,
//! default `code "%path"`) and the project-relative file path. We resolve the
//! absolute path, substitute it for the `%path` placeholder with shell-safe
//! quoting, and spawn the resulting command via the OS shell. The child is
//! detached — we don't wait for the editor to exit.
//!
//! macOS caveat: Tauri GUI apps don't inherit the shell PATH, so the user
//! must either keep their editor on the system PATH (`/usr/local/bin/code`)
//! or write the absolute path in the command template. The Settings hint
//! string surfaces this.

use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
#[specta::specta]
pub async fn open_in_editor(
    project_root: String,
    rel_path: String,
    editor_cmd: String,
) -> Result<(), String> {
    if editor_cmd.trim().is_empty() {
        return Err("External editor command is not configured. Set one in Settings.".to_string());
    }
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(format!("project root does not exist: {}", root.display()));
    }
    let abs = if rel_path.is_empty() {
        root.clone()
    } else {
        root.join(&rel_path)
    };
    let abs_str = abs.to_string_lossy().to_string();
    let cmd_str = substitute_path(&editor_cmd, &abs_str);

    spawn_detached(&cmd_str).map_err(|e| format!("Failed to launch editor: {e}"))
}

/// Open an http(s) URL in the user's default browser. Used by the Today commit
/// graph to jump to a commit on GitHub. We shell out to the OS opener
/// (`open` / `xdg-open` / `cmd start`) rather than the opener plugin so no
/// path/url scope config is needed (mirrors `oculpm_open_entry_in_editor`).
/// Only http/https is allowed — never a local path or arbitrary scheme.
#[tauri::command]
#[specta::specta]
pub async fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened.".to_string());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(trimmed);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(trimmed);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        // empty title arg so a URL with spaces isn't treated as the window title
        c.args(["/C", "start", "", trimmed]);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("Failed to open URL: {e}"))
}

/// Replace the first occurrence of `%path` (or `"%path"`) in `template` with a
/// shell-quoted form of `abs_path`. Public for unit testing.
pub fn substitute_path(template: &str, abs_path: &str) -> String {
    let quoted = format!("\"{}\"", abs_path.replace('"', "\\\""));
    if template.contains("\"%path\"") {
        template.replacen("\"%path\"", &quoted, 1)
    } else if template.contains("%path") {
        template.replacen("%path", &quoted, 1)
    } else {
        // No placeholder — append at the end so a bare `code` still gets a
        // file to open. Avoids the silent "editor opened with no file" trap.
        format!("{template} {quoted}")
    }
}

fn spawn_detached(command: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").arg("/C").arg(command).spawn().map(|_| ())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh").arg("-c").arg(command).spawn().map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_quoted_placeholder() {
        let out = substitute_path("code \"%path\"", "/Users/me/project/src/main.rs");
        assert_eq!(out, "code \"/Users/me/project/src/main.rs\"");
    }

    #[test]
    fn substitutes_bare_placeholder() {
        let out = substitute_path("subl %path", "/tmp/a b.txt");
        assert_eq!(out, "subl \"/tmp/a b.txt\"");
    }

    #[test]
    fn appends_when_no_placeholder() {
        let out = substitute_path("cursor", "/tmp/x.rs");
        assert_eq!(out, "cursor \"/tmp/x.rs\"");
    }

    #[test]
    fn escapes_double_quotes_in_path() {
        let out = substitute_path("code \"%path\"", "/tmp/weird\"name.rs");
        assert_eq!(out, "code \"/tmp/weird\\\"name.rs\"");
    }

    #[test]
    fn preserves_extra_args() {
        let out = substitute_path("code --new-window \"%path\"", "/tmp/a.rs");
        assert_eq!(out, "code --new-window \"/tmp/a.rs\"");
    }
}
