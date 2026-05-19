use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{
    forward_sse_lines, ChatEvent, ChatOptions, ChatResponse, LlmError, LlmProvider, Message, Role,
};

const BASE_URL: &str = "https://api.openai.com/v1/chat/completions";

pub struct OpenAi {
    api_key: String,
    client: reqwest::Client,
}

impl OpenAi {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
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

        ChatCompletionRequest {
            model: opts.model.clone(),
            messages: turns,
            temperature: opts.temperature,
            max_tokens: opts.max_tokens,
            stream,
        }
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<TurnMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
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

    async fn chat(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
    ) -> Result<ChatResponse, LlmError> {
        let body = self.build_request(messages, &opts, false);
        let resp = self
            .client
            .post(BASE_URL)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
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
            provider: "openai".into(),
        })
    }

    async fn chat_stream(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
        sink: mpsc::Sender<ChatEvent>,
    ) -> Result<(), LlmError> {
        let body = self.build_request(messages, &opts, true);
        let resp = self
            .client
            .post(BASE_URL)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
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
