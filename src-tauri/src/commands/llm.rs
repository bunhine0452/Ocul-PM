use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;

use crate::llm::{self, ChatEvent, ChatOptions, ChatResponse, Message};
use crate::secrets;

fn load_api_key(provider: &str) -> Result<String, String> {
    let secret_name = format!("{provider}_api_key");
    secrets::get(&secret_name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("API key for {provider} is not set"))
}

/// One entry in the user-configured failover chain (Settings → LLM → 폴백 체인).
/// On a failed call the next entry is tried, in order.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, specta::Type)]
pub struct ProviderModel {
    pub provider: String,
    pub model: String,
}

/// Ordered attempt list: the primary (selected provider + requested model)
/// first, then each fallback. Consecutive / exact duplicates are dropped so a
/// fallback identical to the primary doesn't double-call.
fn build_attempts(
    provider: &str,
    primary_model: &str,
    fallbacks: &[ProviderModel],
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::with_capacity(1 + fallbacks.len());
    out.push((provider.to_string(), primary_model.to_string()));
    for f in fallbacks {
        let pair = (f.provider.clone(), f.model.clone());
        if !out.contains(&pair) {
            out.push(pair);
        }
    }
    out
}

#[tauri::command]
#[specta::specta]
pub async fn chat(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
    // Failover chain — tried in order if the primary call fails. Empty = no
    // failover (the previous behavior).
    fallbacks: Vec<ProviderModel>,
) -> Result<ChatResponse, String> {
    let attempts = build_attempts(&provider, &options.model, &fallbacks);
    let mut last_err = String::from("no provider configured");

    for (prov, model) in attempts {
        let api_key = match load_api_key(&prov) {
            Ok(k) => k,
            Err(e) => {
                last_err = e;
                continue;
            }
        };
        let client = match llm::create(&prov, api_key) {
            Ok(c) => c,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        let mut opts = options.clone();
        opts.model = model;
        match client.chat(messages.clone(), opts).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                last_err = format!("{prov}: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

/// 스트리밍 본체 — 싱크가 mpsc 라 IPC Channel(데스크톱)과 SSE(모바일 브리지
/// #mb4-chat-sse)가 같은 폴백·부분응답 로직을 공유한다. 계약은 기존 그대로:
/// Delta 가 한 번이라도 나가면 폴백하지 않고, 종료는 Done 또는 Error 정확히 1회.
pub async fn run_chat_stream(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
    fallbacks: Vec<ProviderModel>,
    sink: tokio::sync::mpsc::Sender<ChatEvent>,
) -> Result<(), String> {
    let attempts = build_attempts(&provider, &options.model, &fallbacks);
    let n = attempts.len();
    let mut last_err = String::from("no provider configured");

    for (i, (prov, model)) in attempts.into_iter().enumerate() {
        let api_key = match load_api_key(&prov) {
            Ok(k) => k,
            Err(e) => {
                last_err = e;
                continue;
            }
        };
        let client = match llm::create(&prov, api_key) {
            Ok(c) => c,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        let mut opts = options.clone();
        opts.model = model;

        let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatEvent>(32);
        // Track whether any text reached the UI: once it has, a later failure
        // can't be cleanly retried (the user already sees a partial answer).
        let emitted = Arc::new(AtomicBool::new(false));
        let sink_fwd = sink.clone();
        let emitted_fwd = emitted.clone();
        let forward = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                if matches!(event, ChatEvent::Delta { .. }) {
                    emitted_fwd.store(true, Ordering::SeqCst);
                }
                if sink_fwd.send(event).await.is_err() {
                    break;
                }
            }
        });

        let result = client.chat_stream(messages.clone(), opts, tx).await;
        let _ = forward.await;

        match result {
            Ok(()) => {
                let _ = sink.send(ChatEvent::Done).await;
                return Ok(());
            }
            Err(e) => {
                let msg = format!("{prov}: {e}");
                // Fail over only if nothing was streamed yet and another
                // attempt remains; otherwise surface the error.
                if emitted.load(Ordering::SeqCst) || i + 1 == n {
                    let _ = sink
                        .send(ChatEvent::Error {
                            message: msg.clone(),
                        })
                        .await;
                    return Err(msg);
                }
                last_err = msg;
            }
        }
    }

    let _ = sink
        .send(ChatEvent::Error {
            message: last_err.clone(),
        })
        .await;
    Err(last_err)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_stream(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
    fallbacks: Vec<ProviderModel>,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    // 본체는 run_chat_stream — 여기서는 mpsc → IPC Channel 로 나르기만 한다.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatEvent>(32);
    let forward = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if on_event.send(event).is_err() {
                break;
            }
        }
    });
    let result = run_chat_stream(provider, messages, options, fallbacks, tx).await;
    let _ = forward.await;
    result
}
