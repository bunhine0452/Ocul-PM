//! 열린 파일 하나의 본문 창구 — 읽기(`code_read`)·미리보기 자산(`code_asset`)·
//! 낙관적 잠금 저장(`code_write`).
//!
//! 바이너리 판정과 편집 상한, 그리고 저장을 직렬화하는 [`write_with_lock`] 이
//! 여기 산다 — 검색 치환과 로컬 히스토리 되돌리기도 같은 저장 경로를 탄다.

use std::path::Path;
use std::sync::Mutex;

use base64::Engine as _;
use serde::Serialize;
use tauri::State;

use super::guards::canonical_within_root;
use super::project_root;
use crate::commands::project::secure_join;
use crate::db::Db;
use crate::oculpm::history::HistoryState;

/// 에디터로 여는 파일의 상한. 이보다 크면 `too_large` — 뷰어가 아니라 로그/
/// 데이터 파일이라 외부 에디터로 보낸다 (base64 왕복·CM 하이라이트 비용 방어).
pub(super) const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// 미리보기(이미지·PDF)로 실어 나르는 파일의 상한. 편집 상한([`MAX_EDIT_BYTES`])
/// 보다 크게 잡는다 — 스크린샷 한 장이 2MB 를 넘는 일은 흔해서, 같은 값을 쓰면
/// 정작 미리보기가 필요한 파일에서만 "너무 큼" 이 뜨는 꼴이 된다.
const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;

/// 바이너리 판정 프로브 크기 — 선두 8KB 에 NUL 이 있으면 바이너리로 본다.
const BINARY_PROBE_BYTES: usize = 8192;

/// `code_read` 응답. `binary`/`too_large` 면 `content` 는 빈 문자열이고
/// UI 는 "외부 에디터로 열기" 안내를 그린다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeFileContent {
    pub content: String,
    /// blake3(원본 바이트) hex — 저장 시 `base_hash` 로 되돌려 보내는 토큰.
    pub hash: String,
    pub bytes: u32,
    pub binary: bool,
    pub too_large: bool,
}

/// `code_asset` 응답 — 이미지/PDF 바이트를 base64 + MIME 으로. 웹뷰는 임의 파일
/// 경로를 `<img src>` 로 직접 못 읽으므로, 프런트가 이걸 Blob 으로 되돌려 문다

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeAsset {
    pub mime: String,
    pub base64: String,
    pub bytes: u32,
}

/// `code_write` 결과 — 충돌은 오류가 아니라 정상 분기라 Err 로 보내지 않는다
/// (프런트가 배너로 병합 선택지를 그려야 한다).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind")]
pub enum CodeWriteOutcome {
    #[serde(rename = "saved")]
    Saved { hash: String },
    #[serde(rename = "conflict")]
    Conflict { disk_hash: String },
}

/// 단일 파일 본문 + 해시. 바이너리/대용량은 본문 없이 플래그만 세운다.
#[tauri::command]
#[specta::specta]
pub async fn code_read(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeFileContent, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let full = canonical_within_root(&root, &full)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Ok(CodeFileContent {
            content: String::new(),
            hash: String::new(),
            bytes: meta.len().min(u32::MAX as u64) as u32,
            binary: false,
            too_large: true,
        });
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let len = bytes.len() as u32;
    if looks_binary(&bytes) {
        return Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(CodeFileContent {
            content,
            hash,
            bytes: len,
            binary: false,
            too_large: false,
        }),
        // UTF-8 이 아니면 텍스트 에디터 대상이 아니다 — 바이너리로 취급.
        Err(_) => Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        }),
    }
}

/// 이미지·PDF 를 미리보기용 바이트로 읽는다.
///
/// [`code_read`] 와 **같은 경로 가드**를 쓰되(프로젝트 루트 밖 탈출 불가), 텍스트가
/// 아니므로 해시·바이너리 판정 없이 통째로 싣는다. 편집 대상이 아니라 저장 창구가
/// 없고, 그래서 낙관적 잠금 토큰(blake3)도 필요 없다.
#[tauri::command]
#[specta::specta]
pub async fn code_asset(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeAsset, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let full = canonical_within_root(&root, &full)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err("File is too large to preview (over 16MB)".to_string());
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let len = bytes.len() as u32;
    Ok(CodeAsset {
        mime: crate::commands::fsutil::mime_for(&full),
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        bytes: len,
    })
}

/// 파일 저장 (낙관적 잠금). **기존 파일만** — 신규 생성은 v1 스코프 밖이라
/// 트리와 어긋난 유령 경로 생성을 막는다.
#[tauri::command]
#[specta::specta]
pub async fn code_write(
    db: State<'_, Db>,
    hist: State<'_, HistoryState>,
    project_id: u32,
    rel_path: String,
    content: String,
    base_hash: String,
    by_agent: Option<bool>,
) -> Result<CodeWriteOutcome, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        write_with_lock(&full, &content, &base_hash)
    })
    .await
    .map_err(|e| format!("Failed to save file: {e}"))??;

    // 로컬 히스토리는 워처 한 곳에서만 찍는다 (이중 캡처 방지). 대신 **누가
    // 썼는지**만 알려 준다 — `by_agent` 는 ⌘K 가 쓴 판인가다 (저장한 손이 아니라).
    if let CodeWriteOutcome::Saved { hash } = &outcome {
        hist.note_self_write(project_id, &rel_path, hash, by_agent.unwrap_or(false));
    }
    Ok(outcome)
}

pub(super) fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE_BYTES)].contains(&0)
}

/// 저장 직렬화 — 같은 파일에 저장이 동시에 두 건 들어오면 둘 다 해시 검사를
/// 통과한 뒤 서로를 덮어써, 둘 다 Saved 를 돌려주면서 한쪽 편집이 조용히
/// 사라진다. 저장은 드물고 짧아 경로별이 아닌 전역 뮤텍스로 충분하다.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 해시 대조 → 같은 디렉터리 임시 파일 → 권한 복사 → rename. 동기 IO 라
/// spawn_blocking 안에서 부른다.
pub(crate) fn write_with_lock(
    full: &Path,
    content: &str,
    base_hash: &str,
) -> Result<CodeWriteOutcome, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let disk = std::fs::read(full).map_err(|e| format!("Failed to read file before save: {e}"))?;
    let disk_hash = blake3::hash(&disk).to_hex().to_string();
    if disk_hash != base_hash {
        return Ok(CodeWriteOutcome::Conflict { disk_hash });
    }

    let parent = full
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let file_name = full
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let tmp = parent.join(format!(".{file_name}.oculpm-save-tmp"));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Failed to save file: {e}"))?;
    // rename 은 inode 를 갈아끼우므로 원본 권한(실행 비트 등)을 임시 파일에
    // 먼저 옮겨 둬야 저장 후에도 유지된다.
    if let Ok(meta) = std::fs::metadata(full) {
        // 실패해도 저장은 계속하지만(내용 보존이 우선), 실행 비트가 조용히
        // 사라지는 종류의 회귀라 진단 가능하게 남긴다.
        if let Err(e) = std::fs::set_permissions(&tmp, meta.permissions()) {
            tracing::warn!(path = %full.display(), error = %e, "failed to preserve permissions on save");
        }
    }
    if let Err(e) = std::fs::rename(&tmp, full) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to save file: {e}"));
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    Ok(CodeWriteOutcome::Saved { hash })
}
