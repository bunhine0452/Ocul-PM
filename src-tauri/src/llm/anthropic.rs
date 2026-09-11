use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{
    forward_sse_lines, json_or_api_error, ChatEvent, ChatOptions, ChatResponse, LlmError,
    LlmProvider, Message, ModelInfo, Role,
};

const BASE_URL: &str = "https://api.anthropic.com/v1/messages";
const MODELS_URL: &str = "https://api.anthropic.com/v1/models";
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
            temperature: opts
                .temperature
                .filter(|_| accepts_sampling_params(&opts.model)),
            stream,
        }
    }
}

/// 이 모델이 `temperature`/`top_p`/`top_k` 를 받는가 (감사 라운드 2026-09-11 B1).
///
/// Claude Opus 4.7 이후 · Opus 5 · Sonnet 5 · Fable · Mythos 는 샘플링
/// 파라미터를 **400 으로 거절**한다. 앱은 설정의 온도(기본 0.7)를 늘 실어
/// 보냈으므로 사용자가 `claude-sonnet-5` 를 적는 순간 채팅이 죽었다.
/// 4.6 이하(Opus/Sonnet 4.6 · Haiku 4.5 · 3.x)만 보내고, 모르는 id 는 **안
/// 보낸다** — 안 보내서 깨지는 모델은 없고, 보내서 깨지는 모델은 있다.
fn accepts_sampling_params(model: &str) -> bool {
    let m = model.trim().to_ascii_lowercase();
    if m.starts_with("claude-3") || m.starts_with("claude-2") || m.starts_with("claude-instant") {
        return true;
    }
    // claude-<family>-<major>[-<minor>][-<date>]
    let rest = match m.strip_prefix("claude-") {
        Some(r) => r,
        None => return false,
    };
    let mut parts = rest.split('-');
    let family = parts.next().unwrap_or("");
    let major: u32 = match parts.next().and_then(|p| p.parse().ok()) {
        Some(v) => v,
        None => return false,
    };
    // 두 번째 숫자 조각이 **짧으면** minor, 길면(20250514) 날짜 = minor 0.
    let minor: u32 = parts
        .next()
        .filter(|p| p.len() <= 2)
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    match family {
        "opus" | "sonnet" => major < 4 || (major == 4 && minor <= 6),
        "haiku" => major <= 4,
        _ => false,
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
    Text {
        text: String,
    },
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

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        #[derive(Deserialize)]
        struct Page {
            data: Vec<Row>,
        }
        #[derive(Deserialize)]
        struct Row {
            id: String,
            display_name: Option<String>,
        }
        let resp = self
            .client
            .get(format!("{MODELS_URL}?limit=100"))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .send()
            .await?;
        let page: Page = json_or_api_error(resp).await?;
        // API 순서 그대로 — 최신이 앞이다.
        Ok(page
            .data
            .into_iter()
            .map(|r| ModelInfo {
                label: r.display_name.unwrap_or_else(|| r.id.clone()),
                id: r.id,
            })
            .collect())
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
            let body = crate::llm::error_body(resp).await;
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
            let body = crate::llm::error_body(resp).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampling_params_only_go_to_models_that_take_them() {
        for allowed in [
            "claude-sonnet-4-6",
            "claude-opus-4-6",
            "claude-haiku-4-5",
            "claude-sonnet-4-20250514",
            "claude-3-5-sonnet-20241022",
            "claude-opus-4-5",
        ] {
            assert!(accepts_sampling_params(allowed), "{allowed}");
        }
        for rejected in [
            "claude-opus-4-7",
            "claude-opus-4-8",
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-fable-5-1",
            "claude-mythos-5-1",
            "",
            "gpt-4o",
        ] {
            assert!(!accepts_sampling_params(rejected), "{rejected}");
        }
    }

    #[test]
    fn request_omits_temperature_for_claude_5() {
        let a = Anthropic::new("k".into());
        let opts = ChatOptions {
            model: "claude-sonnet-5".into(),
            temperature: Some(0.7),
            max_tokens: None,
        };
        let req = a.build_request(vec![], &opts, false);
        assert!(req.temperature.is_none());
        let opts = ChatOptions {
            model: "claude-sonnet-4-6".into(),
            ..opts
        };
        assert_eq!(a.build_request(vec![], &opts, false).temperature, Some(0.7));
    }
}
