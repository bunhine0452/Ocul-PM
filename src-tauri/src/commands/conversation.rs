//! Conversation commands — chat history persistence (M2-3).

use tauri::State;

use crate::db::{ChatMessage, Conversation, Db};

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
