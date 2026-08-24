//! POST /api/invoke/{cmd} 디스패처 (#mb1-dispatch).
//!
//! 251개 커맨드 중 **명시 화이트리스트만** 연다 (플랜 D4) — 새 커맨드는 아래
//! match 에 한 줄을 더해야만 노출되고, 자동 노출 경로는 없다. 제외 원칙(창·
//! 터미널·삭제류·secret_set·ACP)은 플랜 #command-whitelist 에 잠겨 있다.
//!
//! 인자 이름은 bindings.ts 가 보내는 camelCase 그대로 받는다 — tauri invoke 와
//! 같은 계약이라 MB2 셤이 `__TAURI_INVOKE` 를 이 엔드포인트로 바꿔치기만 하면
//! 된다. 응답도 커맨드 Ok 값의 직렬화 그대로 (#mb1-envelope).
//!
//! `app_info` 는 화이트리스트에서 뺐다: 디스크 경로를 노출하는데 폰에는 쓸모가
//! 없고, 버전은 /healthz 가 준다. `oculpm_create_manual_entry` 는 커맨드 대신
//! 내부 `create_manual_journal_entry` 를 부른다 — 커맨드 쪽의 AppHandle 은
//! 데스크톱 토스트(IntegrityWarning 이벤트)용이라 폰에서는 에러 문자열로 충분.

use serde_json::{Map, Value};
use tauri::Manager as _;

use crate::commands;
use crate::db::Db;
use crate::oculpm::manager::OculpmManager;

#[derive(Debug, PartialEq, Eq)]
pub enum DispatchError {
    /// 화이트리스트에 없다 → 404. 커맨드 실존 여부는 구분해 주지 않는다.
    UnknownCommand,
    /// 인자 역직렬화 실패 → 400.
    BadArgs(String),
    /// 커맨드가 Err 을 반환 → 422 (네이티브 invoke 의 reject 에 대응).
    Command(String),
}

impl From<String> for DispatchError {
    fn from(e: String) -> Self {
        Self::Command(e)
    }
}

/// camelCase 인자 꾸러미. `take` 는 키 부재를 `null` 로 취급한다 — Option
/// 파라미터가 생략됐을 때 tauri invoke 와 같은 관용.
struct Args(Map<String, Value>);

impl Args {
    fn new(body: Value) -> Result<Self, DispatchError> {
        match body {
            Value::Null => Ok(Self(Map::new())),
            Value::Object(m) => Ok(Self(m)),
            _ => Err(DispatchError::BadArgs("arguments must be a JSON object".into())),
        }
    }

    fn take<T: serde::de::DeserializeOwned>(&mut self, key: &str) -> Result<T, DispatchError> {
        let v = self.0.remove(key).unwrap_or(Value::Null);
        serde_json::from_value(v).map_err(|e| DispatchError::BadArgs(format!("{key}: {e}")))
    }
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value, DispatchError> {
    serde_json::to_value(v).map_err(|e| DispatchError::Command(format!("serialize response: {e}")))
}

/// 런타임 제네릭 — 프로덕션은 Wry, 테스트는 MockRuntime.
pub async fn dispatch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    cmd: &str,
    body: Value,
) -> Result<Value, DispatchError> {
    let mut a = Args::new(body)?;
    match cmd {
        // ── 공통 ────────────────────────────────────────────────────────
        "list_projects" => ok(commands::list_projects(app.state()).await?),
        "project_stats" => ok(commands::project_stats(app.state(), a.take("projectId")?).await?),

        // ── Today ───────────────────────────────────────────────────────
        "oculpm_workday_brief" => ok(commands::oculpm_workday_brief(
            app.state(), app.state(), a.take("projectId")?, a.take("workdays")?, a.take("linesWorkday")?,
        ).await?),
        "journal_missing_signals" => ok(commands::journal_missing_signals(
            app.state(), a.take("projectId")?, a.take("days")?,
        ).await?),
        "plan_recent_updates" => ok(commands::plan_recent_updates(
            app.state(), a.take("projectId")?, a.take("limit")?,
        ).await?),
        "git_status" => ok(commands::git_status(app.state(), a.take("projectId")?).await?),
        "git_log" => ok(commands::git_log(app.state(), a.take("projectId")?, a.take("limit")?).await?),
        "git_graph" => ok(commands::git_graph(app.state(), a.take("projectId")?, a.take("limit")?).await?),
        "git_head_status_brief" => {
            ok(commands::git_head_status_brief(app.state(), a.take("projectId")?).await?)
        }
        "oculpm_generate_summary" => ok(commands::oculpm_generate_summary(
            app.state(), a.take("projectId")?, a.take("since")?, a.take("until")?,
            a.take("style")?, a.take("provider")?, a.take("model")?,
        ).await?),
        "oculpm_compare_layers" => ok(commands::oculpm_compare_layers(
            app.state(), app.state(), a.take("projectId")?, a.take("sessionId")?,
        ).await?),
        "oculpm_list_sessions" => ok(commands::oculpm_list_sessions(
            app.state(), app.state(), a.take("projectId")?, a.take("workday")?,
        ).await?),

        // ── 일지 ────────────────────────────────────────────────────────
        "oculpm_list_journal_entries" => ok(commands::oculpm_list_journal_entries(
            app.state(), app.state(), a.take("projectId")?, a.take("workday")?, a.take("filters")?,
        ).await?),
        "oculpm_get_journal_entry" => ok(commands::oculpm_get_journal_entry(
            app.state(), app.state(), a.take("projectId")?, a.take("relativePath")?,
        ).await?),
        "oculpm_get_file_changes" => ok(commands::oculpm_get_file_changes(
            app.state(), a.take("projectId")?, a.take("workday")?, a.take("sessionId")?,
        ).await?),
        "oculpm_get_entry_diffs" => ok(commands::oculpm_get_entry_diffs(
            app.state(), app.state(), a.take("projectId")?, a.take("relativePath")?,
        ).await?),
        "oculpm_create_manual_entry" => {
            let manager = app.state::<OculpmManager>();
            let db = app.state::<Db>();
            ok(manager
                .create_manual_journal_entry(&db, a.take("projectId")?, a.take("draft")?)
                .await
                .map_err(|e| e.to_string())?)
        }
        "oculpm_update_entry_body" => ok(commands::oculpm_update_entry_body(
            app.state(), app.state(), a.take("projectId")?, a.take("relativePath")?, a.take("bodyMarkdown")?,
        ).await?),
        "oculpm_update_entry_meta" => ok(commands::oculpm_update_entry_meta(
            app.state(), app.state(), a.take("projectId")?, a.take("relativePath")?,
            a.take("difficultyChange")?, a.take("status")?,
        ).await?),
        "oculpm_set_journal_verified" => ok(commands::oculpm_set_journal_verified(
            app.state(), app.state(), a.take("projectId")?, a.take("relativePath")?, a.take("verified")?,
        ).await?),

        // ── 플래너 ──────────────────────────────────────────────────────
        "plan_list" => ok(commands::plan_list(app.state(), a.take("projectId")?).await?),
        "plan_get" => ok(commands::plan_get(app.state(), a.take("projectId")?, a.take("planId")?).await?),
        "plan_item_history" => ok(commands::plan_item_history(
            app.state(), a.take("projectId")?, a.take("planId")?, a.take("itemId")?,
        ).await?),
        "plan_apply_edit" => ok(commands::plan_apply_edit(
            app.state(), app.state(), a.take("projectId")?, a.take("planId")?, a.take("op")?, a.take("agentId")?,
        ).await?),
        "plan_create" => ok(commands::plan_create(
            app.state(), app.state(), a.take("projectId")?, a.take("title")?,
        ).await?),
        "plan_set_status" => ok(commands::plan_set_status(
            app.state(), app.state(), a.take("projectId")?, a.take("planId")?, a.take("status")?,
        ).await?),
        "plan_rename" => ok(commands::plan_rename(
            app.state(), app.state(), a.take("projectId")?, a.take("planId")?, a.take("title")?,
        ).await?),
        "plan_dispatch_prompt" => ok(commands::plan_dispatch_prompt(
            app.state(), a.take("projectId")?, a.take("planId")?, a.take("itemId")?,
        ).await?),
        "plan_ai_refresh" => ok(commands::plan_ai_refresh(
            app.state(), app.state(), a.take("projectId")?, a.take("planId")?,
            a.take("provider")?, a.take("model")?,
        ).await?),
        "settings_get" => ok(commands::settings_get(app.state(), a.take("key")?).await?),

        // ── 논의 ────────────────────────────────────────────────────────
        "discussion_list" => ok(commands::discussion_list(app.state(), a.take("projectId")?).await?),
        "discussion_get" => ok(commands::discussion_get(
            app.state(), a.take("projectId")?, a.take("discussionId")?,
        ).await?),
        "discussion_create" => ok(commands::discussion_create(
            app.state(), a.take("projectId")?, a.take("title")?,
        ).await?),
        "discussion_write" => ok(commands::discussion_write(
            app.state(), a.take("projectId")?, a.take("discussionId")?, a.take("bodyMd")?,
        ).await?),
        "discussion_set_status" => ok(commands::discussion_set_status(
            app.state(), a.take("projectId")?, a.take("discussionId")?, a.take("status")?,
        ).await?),
        "discussion_read_raw" => ok(commands::discussion_read_raw(
            app.state(), a.take("projectId")?, a.take("discussionId")?,
        ).await?),
        "discussion_rename" => ok(commands::discussion_rename(
            app.state(), a.take("projectId")?, a.take("discussionId")?, a.take("title")?,
        ).await?),
        "discussion_asset" => ok(commands::discussion_asset(
            app.state(), a.take("projectId")?, a.take("discussionId")?, a.take("relPath")?,
        ).await?),
        "discussion_promote_to_plan" => ok(commands::discussion_promote_to_plan(
            app.state(), app.state(), a.take("projectId")?, a.take("discussionId")?,
        ).await?),

        // ── 검색 ────────────────────────────────────────────────────────
        "search_text" => ok(commands::search_text(
            app.state(), a.take("projectId")?, a.take("query")?, a.take("limit")?,
        ).await?),
        "search_chunks" => ok(commands::search_chunks(
            app.state(), app.state(), a.take("projectId")?, a.take("query")?,
            a.take("limit")?, a.take("includeDocs")?,
        ).await?),
        "search_symbols" => ok(commands::search_symbols(
            app.state(), a.take("projectId")?, a.take("query")?, a.take("limit")?,
        ).await?),
        "read_file_range" => ok(commands::read_file_range(
            app.state(), a.take("projectId")?, a.take("relPath")?, a.take("startLine")?, a.take("endLine")?,
        ).await?),

        // ── AI ──────────────────────────────────────────────────────────
        "chat" => ok(commands::chat(
            a.take("provider")?, a.take("messages")?, a.take("options")?, a.take("fallbacks")?,
        ).await?),
        "conversation_create" => ok(commands::conversation_create(
            app.state(), a.take("title")?, a.take("provider")?, a.take("model")?, a.take("projectId")?,
        ).await?),
        "conversation_list" => ok(commands::conversation_list(app.state(), a.take("projectId")?).await?),
        "chat_message_list" => ok(commands::chat_message_list(app.state(), a.take("conversationId")?).await?),
        "chat_message_append" => ok(commands::chat_message_append(
            app.state(), a.take("conversationId")?, a.take("role")?, a.take("content")?,
            a.take("provider")?, a.take("model")?,
        ).await?),
        "secret_has" => ok(commands::secret_has(app.state(), a.take("name")?).await?),

        _ => Err(DispatchError::UnknownCommand),
    }
}
