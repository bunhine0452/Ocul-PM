use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::{
    forward_sse_lines, json_or_api_error, ChatEvent, ChatOptions, ChatResponse, LlmError,
    LlmProvider, Message, ModelInfo, Role,
};

const BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

pub struct Gemini {
    api_key: String,
    client: reqwest::Client,
}

impl Gemini {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    fn build_request(&self, messages: Vec<Message>, opts: &ChatOptions) -> GenerateRequest {
        let mut system_text: Vec<String> = Vec::new();
        let mut contents: Vec<Content> = Vec::new();

        for msg in messages {
            match msg.role {
                Role::System => system_text.push(msg.content),
                Role::User => contents.push(Content {
                    role: "user",
                    parts: vec![Part { text: msg.content }],
                }),
                Role::Assistant => contents.push(Content {
                    role: "model",
                    parts: vec![Part { text: msg.content }],
                }),
            }
        }

        GenerateRequest {
            contents,
            system_instruction: (!system_text.is_empty()).then(|| SystemInstruction {
                parts: vec![Part {
                    text: system_text.join("\n\n"),
                }],
            }),
            generation_config: Some(GenerationConfig {
                temperature: opts.temperature,
                max_output_tokens: opts.max_tokens,
            }),
        }
    }
}

#[derive(Serialize)]
struct GenerateRequest {
    contents: Vec<Content>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "systemInstruction")]
    system_instruction: Option<SystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "generationConfig")]
    generation_config: Option<GenerationConfig>,
}

#[derive(Serialize)]
struct Content {
    role: &'static str,
    parts: Vec<Part>,
}

#[derive(Serialize, Deserialize)]
struct Part {
    text: String,
}

#[derive(Serialize)]
struct SystemInstruction {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct GenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "maxOutputTokens")]
    max_output_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Option<Vec<Part>>,
}

#[async_trait]
impl LlmProvider for Gemini {
    fn name(&self) -> &'static str {
        "gemini"
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        #[derive(Deserialize)]
        struct Page {
            #[serde(default)]
            models: Vec<Row>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Row {
            /// `models/gemini-2.5-flash` — 앞의 `models/` 는 우리 id 에 없다.
            name: String,
            display_name: Option<String>,
            #[serde(default)]
            supported_generation_methods: Vec<String>,
        }
        let resp = self
            .client
            .get(format!("{BASE_URL}/models?pageSize=200"))
            .header("x-goog-api-key", &self.api_key)
            .send()
            .await?;
        let page: Page = json_or_api_error(resp).await?;
        let mut rows: Vec<ModelInfo> = page
            .models
            .into_iter()
            // 채팅에 못 쓰는 것(임베딩·이미지)은 뺀다.
            .filter(|r| {
                r.supported_generation_methods
                    .iter()
                    .any(|m| m == "generateContent")
            })
            .map(|r| {
                let id = r
                    .name
                    .strip_prefix("models/")
                    .unwrap_or(&r.name)
                    .to_string();
                ModelInfo {
                    label: r.display_name.unwrap_or_else(|| id.clone()),
                    id,
                }
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
        let body = self.build_request(messages, &opts);
        let url = format!("{BASE_URL}/models/{}:generateContent", opts.model);
        let resp = self
            .client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
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

        let parsed: GenerateResponse = resp.json().await?;
        let content = parsed
            .candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content)
            .and_then(|c| c.parts)
            .map(|parts| parts.into_iter().map(|p| p.text).collect::<String>())
            .ok_or_else(|| LlmError::Parse("empty response".into()))?;

        if content.is_empty() {
            return Err(LlmError::Parse("empty response".into()));
        }

        Ok(ChatResponse {
            content,
            model: opts.model,
            provider: "gemini".into(),
        })
    }

    async fn chat_stream(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
        sink: mpsc::Sender<ChatEvent>,
    ) -> Result<(), LlmError> {
        let body = self.build_request(messages, &opts);
        let url = format!(
            "{BASE_URL}/models/{}:streamGenerateContent?alt=sse",
            opts.model
        );
        let resp = self
            .client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
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
            let parsed: GenerateResponse = serde_json::from_str(payload).ok()?;
            let text = parsed
                .candidates?
                .into_iter()
                .next()?
                .content?
                .parts?
                .into_iter()
                .map(|p| p.text)
                .collect::<String>();
            (!text.is_empty()).then_some(text)
        })
        .await
    }
}
