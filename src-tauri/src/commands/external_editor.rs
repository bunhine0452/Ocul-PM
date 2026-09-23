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
// Quick Look(qlmanage) 한 곳만 쓴다 — 비-mac 에서는 미사용 import 가 된다.
#[cfg(target_os = "macos")]
use std::process::Stdio;

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
/// (`open` / `xdg-open`; on Windows ShellExecute via the opener plugin's *Rust*
/// function, not `cmd start`) rather than the plugin's JS command, so no
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
        let mut c = crate::proc::std_cmd("open");
        c.arg(trimmed);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = crate::proc::std_cmd("xdg-open");
        c.arg(trimmed);
        c
    };
    // Windows 는 셸(cmd)을 거치지 않는다 — `cmd /C start "" <url>` 는 쿼리의
    // `&` 에서 명령이 끊겨 뒤쪽이 **명령으로 실행**됐다 (`https://x/?a=1&calc`).
    #[cfg(target_os = "windows")]
    {
        super::open_native::shell_open(std::ffi::OsStr::new(trimmed))
            .map_err(|e| format!("Failed to open URL: {e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd.spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open URL: {e}"))
    }
}

/// 프로젝트 파일을 **파일 탐색기에서 선택된 채로** 연다 (macOS: Finder).
///
/// 터미널 링크의 ⌘클릭 메뉴가 쓴다. `open_in_editor` 와 같은 경로 가드를 지나며
/// (`secure_join`), 편집기 템플릿과 달리 **셸을 거치지 않는다** — 인자를 그대로
/// 넘기므로 인용이 깨질 자리가 없다.
#[tauri::command]
#[specta::specta]
pub async fn reveal_in_file_manager(project_root: String, rel_path: String) -> Result<(), String> {
    let abs = resolve_project_file(&project_root, &rel_path)?;
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = crate::proc::std_cmd("open");
        c.arg("-R").arg(&abs);
        c
    };
    // 리눅스 파일 관리자에는 "선택한 채로 열기"의 공통 규약이 없다 — 부모
    // 폴더를 여는 것이 어느 데스크톱에서나 통하는 최대한이다.
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let parent = abs.parent().unwrap_or(&abs).to_path_buf();
        let mut c = crate::proc::std_cmd("xdg-open");
        c.arg(parent);
        c
    };
    // Windows — 셸의 "폴더 열고 선택"(SHOpenFolderAndSelectItems). `explorer
    // /select,<경로>` 는 공백·쉼표가 든 경로를 인자 인용과 다르게 읽는다.
    #[cfg(target_os = "windows")]
    {
        tauri_plugin_opener::reveal_item_in_dir(&abs)
            .map_err(|e| format!("Failed to reveal file: {e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd.spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to reveal file: {e}"))
    }
}

/// 프로젝트 파일을 **빠른 미리보기**로 띄운다 (macOS Quick Look).
///
/// `qlmanage -p` 는 파일을 열지 않고 내용만 훑어보는, macOS 에서 스페이스바가
/// 하는 그 동작이다. 다른 플랫폼에는 대응물이 없으므로 조용히 아무 일도 하지
/// 않는 대신 **이유를 돌려준다** — 화면이 그 문구를 그대로 보여 준다.
#[tauri::command]
#[specta::specta]
pub async fn quick_look_file(project_root: String, rel_path: String) -> Result<(), String> {
    let abs = resolve_project_file(&project_root, &rel_path)?;
    #[cfg(target_os = "macos")]
    {
        // stdout/stderr 를 버린다 — qlmanage 는 진단을 잔뜩 뱉고, 그 파이프를
        // 아무도 읽지 않으면 가득 찬 순간 자식이 멈춘다.
        crate::proc::std_cmd("qlmanage")
            .arg("-p")
            .arg(&abs)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open Quick Look: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = abs;
        Err("Quick Look is only available on macOS.".to_string())
    }
}

/// 프로젝트 루트 기준 상대경로를 **존재가 확인된 절대경로**로 바꾼다.
///
/// 터미널 스캐너가 뽑은 경로는 신뢰할 수 없는 바이트다. `secure_join` 이 `..`
/// 탈출과 절대경로를 막고, 존재 확인이 그 뒤를 받는다 — 없는 파일을 넘기면
/// Finder 는 아무 말 없이 아무 일도 안 해서, 눌렀는데 왜 안 되는지 알 수 없다.
fn resolve_project_file(project_root: &str, rel_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root);
    if !root.exists() {
        return Err(format!("project root does not exist: {}", root.display()));
    }
    let abs = crate::commands::project::secure_join(&root, rel_path)?;
    if !abs.exists() {
        return Err(format!("file does not exist: {rel_path}"));
    }
    Ok(abs)
}

/// POSIX 셸에 안전한 인용. **작은따옴표**로 감싸고 내부의 `'` 만 `'\''` 로
/// 끊는다 — 작은따옴표 안에서는 어떤 문자도 특별하지 않다.
///
/// 2026-07-30 보안 수정: 예전엔 큰따옴표로 감싸고 `"` 만 이스케이프했다.
/// 큰따옴표 안에서는 `$`·백틱·`\` 가 여전히 살아 있어서 `/tmp/$(id).rs` 같은
/// 경로가 `sh -c` 에서 **명령 치환으로 실행**됐고, `\` 로 끝나는 경로는 닫는
/// 따옴표를 먹어 인용이 통째로 깨졌다.
///
/// **인용 규칙은 플랫폼마다 다르다** (2026-09-08). 이 함수가 하나였던 동안
/// [`spawn_detached`] 의 Windows 분기(`cmd /C`)는 POSIX 인용을 받아 갔는데,
/// **cmd 는 작은따옴표를 인용으로 읽지 않는다** — `'C:\a&calc&b.rs'` 는 리터럴
/// 한 덩어리가 아니라 `&` 에서 끊긴 세 명령이 된다. 실제 배포는 macOS 뿐이라
/// 사고는 없었지만 `bundle.targets` 가 `"all"` 이라 형식상 열려 있었다.
fn posix_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', r"'\''"))
}

/// `cmd.exe` 에 안전한 인용 — **큰따옴표**로 감싼다.
///
/// cmd 는 큰따옴표 안에서 `&`·`|`·`<`·`>`·`(`·`)`·`^` 를 특별하게 보지 않으므로
/// 이것만으로 명령 주입이 닫힌다. POSIX 쪽이 막는 `$`·백틱은 cmd 의 문법이
/// 아니라 애초에 위험하지 않다.
///
/// `"` 는 지운다. Windows 파일명 예약 문자라 정상 경로에는 올 수 없고, 그래도
/// 넘어오면 인용이 통째로 깨진다 — **엉뚱한 경로로 실패하는 편이 임의 명령을
/// 실행하는 것보다 낫다.**
///
/// `%` 는 남긴다. cmd 는 인용 안에서도 `%VAR%` 를 펼치므로 그런 이름의 파일은
/// 엉뚱한 경로로 열릴 수 있다. 다만 펼친 결과도 여전히 따옴표 안이라 주입으로는
/// 번지지 않고, `%` 는 Windows 에서 **합법적인 파일명 문자**라 지우면 멀쩡한
/// 파일을 못 열게 된다.
fn cmd_quote(raw: &str) -> String {
    format!("\"{}\"", raw.replace('"', ""))
}

/// 이 빌드가 나가는 셸의 인용.
///
/// 두 구현을 **cfg 로 가르지 않고** 둘 다 컴파일해 두는 이유는 검증이다. cfg
/// 안에 든 코드는 그 플랫폼에서 빌드하기 전까지 컴파일도 테스트도 되지 않아,
/// 여기 살던 Windows 분기가 몇 달째 아무도 안 본 채 POSIX 인용을 받아 갔다.
/// 순수 함수 둘로 갈라 두면 계약은 **모든 플랫폼의 테스트가** 문다.
fn sh_quote(raw: &str) -> String {
    if cfg!(target_os = "windows") {
        cmd_quote(raw)
    } else {
        posix_quote(raw)
    }
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
    shell_command(command).spawn().map(|_| ())
}

/// 명령 한 줄을 이 OS 의 셸로 — `sh -c` / `cmd /S /C`.
///
/// Windows 는 **명령줄을 손으로** 만든다(`raw_arg`). std 의 인자 인용은 MSVCRT
/// 규칙(`\"`)이라 `cmd` 가 읽지 못한다 — `code "C:\a b\x.rs"` 가
/// `"code \"C:\a b\x.rs\""` 로 넘어가 인용이 통째로 깨졌다. `/S` 는 바깥
/// 따옴표 한 쌍만 벗기고 안쪽은 그대로 두라는 뜻이다 — 안쪽 경로 인용
/// (`cmd_quote`)이 살아 `&`·`|` 가 경로 밖으로 새지 않는다.
fn shell_command(command: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = crate::proc::std_cmd("cmd");
        cmd.raw_arg(format!("/S /C \"{command}\""));
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = crate::proc::std_cmd("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
}

// `substitute_path` 를 통과하는 단언은 **이 빌드의 셸** 인용을 본다. 두 인용
// 규칙 자체는 아래 `quoting` 모듈이 플랫폼과 무관하게 문다.
#[cfg(all(test, not(target_os = "windows")))]
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

/// 두 셸의 인용 규칙 — **플랫폼과 무관하게** 돈다 (`sh_quote` 문단의 이유).
#[cfg(test)]
mod quoting {
    use super::*;

    /// **cmd 메타문자가 큰따옴표 안에서 리터럴이 된다.** POSIX 인용을 그대로
    /// `cmd /C` 로 넘기던 시절, 이 경로는 `calc` 를 실행했다 — cmd 는 작은
    /// 따옴표를 인용으로 읽지 않아 `&` 에서 명령이 끊긴다.
    #[test]
    fn cmd_quoting_keeps_metacharacters_inside_the_quotes() {
        assert_eq!(cmd_quote(r"C:\p\a&calc&b.rs"), "\"C:\\p\\a&calc&b.rs\"");
        assert_eq!(cmd_quote(r"C:\p\a|calc.rs"), "\"C:\\p\\a|calc.rs\"");
        assert_eq!(cmd_quote(r"C:\p\a^b(c).rs"), "\"C:\\p\\a^b(c).rs\"");
    }

    /// 그 경로를 POSIX 인용으로 감싸면 **cmd 에서는 보호가 0** 이다 — 회귀가
    /// 돌아왔는지 가르는 단언이라 두 규칙이 다르다는 사실 자체를 문다.
    #[test]
    fn the_two_shells_do_not_share_a_quoting_rule() {
        let path = r"C:\p\a&calc&b.rs";
        assert_ne!(posix_quote(path), cmd_quote(path));
        assert!(posix_quote(path).starts_with('\''));
        assert!(cmd_quote(path).starts_with('"'));
    }

    /// 역슬래시는 cmd 의 이스케이프가 아니다 — 경로가 그대로 살아야 한다.
    #[test]
    fn cmd_quoting_leaves_backslashes_alone() {
        assert_eq!(cmd_quote(r"C:\dir\sub\a.rs"), "\"C:\\dir\\sub\\a.rs\"");
    }

    /// 인용을 깨뜨릴 수 있는 유일한 문자(`"` — Windows 파일명 예약 문자)는
    /// 지운다. 엉뚱한 경로로 실패하는 편이 임의 명령을 실행하는 것보다 낫다.
    #[test]
    fn cmd_quoting_cannot_be_broken_out_of() {
        let out = cmd_quote("C:\\a\"&calc&\".rs");
        assert_eq!(
            out.matches('"').count(),
            2,
            "따옴표가 둘뿐이어야 한다: {out}"
        );
        assert_eq!(out, "\"C:\\a&calc&.rs\"");
    }

    /// `%` 는 남긴다 — Windows 에서 합법적인 파일명 문자라 지우면 멀쩡한 파일을
    /// 못 연다. 펼쳐지더라도 결과는 여전히 따옴표 안이다.
    #[test]
    fn cmd_quoting_keeps_percent_signs() {
        assert_eq!(cmd_quote(r"C:\a\100%.md"), "\"C:\\a\\100%.md\"");
    }
}

/// 편집기 명령이 **이 OS 의 셸을 실제로 지나** 경로가 한 덩어리로 도착하는가.
/// 인용 규칙(`quoting`)이 옳아도 셸에 넘기는 방식이 틀리면 소용없다 — Windows 는
/// std 의 인자 인용이 cmd 와 달라 인용이 통째로 깨졌었다.
#[cfg(test)]
mod shell {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_receives_the_quoted_path_as_one_token() {
        // `&` 는 cmd 의 명령 구분자다 — 인용이 새면 `calc` 가 명령으로 떨어진다.
        // (ASCII 만 — cmd 의 echo 는 콘솔 코드페이지로 찍는다.)
        let path = r"C:\work dir\a&calc\file.rs";
        let command = substitute_path("echo %path", path, None);
        let out = shell_command(&command).output().expect("cmd 실행");
        assert!(out.status.success(), "{out:?}");
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert_eq!(stdout.trim_end(), format!("\"{path}\""), "{stdout}");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn sh_receives_the_quoted_path_as_one_token() {
        let path = "/tmp/work dir/a;$(id)/`x`/파일.rs";
        let command = substitute_path("printf %s %path", path, None);
        let out = shell_command(&command).output().expect("sh 실행");
        assert!(out.status.success(), "{out:?}");
        assert_eq!(String::from_utf8_lossy(&out.stdout), path);
    }

    /// 재발 가드 — Windows 에서 URL·경로를 `cmd /c start` 로 여는 자리가 다시
    /// 생기면 안 된다 (따옴표 밖의 `&` 가 명령으로 실행된다). ShellExecute 로 여는
    /// 창구는 `open_native::shell_open` 하나다.
    #[test]
    fn nothing_opens_urls_through_cmd_start() {
        for (name, src) in [
            ("external_editor.rs", include_str!("external_editor.rs")),
            ("open_native.rs", include_str!("open_native.rs")),
            ("notion.rs", include_str!("notion.rs")),
        ] {
            let code: String = src
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n")
                .to_ascii_lowercase();
            assert!(
                !code.contains("\"start\","),
                "{name} 이 `cmd start` 로 연다 — open_native::shell_open 을 쓸 것"
            );
        }
    }
}
