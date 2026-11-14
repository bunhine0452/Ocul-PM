//! Claude Code 테마 파일 — `~/.claude/themes/ocul.json` (2026-11-15, 계획 quality-round-20261115
//! `{#claude-theme}`).
//!
//! 앱의 터미널 색(라이트 · 다크 · 앱 강조색)으로 만든 Claude Code 사용자 테마를 **이 파일 하나에만**
//! 쓴다. 사용자가 Claude 안에서 `/theme` 으로 고른다 — Claude Code 의 `settings.json` 같은 다른 설정은
//! 읽지도 쓰지도 않는다(사용자 결정 11-15 「테마 파일만 두기」). 프로젝트 밖에 쓰는 두 번째 파일이다
//! (첫째는 `vscode_color.rs` 의 `.vscode/settings.json`). 테마는 프런트가 만든다
//! (`features/theme/claudeTheme.ts`) — 색의 정본이 tokens.css 라서. 여기는 모양을 검증하고 쓰기만 한다.
//!
//! - `~/.claude` 가 없으면(Claude Code 를 안 쓰는 기기) 아무것도 만들지 않는다. 먼저 확인하고 `themes/`
//!   는 `create_dir` 로 한 칸만 만든다 — `write_atomic` 의 `create_dir_all` 이 `~/.claude` 까지 만들지 않게.
//! - 쓰기는 같은 폴더의 임시 파일 → rename (`write_atomic`). 임시 이름은 `.tmp` 로 끝난다: Claude 의 테마
//!   감시는 `.json` 만 읽으므로 반쯤 쓴 파일을 테마로 읽지 않는다. 실패하면 임시 파일을 지운다.
//! - 내용(바이트)이 같으면 쓰지 않는다 — 창 여럿이 같은 내용을 보내도 파일과 mtime 이 그대로다.
//! - 홈은 `oculpm::paths::claude_code_home()` 한 자리(Windows 는 프로필). `CLAUDE_CONFIG_DIR` 은 보지
//!   않는다: Finder 로 띄운 앱은 셸의 환경변수를 물려받지 않아, 띄운 방법에 따라 쓰는 자리가 달라진다.
//!   대신 설정의 줄이 실제로 쓴 경로(없으면 찾아본 자리)를 보여 준다.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// `~/.claude/themes/` 안의 파일 이름 — Claude 의 `/theme` 목록에 이 이름으로 선다.
pub const FILE_NAME: &str = "ocul.json";

/// 한 파일에 담는 색의 상한 — 프런트가 보내는 것은 서른 남짓이다.
const MAX_OVERRIDES: usize = 64;

/// 덮을 바탕 — Claude Code 의 내장 테마 이름(앱 테마의 가족과 같은 둘).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeThemeBase {
    Light,
    Dark,
}

/// Claude Code 의 사용자 테마 — 내장 테마 하나 위에 색 몇 개를 덮는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ClaudeTheme {
    /// `/theme` 목록에 보이는 이름.
    pub name: String,
    pub base: ClaudeThemeBase,
    /// Claude 의 색 키 → `#rrggbb`. 파일에는 키 이름 순으로 적는다 — 같은 내용이면 같은 바이트.
    pub overrides: BTreeMap<String, String>,
}

/// 쓴 결과 — 설정의 줄이 무엇을 보여 줄지 가른다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ClaudeThemeOutcome {
    /// 새 내용을 썼다.
    Written { path: String },
    /// 같은 내용이라 손대지 않았다.
    Unchanged { path: String },
    /// `~/.claude` 가 없다 — 아무것도 만들지 않았다. `dir` 은 찾아본 자리.
    NoClaude { dir: String },
}

fn is_hex_color(v: &str) -> bool {
    v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Claude 의 색 키 모양 — 낱말 하나(`claude` · `diffAddedWord` · `rate_limit_fill`).
fn is_color_key(k: &str) -> bool {
    let mut bytes = k.bytes();
    k.len() <= 64
        && bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// 검증하고 파일 내용을 만든다 (순수). 색은 `#rrggbb` 만 받는다 — `red` · `#fff` · `rgb(…)` 는 거절.
pub fn render(theme: &ClaudeTheme) -> Result<String, String> {
    let name = theme.name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err(format!("invalid theme name: {:?}", theme.name));
    }
    if theme.overrides.len() > MAX_OVERRIDES {
        return Err(format!("too many colors: {}", theme.overrides.len()));
    }
    let mut overrides = BTreeMap::new();
    for (key, value) in &theme.overrides {
        if !is_color_key(key) {
            return Err(format!("invalid color key: {key:?}"));
        }
        if !is_hex_color(value) {
            return Err(format!("invalid color for {key}: {value:?}"));
        }
        overrides.insert(key.clone(), value.to_ascii_lowercase());
    }
    let clean = ClaudeTheme {
        name: name.to_string(),
        base: theme.base,
        overrides,
    };
    let mut text = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text)
}

/// `claude_dir`(보통 `~/.claude`) 아래 `themes/ocul.json` 을 맞춘다. 경로를 받는 이유: 시험이 임시 폴더를
/// 넘긴다 — `HOME` 을 바꾸면 같은 시험 바이너리에서 홈을 읽는 다른 시험과 경합한다.
pub fn write_to(claude_dir: &Path, theme: &ClaudeTheme) -> Result<ClaudeThemeOutcome, String> {
    let text = render(theme)?;
    if !claude_dir.is_dir() {
        return Ok(ClaudeThemeOutcome::NoClaude {
            dir: claude_dir.display().to_string(),
        });
    }
    let themes = claude_dir.join("themes");
    match std::fs::create_dir(&themes) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("{}: {e}", themes.display())),
    }
    let path = themes.join(FILE_NAME);
    let shown = path.display().to_string();
    if std::fs::read(&path).is_ok_and(|old| old == text.as_bytes()) {
        return Ok(ClaudeThemeOutcome::Unchanged { path: shown });
    }
    crate::oculpm::atomic_io::write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(ClaudeThemeOutcome::Written { path: shown })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn theme(pairs: &[(&str, &str)]) -> ClaudeTheme {
        ClaudeTheme {
            name: "Ocul".into(),
            base: ClaudeThemeBase::Dark,
            overrides: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    /// 임시 홈 — `.claude` 를 만들지 말지는 시험이 정한다.
    fn home(with_claude: bool) -> (tempfile::TempDir, std::path::PathBuf) {
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join(".claude");
        if with_claude {
            std::fs::create_dir(&claude).unwrap();
        }
        (home, claude)
    }

    #[test]
    fn nothing_is_created_without_a_claude_folder() {
        let (home, claude) = home(false);
        let out = write_to(&claude, &theme(&[("claude", "#34d095")])).unwrap();
        assert_eq!(
            out,
            ClaudeThemeOutcome::NoClaude {
                dir: claude.display().to_string()
            }
        );
        assert!(names(home.path()).is_empty(), "~/.claude 를 만들면 안 된다");
    }

    #[test]
    fn writes_the_theme_atomically_and_leaves_only_that_file() {
        let (_home, claude) = home(true);
        let out = write_to(
            &claude,
            &theme(&[("text", "#F1F4F1"), ("claude", "#34d095")]),
        )
        .unwrap();
        let themes = claude.join("themes");
        let path = themes.join(FILE_NAME);
        assert_eq!(
            out,
            ClaudeThemeOutcome::Written {
                path: path.display().to_string()
            }
        );
        // 임시 파일이 남지 않는다 — Claude 의 테마 감시가 보는 폴더에는 ocul.json 하나뿐.
        assert_eq!(names(&themes), vec![FILE_NAME.to_string()]);
        let text = std::fs::read_to_string(&path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["name"], "Ocul");
        assert_eq!(v["base"], "dark");
        assert_eq!(v["overrides"]["text"], "#f1f4f1", "색은 소문자로 적는다");
        // 키는 이름 순 — 프런트가 어떤 순서로 보내도 같은 바이트.
        assert!(text.find("\"claude\"").unwrap() < text.find("\"text\"").unwrap());

        // 내용이 바뀌면 다시 쓴다. 그래도 폴더에는 그 파일 하나다.
        let out = write_to(&claude, &theme(&[("claude", "#2570e0")])).unwrap();
        assert!(matches!(out, ClaudeThemeOutcome::Written { .. }));
        assert!(std::fs::read_to_string(&path).unwrap().contains("#2570e0"));
        assert_eq!(names(&themes), vec![FILE_NAME.to_string()]);
    }

    #[test]
    fn the_same_content_leaves_the_file_and_its_mtime_alone() {
        let (_home, claude) = home(true);
        let t = theme(&[("claude", "#34d095")]);
        write_to(&claude, &t).unwrap();
        let path = claude.join("themes").join(FILE_NAME);
        // 오래된 시각으로 돌려 둔다 — 다시 썼다면 지금 시각이 된다(같은 초 안에 돌아도 갈린다).
        let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000_000);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        let out = write_to(&claude, &t).unwrap();
        assert_eq!(
            out,
            ClaudeThemeOutcome::Unchanged {
                path: path.display().to_string()
            }
        );
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), old);
    }

    #[test]
    fn claude_settings_are_never_touched() {
        let (_home, claude) = home(true);
        let settings = claude.join("settings.json");
        let mine = b"{\n  // mine\n  \"theme\": \"dark\",\n}\n";
        std::fs::write(&settings, mine).unwrap();
        write_to(&claude, &theme(&[("claude", "#34d095")])).unwrap();
        assert_eq!(std::fs::read(&settings).unwrap(), mine);
        assert_eq!(
            names(&claude),
            vec!["settings.json".to_string(), "themes".to_string()]
        );
    }

    #[test]
    fn bad_colors_and_keys_are_refused_before_anything_is_written() {
        let (_home, claude) = home(true);
        for bad in [
            "red",
            "#fff",
            "#12345g",
            "rgb(1, 2, 3)",
            "#1234567",
            "",
            "34d095",
        ] {
            let err = write_to(&claude, &theme(&[("claude", bad)])).unwrap_err();
            assert!(err.contains("claude"), "{bad}: {err}");
        }
        for key in ["../x", "a b", "", "1abc", "text\n"] {
            assert!(
                write_to(&claude, &theme(&[(key, "#34d095")])).is_err(),
                "{key:?}"
            );
        }
        assert!(
            names(&claude).is_empty(),
            "거절하면 themes/ 도 만들지 않는다"
        );
    }
}
