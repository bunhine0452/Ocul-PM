//! Claude 플러그인 번들 임포트의 진입점 (Osaurus 라운드 Phase 6 #plugin-import).
//!
//! 얇다 — 가드는 [`plugins::archive`], 분류는 [`plugins::manifest`], 배치와
//! 소유는 [`plugins::install`] 이 한다. 여기서는 출처를 가져오고(네트워크
//! 또는 파일), 순서를 잡고, `.mcp.json` 병합과 자동화 정의 생성처럼 **앱
//! 상태가 필요한 마무리**만 붙인다.
//!
//! 미리보기와 설치는 **같은 함수**를 `dry` 만 바꿔 부른다 — 미리 본 것과
//! 일어난 것이 갈라질 길을 코드 수준에서 없앤다.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::automation::store as automation_store;
use crate::oculpm::automation::store::{AutomationDef, AutomationKind};
use crate::plugins::archive;
use crate::plugins::install::{self, InstallReport, McpMerge, PlacementOutcome};
use crate::plugins::manifest::{self, ArtifactKind, BundleManifest};
use crate::plugins::source;
use crate::plugins::store;
use crate::plugins::store::InstalledBundle;

/// 로컬 번들 파일 상한 — 압축 상태. 네트워크 쪽과 같은 값이다.
const MAX_LOCAL_BUNDLE_BYTES: u64 = source::MAX_DOWNLOAD_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BundleSourceKind {
    /// GitHub `owner/repo` — 임의 URL 은 받지 않는다.
    Github,
    /// 로컬 `.zip` 파일 경로.
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BundleImportResult {
    pub manifest: BundleManifest,
    pub report: InstallReport,
    pub mcp: McpMerge,
    /// 이 번들에서 만든 비활성 자동화 정의 id.
    pub automations: Vec<String>,
    /// 같은 id 의 번들이 이미 설치돼 있다 — `replace` 없이는 쓰지 않았다.
    pub already_installed: Option<InstalledBundle>,
    /// 받은 바이트의 blake3 — 설치 호출이 `expect_hash` 로 되돌려준다.
    pub content_hash: String,
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// 번들 zip 파일을 고른다. 취소하면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn plugin_pick_bundle(app: AppHandle) -> Result<Option<String>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .add_filter("Claude plugin bundle", &["zip"])
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

async fn fetch_bytes(kind: BundleSourceKind, src: &str) -> Result<Vec<u8>, AppError> {
    match kind {
        BundleSourceKind::Github => {
            let parsed = source::parse_github(src).ok_or_else(|| {
                AppError::new(
                    "bundle_bad_source",
                    format!("expected owner/repo, got: {src}"),
                )
            })?;
            source::fetch_github_zip(&parsed)
                .await
                .map_err(|e| AppError::new(e.code(), e.detail()))
        }
        BundleSourceKind::File => {
            let path = Path::new(src);
            let meta = std::fs::metadata(path)
                .map_err(|e| AppError::new("bundle_unreadable", format!("{src}: {e}")))?;
            if meta.len() > MAX_LOCAL_BUNDLE_BYTES {
                return Err(AppError::new(
                    "bundle_too_large",
                    format!("{} bytes exceeds the download limit", meta.len()),
                ));
            }
            std::fs::read(path)
                .map_err(|e| AppError::new("bundle_unreadable", format!("{src}: {e}")))
        }
    }
}

/// 번들을 들여온다. `dry` 면 **한 글자도 쓰지 않고** 같은 판정만 낸다.
///
/// `replace` 는 같은 id 가 이미 설치돼 있을 때만 뜻이 있다 — 없으면
/// `already_installed` 를 채워 돌려주고 아무것도 쓰지 않는다 (명시적 교체 확인).
///
/// 설치(`dry == false`)는 `expect_hash` 를 요구한다 — 미리보기가 돌려준
/// `content_hash` 그대로. 미리보기와 설치는 따로 내려받으므로, 그 사이 작성자가
/// 브랜치를 바꾸면 본 것과 다른 `.mcp.json` 명령이 깔린다 (2026-10-09 리포트).
/// 바이트가 다르면 아무것도 쓰지 않고 `bundle_changed` 로 돌려보낸다.
#[tauri::command]
#[specta::specta]
pub async fn plugin_import(
    db: State<'_, Db>,
    project_id: u32,
    kind: BundleSourceKind,
    src: String,
    dry: bool,
    replace: bool,
    expect_hash: Option<String>,
) -> Result<BundleImportResult, AppError> {
    let root = db.project_root(project_id).await?;
    let bytes = fetch_bytes(kind, &src).await?;
    let content_hash = blake3::hash(&bytes).to_hex().to_string();
    if !dry && !same_bytes(expect_hash.as_deref(), &content_hash) {
        return Err(AppError::new(
            "bundle_changed",
            "the bundle differs from the one previewed — preview it again",
        ));
    }
    let read = archive::read_zip(bytes).map_err(|e| AppError::new(e.code(), e.detail()))?;

    let fallback = match kind {
        BundleSourceKind::Github => src.clone(),
        BundleSourceKind::File => Path::new(&src)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "bundle".into()),
    };
    let manifest = manifest::read(&read.files, &fallback)
        .ok_or_else(|| AppError::new("bundle_empty", "the archive contains no usable files"))?;

    let existing = store::read(&root, &manifest.id).ok().flatten();
    // 이미 있는 번들 위에 설치할 때는 명시적 확인을 받는다 (#import-guards).
    // 미리보기는 이 문에서 멈추지 않는다 — 보여 주는 것이 목적이다.
    let blocked_by_confirmation = existing.is_some() && !replace && !dry;

    let (report, mut installed) = install::install(
        &root,
        &manifest,
        &read.files,
        read.skipped,
        &src,
        &now_iso(),
        dry || blocked_by_confirmation,
    );

    // `.mcp.json` — 우리가 전에 넣은 키는 갱신해도 되고, 남의 키는 못 만진다.
    let owned_keys = existing
        .as_ref()
        .map(|b| b.mcp_keys.clone())
        .unwrap_or_default();
    let mcp = read
        .files
        .iter()
        .find(|f| f.path == ".mcp.json")
        .map(|f| install::merge_mcp(&root, &f.bytes, &owned_keys, dry || blocked_by_confirmation))
        .unwrap_or(McpMerge {
            added: Vec::new(),
            launches: Vec::new(),
            conflicts: Vec::new(),
            unreadable: false,
        });

    let automations = if dry || blocked_by_confirmation {
        planned_automations(&manifest)
    } else {
        create_automations(&root, &manifest, &read.files)
    };

    if !dry && !blocked_by_confirmation {
        installed.mcp_keys = mcp.added.clone();
        installed.automations = automations.clone();
        store::write(&root, &installed).map_err(AppError::from)?;
    }

    Ok(BundleImportResult {
        manifest,
        report,
        mcp,
        automations,
        already_installed: blocked_by_confirmation.then_some(existing).flatten(),
        content_hash,
    })
}

/// 설치가 미리 본 바이트 그대로인가. 미리보기 없이 온 설치(`None`)도 거부한다.
fn same_bytes(expected: Option<&str>, actual: &str) -> bool {
    expected.is_some_and(|e| e == actual)
}

/// 에이전트 정의가 만들 자동화 id 목록 (쓰지 않고 이름만).
fn planned_automations(manifest: &BundleManifest) -> Vec<String> {
    manifest
        .honored()
        .filter(|a| a.kind == ArtifactKind::Agent)
        .filter_map(|a| manifest::normalize_id(&a.name))
        .map(|id| format!("schedules/{id}"))
        .collect()
}

/// `agents/<n>.md` → **비활성** 스케줄 정의. 빈도를 정하지 않고 꺼진 채로
/// 둔다 — 남의 저장소에서 들여온 지시문이 자기 발로 돌면 안 된다.
///
/// 파일 자체는 `.claude/agents/` 에도 그대로 놓였다 (installer). 여기서
/// 만드는 것은 "그 지시문을 배경 작업으로도 쓸 수 있는 자리" 다.
fn create_automations(
    project_root: &Path,
    manifest: &BundleManifest,
    files: &[archive::BundleFile],
) -> Vec<String> {
    let today = today();
    let mut made = Vec::new();
    for artifact in manifest.honored() {
        if artifact.kind != ArtifactKind::Agent {
            continue;
        }
        let Some(id) = manifest::normalize_id(&artifact.name) else {
            continue;
        };
        // 이미 있는 정의는 덮지 않는다 — 사용자가 고쳐 뒀을 수 있다.
        if automation_store::read_automation(project_root, AutomationKind::Schedule, &id)
            .ok()
            .flatten()
            .is_some()
        {
            continue;
        }
        let Some(file) = files.iter().find(|f| f.path == artifact.source) else {
            continue;
        };
        let mut def = AutomationDef::new(
            id.clone(),
            AutomationKind::Schedule,
            artifact.name.clone(),
            &today,
        );
        def.instructions = String::from_utf8_lossy(&file.bytes).into_owned();
        if automation_store::write_automation(project_root, &def).is_ok() {
            made.push(format!("schedules/{id}"));
        }
    }
    made
}

/// 설치된 번들 목록.
#[tauri::command]
#[specta::specta]
pub async fn plugin_list(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<InstalledBundle>, AppError> {
    Ok(store::list(&db.project_root(project_id).await?))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct BundleRemoveReport {
    pub removed: u32,
    /// 사용자가 이어받아(마커를 지워) 남긴 파일.
    pub kept: Vec<String>,
    pub mcp_removed: bool,
    /// 함께 지운 비활성 자동화 정의.
    pub automations_removed: Vec<String>,
}

/// 번들이 놓은 것만 지운다. 사용자가 이어받은 파일은 남긴다.
#[tauri::command]
#[specta::specta]
pub async fn plugin_remove(
    db: State<'_, Db>,
    project_id: u32,
    bundle_id: String,
) -> Result<BundleRemoveReport, AppError> {
    let root = db.project_root(project_id).await?;
    let Some(bundle) = store::read(&root, &bundle_id).map_err(AppError::from)? else {
        return Err(AppError::new("bundle_not_installed", bundle_id));
    };

    let mut removed = 0u32;
    let mut kept = Vec::new();
    for item in &bundle.items {
        match install::unplace(&root, &bundle.id, &item.path) {
            PlacementOutcome::Wrote => removed += 1,
            PlacementOutcome::Conflict => kept.push(item.path.clone()),
            _ => {}
        }
    }

    let mut automations_removed = Vec::new();
    for entry in &bundle.automations {
        let Some(id) = entry.strip_prefix("schedules/") else {
            continue;
        };
        if automation_store::delete_automation(&root, AutomationKind::Schedule, id).unwrap_or(false)
        {
            automations_removed.push(entry.clone());
        }
    }

    let mcp_removed = install::unmerge_mcp(&root, &bundle.mcp_keys);
    store::delete(&root, &bundle.id).map_err(AppError::from)?;

    Ok(BundleRemoveReport {
        removed,
        kept,
        mcp_removed,
        automations_removed,
    })
}

#[cfg(test)]
mod tests {
    use super::same_bytes;

    #[test]
    fn install_needs_the_exact_previewed_bytes() {
        assert!(same_bytes(Some("ab12"), "ab12"));
        assert!(!same_bytes(Some("ab12"), "cd34"), "미리본 뒤 바뀐 번들");
        assert!(!same_bytes(None, "ab12"), "미리보기 없이 온 설치");
    }
}
