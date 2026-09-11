//! 설치된 VS Code 확장(`oculpm.ocul-pm`) 감지 — 플랜 `vscode-extension-round`
//! `{#app-editor-open}`.
//!
//! `code --list-extensions` 를 부르지 않는 이유: 패키징된 .app 은 셸 PATH 를
//! 물려받지 않아 `code` 가 없다(external_editor.rs 의 캐비앗과 같다). 대신 VS Code
//! 가 확장을 푸는 자리(`~/.vscode/extensions/<publisher>.<name>-<version>`)를
//! 본다 — 디스크만 읽는 순수 판정이라 창 없이 단언할 수 있다.
//!
//! 확장이 있으면 일지 열기가 OS 기본 앱 대신 `vscode://oculpm.ocul-pm/open?entry=`
//! 로 간다 — 확장의 URI 핸들러가 파일을 열고 **사이드바 트리에서 그 일지를
//! 선택**한다. 없으면 예전 그대로 `open <path>`.

use std::path::{Path, PathBuf};

pub const EXTENSION_ID: &str = "oculpm.ocul-pm";

/// 감지된 편집기 — URI 스킴이 다르다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Editor {
    Stable,
    Insiders,
}

impl Editor {
    pub fn scheme(self) -> &'static str {
        match self {
            Editor::Stable => "vscode",
            Editor::Insiders => "vscode-insiders",
        }
    }
}

/// 확장 폴더 후보 — 안정판이 먼저.
fn extension_dirs(home: &Path) -> [(Editor, PathBuf); 2] {
    [
        (Editor::Stable, home.join(".vscode").join("extensions")),
        (
            Editor::Insiders,
            home.join(".vscode-insiders").join("extensions"),
        ),
    ]
}

/// `<dir>/oculpm.ocul-pm-<version>` 폴더가 하나라도 있으면 설치로 본다.
pub fn detect_in(home: &Path) -> Option<Editor> {
    let prefix = format!("{EXTENSION_ID}-");
    for (editor, dir) in extension_dirs(home) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let hit = entries.flatten().any(|e| {
            e.file_name().to_string_lossy().starts_with(&prefix)
                && e.file_type().map(|t| t.is_dir()).unwrap_or(false)
        });
        if hit {
            return Some(editor);
        }
    }
    None
}

pub fn detect() -> Option<Editor> {
    directories::BaseDirs::new().and_then(|b| detect_in(b.home_dir()))
}

/// 확장 URI 핸들러로 보낼 일지 링크. `entry` 는 절대경로를 percent-encoding.
pub fn entry_uri(editor: Editor, abs: &Path) -> String {
    format!(
        "{}://{EXTENSION_ID}/open?entry={}",
        editor.scheme(),
        percent_encode(&abs.to_string_lossy())
    )
}

/// `encodeURIComponent` 와 같은 집합 — `A-Z a-z 0-9 - _ . ! ~ * ' ( )` 만 남긴다.
/// 확장 쪽(`extension/src/deeplink.ts`)과 대칭.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_stable_before_insiders_and_ignores_files() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(detect_in(home.path()), None);
        let ins = home
            .path()
            .join(".vscode-insiders/extensions/oculpm.ocul-pm-0.0.1");
        std::fs::create_dir_all(&ins).unwrap();
        assert_eq!(detect_in(home.path()), Some(Editor::Insiders));
        // 파일(폴더 아님)은 무시 — 찌꺼기 .obsolete 마커 등.
        let stable_dir = home.path().join(".vscode/extensions");
        std::fs::create_dir_all(&stable_dir).unwrap();
        std::fs::write(stable_dir.join("oculpm.ocul-pm-9.9.9"), b"").unwrap();
        assert_eq!(detect_in(home.path()), Some(Editor::Insiders));
        std::fs::create_dir_all(stable_dir.join("oculpm.ocul-pm-0.0.1")).unwrap();
        assert_eq!(detect_in(home.path()), Some(Editor::Stable));
    }

    #[test]
    fn entry_uri_percent_encodes_like_encode_uri_component() {
        let uri = entry_uri(
            Editor::Stable,
            Path::new("/Users/me/한 프로젝트/.oculpm/journal/20260911/Chores/1_chore_x.md"),
        );
        assert_eq!(
            uri,
            "vscode://oculpm.ocul-pm/open?entry=%2FUsers%2Fme%2F%ED%95%9C%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%2F.oculpm%2Fjournal%2F20260911%2FChores%2F1_chore_x.md"
        );
        assert!(entry_uri(Editor::Insiders, Path::new("/p")).starts_with("vscode-insiders://"));
    }
}
