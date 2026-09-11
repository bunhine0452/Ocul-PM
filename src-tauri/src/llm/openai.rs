use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{
    forward_sse_lines, json_or_api_error, ChatEvent, ChatOptions, ChatResponse, LlmError,
    LlmProvider, Message, ModelInfo, Role,
};

const BASE_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// OpenAI Chat Completions client. Also backs any OpenAI-compatible endpoint
/// (OpenRouter today; a custom `base_url` is a small future step) by varying
/// `base_url` / `provider` / the OpenRouter ranking headers — the request and
/// SSE shapes are identical.
pub struct OpenAi {
    api_key: String,
    client: reqwest::Client,
    base_url: &'static str,
    provider: &'static str,
    /// When true, send OpenRouter's recommended `HTTP-Referer` / `X-Title`
    /// attribution headers (ignored by plain OpenAI).
    openrouter_headers: bool,
}

impl OpenAi {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
            base_url: BASE_URL,
            provider: "openai",
            openrouter_headers: false,
        }
    }

    /// OpenRouter (https://openrouter.ai) — OpenAI-compatible aggregator that
    /// fronts hundreds of models. Model ids look like `openai/gpt-4o` or
    /// `anthropic/claude-3.5-sonnet`.
    pub fn openrouter(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
            base_url: OPENROUTER_URL,
            provider: "openrouter",
            openrouter_headers: true,
        }
    }

    /// Build the POST with auth + (for OpenRouter) attribution headers. Shared
    /// by `chat` and `chat_stream` so both endpoints stay in lockstep.
    fn post(&self) -> reqwest::RequestBuilder {
        let mut rb = self.client.post(self.base_url).bearer_auth(&self.api_key);
        if self.openrouter_headers {
            rb = rb
                .header("HTTP-Referer", "https://oculpm.com")
                .header("X-Title", "ocul-pm");
        }
        rb
    }

    fn build_request(
        &self,
        messages: Vec<Message>,
        opts: &ChatOptions,
        stream: bool,
    ) -> ChatCompletionRequest {
        let turns = messages
            .into_iter()
            .map(|m| TurnMessage {
                role: match m.role {
                    Role::System => "system",
                    Role::User => "user",
                    Role::Assistant => "assistant",
                },
                content: m.content,
            })
            .collect();

        // 감사 라운드 2026-09-11 B2 — OpenAI 본진의 추론 모델(o1·o3·o4·gpt-5)
        // 은 `temperature` 를 기본값 외엔 거절하고 `max_tokens` 대신
        // `max_completion_tokens` 를 요구한다. 호환 엔드포인트(OpenRouter·NIM)
        // 는 옛 이름을 그대로 받으므로 본진에서만 새 이름을 쓴다.
        let native_openai = self.base_url == BASE_URL;
        let reasoning = native_openai && is_reasoning_model(&opts.model);
        ChatCompletionRequest {
            model: opts.model.clone(),
            messages: turns,
            temperature: if reasoning { None } else { opts.temperature },
            max_tokens: if native_openai { None } else { opts.max_tokens },
            max_completion_tokens: if native_openai { opts.max_tokens } else { None },
            stream,
        }
    }
}

/// OpenAI 의 추론 모델인가 — 샘플링 파라미터를 받지 않는 계열.
fn is_reasoning_model(model: &str) -> bool {
    let m = model.trim().to_ascii_lowercase();
    ["o1", "o3", "o4", "gpt-5"]
        .iter()
        .any(|p| m == *p || m.starts_with(&format!("{p}-")) || m.starts_with(&format!("{p}.")))
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<TurnMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    stream: bool,
}

#[derive(Serialize)]
struct TurnMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
    model: String,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[async_trait]
impl LlmProvider for OpenAi {
    fn name(&self) -> &'static str {
        "openai"
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        #[derive(Deserialize)]
        struct Page {
            data: Vec<Row>,
        }
        #[derive(Deserialize)]
        struct Row {
            id: String,
            /// OpenRouter 만 준다. OpenAI 본진은 id 뿐.
            name: Option<String>,
        }
        let url = self.base_url.replace("/chat/completions", "/models");
        let resp = self
            .client
            .get(url)
            .bearer_auth(&self.api_key)
            .send()
            .await?;
        let page: Page = json_or_api_error(resp).await?;
        let mut rows: Vec<ModelInfo> = page
            .data
            .into_iter()
            .map(|r| ModelInfo {
                label: r.name.unwrap_or_else(|| r.id.clone()),
                id: r.id,
            })
            .collect();
        rows.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(rows)
    }

    async fn chat(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
    ) -> Result<ChatResponse, LlmError> {
        let body = self.build_request(messages, &opts, false);
        let resp = self.post().json(&body).send().await?;

        let status = resp.status();
        if !status.is_success() {
            let body = crate::llm::error_body(resp).await;
            return Err(LlmError::ApiError {
                status: status.as_u16(),
                body,
            });
        }

        let parsed: ChatCompletionResponse = resp.json().await?;
        let content = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or_else(|| LlmError::Parse("empty response".into()))?;

        Ok(ChatResponse {
            content,
            model: parsed.model,
            provider: self.provider.into(),
        })
    }

    async fn chat_stream(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
        sink: mpsc::Sender<ChatEvent>,
    ) -> Result<(), LlmError> {
        let body = self.build_request(messages, &opts, true);
        let resp = self.post().json(&body).send().await?;

        let status = resp.status();
        if !status.is_success() {
            let body = crate::llm::error_body(resp).await;
            return Err(LlmError::ApiError {
                status: status.as_u16(),
                body,
            });
        }

        forward_sse_lines(resp, &sink, |line| {
            let payload = line.strip_prefix("data: ")?.trim();
            if payload.is_empty() || payload == "[DONE]" {
                return None;
            }
            let chunk: StreamChunk = serde_json::from_str(payload).ok()?;
            chunk.choices.into_iter().next()?.delta.content
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(model: &str) -> ChatOptions {
        ChatOptions {
            model: model.into(),
            temperature: Some(0.7),
            max_tokens: Some(1000),
        }
    }

    #[test]
    fn native_openai_uses_max_completion_tokens_and_drops_sampling_for_reasoning_models() {
        let o = OpenAi::new("k".into());
        let r = o.build_request(vec![], &opts("gpt-5"), false);
        assert!(r.temperature.is_none());
        assert_eq!(r.max_completion_tokens, Some(1000));
        assert!(r.max_tokens.is_none());

        let r = o.build_request(vec![], &opts("gpt-4o-mini"), false);
        assert_eq!(r.temperature, Some(0.7));
        assert_eq!(r.max_completion_tokens, Some(1000));
    }

    #[test]
    fn openrouter_keeps_the_legacy_shape() {
        let o = OpenAi::openrouter("k".into());
        let r = o.build_request(vec![], &opts("openai/gpt-5"), false);
        assert_eq!(r.temperature, Some(0.7));
        assert_eq!(r.max_tokens, Some(1000));
        assert!(r.max_completion_tokens.is_none());
    }

    #[test]
    fn reasoning_model_detection() {
        assert!(is_reasoning_model("o3-mini"));
        assert!(is_reasoning_model("gpt-5.1"));
        assert!(is_reasoning_model("GPT-5-mini"));
        assert!(!is_reasoning_model("gpt-4o"));
        assert!(!is_reasoning_model("gpt-4.1"));
    }
}
