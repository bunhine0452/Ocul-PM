//! PR-CI7 — Notion 내보내기 커맨드 (thin). 로직은 `crate::notion` 소유.
//!
//! 토큰은 기존 `secret_set`/`secret_delete` 커맨드(키체인)로 저장·삭제하고,
//! 여기는 검증·상태·내보내기만 담당한다. 내보내기는 회고 화면의 **명시적
//! 버튼**으로만 호출된다 (자동 동기화 없음 — 마스터플랜 D6).

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::notion;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct NotionStatus {
    /// 키체인에 internal integration token 이 있는가 — 없으면 UI 는 내보내기
    /// 버튼 자체를 그리지 않는다 (수용 기준: 토큰 없으면 기능 비노출).
    pub has_token: bool,
    /// 정규화된 부모 페이지 id (설정 안 됐으면 None).
    pub parent_page_id: Option<String>,
}

/// 토큰/부모 페이지 설정 상태 (네트워크 없음).
#[tauri::command]
#[specta::specta]
pub async fn notion_status(db: State<'_, Db>) -> Result<NotionStatus, String> {
    let has_token = crate::secrets::has(notion::NOTION_TOKEN_SECRET).map_err(|e| e.to_string())?;
    let parent_page_id = db
        .settings_get(notion::NOTION_PARENT_SETTING.to_string())
        .await
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    Ok(NotionStatus {
        has_token,
        parent_page_id,
    })
}

/// 입력한 토큰을 실검증한다 (`GET /users/me`) — 성공 시 통합(봇) 이름.
/// 저장은 하지 않는다: UI 가 검증 성공 후 기존 `secret_set` 으로 키체인에 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn notion_verify_token(token: String) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("토큰을 입력하세요".into());
    }
    notion::verify_token(token).await
}

/// 부모 페이지 설정 — URL/ID 를 정규화해 저장한다. 빈 입력은 해제.
/// 반환: 저장된 정규화 id (해제 시 None).
#[tauri::command]
#[specta::specta]
pub async fn notion_set_parent(
    db: State<'_, Db>,
    input: String,
) -> Result<Option<String>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        db.settings_set(notion::NOTION_PARENT_SETTING.to_string(), String::new())
            .await
            .map_err(|e| e.to_string())?;
        return Ok(None);
    }
    let id = notion::normalize_page_id(trimmed)
        .ok_or_else(|| "페이지 URL/ID 를 인식하지 못했습니다 — Notion 페이지 링크를 붙여넣으세요".to_string())?;
    db.settings_set(notion::NOTION_PARENT_SETTING.to_string(), id.clone())
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(id))
}

/// 마크다운을 부모 페이지 아래 새 Notion 페이지로 내보낸다 — 성공 시 페이지 URL.
#[tauri::command]
#[specta::specta]
pub async fn notion_export(
    db: State<'_, Db>,
    project_id: u32,
    title: String,
    markdown: String,
) -> Result<String, String> {
    let token = crate::secrets::get(notion::NOTION_TOKEN_SECRET)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Notion 토큰이 설정되지 않았습니다 (설정 → 데이터)".to_string())?;
    let parent = db
        .settings_get(notion::NOTION_PARENT_SETTING.to_string())
        .await
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "내보낼 부모 페이지가 설정되지 않았습니다 (설정 → 데이터)".to_string())?;
    // 심층 방어 (2026-07-20 리뷰): 이 커맨드는 임의 문자열을 외부(api.notion.com)
    // 로 내보내는 유일한 경로다. 현재 호출자는 이미 마스킹된 캐시 파생물만
    // 넘기지만, 커맨드 자체가 보증을 갖도록 프로젝트 redact 패턴을 한 번 더
    // 통과시킨다 (rule_promotion 의 LLM 전송 경로와 동일 규율).
    let patterns = match db.get_project(project_id).await {
        Ok(p) => crate::oculpm::redact::patterns_for_project(std::path::Path::new(&p.root_path)),
        Err(_) => Vec::new(),
    };
    let (title, _) = crate::oculpm::redact::redact_text(&title, &patterns);
    let (markdown, _) = crate::oculpm::redact::redact_text(&markdown, &patterns);
    notion::create_page(&token, &parent, &title, &markdown).await
}
