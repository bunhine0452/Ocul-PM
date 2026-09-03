//! 커맨드 경계의 오류 규약 (완성도 라운드 Phase 4, 2026-08-30).
//!
//! 275개 커맨드가 전부 `Result<_, String>` 이었다 — 프런트는 문자열을 정규식
//! 25개로 되짚어 i18n 키를 골랐고(`src/i18n/errors.ts`), Rust 쪽엔 한국어
//! 오류 문구가 46곳 섞여 있어 영어 UI 에 한국어가 튀었다. 이 타입이 계약이다:
//! **`code` 는 기계가 읽는 snake_case 식별자**(프런트가 i18n 키로 바꾼다),
//! **`detail` 은 사람이 읽는 영어 원문**(로그·복사용). 어느 쪽에도 UI 언어는
//! 없다.
//!
//! 도입 순서: 이 라운드는 `oculpm_*`·`acp_*` 커맨드를 옮겼다. 나머지는
//! `From<String>` 다리로 그대로 살고, `unknown` 코드로 프런트에 닿는다 —
//! 프런트 래퍼(`src/api/invoke.ts`)가 문자열과 이 구조체를 둘 다 받는다.

use std::fmt;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::oculpm::error::OculpmError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppError {
    /// snake_case 식별자 — `not_initialized`, `acp_not_running`, `unknown`.
    pub code: String,
    /// 영어 원문. 없을 수 있다(코드만으로 충분한 경우).
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: Some(detail.into()),
        }
    }

    pub fn code(code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: None,
        }
    }

    /// 아직 코드가 없는 오류 — 문자열 그대로. 프런트가 옛 정규식으로 되짚는다.
    pub fn unknown(detail: impl Into<String>) -> Self {
        Self::new("unknown", detail)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(d) => write!(f, "{}: {d}", self.code),
            None => f.write_str(&self.code),
        }
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::unknown(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::unknown(s)
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::new("io", e.to_string())
    }
}

impl From<crate::error::Error> for AppError {
    fn from(e: crate::error::Error) -> Self {
        Self::new("db", e.to_string())
    }
}

impl From<OculpmError> for AppError {
    fn from(e: OculpmError) -> Self {
        let code = match &e {
            OculpmError::Io { .. } => "io",
            OculpmError::InvalidTimezone(_) => "invalid_timezone",
            OculpmError::InvalidHHMM(_) => "invalid_hhmm",
            OculpmError::ConfigParse(_) => "config_parse",
            OculpmError::ConfigSerialize(_) => "config_serialize",
            OculpmError::InvalidConfig(_) => "invalid_config",
            OculpmError::A2aRejected(_) => "a2a_rejected",
            OculpmError::InvalidPath(_) => "invalid_path",
            OculpmError::ManagedBlockMismatch { .. } => "managed_block_mismatch",
            OculpmError::NdjsonLineTooLarge(..) => "ndjson_line_too_large",
            OculpmError::NdjsonLineHasNewline => "ndjson_line_has_newline",
            OculpmError::JsonParse { .. } => "json_parse",
            OculpmError::JsonSerialize(_) => "json_serialize",
            OculpmError::JsonDeserialize(_) => "json_deserialize",
            OculpmError::NotInitialized(_) => "not_initialized",
            OculpmError::InvalidSessionId(_) => "invalid_session_id",
            OculpmError::SessionNotFound { .. } => "session_not_found",
            OculpmError::ActorClosed => "actor_closed",
            OculpmError::Sqlite(_) => "sqlite",
            OculpmError::ForbiddenJournalPath { .. } => "forbidden_journal_path",
            OculpmError::NotImplemented => "not_implemented",
        };
        Self::new(code, e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oculpm_errors_get_stable_codes_and_english_detail() {
        let e = AppError::from(OculpmError::NotInitialized(7));
        assert_eq!(e.code, "not_initialized");
        assert!(e.detail.unwrap().contains("oculpm_init"));
        let s = AppError::from("plain".to_string());
        assert_eq!(s.code, "unknown");
        assert_eq!(String::from(s), "unknown: plain");
    }

    #[test]
    fn serializes_as_object_the_frontend_can_narrow() {
        let json = serde_json::to_string(&AppError::code("acp_not_running")).unwrap();
        assert_eq!(json, r#"{"code":"acp_not_running","detail":null}"#);
    }
}
