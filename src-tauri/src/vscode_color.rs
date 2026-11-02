//! 프로젝트 색 → VS Code 창 색 (2026-11-03).
//!
//! 프로젝트 ▾ 목록에서 색을 고르면 그 프로젝트의 `.vscode/settings.json` 에
//! `workbench.colorCustomizations` 의 제목 표시줄 색을 맞춘다 — VS Code 창도 앱의 윗줄 띠와 같은 색이
//! 되어 창 여럿 사이에서 갈린다(Peacock 확장과 같은 자리). 「색 없음」 이면 이 모듈이 쓰는 키만 걷는다.
//!
//! **주석 · 끝 쉼표가 있는 settings.json(JSONC)은 건드리지 않는다.** 엄격한 JSON 으로 읽히지 않으면
//! 다시 쓰는 순간 사용자의 주석이 사라진다(config.toml 주석 유실의 교훈) — 그 경우 `Skipped` 로 알린다.
//! 이 모듈이 쓰는 키 밖의 설정 · 키 순서는 그대로 둔다(`serde_json` 의 `preserve_order`).

use std::path::Path;

use serde_json::{Map, Value};

/// 이 모듈이 소유하는 `workbench.colorCustomizations` 키 — 걷을 때 이것만 걷는다.
const OWNED_KEYS: &[&str] = &[
    "titleBar.activeBackground",
    "titleBar.activeForeground",
    "titleBar.inactiveBackground",
    "titleBar.inactiveForeground",
    "titleBar.border",
];

const SETTINGS_REL: &str = ".vscode/settings.json";

/// 결과 — 프런트가 「VS Code 색도 바꿨어요」 · 「주석이 있어 못 고쳤어요」 를 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum VscodeColorOutcome {
    /// 색을 썼다.
    Applied,
    /// 우리 키를 걷었다(또는 걷을 것이 없었다).
    Cleared,
    /// 파일이 엄격한 JSON 이 아니라(주석 · 끝 쉼표) 손대지 않았다.
    Skipped,
}

/// 앱 토큰(`tokens.css` 의 밝은 `[data-pc]`)과 같은 색. VS Code 는 앱 테마를 모르므로 한 벌만.
fn hex_of(color: &str) -> Option<&'static str> {
    Some(match color {
        "slate" => "#6b7280",
        "green" => "#12a06b",
        "blue" => "#2f7fd8",
        "violet" => "#7c5cd6",
        "amber" => "#c2891b",
        "rose" => "#d05470",
        "teal" => "#0f9a99",
        "orange" => "#d2703a",
        _ => return None,
    })
}

/// 배경 위 글자색 — 밝기(상대 휘도)로 흰 글자 · 짙은 글자를 고른다.
fn foreground_for(hex: &str) -> &'static str {
    let ch = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0) as f64 / 255.0;
    let lin = |c: f64| {
        if c <= 0.03928 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let l = 0.2126 * lin(ch(1)) + 0.7152 * lin(ch(3)) + 0.0722 * lin(ch(5));
    // 흰 글자 대비와 짙은 글자(#1f1f1f, 휘도 ≈ 0.0137) 대비를 견줘 큰 쪽.
    let on_white = 1.05 / (l + 0.05);
    let on_dark = (l + 0.05) / (0.0137 + 0.05);
    if on_white >= on_dark {
        "#ffffff"
    } else {
        "#1f1f1f"
    }
}

/// 순수 변환 — 지금 내용(없으면 `None`)과 색으로 새 내용을 만든다. `Ok(None)` 은 「파일을 쓰지 않는다」
/// (걷을 것이 없거나, 걷고 나니 빈 설정이라 지운다는 뜻은 [`apply`] 가 가른다).
pub fn render(
    existing: Option<&str>,
    color: Option<&str>,
) -> Result<Option<String>, VscodeColorOutcome> {
    let mut root: Map<String, Value> = match existing.map(str::trim) {
        None | Some("") => Map::new(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(m)) => m,
            _ => return Err(VscodeColorOutcome::Skipped),
        },
    };
    let hex = color.and_then(hex_of);
    let mut custom = match root.remove("workbench.colorCustomizations") {
        Some(Value::Object(m)) => m,
        Some(other) if hex.is_none() => {
            // 우리 것이 아닌 모양 — 걷을 때는 그대로 돌려놓는다.
            root.insert("workbench.colorCustomizations".into(), other);
            return Ok(None);
        }
        _ => Map::new(),
    };
    let before = custom.clone();
    for k in OWNED_KEYS {
        custom.remove(*k);
    }
    if let Some(bg) = hex {
        let fg = foreground_for(bg);
        custom.insert("titleBar.activeBackground".into(), bg.into());
        custom.insert("titleBar.activeForeground".into(), fg.into());
        custom.insert(
            "titleBar.inactiveBackground".into(),
            format!("{bg}cc").into(),
        );
        custom.insert(
            "titleBar.inactiveForeground".into(),
            format!("{fg}99").into(),
        );
        custom.insert("titleBar.border".into(), bg.into());
    } else if custom == before {
        return Ok(None); // 걷을 것이 없었다 — 파일을 다시 쓰지 않는다.
    }
    if !custom.is_empty() {
        root.insert(
            "workbench.colorCustomizations".into(),
            Value::Object(custom),
        );
    }
    let mut out = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|_| VscodeColorOutcome::Skipped)?;
    out.push('\n');
    Ok(Some(out))
}

/// 프로젝트 폴더의 `.vscode/settings.json` 에 색을 맞춘다. 마지막 구간이 링크면 거부한다.
pub fn apply(root: &Path, color: Option<&str>) -> Result<VscodeColorOutcome, String> {
    let path = crate::path_guard::secure_join_managed(root, SETTINGS_REL)?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let next = match render(existing.as_deref(), color) {
        Ok(next) => next,
        Err(outcome) => return Ok(outcome),
    };
    let done = if color.and_then(hex_of).is_some() {
        VscodeColorOutcome::Applied
    } else {
        VscodeColorOutcome::Cleared
    };
    let Some(text) = next else { return Ok(done) };
    // 걷고 나니 빈 설정이고 처음부터 우리가 만든 파일이었다면(내용이 우리 키뿐) 파일을 지운다.
    if text.trim() == "{}" {
        if existing.is_some() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            if let Some(dir) = path.parent() {
                let _ = std::fs::remove_dir(dir); // 비어 있을 때만 지워진다
            }
        }
        return Ok(done);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn writes_title_bar_into_a_new_file_and_keeps_other_settings() {
        let out = render(None, Some("blue")).unwrap().unwrap();
        let v = parse(&out);
        assert_eq!(
            v["workbench.colorCustomizations"]["titleBar.activeBackground"],
            "#2f7fd8"
        );
        assert_eq!(
            v["workbench.colorCustomizations"]["titleBar.activeForeground"],
            "#ffffff"
        );

        let mine = r##"{"editor.tabSize": 2, "workbench.colorCustomizations": {"editor.background": "#000000"}}"##;
        let v = parse(&render(Some(mine), Some("teal")).unwrap().unwrap());
        assert_eq!(v["editor.tabSize"], 2);
        assert_eq!(
            v["workbench.colorCustomizations"]["editor.background"],
            "#000000"
        );
        assert_eq!(
            v["workbench.colorCustomizations"]["titleBar.activeBackground"],
            "#0f9a99"
        );
    }

    #[test]
    fn clearing_removes_only_our_keys() {
        let set = render(
            Some(r##"{"a": 1, "workbench.colorCustomizations": {"x": "#111111"}}"##),
            Some("rose"),
        )
        .unwrap()
        .unwrap();
        let v = parse(&render(Some(&set), None).unwrap().unwrap());
        assert_eq!(v["a"], 1);
        assert_eq!(
            v["workbench.colorCustomizations"],
            serde_json::json!({ "x": "#111111" })
        );
        // 우리 키만 있던 파일은 빈 객체가 된다 — `apply` 가 지운다.
        let only = render(None, Some("amber")).unwrap().unwrap();
        assert_eq!(render(Some(&only), None).unwrap().unwrap().trim(), "{}");
        // 걷을 것이 없으면 쓰지 않는다.
        assert_eq!(render(Some(r#"{"a": 1}"#), None).unwrap(), None);
        assert_eq!(render(None, None).unwrap(), None);
    }

    #[test]
    fn jsonc_with_comments_is_left_alone() {
        let jsonc = "{\n  // 내 설정\n  \"a\": 1,\n}";
        assert_eq!(
            render(Some(jsonc), Some("green")),
            Err(VscodeColorOutcome::Skipped)
        );
        assert_eq!(
            render(Some("[1]"), Some("green")),
            Err(VscodeColorOutcome::Skipped)
        );
    }

    #[test]
    fn light_backgrounds_get_dark_text() {
        assert_eq!(foreground_for("#2f7fd8"), "#ffffff");
        assert_eq!(foreground_for("#f5f5f5"), "#1f1f1f");
    }

    #[test]
    fn apply_creates_then_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            apply(dir.path(), Some("violet")).unwrap(),
            VscodeColorOutcome::Applied
        );
        let file = dir.path().join(".vscode/settings.json");
        assert!(std::fs::read_to_string(&file).unwrap().contains("#7c5cd6"));
        assert_eq!(
            apply(dir.path(), None).unwrap(),
            VscodeColorOutcome::Cleared
        );
        assert!(!file.exists());
        assert!(!dir.path().join(".vscode").exists());
        std::fs::create_dir_all(dir.path().join(".vscode")).unwrap();
        std::fs::write(&file, "{ /* keep */ }").unwrap();
        assert_eq!(
            apply(dir.path(), Some("blue")).unwrap(),
            VscodeColorOutcome::Skipped
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ /* keep */ }");
    }
}
