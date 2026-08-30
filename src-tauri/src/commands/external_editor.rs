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

/// 외부 편집기로 프로젝트 파일을 연다.
///
/// `line` 은 1-based 줄 번호로 템플릿의 `%line` 에 들어간다 (터미널의
/// `file:line` 링크가 쓴다). `None` 이면 파일만 연다.
#[tauri::command]
#[specta::specta]
pub async fn open_in_editor(
    project_root: String,
    rel_path: String,
    editor_cmd: String,
    line: Option<u32>,
) -> Result<(), String> {
    if editor_cmd.trim().is_empty() {
        return Err("External editor command is not configured. Set one in Settings.".to_string());
    }
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Err(format!("project root does not exist: {}", root.display()));
    }
    // 2026-07-30 보안 수정: 예전엔 `root.join(&rel_path)` 였다. `..` 을 막지
    // 않아 `../../.ssh/id_rsa` 가 그대로 열렸고, 절대경로를 주면 `Path::join`
    // 이 root 를 통째로 버려 `/etc/passwd` 도 열렸다. 터미널 출력에서 뽑은
    // 경로를 이 커맨드에 물리기 전에 반드시 닫아야 할 구멍이었다.
    let abs = if rel_path.is_empty() {
        root.clone()
    } else {
        crate::commands::project::secure_join(&root, &rel_path)?
    };
    let abs_str = abs.to_string_lossy().to_string();
    let cmd_str = substitute_path(&editor_cmd, &abs_str, line);

    spawn_detached(&cmd_str).map_err(|e| format!("Failed to launch editor: {e}"))
}

/// Open an external URL in the user's default app (browser / mail client). Used
/// by the Today commit graph to jump to a commit on GitHub, and by the app-wide
/// link guard (`src/lib/externalLinks.ts`) for any anchor an agent answer or a
/// rendered document puts on screen. We shell out to the OS opener
/// (`open` / `xdg-open` / `cmd start`) rather than the opener plugin so no
/// path/url scope config is needed (mirrors `oculpm_open_entry_in_editor`).
/// Only http/https/mailto is allowed — never a local path or arbitrary scheme.
#[tauri::command]
#[specta::specta]
pub async fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("mailto:"))
    {
        return Err("Only http(s)/mailto URLs can be opened.".to_string());
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
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open URL: {e}"))
}

/// POSIX 셸에 안전한 인용. **작은따옴표**로 감싸고 내부의 `'` 만 `'\''` 로
/// 끊는다 — 작은따옴표 안에서는 어떤 문자도 특별하지 않다.
///
/// 2026-07-30 보안 수정: 예전엔 큰따옴표로 감싸고 `"` 만 이스케이프했다.
/// 큰따옴표 안에서는 `$`·백틱·`\` 가 여전히 살아 있어서 `/tmp/$(id).rs` 같은
/// 경로가 `sh -c` 에서 **명령 치환으로 실행**됐고, `\` 로 끝나는 경로는 닫는
/// 따옴표를 먹어 인용이 통째로 깨졌다.
fn sh_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', r"'\''"))
}

/// `template` 의 `%path` / `%line` 을 치환한다. Public for unit testing.
///
/// 인식 순서 — 줄 번호를 파일 경로에 이어 붙이는 편집기(`code -g file:42`,
/// `subl file:42`)를 한 토큰으로 처리해야 인용이 깨지지 않는다:
///
/// 1. `"%path:%line"` / `%path:%line` → `'<abs>:<line>'` (line 이 있을 때만)
/// 2. `"%path"` / `%path` → `'<abs>'`
/// 3. 자리표시자 없음 → 끝에 `'<abs>'` 를 덧붙인다
/// 4. 남은 `%line` → 숫자 그대로 (u32 라 주입이 불가능하다)
pub fn substitute_path(template: &str, abs_path: &str, line: Option<u32>) -> String {
    let quoted = sh_quote(abs_path);

    let mut out = if let Some(n) = line {
        let with_line = sh_quote(&format!("{abs_path}:{n}"));
        if template.contains("\"%path:%line\"") {
            template.replacen("\"%path:%line\"", &with_line, 1)
        } else if template.contains("%path:%line") {
            template.replacen("%path:%line", &with_line, 1)
        } else {
            substitute_bare_path(template, &quoted)
        }
    } else {
        // line 이 없으면 `:%line` 꼬리를 통째로 걷어낸다 — `file:` 로 끝나는
        // 인자를 넘기면 편집기가 빈 파일명으로 해석한다.
        let stripped = template.replacen("%path:%line", "%path", 1);
        substitute_bare_path(&stripped, &quoted)
    };

    // 경로와 떨어져 있는 `%line` (`emacs +%line "%path"`). 남아 있으면 채운다.
    if out.contains("%line") {
        out = out.replace("%line", &line.unwrap_or(1).to_string());
    }
    out
}

fn substitute_bare_path(template: &str, quoted: &str) -> String {
    if template.contains("\"%path\"") {
        template.replacen("\"%path\"", quoted, 1)
    } else if template.contains("%path") {
        template.replacen("%path", quoted, 1)
    } else {
        // No placeholder — append at the end so a bare `code` still gets a
        // file to open. Avoids the silent "editor opened with no file" trap.
        format!("{template} {quoted}")
    }
}

fn spawn_detached(command: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/C")
            .arg(command)
            .spawn()
            .map(|_| ())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .arg("-c")
            .arg(command)
            .spawn()
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_quoted_placeholder() {
        let out = substitute_path("code \"%path\"", "/Users/me/project/src/main.rs", None);
        assert_eq!(out, "code '/Users/me/project/src/main.rs'");
    }

    #[test]
    fn substitutes_bare_placeholder() {
        let out = substitute_path("subl %path", "/tmp/a b.txt", None);
        assert_eq!(out, "subl '/tmp/a b.txt'");
    }

    #[test]
    fn appends_when_no_placeholder() {
        let out = substitute_path("cursor", "/tmp/x.rs", None);
        assert_eq!(out, "cursor '/tmp/x.rs'");
    }

    #[test]
    fn preserves_extra_args() {
        let out = substitute_path("code --new-window \"%path\"", "/tmp/a.rs", None);
        assert_eq!(out, "code --new-window '/tmp/a.rs'");
    }

    // ── 셸 주입 방어 (2026-07-30) ────────────────────────────────────────────

    /// 회귀 방어 — 큰따옴표 인용이던 시절 이 경로는 `sh -c` 에서 `id` 를
    /// **실행**했다. 작은따옴표 안에서는 `$(...)` 가 리터럴이다.
    #[test]
    fn command_substitution_in_path_stays_literal() {
        let out = substitute_path("code \"%path\"", "/tmp/$(id).rs", None);
        assert_eq!(out, "code '/tmp/$(id).rs'");
        assert!(!out.contains("\""));
    }

    #[test]
    fn backticks_and_variables_stay_literal() {
        let out = substitute_path("code %path", "/tmp/`whoami`/$HOME.rs", None);
        assert_eq!(out, "code '/tmp/`whoami`/$HOME.rs'");
    }

    /// 역슬래시로 끝나는 경로가 닫는 따옴표를 먹어 인용이 깨지던 케이스.
    #[test]
    fn trailing_backslash_does_not_break_quoting() {
        let out = substitute_path("code \"%path\"", "/tmp/dir\\", None);
        assert_eq!(out, "code '/tmp/dir\\'");
    }

    /// 작은따옴표가 든 경로 — `'\''` 로 끊어 인용을 유지한다.
    #[test]
    fn single_quote_in_path_is_broken_out() {
        let out = substitute_path("code %path", "/tmp/it's.rs", None);
        assert_eq!(out, r"code '/tmp/it'\''s.rs'");
    }

    #[test]
    fn double_quote_in_path_needs_no_escaping_now() {
        let out = substitute_path("code \"%path\"", "/tmp/weird\"name.rs", None);
        assert_eq!(out, "code '/tmp/weird\"name.rs'");
    }

    // ── %line ────────────────────────────────────────────────────────────────

    /// `code -g file:42` 형태 — 경로와 줄 번호가 **한 토큰**이라 통째로 인용한다.
    #[test]
    fn path_and_line_are_quoted_as_one_token() {
        let out = substitute_path("code -g \"%path:%line\"", "/tmp/a b.rs", Some(42));
        assert_eq!(out, "code -g '/tmp/a b.rs:42'");
    }

    #[test]
    fn bare_path_line_placeholder_works_too() {
        let out = substitute_path("subl %path:%line", "/tmp/x.rs", Some(7));
        assert_eq!(out, "subl '/tmp/x.rs:7'");
    }

    /// 줄 번호가 없으면 `:%line` 꼬리를 걷어낸다 — `file:` 로 끝나면 편집기가
    /// 빈 파일명으로 해석한다.
    #[test]
    fn missing_line_drops_the_line_suffix() {
        let out = substitute_path("code -g \"%path:%line\"", "/tmp/x.rs", None);
        assert_eq!(out, "code -g '/tmp/x.rs'");
    }

    /// 경로와 떨어진 `%line` (emacs `+N` 스타일).
    #[test]
    fn detached_line_placeholder_is_filled() {
        let out = substitute_path("emacs +%line \"%path\"", "/tmp/x.rs", Some(12));
        assert_eq!(out, "emacs +12 '/tmp/x.rs'");
        // 줄을 모르면 파일 첫 줄로.
        let none = substitute_path("emacs +%line \"%path\"", "/tmp/x.rs", None);
        assert_eq!(none, "emacs +1 '/tmp/x.rs'");
    }

    /// 줄 번호는 u32 라 주입이 원천적으로 불가능하다 — 그래도 인용 형태를 고정.
    #[test]
    fn line_number_is_plain_digits() {
        let out = substitute_path("code -g \"%path:%line\"", "/tmp/x.rs", Some(4_294_967_295));
        assert_eq!(out, "code -g '/tmp/x.rs:4294967295'");
    }
}
