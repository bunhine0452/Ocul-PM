//! 테마 파일화 (Osaurus 벤치마크 라운드 Phase 4 — `docs/20260831_osaurus-bench/03-themes.md`).
//!
//! 프리셋 5종이 `src/styles/tokens.css` 에 하드코딩돼 있어 사용자가 색을
//! 만들 수도, 주고받을 수도, 프로젝트마다 다르게 둘 수도 없었다. 이 모듈이
//! 테마를 **파일**로 만든다.
//!
//! ## 규약
//!
//! - **키는 CSS 변수 이름 그대로다** (D3). `--bg-window` 를 `colors.background`
//!   같은 이름으로 옮기지 않는다 — `tokens.css` 가 이미 단일 SSOT 이므로 매핑
//!   표를 만들면 그것이 영원한 부채가 된다.
//! - 저장 위치는 `.oculpm` **밖**, 앱 데이터다 (`app_data_dir()/themes/<uuid>.json`)
//!   — 테마는 프로젝트가 아니라 사람에게 속한다.
//! - `tokens` 는 **부분 지정**이다. 빠진 토큰은 가족(light/dark) 기본값을
//!   상속하므로 "강조색만 바꾼 테마" 가 다섯 줄로 성립한다.
//! - 허용 토큰은 **화이트리스트**다. 밖의 키는 거부하고 사유를 돌려준다
//!   (인라인 스타일로 임의 CSS 를 주입하는 경로를 구조적으로 없앤다).
//!
//! 프런트의 편집기 그룹(`src/features/theme/schema.ts`)과 이 목록이 어긋나면
//! `src/__tests__/theme_schema.test.ts` 가 막는다 — 두 언어에 같은 목록이
//! 사는 유일한 이유는 검증이 신뢰 경계(백엔드)에 있어야 하기 때문이다.

pub mod store;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::app_error::AppError;

/// 스키마 표식. 올릴 때는 파서가 옛 값을 함께 받아야 한다.
pub const SCHEMA_V1: &str = "v1";

/// 임포트 파일 크기 상한 (256KB). 토큰 31개짜리 JSON 은 2KB 도 안 된다 —
/// 이 상한은 "실수로 고른 남의 파일" 을 막는 선이지 압축률 경쟁이 아니다.
pub const MAX_THEME_BYTES: u64 = 256 * 1024;

/// 값 하나의 길이 상한. 가장 긴 정상 값(`rgba(255,122,102,0.16)`)이 22자다.
const MAX_VALUE_LEN: usize = 64;

/// 이름 길이 상한 (문자 수).
const MAX_NAME_CHARS: usize = 64;

/// 테마가 칠할 수 있는 토큰 — **다섯 그룹**이고, 편집기 섹션과 1:1 이다.
///
/// 트리거 색(`--t-*`)·diff·터미널 ANSI 는 일부러 뺐다. 그것들은 의미색이라
/// 가족에서 상속돼야 하고, 편집기에 노출하지 않는 토큰을 임포트로만 칠할 수
/// 있게 하면 "되돌릴 방법이 없는 색" 이 생긴다.
pub const ALLOWED_TOKENS: &[&str] = &[
    // 배경
    "--bg-window",
    "--bg-sidebar",
    "--bg-content",
    "--bg-card",
    "--bg-inset",
    "--bg-hover",
    "--bg-active",
    // 글자
    "--text",
    "--text-2",
    "--text-3",
    "--text-on-accent",
    // 강조
    "--accent",
    "--accent-strong",
    "--accent-text",
    "--accent-soft",
    "--accent-ring",
    // 경계·구분
    "--sep",
    "--sep-strong",
    "--border-card",
    // 상태색
    "--ok",
    "--ok-text",
    "--ok-soft",
    "--warn",
    "--warn-text",
    "--warn-soft",
    "--danger",
    "--danger-text",
    "--danger-soft",
    "--info",
    "--info-text",
    "--info-soft",
];

/// 테마가 강조를 **소유**했는지 판정할 때 보는 다섯 토큰.
///
/// 하나도 지정하지 않았으면 사용자가 고른 `data-accent` 를 유지한다 — 그러지
/// 않으면 "배경만 바꾼 테마" 를 골랐다는 이유로 강조색 선택이 조용히 사라진다.
pub const ACCENT_TOKENS: &[&str] = &[
    "--accent",
    "--accent-strong",
    "--accent-text",
    "--accent-soft",
    "--accent-ring",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ThemeMetadata {
    /// UUID v4. 임포트할 때는 **버리고 새로 발급**한다 (남의 id 충돌 방지).
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    /// ISO8601. 없으면 저장 시점을 찍는다.
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_version() -> String {
    "1.0".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ThemeFile {
    /// 항상 `"v1"`.
    pub oculpm_theme: String,
    pub metadata: ThemeMetadata,
    /// `"light"` | `"dark"` — 기존 `data-theme` 가족을 그대로 태운다. 코드
    /// 에디터·hljs·스크롤바·글래스가 전부 이 축을 보므로 반드시 있어야 한다.
    pub family: String,
    #[serde(default)]
    pub is_built_in: bool,
    #[serde(default)]
    pub follows_system_accent: bool,
    /// 부분 지정 가능. 빠진 토큰은 가족 기본값을 상속한다.
    #[serde(default)]
    pub tokens: BTreeMap<String, String>,
}

impl ThemeFile {
    /// 강조 5토큰 중 하나라도 지정했나 — `data-accent` 유지 여부를 가른다.
    pub fn owns_accent(&self) -> bool {
        self.follows_system_accent || ACCENT_TOKENS.iter().any(|k| self.tokens.contains_key(*k))
    }
}

fn err(code: &str, detail: impl Into<String>) -> AppError {
    AppError::new(code, detail)
}

/// 색 문자열인가 — hex 또는 `rgb()/rgba()/hsl()/hsla()` 만.
///
/// 파서를 만들지 않는다(설계 §1). 대신 **모양이 아닌 문자를 전부 거부**한다:
/// 여는 괄호 하나, 닫는 괄호 하나, 그 안은 숫자·구분자뿐이라 `var()`·`url()`·
/// `;` 로 인라인 스타일을 빠져나가는 경로가 남지 않는다.
pub fn is_color_value(raw: &str) -> bool {
    let v = raw.trim();
    if v.is_empty() || v.len() > MAX_VALUE_LEN {
        return false;
    }
    if let Some(hex) = v.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let Some(open) = v.find('(') else {
        return false;
    };
    let func = &v[..open];
    if !matches!(func, "rgb" | "rgba" | "hsl" | "hsla") {
        return false;
    }
    let Some(rest) = v.strip_suffix(')') else {
        return false;
    };
    let inner = &rest[open + 1..];
    !inner.is_empty()
        && inner.bytes().all(|b| {
            b.is_ascii_digit() || matches!(b, b'.' | b',' | b'%' | b'/' | b' ' | b'-' | b'+')
        })
}

/// 프로젝트 바인딩에 쓸 수 있는 값인가.
///
/// 바인딩이 저장하는 것은 **설정의 `theme` 값과 같은 축**이다 —
/// `"dark"` · `"solarized"` 같은 내장 값이거나 `"custom:<uuid>"` 다. 별도
/// 이름 체계를 만들지 않는 이유는 D3 과 같다: 축이 둘이면 매핑이 생긴다.
pub fn is_valid_binding(value: &str) -> bool {
    match value.strip_prefix("custom:") {
        Some(id) => is_valid_id(id),
        None => is_valid_id(value),
    }
}

/// 파일 이름으로 쓸 수 있는 id 인가 — 경로 탈출을 구조적으로 막는다.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

/// 디스크·임포트에서 온 테마를 검증하고 **정규화**한다.
///
/// 정규화가 하는 일: 이름 trim · 빈 버전 채우기 · `is_built_in` 강제 false ·
/// 값 trim. 검증이 막는 일: 스키마 버전 · 가족 · 화이트리스트 밖 토큰 ·
/// 색이 아닌 값.
pub fn validate(mut theme: ThemeFile) -> Result<ThemeFile, AppError> {
    if theme.oculpm_theme != SCHEMA_V1 {
        return Err(err(
            "theme_schema_version",
            format!(
                "unsupported theme schema {:?} (expected {SCHEMA_V1})",
                theme.oculpm_theme
            ),
        ));
    }

    theme.metadata.name = theme.metadata.name.trim().to_string();
    if theme.metadata.name.is_empty() {
        return Err(err("theme_name_required", "theme name is empty"));
    }
    if theme.metadata.name.chars().count() > MAX_NAME_CHARS {
        return Err(err(
            "theme_name_too_long",
            format!("theme name exceeds {MAX_NAME_CHARS} characters"),
        ));
    }
    if theme.metadata.version.trim().is_empty() {
        theme.metadata.version = default_version();
    }

    if theme.family != "light" && theme.family != "dark" {
        return Err(err(
            "theme_bad_family",
            format!(
                "family must be \"light\" or \"dark\", got {:?}",
                theme.family
            ),
        ));
    }

    if theme.tokens.len() > ALLOWED_TOKENS.len() {
        return Err(err(
            "theme_token_not_allowed",
            format!(
                "theme declares {} tokens, more than exist",
                theme.tokens.len()
            ),
        ));
    }

    let mut normalized: BTreeMap<String, String> = BTreeMap::new();
    for (key, value) in theme.tokens.into_iter() {
        if !ALLOWED_TOKENS.contains(&key.as_str()) {
            return Err(err(
                "theme_token_not_allowed",
                format!("token {key:?} is not a themeable token"),
            ));
        }
        let value = value.trim().to_string();
        if !is_color_value(&value) {
            return Err(err(
                "theme_value_invalid",
                format!("token {key:?} has a value that is not a color: {value:?}"),
            ));
        }
        normalized.insert(key, value);
    }
    theme.tokens = normalized;

    // 디스크의 내장 표식은 믿지 않는다 — 내장 5종은 프런트가 정적으로 들고
    // 있고, 파일로 존재하는 테마는 정의상 사용자 것이다 (설계 §3).
    theme.is_built_in = false;

    Ok(theme)
}

/// 새 UUID · 발행 시각을 채운 사용자 테마. 임포트와 "새 테마" 가 함께 쓴다.
pub fn stamp_new(mut theme: ThemeFile, now: String) -> ThemeFile {
    theme.metadata.id = uuid::Uuid::new_v4().to_string();
    theme.metadata.created_at = now.clone();
    theme.metadata.updated_at = now;
    theme.is_built_in = false;
    theme
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme(tokens: &[(&str, &str)]) -> ThemeFile {
        ThemeFile {
            oculpm_theme: SCHEMA_V1.to_string(),
            metadata: ThemeMetadata {
                id: "id".into(),
                name: "미드나이트 코랄".into(),
                version: "1.0".into(),
                author: None,
                created_at: "2026-09-01T00:00:00+09:00".into(),
                updated_at: "2026-09-01T00:00:00+09:00".into(),
            },
            family: "dark".into(),
            is_built_in: false,
            follows_system_accent: false,
            tokens: tokens
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn accepts_hex_and_functional_colors() {
        for ok in [
            "#fff",
            "#ffff",
            "#141416",
            "#141416ff",
            "rgba(255,122,102,0.16)",
            "rgb(20 20 22 / 50%)",
            "hsl(160, 60%, 40%)",
        ] {
            assert!(is_color_value(ok), "{ok} should be a color");
        }
    }

    #[test]
    fn rejects_injection_and_indirection() {
        for bad in [
            "red",
            "var(--evil)",
            "url(http://x)",
            "#12345",
            "rgba(0,0,0,0.5); background:url(x)",
            "rgb(calc(1+1))",
            "",
            "#gggggg",
        ] {
            assert!(!is_color_value(bad), "{bad} must be rejected");
        }
    }

    #[test]
    fn validate_rejects_tokens_outside_the_whitelist() {
        let e = validate(theme(&[("--evil", "#000000")])).unwrap_err();
        assert_eq!(e.code, "theme_token_not_allowed");
        let e = validate(theme(&[("--bg-window", "expression(alert(1))")])).unwrap_err();
        assert_eq!(e.code, "theme_value_invalid");
    }

    #[test]
    fn validate_normalizes_and_forces_user_ownership() {
        let mut t = theme(&[("--accent", "  #ff7a66 ")]);
        t.metadata.name = "  코랄  ".into();
        t.metadata.version = "".into();
        t.is_built_in = true;
        let out = validate(t).unwrap();
        assert_eq!(out.metadata.name, "코랄");
        assert_eq!(out.metadata.version, "1.0");
        assert_eq!(out.tokens["--accent"], "#ff7a66");
        assert!(!out.is_built_in);
    }

    #[test]
    fn validate_guards_schema_family_and_name() {
        let mut t = theme(&[]);
        t.oculpm_theme = "v2".into();
        assert_eq!(validate(t).unwrap_err().code, "theme_schema_version");

        let mut t = theme(&[]);
        t.family = "sepia".into();
        assert_eq!(validate(t).unwrap_err().code, "theme_bad_family");

        let mut t = theme(&[]);
        t.metadata.name = "   ".into();
        assert_eq!(validate(t).unwrap_err().code, "theme_name_required");
    }

    #[test]
    fn partial_tokens_are_the_normal_case() {
        let out = validate(theme(&[("--accent", "#ff7a66")])).unwrap();
        assert_eq!(out.tokens.len(), 1);
        assert!(out.owns_accent());
        assert!(!validate(theme(&[("--bg-window", "#141416")]))
            .unwrap()
            .owns_accent());
    }

    #[test]
    fn ids_that_could_escape_the_themes_dir_are_rejected() {
        assert!(is_valid_id("9f2c-1234"));
        assert!(!is_valid_id("../../etc/passwd"));
        assert!(!is_valid_id("a/b"));
        assert!(!is_valid_id(""));
    }

    #[test]
    fn bindings_accept_builtin_values_and_custom_ids() {
        assert!(is_valid_binding("dark"));
        assert!(is_valid_binding("high-contrast"));
        assert!(is_valid_binding("custom:9f2c-1234"));
        assert!(!is_valid_binding("custom:../../etc"));
        assert!(!is_valid_binding("custom:"));
        assert!(!is_valid_binding("../evil"));
    }

    #[test]
    fn stamp_new_issues_a_fresh_id() {
        let a = stamp_new(theme(&[]), "now".into());
        let b = stamp_new(theme(&[]), "now".into());
        assert_ne!(a.metadata.id, b.metadata.id);
        assert!(is_valid_id(&a.metadata.id));
    }
}
