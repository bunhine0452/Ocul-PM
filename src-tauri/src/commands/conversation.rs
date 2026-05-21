//! Conversation commands — chat history persistence (M2-3).

use tauri::State;

use crate::db::{ChatMessage, Conversation, ConversationAction, Db};

#[tauri::command]
#[specta::specta]
pub async fn conversation_create(
    db: State<'_, Db>,
    title: String,
    provider: Option<String>,
    model: Option<String>,
    project_id: Option<u32>,
) -> Result<Conversation, String> {
    db.conversation_create(title, provider, model, project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn conversation_list(
    db: State<'_, Db>,
    project_id: Option<u32>,
) -> Result<Vec<Conversation>, String> {
    db.conversation_list(project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn conversation_rename(
    db: State<'_, Db>,
    conversation_id: u32,
    title: String,
) -> Result<(), String> {
    db.conversation_rename(conversation_id, title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn conversation_set_context(
    db: State<'_, Db>,
    conversation_id: u32,
    provider: Option<String>,
    model: Option<String>,
    project_id: Option<u32>,
) -> Result<(), String> {
    db.conversation_set_context(conversation_id, provider, model, project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn conversation_delete(
    db: State<'_, Db>,
    conversation_id: u32,
) -> Result<(), String> {
    db.conversation_delete(conversation_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn chat_message_append(
    db: State<'_, Db>,
    conversation_id: u32,
    role: String,
    content: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<ChatMessage, String> {
    db.chat_message_append(conversation_id, role, content, provider, model)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn chat_message_list(
    db: State<'_, Db>,
    conversation_id: u32,
) -> Result<Vec<ChatMessage>, String> {
    db.chat_message_list(conversation_id)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Action proposal apply-state (W5 / UI-5) ----------

/// Persist that the user applied the ActionProposalCard at `message_index`
/// inside `conversation_id`. Idempotent — re-recording just refreshes
/// `applied_at`. Replaces the old `localStorage[action_{conv}_{i}]="applied"`
/// pattern in `ChatPanel`.
#[tauri::command]
#[specta::specta]
pub async fn record_conversation_action(
    db: State<'_, Db>,
    conversation_id: u32,
    message_index: u32,
    status: Option<String>,
) -> Result<ConversationAction, String> {
    let s = status.unwrap_or_else(|| "applied".to_string());
    db.record_conversation_action(conversation_id, message_index, s)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_conversation_actions(
    db: State<'_, Db>,
    conversation_id: u32,
) -> Result<Vec<ConversationAction>, String> {
    db.list_conversation_actions(conversation_id)
        .await
        .map_err(|e| e.to_string())
}
