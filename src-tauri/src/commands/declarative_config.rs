//! 선언적 설정의 UI 진입점 (Osaurus 라운드 Phase 6 #config-plan-apply).
//!
//! 얇다. 계산은 전부 [`crate::config`] 에 있고 여기서는 DB·디스크·대화상자만
//! 다룬다 — CLI·MCP 가 같은 두 모듈을 부르므로 로직이 여기 생기면 진입점마다
//! 결과가 갈라진다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::app_error::AppError;
use crate::config::applier::{self, ConfigApplyFailure, ConfigApplyResult};
use crate::config::planner::{self, ConfigPlan, ConfigSurface};
use crate::config::schema::{self, ConfigDoc};
use crate::db::Db;

/// 문서 파일 상한 — 설정 한 장이 이보다 크면 그 파일이 아니다.
const MAX_DOC_BYTES: u64 = 1024 * 1024;

fn doc_error(e: schema::DocError) -> AppError {
    AppError::new(e.code(), e.detail())
}

async fn current_settings(db: &Db) -> Result<BTreeMap<String, String>, AppError> {
    Ok(db
        .settings_get_all()
        .await
        .map_err(|e| AppError::new("settings_read", e.to_string()))?
        .into_iter()
        .collect())
}

/// 프로젝트 id → 루트 경로. 프런트는 어디서나 id 를 들고 다니므로 경로를
/// 실어 보내게 하지 않는다 (경로를 받으면 그 경로가 등록된 프로젝트인지
/// 커맨드마다 다시 확인해야 한다).
async fn root_of(db: &Db, project_id: Option<u32>) -> Result<Option<PathBuf>, AppError> {
    let Some(id) = project_id else {
        return Ok(None);
    };
    let project = db
        .get_project(id)
        .await
        .map_err(|e| AppError::new("project_not_found", e.to_string()))?;
    Ok(Some(PathBuf::from(project.root_path)))
}

/// 지금 상태를 YAML 문서로 내보낸다. 시크릿·머신 상태는 planner 가 뺀다.
#[tauri::command]
#[specta::specta]
pub async fn config_export(
    db: State<'_, Db>,
    project_id: Option<u32>,
) -> Result<String, AppError> {
    let settings = current_settings(&db).await?;
    let root = root_of(&db, project_id).await?;
    let state = planner::capture(settings, root.as_deref());
    schema::render_doc(&planner::export(&state)).map_err(doc_error)
}

/// 문서를 파일로 저장한다 (대화상자). 취소하면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn config_export_to_file(
    app: AppHandle,
    db: State<'_, Db>,
    project_id: Option<u32>,
) -> Result<Option<String>, AppError> {
    let body = config_export(db, project_id).await?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name("oculpm-config.yaml")
        .add_filter("Ocul-PM config", &["yaml", "yml"])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .await
        .map_err(|e| AppError::new("dialog_closed", e.to_string()))?;
    let Some(FilePath::Path(path)) = picked else {
        return Ok(None);
    };
    crate::oculpm::atomic_io::write_atomic(&path, body.as_bytes())?;
    Ok(path.to_str().map(String::from))
}

/// 문서 파일을 읽는다 (`path` 가 없으면 대화상자). 취소하면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn config_read_file(
    app: AppHandle,
    path: Option<String>,
) -> Result<Option<String>, AppError> {
    let source: PathBuf = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
            app.dialog()
                .file()
                .add_filter("Ocul-PM config", &["yaml", "yml"])
                .pick_file(move |picked| {
                    let _ = tx.send(picked);
                });
            match rx
                .await
                .map_err(|e| AppError::new("dialog_closed", e.to_string()))?
            {
                Some(FilePath::Path(p)) => p,
                _ => return Ok(None),
            }
        }
    };
    read_doc_text(&source).map(Some)
}

fn read_doc_text(path: &Path) -> Result<String, AppError> {
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::new("config_doc_read", format!("{}: {e}", path.display())))?;
    if meta.len() > MAX_DOC_BYTES {
        return Err(AppError::new(
            "config_doc_too_large",
            format!(
                "{} bytes exceeds the {MAX_DOC_BYTES} byte limit",
                meta.len()
            ),
        ));
    }
    std::fs::read_to_string(path)
        .map_err(|e| AppError::new("config_doc_read", format!("{}: {e}", path.display())))
}

/// 문서와 지금 상태의 diff. **아무것도 쓰지 않는다** — 승인 카드의 입력이다.
#[tauri::command]
#[specta::specta]
pub async fn config_plan(
    db: State<'_, Db>,
    project_id: Option<u32>,
    doc: String,
) -> Result<ConfigPlan, AppError> {
    let parsed = schema::parse_doc(&doc).map_err(doc_error)?;
    let settings = current_settings(&db).await?;
    let root = root_of(&db, project_id).await?;
    let state = planner::capture(settings, root.as_deref());
    Ok(planner::plan(&state, &parsed, root.as_deref()))
}

/// 계획을 적용하고 **다시 계획해** 남은 diff 로 결론을 낸다 (#config-verify).
#[tauri::command]
#[specta::specta]
pub async fn config_apply(
    db: State<'_, Db>,
    project_id: Option<u32>,
    doc: String,
) -> Result<ConfigApplyResult, AppError> {
    let parsed = schema::parse_doc(&doc).map_err(doc_error)?;
    let root = root_of(&db, project_id).await?;
    apply_doc(&db, root.as_deref(), &parsed).await
}

/// UI·CLI·MCP 가 공유하는 적용 본체. 진입점은 문서를 어떻게 얻었는지만 다르다.
pub async fn apply_doc(
    db: &Db,
    root: Option<&Path>,
    parsed: &ConfigDoc,
) -> Result<ConfigApplyResult, AppError> {
    let settings = current_settings(db).await?;
    let state = planner::capture(settings, root);
    let plan = planner::plan(&state, parsed, root);

    let mut applied: Vec<String> = Vec::new();
    let mut failed: Vec<ConfigApplyFailure> = Vec::new();

    let writes = applier::settings_writes(&plan);
    for (key, value) in writes {
        match db.settings_set(key.clone(), value).await {
            Ok(()) => applied.push(key),
            Err(e) => failed.push(ConfigApplyFailure {
                surface: ConfigSurface::Settings,
                key,
                code: "write_failed".into(),
                detail: e.to_string(),
            }),
        }
    }

    if let Some(root) = root {
        match applier::apply_oculpm(root, parsed) {
            Ok(true) => applied.push(".oculpm/config.toml".into()),
            Ok(false) => {}
            Err(f) => failed.push(f),
        }
    }

    // 대조 검증 — 방금 쓴 상태를 **다시 읽어** 계획한다. 여기서 쓸 것이 남으면
    // apply 가 성공을 반환했더라도 "일부만 적용됨" 이다.
    let after_settings = current_settings(db).await?;
    let after = planner::capture(after_settings, root);
    let residual = planner::plan(&after, parsed, root);

    Ok(applier::conclude(
        applied,
        failed,
        plan.blocked,
        residual.added + residual.changed,
    ))
}
