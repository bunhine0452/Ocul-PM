//! 어느 편집기로 여는가 — 설정 `externalEditorCommand` 의 값을 읽는다 (2026-11-02).
//!
//! 예전 기본값은 셸 명령 `code "%path"` 하나였다. 그런데 macOS 에서 VS Code 를
//! 깔아도 `code` 셸 명령은 따로 설치해야 하고(명령 팔레트 「Shell Command: Install
//! 'code' command in PATH」), 설치해도 Finder 로 띄운 앱은 셸의 PATH 를 물려받지
//! 않는다. 그래서 변경 화면의 「편집기로 열기」와 터미널 ⌘클릭 → 편집기가 VS Code
//! 가 깔린 기기에서도 오류 토스트만 띄웠고, 설정 화면에는 명령을 바꿀 칸도 없었다.
//!
//! 이제 값은 다섯 가지다:
//!
//! | 값 | 여는 길 |
//! |---|---|
//! | `auto` · 빈 값 · 옛 기본값 `code "%path"` | 깔린 것을 찾아 아래 셋 중 하나 |
//! | `vscode` · `cursor` | `vscode://file/<경로>:<줄>:1` — 편집기가 OS 에 등록한 주소. 셸 명령이 없어도 되고 줄로 바로 간다 |
//! | `system` | OS 기본 앱 (`open` / `xdg-open` / ShellExecute) |
//! | 그 밖의 글자 | 셸 명령 템플릿 (`%path` · `%line`) — 예전 그대로 |
//!
//! 주소를 여는 것은 OS 오프너다(`open_native`) — 새 자식 프로세스 자리를 만들지 않는다.

use std::path::Path;

/// 셸 명령 템플릿이던 시절의 기본값. 이 값이 저장돼 있으면 사용자가 고른 것이
/// 아니라 기본값이 남은 것이므로 `auto` 로 읽는다.
pub const LEGACY_DEFAULT: &str = "code \"%path\"";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorChoice {
    /// 주소 스킴(`vscode` · `cursor`)으로 연다.
    Uri(&'static str),
    /// OS 기본 앱.
    System,
    /// 사용자가 적은 셸 명령 템플릿.
    Template(String),
}

/// 설정 값을 고르기로 바꾼다. `auto` 류는 `detect` 를 부른다 — 테스트가 기기에
/// 무엇이 깔렸는지와 무관하게 돌도록 주입받는다.
pub fn choose(raw: &str, detect: impl FnOnce() -> EditorChoice) -> EditorChoice {
    match raw.trim() {
        "" | "auto" | LEGACY_DEFAULT => detect(),
        "vscode" => EditorChoice::Uri("vscode"),
        "cursor" => EditorChoice::Uri("cursor"),
        "system" => EditorChoice::System,
        other => EditorChoice::Template(other.to_string()),
    }
}

/// 이 기기에 깔린 편집기 — VS Code 먼저, 다음 Cursor, 없으면 OS 기본 앱.
pub fn detect_installed() -> EditorChoice {
    if installed("Visual Studio Code", "code") {
        EditorChoice::Uri("vscode")
    } else if installed("Cursor", "cursor") {
        EditorChoice::Uri("cursor")
    } else {
        EditorChoice::System
    }
}

/// macOS 는 앱 번들 자리를, 그 밖은 PATH 의 실행 파일을 본다. 어느 쪽도 프로세스를
/// 띄우지 않는다 — 설정 화면이 열릴 때마다 부르는 함수다.
#[cfg(target_os = "macos")]
fn installed(app: &str, _bin: &str) -> bool {
    let bundle = format!("{app}.app");
    let mut roots = vec![std::path::PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(Path::new(&home).join("Applications"));
    }
    roots.iter().any(|r| r.join(&bundle).is_dir())
}

#[cfg(not(target_os = "macos"))]
fn installed(_app: &str, bin: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let names: Vec<String> = if cfg!(target_os = "windows") {
        vec![format!("{bin}.cmd"), format!("{bin}.exe")]
    } else {
        vec![bin.to_string()]
    };
    std::env::split_paths(&path).any(|dir| names.iter().any(|n| dir.join(n).is_file()))
}

/// 편집기의 명령줄 도구 — 프로젝트 폴더를 **그 프로젝트의 창**으로 열 때 쓴다 (2026-11-03).
///
/// `vscode://file/<파일>` 은 그 파일을 품은 폴더가 열린 창이 없으면 **마지막으로 쓴 창**에 낱장으로
/// 연다 — 프로젝트 A 의 파일이 프로젝트 B 의 VS Code 창에 끼어들었다. 명령줄 도구는 `<폴더> -g <파일>`
/// 을 받아, 그 폴더의 창이 있으면 그 창에, 없으면 새 창으로 폴더째 연다.
///
/// macOS 는 앱 번들 안에 함께 오는 도구를 쓴다(`code` 셸 명령을 따로 설치하지 않아도 되고, Finder 로
/// 띄운 앱이 셸의 PATH 를 몰라도 된다). 그 밖은 PATH 의 `code` · `cursor`. 못 찾으면 `None` — 부르는
/// 쪽이 주소(`vscode://`)로 돌아간다.
pub fn editor_cli(scheme: &str) -> Option<std::path::PathBuf> {
    let (app, bin) = match scheme {
        "vscode" => ("Visual Studio Code", "code"),
        "cursor" => ("Cursor", "cursor"),
        _ => return None,
    };
    cli_path(app, bin)
}

#[cfg(target_os = "macos")]
fn cli_path(app: &str, bin: &str) -> Option<std::path::PathBuf> {
    let mut roots = vec![std::path::PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(Path::new(&home).join("Applications"));
    }
    roots
        .iter()
        .map(|r| {
            r.join(format!("{app}.app"))
                .join("Contents/Resources/app/bin")
                .join(bin)
        })
        .find(|p| p.is_file())
}

#[cfg(not(target_os = "macos"))]
fn cli_path(_app: &str, bin: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    let names: Vec<String> = if cfg!(target_os = "windows") {
        vec![format!("{bin}.cmd"), format!("{bin}.exe")]
    } else {
        vec![bin.to_string()]
    };
    std::env::split_paths(&path)
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

/// 명령줄 도구의 인자 — `<폴더>` 를 먼저 줘야 파일이 그 폴더의 창에 들어간다.
/// 폴더 자체를 열 때는 폴더만, 줄이 있으면 `-g <파일>:<줄>`.
pub fn editor_cli_args(root: &Path, abs: &Path, line: Option<u32>) -> Vec<std::ffi::OsString> {
    let mut args = vec![root.as_os_str().to_os_string()];
    if abs == root {
        return args;
    }
    match line {
        Some(n) => {
            args.push("-g".into());
            let mut target = abs.as_os_str().to_os_string();
            target.push(format!(":{n}"));
            args.push(target);
        }
        None => args.push(abs.as_os_str().to_os_string()),
    }
    args
}

/// `vscode://file/<절대경로>[:<줄>:1]`.
///
/// 경로는 퍼센트 인코딩한다 — 공백 · `#` · `?` 가 주소를 끊는다. `/` 와 `:`(Windows
/// 드라이브 문자)는 그대로 둔다. 역슬래시는 `/` 로 바꾸고, `C:/…` 처럼 `/` 로
/// 시작하지 않으면 앞에 붙인다. 줄 번호는 u32 라 주소를 깨뜨릴 수 없다.
pub fn editor_uri(scheme: &str, abs: &Path, line: Option<u32>) -> String {
    let raw = abs.to_string_lossy().replace('\\', "/");
    let mut path = String::with_capacity(raw.len() + 8);
    if !raw.starts_with('/') {
        path.push('/');
    }
    for b in raw.bytes() {
        let keep =
            b.is_ascii_alphanumeric() || matches!(b, b'/' | b':' | b'-' | b'.' | b'_' | b'~');
        if keep {
            path.push(b as char);
        } else {
            path.push_str(&format!("%{b:02X}"));
        }
    }
    match line {
        Some(n) => format!("{scheme}://file{path}:{n}:1"),
        None => format!("{scheme}://file{path}"),
    }
}

/// 설정 화면의 「자동」 옆에 무엇을 찾았는지 보여 준다 — `vscode` · `cursor` · `system`.
#[tauri::command]
#[specta::specta]
pub fn detect_editor() -> String {
    match detect_installed() {
        EditorChoice::Uri(s) => s.to_string(),
        _ => "system".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn vscode() -> EditorChoice {
        EditorChoice::Uri("vscode")
    }

    #[test]
    fn auto_values_detect() {
        for raw in ["", "  ", "auto", LEGACY_DEFAULT, " code \"%path\" "] {
            assert_eq!(choose(raw, vscode), vscode(), "{raw:?}");
        }
    }

    #[test]
    fn named_choices() {
        let never = || panic!("auto 가 아니면 찾지 않는다");
        assert_eq!(choose("vscode", never), EditorChoice::Uri("vscode"));
        assert_eq!(choose("cursor", never), EditorChoice::Uri("cursor"));
        assert_eq!(choose("system", never), EditorChoice::System);
    }

    /// 사용자가 적은 명령은 그대로 — 옛 기본값과 한 글자라도 다르면 고른 것이다.
    #[test]
    fn anything_else_is_a_template() {
        let never = || panic!("템플릿은 찾지 않는다");
        assert_eq!(
            choose("code -g \"%path:%line\"", never),
            EditorChoice::Template("code -g \"%path:%line\"".into())
        );
        assert_eq!(
            choose("subl %path", never),
            EditorChoice::Template("subl %path".into())
        );
    }

    #[test]
    fn uri_with_line() {
        let p = PathBuf::from("/Users/me/proj/src/main.rs");
        assert_eq!(
            editor_uri("vscode", &p, Some(42)),
            "vscode://file/Users/me/proj/src/main.rs:42:1"
        );
        assert_eq!(
            editor_uri("cursor", &p, None),
            "cursor://file/Users/me/proj/src/main.rs"
        );
    }

    /// 공백 · `#` · `?` · 한글이 주소를 끊거나 깨뜨리지 않는다.
    #[test]
    fn uri_percent_encodes() {
        let p = PathBuf::from("/tmp/내 폴더/a#b?.md");
        assert_eq!(
            editor_uri("vscode", &p, None),
            "vscode://file/tmp/%EB%82%B4%20%ED%8F%B4%EB%8D%94/a%23b%3F.md"
        );
    }

    /// 폴더가 먼저 — 그래야 파일이 그 프로젝트의 창으로 간다.
    #[test]
    fn cli_args_put_the_project_first() {
        let root = PathBuf::from("/Users/me/proj");
        let file = root.join("src/a b.rs");
        assert_eq!(
            editor_cli_args(&root, &root, None),
            vec![root.clone().into_os_string()]
        );
        assert_eq!(
            editor_cli_args(&root, &file, None),
            vec![root.clone().into_os_string(), file.clone().into_os_string()]
        );
        assert_eq!(
            editor_cli_args(&root, &file, Some(7)),
            vec![
                root.into_os_string(),
                "-g".into(),
                "/Users/me/proj/src/a b.rs:7".into()
            ]
        );
    }

    #[test]
    fn cli_only_for_known_editors() {
        assert_eq!(editor_cli("system"), None);
        assert_eq!(editor_cli("subl"), None);
    }

    #[test]
    fn uri_windows_drive() {
        let p = PathBuf::from(r"C:\Users\me\a b.rs");
        assert_eq!(
            editor_uri("vscode", &p, Some(3)),
            "vscode://file/C:/Users/me/a%20b.rs:3:1"
        );
    }

    /// 주입 시도 — 셸을 거치지 않지만, 주소의 구분자가 될 글자는 전부 인코딩된다.
    #[test]
    fn uri_has_no_raw_separators() {
        let p = PathBuf::from("/tmp/$(id)&x;y'z\".rs");
        let uri = editor_uri("vscode", &p, None);
        let tail = uri.trim_start_matches("vscode://file");
        assert!(
            !tail.contains(['$', '(', ')', '&', ';', '\'', '"', ' ']),
            "{uri}"
        );
    }
}
