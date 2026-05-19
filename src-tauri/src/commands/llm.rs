use tauri::ipc::Channel;

use crate::llm::{self, ChatEvent, ChatOptions, ChatResponse, Message};
use crate::secrets;

fn load_api_key(provider: &str) -> Result<String, String> {
    let secret_name = format!("{provider}_api_key");
    secrets::get(&secret_name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("API key for {provider} is not set"))
}

#[tauri::command]
#[specta::specta]
pub async fn chat(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
) -> Result<ChatResponse, String> {
    let api_key = load_api_key(&provider)?;
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;
    client
        .chat(messages, options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn chat_stream(
    provider: String,
    messages: Vec<Message>,
    options: ChatOptions,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let api_key = load_api_key(&provider)?;
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<ChatEvent>(32);

    // Forward provider deltas to the Tauri channel as they arrive.
    let forwarder_channel = on_event.clone();
    let forward = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if forwarder_channel.send(event).is_err() {
                break;
            }
        }
    });

    let result = client.chat_stream(messages, options, tx).await;
    let _ = forward.await;

    match result {
        Ok(()) => {
            let _ = on_event.send(ChatEvent::Done);
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = on_event.send(ChatEvent::Error {
                message: msg.clone(),
            });
            Err(msg)
        }
    }
}
