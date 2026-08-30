//! LLM 산출물의 출력 언어 (docs/20260811_three-features/03-i18n.md §4.5).
//!
//! 이 모듈이 정하는 건 **AI 가 쓰는 문서의 언어**다 — 작업 일지·플래너 항목·
//! 회고처럼 `.oculpm/` 아래 디스크에 영구히 남는 것들. UI 언어(`language`)와
//! 의도적으로 **다른 설정 키**(`content_language`)를 읽는다: UI 는 언제든
//! 되돌릴 수 있지만 이미 쓰인 일지는 되돌릴 수 없어서, UI 를 영어로 바꿨다는
//! 이유만으로 일지가 조용히 영어로 넘어가면 언어가 섞인 이력이 남는다.
//!
//! ## 프롬프트 본문은 번역하지 않는다
//!
//! 각 프롬프트의 본문(지시문)은 한국어 그대로 두고, **출력 언어 지시 한 줄만**
//! 덧붙인다. 본문을 두 벌로 유지하면 한쪽만 고치는 드리프트가 반드시 생기는데,
//! 본문은 모델에게 주는 지시지 사용자가 읽는 문자열이 아니라서 두 벌을 유지할
//! 이득이 없다. LLM 은 한국어 지시 + 영어 출력 요구를 문제없이 처리한다.
//!
//! 예외는 `plan_dispatch_prompt` 처럼 **사용자가 복사해 외부 에이전트에
//! 붙여넣는** 프롬프트다 — 그건 사용자가 읽는 산출물이라 본문도 번역 대상이다.

use crate::db::Db;

/// 설정 키 — 프런트 `KEYS.contentLanguage` 와 같은 문자열이어야 한다.
const SETTING_KEY: &str = "content_language";

/// 산출물 언어. `Unset`(= 설정의 "system")은 지시를 붙이지 않는다 — 프롬프트
/// 본문이 한국어라 모델이 자연히 한국어로 답하고, 그게 기존 동작이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentLang {
    Korean,
    English,
    Unset,
}

impl ContentLang {
    /// 설정 문자열 → 언어. 알 수 없는 값은 `Unset` 으로 접는다 (DB 가 깨져도
    /// 프롬프트 생성이 실패하면 안 된다).
    pub fn from_setting(raw: Option<&str>) -> Self {
        match raw {
            Some("ko") => Self::Korean,
            Some("en") => Self::English,
            _ => Self::Unset,
        }
    }

    /// 프롬프트 끝에 덧붙일 출력 언어 지시. `Unset` 이면 빈 문자열.
    pub fn directive(self) -> &'static str {
        match self {
            Self::Korean => "\n\n출력 언어: 한국어로 작성하라.",
            Self::English => {
                "\n\nOutput language: write the entire response in English, \
                 including all section headings and field values."
            }
            Self::Unset => "",
        }
    }

    /// 시스템 프롬프트에 지시를 붙인 사본.
    pub fn apply(self, prompt: &str) -> String {
        format!("{prompt}{}", self.directive())
    }

    /// 두 벌 문구 중 하나를 고른다 — **LLM 을 안 거치는 산출물** 용.
    ///
    /// 프롬프트는 지시 한 줄로 끝나지만, 코드가 직접 조립하는 마크다운(결정적
    /// 요약 · 일지 폴백 문구)은 모델이 손대지 않으므로 여기서 갈라야 한다.
    /// Rust 에는 사전이 없고 대상이 수십 개뿐이라 사전을 새로 들이지 않는다.
    ///
    /// `Unset` 은 한국어 — 설정을 안 건드린 기존 사용자의 산출물이 조용히
    /// 바뀌면 안 된다.
    pub fn pick(self, ko: &'static str, en: &'static str) -> &'static str {
        match self {
            Self::English => en,
            _ => ko,
        }
    }
}

/// UI 언어 설정 키 — `content_language` 가 "system" 일 때의 폴백.
const UI_SETTING_KEY: &str = "language";

/// DB 에서 현재 산출물 언어를 읽는다. 조회 실패는 `Unset` — 설정 조회가
/// 안 된다고 일지 생성 자체가 막히면 안 된다.
///
/// ## "system" 은 UI 언어를 따른다
///
/// 프런트의 `getContentLang()` 과 **같은 규칙**이어야 한다 (i18n/index.ts).
/// 두 쪽이 어긋나면 영어 UI 사용자가 화면은 영어인데 일지는 한국어로 받는다 —
/// 설정을 한 번도 안 건드린 사람에게 그게 기본값이 되면 안 된다.
///
/// 다만 `language` 마저 "system" 이면 `Unset` 으로 남긴다. 그 해석은
/// `navigator.language`(웹뷰) 몫이라 Rust 가 알 수 없고, 여기서 OS 로케일을
/// 새로 추측하면 프런트와 또 다른 규칙이 하나 더 생긴다.
pub async fn current(db: &Db) -> ContentLang {
    let explicit = match db.settings_get(SETTING_KEY.to_string()).await {
        Ok(v) => ContentLang::from_setting(v.as_deref()),
        Err(_) => return ContentLang::Unset,
    };
    if explicit != ContentLang::Unset {
        return explicit;
    }
    match db.settings_get(UI_SETTING_KEY.to_string()).await {
        Ok(v) => ContentLang::from_setting(v.as_deref()),
        Err(_) => ContentLang::Unset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_values() {
        assert_eq!(ContentLang::from_setting(Some("ko")), ContentLang::Korean);
        assert_eq!(ContentLang::from_setting(Some("en")), ContentLang::English);
    }

    #[test]
    fn unknown_and_missing_fold_to_unset() {
        // "system" 은 명시적 미지정, 나머지는 깨진 값 — 둘 다 기존 동작 유지.
        assert_eq!(
            ContentLang::from_setting(Some("system")),
            ContentLang::Unset
        );
        assert_eq!(ContentLang::from_setting(Some("fr")), ContentLang::Unset);
        assert_eq!(ContentLang::from_setting(None), ContentLang::Unset);
    }

    #[test]
    fn unset_leaves_the_prompt_untouched() {
        // 기존 프로젝트가 설정을 건드리지 않았을 때 프롬프트가 한 글자도
        // 바뀌지 않아야 한다 — 그래야 이 기능이 회귀를 만들지 않는다.
        let p = "너는 작업 일지 작성기다.";
        assert_eq!(ContentLang::Unset.apply(p), p);
        assert_eq!(ContentLang::Unset.directive(), "");
    }

    #[test]
    fn english_directive_is_appended_after_the_body() {
        let out = ContentLang::English.apply("BODY");
        assert!(out.starts_with("BODY"), "본문이 앞에 그대로 남아야 한다");
        assert!(out.contains("English"));
    }

    #[test]
    fn korean_directive_is_appended() {
        let out = ContentLang::Korean.apply("BODY");
        assert!(out.starts_with("BODY"));
        assert!(out.contains("한국어"));
    }

    // `current()` 의 폴백 규칙 — 프런트 `getContentLang()` 과 같아야 한다.
    // 어긋나면 영어 UI 사용자가 화면은 영어인데 일지는 한국어로 받는다.

    async fn db_with(pairs: &[(&str, &str)]) -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        for (k, v) in pairs {
            db.settings_set(k.to_string(), v.to_string()).await.unwrap();
        }
        (dir, db)
    }

    #[tokio::test]
    async fn explicit_content_language_wins_over_ui() {
        let (_d, db) = db_with(&[("content_language", "ko"), ("language", "en")]).await;
        // 화면은 영어인데 일지는 한국어로 남기고 싶은 사용자 — 이 축을 나눈 이유다.
        assert_eq!(current(&db).await, ContentLang::Korean);
    }

    #[tokio::test]
    async fn system_content_language_follows_ui_language() {
        let (_d, db) = db_with(&[("content_language", "system"), ("language", "en")]).await;
        assert_eq!(current(&db).await, ContentLang::English);
    }

    #[tokio::test]
    async fn missing_content_language_also_follows_ui() {
        // 기존 프로젝트는 이 키가 아예 없다.
        let (_d, db) = db_with(&[("language", "en")]).await;
        assert_eq!(current(&db).await, ContentLang::English);
    }

    #[tokio::test]
    async fn both_unset_stays_unset() {
        // `language` 의 "system" 해석은 navigator.language 몫이라 Rust 가 모른다 —
        // 여기서 OS 로케일을 새로 추측하면 규칙이 하나 더 생긴다.
        let (_d, db) = db_with(&[("content_language", "system"), ("language", "system")]).await;
        assert_eq!(current(&db).await, ContentLang::Unset);
    }
}
