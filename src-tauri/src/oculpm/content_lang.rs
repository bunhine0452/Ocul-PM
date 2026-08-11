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
}

/// DB 에서 현재 산출물 언어를 읽는다. 조회 실패는 `Unset` — 설정 조회가
/// 안 된다고 일지 생성 자체가 막히면 안 된다.
pub async fn current(db: &Db) -> ContentLang {
    match db.settings_get(SETTING_KEY.to_string()).await {
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
        assert_eq!(ContentLang::from_setting(Some("system")), ContentLang::Unset);
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
}
