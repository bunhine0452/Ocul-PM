//! 대화 임포트의 진입점 (Osaurus 라운드 Phase 7 #conversation-import).
//!
//! 얇다 — 파싱은 [`oculpm::import::adapters`], 일지화는
//! [`oculpm::import::journalize`] 가 한다. 여기서는 파일을 고르고, 중복을
//! 걸러내고, 순서를 잡는다.
//!
//! # 스캔은 과금이 없다
//!
//! [`import_scan`] 은 네트워크도 모델도 부르지 않는다. 사용자가 무엇을 들여올지
//! 고르기 **전에** 돈이 나가는 구조를 만들지 않기 위해서다.

use std::path::Path;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::automation::core_model;
use crate::oculpm::automation::runner::LlmBackend;
use crate::oculpm::import::journalize::{self, ImportedEntry};
use crate::oculpm::import::{self, ImportCandidate, ImportSkip};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::spec::EntryType;

/// 한 번의 임포트로 받아들일 최대 건수. 넘기면 UI 가 나눠 부르게 한다 —
/// 수백 건을 한 호출에 넣으면 취소도 진행도 보이지 않는다.
const MAX_PER_RUN: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ImportScan {
    pub candidates: Vec<ImportCandidate>,
    /// 읽지 못한 대화 — 조용히 버리지 않는다.
    pub skipped: Vec<ImportSkip>,
    /// 이 프로젝트에 **이미 들여온** 대화의 `source_id`. 목록이 회색으로
    /// 표시되고 기본 선택에서 빠진다.
    pub already: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ImportReport {
    pub entries: Vec<ImportedEntry>,
    pub imported: u32,
    pub duplicates: u32,
    pub failed: u32,
}

/// `.json` 또는 `.zip` 고르기. 취소하면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn conversation_pick_export(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .add_filter("Conversation export", &["json", "zip"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|e| AppError::new("dialog_closed", e.to_string()))?;
    Ok(match picked {
        Some(FilePath::Path(p)) => p.to_str().map(String::from),
        _ => None,
    })
}

/// 후보 목록. **읽기 전용·오프라인**이다.
#[tauri::command]
#[specta::specta]
pub async fn conversation_import_scan(
    db: State<'_, Db>,
    project_id: u32,
    path: String,
) -> Result<ImportScan, AppError> {
    let parsed =
        import::read_source(Path::new(&path)).map_err(|e| AppError::new(e.code(), e.detail()))?;

    let mut already = Vec::new();
    for conv in &parsed.conversations {
        let c = &conv.candidate;
        if journalize::already_imported(&db, project_id, &c.workday, &c.slug)
            .await
            .map_err(|e| AppError::new("import_scan_failed", e))?
        {
            already.push(c.source_id.clone());
        }
    }

    Ok(ImportScan {
        candidates: parsed
            .conversations
            .into_iter()
            .map(|c| c.candidate)
            .collect(),
        skipped: parsed.skipped,
        already,
    })
}

/// 고른 대화를 일지로. **Core Model 로만 돈다** (D2) — 미설정이면 잠긴다.
///
/// `types` 는 `source_ids` 와 같은 길이여야 한다 (목록에서 갈래를 바꿀 수
/// 있으므로). 길이가 다르면 추정값을 그대로 쓴다.
#[tauri::command]
#[specta::specta]
pub async fn conversation_import_run(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    path: String,
    source_ids: Vec<String>,
    types: Vec<EntryType>,
) -> Result<ImportReport, AppError> {
    if source_ids.len() > MAX_PER_RUN {
        return Err(AppError::new(
            "import_too_many_selected",
            format!("select at most {MAX_PER_RUN} conversations per run"),
        ));
    }
    let target = core_model::resolve(&db)
        .await
        .map_err(|e| AppError::new("import_core_model_failed", e))?
        .ok_or_else(|| {
            AppError::new(
                "import_core_model_missing",
                "pick a background model before importing".to_string(),
            )
        })?;

    let parsed =
        import::read_source(Path::new(&path)).map_err(|e| AppError::new(e.code(), e.detail()))?;
    let redact = redact_patterns(&manager, project_id).await;
    let backend = LlmBackend;

    let mut entries: Vec<ImportedEntry> = Vec::new();
    for (i, id) in source_ids.iter().enumerate() {
        let Some(conv) = parsed
            .conversations
            .iter()
            .find(|c| &c.candidate.source_id == id)
        else {
            entries.push(ImportedEntry {
                source_id: id.clone(),
                title: id.clone(),
                relative_path: None,
                outcome: "failed".to_string(),
                detail: Some("not found in this export".to_string()),
            });
            continue;
        };
        let c = &conv.candidate;

        // 중복은 **모델 앞**에서 걸러낸다 — 과금 뒤에 버리는 것은 낭비다.
        match journalize::already_imported(&db, project_id, &c.workday, &c.slug).await {
            Ok(true) => {
                entries.push(ImportedEntry {
                    source_id: c.source_id.clone(),
                    title: c.title.clone(),
                    relative_path: None,
                    outcome: "duplicate".to_string(),
                    detail: None,
                });
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                entries.push(ImportedEntry {
                    source_id: c.source_id.clone(),
                    title: c.title.clone(),
                    relative_path: None,
                    outcome: "failed".to_string(),
                    detail: Some(e),
                });
                continue;
            }
        }

        let entry_type = types.get(i).copied().unwrap_or(c.guessed_type);
        // 한 건이 실패해도 나머지는 계속 간다 (부분 실패 허용).
        entries.push(
            journalize::journalize_one(
                &db, &manager, &backend, &target, project_id, conv, entry_type, &redact,
            )
            .await,
        );
    }

    let imported = entries.iter().filter(|e| e.outcome == "imported").count() as u32;
    let duplicates = entries.iter().filter(|e| e.outcome == "duplicate").count() as u32;
    let failed = entries.iter().filter(|e| e.outcome == "failed").count() as u32;
    Ok(ImportReport {
        entries,
        imported,
        duplicates,
        failed,
    })
}

/// 프로젝트의 마스킹 패턴. 설정을 못 읽어도 임포트를 막지 않는다 —
/// 마스킹은 이중 방어의 한 겹이고, 모델 응답 쪽 겹은 그대로 선다.
async fn redact_patterns(manager: &OculpmManager, project_id: u32) -> Vec<regex::Regex> {
    match manager.get_config(project_id).await {
        Ok(cfg) => crate::oculpm::redact::compile_redact_patterns(&cfg.git.auto_redact_patterns),
        Err(_) => Vec::new(),
    }
}
