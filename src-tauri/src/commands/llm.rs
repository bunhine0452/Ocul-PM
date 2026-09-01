use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;

use crate::llm::{self, ChatEvent, ChatOptions, ChatResponse, LlmError, Message};
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

/// 체인 전체가 실패했을 때의 결말.
///
/// `offline` 이 참이면 **어느 시도도 서버에 닿지 못했다**. 429·401 처럼 응답이
/// 온 실패가 하나라도 섞여 있으면 거짓이다 — 네트워크는 멀쩡했고 문제가 다른
/// 데 있다는 뜻이므로, 그걸 오프라인으로 읽으면 자동화가 영원히 연기된다
/// (Phase 7 #automation-defer-offline).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatFailure {
    pub message: String,
    pub offline: bool,
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
    chat_detailed(provider, messages, options, fallbacks)
        .await
        .map_err(|f| f.message)
}

/// [`chat`] 의 본체. 실패 이유가 **오프라인인지**까지 돌려준다 — 배경 자동화는
/// 그 한 비트로 "실패" 와 "연기" 를 가른다.
pub async fn chat_detailed(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
    fallbacks: Vec<ProviderModel>,
) -> Result<ChatResponse, ChatFailure> {
    let attempts = build_attempts(&provider, &options.model, &fallbacks);
    let mut last_err = String::from("no provider configured");
    // 시도가 하나라도 **서버에 닿았으면** 오프라인이 아니다.
    let mut all_transport = true;

    for (prov, model) in attempts {
        let api_key = match load_api_key(&prov) {
            Ok(k) => k,
            Err(e) => {
                // 키가 없는 것은 네트워크 문제가 아니다 — 도달성 원장도 안 건드린다.
                last_err = e;
                all_transport = false;
                continue;
            }
        };
        let client = match llm::create(&prov, api_key) {
            Ok(c) => c,
            Err(e) => {
                last_err = e.to_string();
                all_transport = false;
                continue;
            }
        };
        let mut opts = options.clone();
        opts.model = model;
        match client.chat(messages.clone(), opts).await {
            Ok(resp) => {
                llm::reach::observe(&prov, None);
                return Ok(resp);
            }
            Err(e) => {
                all_transport &= note_attempt(&prov, &e);
                last_err = format!("{prov}: {e}");
                continue;
            }
        }
    }

    Err(ChatFailure {
        message: last_err,
        offline: all_transport,
    })
}

/// 시도 하나의 실패를 도달성 원장에 적고, **전송 실패였는지**를 돌려준다.
fn note_attempt(provider: &str, e: &LlmError) -> bool {
    let transport = e.is_transport();
    llm::reach::observe(provider, transport.then(|| e.to_string()).as_deref());
    transport
}

/// 마지막으로 관측된 프로바이더 도달성 (Phase 7 #model-picker-offline).
///
/// 프로브를 쏘지 않는다 — 이미 한 호출의 결과만 읽는다. 한 번도 안 불러 본
/// 프로바이더는 목록에 없다: "모른다" 를 "안 된다" 로 그리지 않기 위해서다.
#[tauri::command]
#[specta::specta]
pub async fn llm_reachability() -> Result<Vec<llm::reach::ProviderReach>, String> {
    Ok(llm::reach::snapshot())
}

/// 스트리밍 본체 — 싱크가 mpsc 라 IPC Channel(데스크톱)과 SSE(모바일 브리지
/// #mb4-chat-sse)가 같은 폴백·부분응답 로직을 공유한다. 계약은 기존 그대로:
/// Delta 가 한 번이라도 나가면 폴백하지 않고, 종료는 Done 또는 Error 정확히 1회.
///
/// Phase 7 (#offline-fallback) 이 여기에 더한 것은 **고지 하나**다. 1순위가 아닌
/// 시도가 실제로 답을 내면 첫 Delta 앞에 [`ChatEvent::Fallback`] 이 정확히 한 번
/// 나간다. 설정은 손대지 않는다 — 폴백은 **그 호출 한 번**의 사실이고, 그것을
/// 기본값으로 승격시키면 사용자가 고른 모델이 조용히 바뀐다.
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
        opts.model = model.clone();

        let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatEvent>(32);
        // Track whether any text reached the UI: once it has, a later failure
        // can't be cleanly retried (the user already sees a partial answer).
        let emitted = Arc::new(AtomicBool::new(false));
        // 폴백 고지는 **답이 실제로 나올 때** 한 번만. 시도를 시작할 때 미리
        // 알리면 그 시도마저 실패했을 때 거짓 배지가 남는다.
        let announced = Arc::new(AtomicBool::new(false));
        let sink_fwd = sink.clone();
        let emitted_fwd = emitted.clone();
        let announced_fwd = announced.clone();
        let (fb_prov, fb_model) = (prov.clone(), model.clone());
        let is_fallback = i > 0;
        let forward = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                if matches!(event, ChatEvent::Delta { .. }) {
                    if is_fallback && !announced_fwd.swap(true, Ordering::SeqCst) {
                        let _ = sink_fwd
                            .send(ChatEvent::Fallback {
                                provider: fb_prov.clone(),
                                model: fb_model.clone(),
                            })
                            .await;
                    }
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
                llm::reach::observe(&prov, None);
                // 델타가 한 줄도 없이 끝난 폴백 — 그래도 답을 낸 것은 이쪽이다.
                if is_fallback && !announced.swap(true, Ordering::SeqCst) {
                    let _ = sink
                        .send(ChatEvent::Fallback {
                            provider: prov.clone(),
                            model,
                        })
                        .await;
                }
                let _ = sink.send(ChatEvent::Done).await;
                return Ok(());
            }
            Err(e) => {
                note_attempt(&prov, &e);
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
