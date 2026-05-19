use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{
    forward_sse_lines, ChatEvent, ChatOptions, ChatResponse, LlmError, LlmProvider, Message, Role,
};

const BASE_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 4096;

pub struct Anthropic {
    api_key: String,
    client: reqwest::Client,
}

impl Anthropic {
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
    ) -> MessagesRequest {
        let mut system_parts: Vec<String> = Vec::new();
        let mut turns: Vec<TurnMessage> = Vec::new();

        for msg in messages {
            match msg.role {
                Role::System => system_parts.push(msg.content),
                Role::User => turns.push(TurnMessage {
                    role: "user",
                    content: msg.content,
                }),
                Role::Assistant => turns.push(TurnMessage {
                    role: "assistant",
                    content: msg.content,
                }),
            }
        }

        MessagesRequest {
            model: opts.model.clone(),
            max_tokens: opts.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
            messages: turns,
            system: (!system_parts.is_empty()).then(|| system_parts.join("\n\n")),
            temperature: opts.temperature,
            stream,
        }
    }
}

#[derive(Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<TurnMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    stream: bool,
}

#[derive(Serialize)]
struct TurnMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
    model: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ContentBlock {
    Text { text: String },
    #[serde(other)]
    Unknown,
}

#[derive(Deserialize)]
struct StreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<StreamDelta>,
}

#[derive(Deserialize)]
struct StreamDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[async_trait]
impl LlmProvider for Anthropic {
    fn name(&self) -> &'static str {
        "anthropic"
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
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
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

        let parsed: MessagesResponse = resp.json().await?;
        let content = parsed
            .content
            .into_iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        if content.is_empty() {
            return Err(LlmError::Parse("empty response".into()));
        }

        Ok(ChatResponse {
            content,
            model: parsed.model,
            provider: "anthropic".into(),
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
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("accept", "text/event-stream")
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
            if payload.is_empty() {
                return None;
            }
            let event: StreamEvent = serde_json::from_str(payload).ok()?;
            if event.event_type != "content_block_delta" {
                return None;
            }
            let delta = event.delta?;
            if delta.delta_type.as_deref() != Some("text_delta") {
                return None;
            }
            delta.text
        })
        .await
    }
}
