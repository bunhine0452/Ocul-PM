use crate::llm::{self, ChatOptions, ChatResponse, LlmError, Message};
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

/// 코어 기능(요약·롤업·일지 초안·자동화)이 쓰는 LLM 호출 — 폴백 체인·키 로딩이 여기 있다.
/// AI 패널 채팅 커맨드였던 자리다 (화면은 2026-10-28 에 걷었다, simplify-round).
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
/// 프로바이더의 모델 목록 (감사 라운드 2026-09-11 B2). 설정 → LLM 의 모델
/// 칸이 datalist 로 띄운다. 키가 없으면 곧바로 실패한다 — 그 칸은 어차피
/// 키 없이는 못 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn llm_list_models(provider: String) -> Result<Vec<llm::ModelInfo>, String> {
    let api_key = load_api_key(&provider)?;
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
    client.list_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn llm_reachability() -> Result<Vec<llm::reach::ProviderReach>, String> {
    Ok(llm::reach::snapshot())
}
