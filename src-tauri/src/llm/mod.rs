//! LLM provider abstraction.
//!
//! Each provider implementation lives in its own module. The trait deliberately
//! stays minimal — start with `chat` (non-streaming); streaming is added later
//! via Tauri `Channel`.

pub mod anthropic;
pub mod gemini;
pub mod nim;
pub mod openai;
pub mod reach;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChatOptions {
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub provider: String,
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("unknown provider: {0}")]
    UnknownProvider(String),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("api error ({status}): {body}")]
    ApiError { status: u16, body: String },

    #[error("parse: {0}")]
    Parse(String),
}

impl LlmError {
    /// 이 실패가 **서버에 닿지도 못한** 실패인가 (Phase 7 #offline-fallback).
    ///
    /// 오프라인 판정을 문자열로 하지 않는 이유는 하나다 — 429·401 은 네트워크가
    /// 멀쩡하다는 **증거**이고, 그 둘을 오프라인으로 읽으면 "연기" 가 "영원히
    /// 안 돎" 이 된다. `reqwest` 는 연결·타임아웃·요청 조립 실패를 구분해 두었고
    /// 여기서는 그것만 믿는다.
    pub fn is_transport(&self) -> bool {
        match self {
            LlmError::Http(e) => e.is_connect() || e.is_timeout() || e.is_request(),
            // 응답이 왔다 = 네트워크는 닿았다.
            LlmError::ApiError { .. } | LlmError::Parse(_) | LlmError::UnknownProvider(_) => false,
        }
    }
}

/// 프로바이더가 내놓는 모델 한 줄 (감사 라운드 2026-09-11 B2 — 모델 피커).
/// `label` 은 사람이 읽는 이름, 없으면 id 와 같다.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// 이 키로 쓸 수 있는 모델 목록. 설정 화면의 모델 칸이 datalist 로 띄운다 —
    /// 사용자가 모델 id 를 외워 치지 않게. 실패는 그대로 올린다(키가 틀렸다는
    /// 신호이기도 하다).
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError>;

    async fn chat(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
    ) -> Result<ChatResponse, LlmError>;
}

/// GET 응답을 성공이면 JSON 으로, 아니면 `ApiError` 로 — 다섯 프로바이더의
/// 모델 목록 경로가 전부 이걸 쓴다.
pub(crate) async fn json_or_api_error<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
) -> Result<T, LlmError> {
    let status = resp.status();
    if !status.is_success() {
        let body = error_body(resp).await;
        return Err(LlmError::ApiError {
            status: status.as_u16(),
            body,
        });
    }
    Ok(resp.json().await?)
}

/// 오류 응답 본문 상한. 프로바이더 오류는 그대로 프런트 `console.error` →
/// `oculpm.log` 로 흘러가는데, 본문을 통째로 실으면 하루 5.9MB 로그의 상당 부분이
/// 같은 429/5xx 본문 사본이었다(2026-08-30 감사). 사유는 첫 몇백 바이트에 있다.
const ERROR_BODY_CAP: usize = 512;

/// 실패 응답의 본문을 상한까지만 읽어 돌려준다 — 4 프로바이더의 오류 경로가
/// 전부 이걸 쓴다. UTF-8 경계에서 자른다.
pub(crate) async fn error_body(resp: reqwest::Response) -> String {
    let text = resp.text().await.unwrap_or_default();
    if text.len() <= ERROR_BODY_CAP {
        return text;
    }
    let cut = crate::text::floor_char_boundary(&text, ERROR_BODY_CAP);
    format!("{}… (+{} bytes)", &text[..cut], text.len() - cut)
}

pub fn create(name: &str, api_key: String) -> Result<Box<dyn LlmProvider>, LlmError> {
    match name {
        "anthropic" => Ok(Box::new(anthropic::Anthropic::new(api_key))),
        "gemini" => Ok(Box::new(gemini::Gemini::new(api_key))),
        "openai" => Ok(Box::new(openai::OpenAi::new(api_key))),
        // OpenRouter reuses the OpenAI-compatible client with a different base
        // URL + attribution headers.
        "openrouter" => Ok(Box::new(openai::OpenAi::openrouter(api_key))),
        "nim" => Ok(Box::new(nim::Nim::new(api_key))),
        other => Err(LlmError::UnknownProvider(other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 응답이 **온** 실패는 오프라인이 아니다 — 그 구분이 자동화의
    /// "연기 vs 실패" 와 모델 선택기의 흐림 표시를 동시에 떠받친다.
    #[test]
    fn a_reply_from_the_server_is_never_offline() {
        assert!(!LlmError::ApiError {
            status: 429,
            body: "rate limited".into()
        }
        .is_transport());
        assert!(!LlmError::ApiError {
            status: 401,
            body: "bad key".into()
        }
        .is_transport());
        assert!(!LlmError::Parse("bad json".into()).is_transport());
        assert!(!LlmError::UnknownProvider("nope".into()).is_transport());
    }
}
