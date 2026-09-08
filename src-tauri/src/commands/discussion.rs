//! 문제 해결(Discussion) commands — PR-DISC 0 read side.
//!
//! Each command reprojects the `.oculpm/discussion/<slug>/discussion.md` SSOT
//! into the `oculpm_discussion*` cache and returns DTOs, so results are always
//! fresh even before the watcher live-push lands. Writes (`discussion_create` /
//! `discussion_write` / …) land in PR-DISC 1+.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::oculpm::agent_cli::WRITE_CONFLICT_PREFIX;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cas::{acquire_doc_guard, content_hash};
use crate::oculpm::discussion::doc_edit::{
    create_discussion_skeleton, set_resolution, set_status, set_title, write_body,
};
use crate::oculpm::discussion::parse::parse_discussion;
use crate::oculpm::discussion::project::{
    discussion_root, find_discussion_path, slug_for, DiscussionCache, DiscussionDetail,
    DiscussionSummary,
};
use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::planner::parse::ItemStatus;
use crate::oculpm::planner::plan_edit::{add_item, create_plan_skeleton};
use crate::oculpm::planner::project::planner_dir;

async fn discussion_root_of(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(discussion_root(Path::new(&project.root_path)))
}

/// List the project's discussions (summary + problem preview + counts).
/// Recent-first.
#[tauri::command]
#[specta::specta]
pub async fn discussion_list(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<DiscussionSummary>, String> {
    let root = discussion_root_of(&db, project_id).await?;
    DiscussionCache::new(&db).list(project_id, &root).await
}

/// One discussion's full detail: problem, candidate options, discussion log,
/// conclusion, next steps, attachments, resolution link, and non-fatal parse
/// warnings. `None` when the discussion_id isn't found.
#[tauri::command]
#[specta::specta]
pub async fn discussion_get(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
) -> Result<Option<DiscussionDetail>, String> {
    let root = discussion_root_of(&db, project_id).await?;
    DiscussionCache::new(&db)
        .get(project_id, &root, &discussion_id)
        .await
}

/// 편집기가 읽는 **원문 본문** + 그 본문의 CAS 해시.
///
/// `hash` 는 `discussion_write` 의 `base_hash` 에 그대로 넘긴다 — 이 값이
/// "내가 본 것이 아직 디스크에 있는가" 를 묻는 유일한 재료다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionRaw {
    pub body: String,
    /// 본문의 blake3 hex ([`cas::content_hash`]).
    pub hash: String,
}

/// Read the raw (un-redacted) body markdown (everything after the frontmatter)
/// for the in-app editor. Unlike `discussion_get` (redacted projection for
/// display), this returns exactly what's on disk so a save round-trip is
/// lossless — the user is editing their own file. `discussion_write` saves it.
///
/// 해시는 **본문만** 건다. `write_body` 가 갈아 끼우는 구간이 정확히 본문이라,
/// 파일 전체를 걸면 `discussion_set_status` 가 프런트매터만 고친 것까지 충돌로
/// 둔갑한다 — 본문은 아무도 안 건드렸는데 저장이 거절되는 거짓 충돌이다.
#[tauri::command]
#[specta::specta]
pub async fn discussion_read_raw(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
) -> Result<DiscussionRaw, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(raw_of(&md))
}

/// 디스크 내용 → 편집기가 받는 본문 + 해시. **읽는 자리와 대조하는 자리가
/// 같은 함수를 써야** CAS 가 성립한다 ([`cas`] 의 규율).
fn raw_of(md: &str) -> DiscussionRaw {
    let (_fm, body) = parse_frontmatter_and_body(md);
    let body = body.trim_start_matches('\n').to_string();
    let hash = content_hash(&body);
    DiscussionRaw { body, hash }
}

// ─── write side (PR-DISC 1) ───────────────────────────────────────────────────
//
// App writes go through these (atomic temp+rename); external agents edit the
// `.md` directly per AGENTS.md (PR-DISC 5). Both are absorbed by the watcher /
// reproject-on-read.
//
// **2026-09-08 — "single-user tool, last-write-wins" 였던 자리다.**
//
// 그 문장은 "mirrors planner PR-PLN 1" 이라고 근거를 댔는데, 플래너는 그 뒤
// 문지기 + 필수 `base_hash` 로 갔고({#cas-required}·{#cas-toctou}) 논의만 옛
// 규약에 남았다. 전제도 세 방향에서 깨졌다 — 바로 위 줄이 인정하듯 **외부
// 에이전트가 같은 파일을 고치고**, 모바일 브리지가 `discussion_write` 를 폰에
// 열어 두었으며, 멀티 창이라 편집기가 둘일 수 있다.
//
// 실제 손실 경로는 이랬다: 편집기를 열면 프런트가 본문 스냅숏을 뜨고
// (`DiscussionScreenV2.startEdit`), **편집 중에는 디스크 변경을 일부러 무시하다가**
// (초안을 지키려고) 저장 때 그 스냅숏으로 본문을 통째로 덮었다. 그 사이 에이전트가
// 적은 결론은 오류도 흔적도 없이 사라지고 화면에는 "저장했어요" 가 떴다.
//
// 그래서 이 구역의 모든 read-modify-write 는 [`acquire_doc_guard`] 를 **읽기
// 앞에서** 잡고, 본문을 통째로 갈아 끼우는 `discussion_write` 는 그 위에
// `base_hash` 대조까지 얹는다. 문지기는 프로세스가 겹치는 창을, 해시는 사람이
// 편집기를 열어 둔 몇 분짜리 창을 막는다 — 둘은 서로를 대신하지 못한다.

const LOCKED_MSG: &str =
    "이 문제 해결 문서는 닫힘(resolved/archived) 상태입니다. 다시 열어야 본문을 편집할 수 있어요.";

/// True when the document is not `open` (resolved/archived → body read-only).
fn is_body_locked(md: &str, id: &str) -> bool {
    parse_discussion(md, id).frontmatter.status.as_str() != "open"
}

/// Pick a free folder name under `root` for `base` (`base`, `base-2`, …).
fn free_discussion_dir(root: &Path, base: &str) -> (String, PathBuf) {
    let mut id = base.to_string();
    let mut n = 2;
    loop {
        let dir = root.join(&id);
        if !dir.exists() {
            return (id, dir);
        }
        id = format!("{base}-{n}");
        n += 1;
    }
}

/// Create a new discussion folder (`.oculpm/discussion/<slug>/discussion.md`)
/// with the section skeleton, returning its summary.
#[tauri::command]
#[specta::specta]
pub async fn discussion_create(
    db: State<'_, Db>,
    project_id: u32,
    title: String,
) -> Result<DiscussionSummary, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("Enter a title.".to_string());
    }
    let root = discussion_root_of(&db, project_id).await?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let (id, dir) = free_discussion_dir(&root, &slug_for(t));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let md = create_discussion_skeleton(&id, t, "user", &date);
    write_atomic(&dir.join("discussion.md"), md.as_bytes()).map_err(|e| e.to_string())?;

    let summaries = DiscussionCache::new(&db).list(project_id, &root).await?;
    summaries
        .into_iter()
        .find(|s| s.discussion_id == id)
        .ok_or_else(|| "discussion created but missing from projection".to_string())
}

/// Replace the discussion body (the `## …` sections). Frontmatter is preserved
/// and `updated` re-stamped. Rejected when the document is closed (status not
/// `open`) — the body is read-only after a discussion is resolved/archived.
#[tauri::command]
#[specta::specta]
pub async fn discussion_write(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    body_md: String,
    base_hash: String,
) -> Result<Option<DiscussionDetail>, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;

    // **여기서부터 쓰기까지가 한 임계구간이다.** 락을 읽기 **앞**에 두는 것이
    // 요점 — 대조에 쓴 그 바이트가 쓰기 순간까지 유효해야 한다.
    let _guard = doc_guard(&path, &discussion_id)?;

    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // 잠금 판정이 **해시 대조보다 먼저**다. 닫힌 문서는 어떤 해시로 와도 못
    // 고치므로, 순서가 반대면 호출자는 "다시 읽고 재시도하라" 는 안내를 받아
    // 한 왕복을 더 쓴 끝에 결국 같은 거절을 만난다 (플래너와 같은 순서).
    if is_body_locked(&md, &discussion_id) {
        return Err(LOCKED_MSG.to_string());
    }

    let current = raw_of(&md);
    if !current.hash.eq_ignore_ascii_case(&base_hash) {
        return Err(conflict_message(&discussion_id, &base_hash, &current.hash));
    }

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = write_body(&md, &body_md, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    DiscussionCache::new(&db)
        .get(project_id, &root, &discussion_id)
        .await
}

/// [`acquire_doc_guard`] + 다음 행동 안내.
///
/// 문지기를 못 잡았으면 **쓰지 않는다.** 조용히 진행하면 락이 없는 것보다
/// 나쁘다 — 보호받는다고 믿으면서 보호받지 못한다.
fn doc_guard(
    path: &Path,
    discussion_id: &str,
) -> Result<crate::oculpm::file_guard::FileGuard, String> {
    acquire_doc_guard(path).map_err(|e| {
        format!(
            "{WRITE_CONFLICT_PREFIX} 논의 '{discussion_id}' 을 지금 쓸 수 없습니다: {e}. \
             다른 세션이 같은 문서를 고치는 중입니다 — 잠시 뒤 다시 시도하세요."
        )
    })
}

/// 해시가 어긋났을 때 — 현재 hash 와 재시도 절차를 함께 싣는다.
///
/// 현재 hash 를 주는 것이 "그대로 다시 부르라" 는 뜻은 아니다. 그 사이 남이
/// 적은 내용이 있으므로 **다시 읽어 판단**하는 것이 먼저다 — 그래도 값을 실어
/// 주는 것은, 안 실으면 호출자가 파일을 다시 읽어야 하고 그 사이가 또 창이 되기
/// 때문이다. 프런트는 이 접두사를 보고 초안을 **버리지 않은 채** 사용자에게
/// 선택(다시 읽기 / 알고 덮어쓰기)을 준다.
fn conflict_message(discussion_id: &str, expected: &str, actual: &str) -> String {
    format!(
        "{WRITE_CONFLICT_PREFIX} 논의 '{discussion_id}' 이 읽은 뒤에 바뀌었습니다 \
         (expected {expected}, now {actual}) — 그 사이 다른 세션이 이 문서를 고쳤습니다. \
         아무것도 쓰지 않았습니다."
    )
}

/// Set a discussion's lifecycle status (`open` / `resolved` / `archived`).
/// `archived` moves the folder into `_archive/`; un-archiving moves it back.
#[tauri::command]
#[specta::specta]
pub async fn discussion_set_status(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    status: String,
) -> Result<Option<DiscussionDetail>, String> {
    if !matches!(status.as_str(), "open" | "resolved" | "archived") {
        return Err(format!("unknown discussion status '{status}'"));
    }
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    // 프런트매터만 고치지만 파일은 **통째로** 다시 쓴다 — 문지기가 없으면
    // 동시에 도는 `discussion_write` 의 본문 변경을 그대로 덮는다.
    //
    // 문지기는 쓰기까지만 잡고 **폴더 이동 전에 놓는다.** 락 파일은 그 폴더 안에
    // 살아서, 쥔 채로 옮기면 `Drop` 은 옛 자리를 지우려다 헛치고 새 자리에 락이
    // 남는다 — 보관한 문서가 10초(노후 문턱) 동안 아무도 못 쓰는 상태가 된다.
    {
        let _guard = doc_guard(&path, &discussion_id)?;
        let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let new_md = set_status(&md, &status, &date);
        write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    }

    // Physically (un)archive the folder so `_archive/` stays in sync with the
    // status. The write above already landed at the current path; move after.
    if let Some(folder) = path.parent() {
        let folder = folder.to_path_buf();
        let folder_name = folder.file_name().map(|n| n.to_os_string());
        let in_archive = folder
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n == "_archive")
            .unwrap_or(false);
        if let Some(name) = folder_name {
            if status == "archived" && !in_archive {
                let archive = root.join("_archive");
                std::fs::create_dir_all(&archive).map_err(|e| e.to_string())?;
                let dest = archive.join(&name);
                if !dest.exists() {
                    std::fs::rename(&folder, &dest).map_err(|e| e.to_string())?;
                }
            } else if status != "archived" && in_archive {
                let dest = root.join(&name);
                if !dest.exists() {
                    std::fs::rename(&folder, &dest).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    DiscussionCache::new(&db)
        .get(project_id, &root, &discussion_id)
        .await
}

/// Rename a discussion (frontmatter `title:`). The `id` / folder stay the same
/// so references keep working.
#[tauri::command]
#[specta::specta]
pub async fn discussion_rename(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    title: String,
) -> Result<Option<DiscussionDetail>, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("Enter a title.".to_string());
    }
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    // 제목만 고쳐도 파일은 통째로 다시 쓰인다 — `set_status` 와 같은 이유로
    // 읽기 앞에서 문지기를 잡는다.
    let _guard = doc_guard(&path, &discussion_id)?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = set_title(&md, t, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    DiscussionCache::new(&db)
        .get(project_id, &root, &discussion_id)
        .await
}

/// Delete a discussion: remove its folder (incl. attachments) and refresh the
/// cache (a full reproject from disk is the only cache writer).
#[tauri::command]
#[specta::specta]
pub async fn discussion_delete(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
) -> Result<(), String> {
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    let folder = path
        .parent()
        .ok_or_else(|| "discussion path has no parent folder".to_string())?;
    std::fs::remove_dir_all(folder).map_err(|e| e.to_string())?;
    DiscussionCache::new(&db).list(project_id, &root).await?;
    Ok(())
}

// ─── attachments (PR-DISC 2) ──────────────────────────────────────────────────

/// An attachment's bytes for inline rendering — base64 + MIME, assembled into a
/// `data:` URI by the frontend (mirrors `DocsAsset`).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionAsset {
    pub mime: String,
    pub base64: String,
}

/// 16MB cap — base64 inflates ~33% and crosses the webview boundary whole.
const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;

/// The discussion folder (`<slug>/`) that holds `discussion.md` + `attachments/`.
fn discussion_folder(root: &Path, discussion_id: &str) -> Result<PathBuf, String> {
    let md = find_discussion_path(root, discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    md.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "discussion path has no parent folder".to_string())
}

/// Normalize + confine `rel_path` inside the discussion folder. Rejects `..`
/// escapes (mirrors `secure_docs_join`).
fn secure_attachment_join(folder: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let clean = crate::indexer::clean_path(&folder.join(rel_path));
    let attachments = crate::indexer::clean_path(&folder.join("attachments"));
    if clean.starts_with(&attachments) {
        Ok(clean)
    } else {
        Err("Access denied: path is outside the attachments folder".to_string())
    }
}

fn mime_for(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Copy `src` into `<folder>/attachments/`, using only its file name (no path
/// traversal) and de-duplicating clashes (`name-2.ext`). Returns the new
/// `attachments/<file>` relative path.
fn copy_into_attachments(folder: &Path, src: &Path) -> Result<String, String> {
    if !src.is_file() {
        return Err("Could not find the file to attach.".to_string());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .ok_or_else(|| "Invalid file name.".to_string())?
        .to_string();

    let attachments = folder.join("attachments");
    std::fs::create_dir_all(&attachments).map_err(|e| e.to_string())?;

    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut final_name = name.clone();
    let mut n = 2;
    while attachments.join(&final_name).exists() {
        final_name = format!("{stem}-{n}{ext}");
        n += 1;
    }
    std::fs::copy(src, attachments.join(&final_name))
        .map_err(|e| format!("Could not copy the attachment: {e}"))?;
    Ok(format!("attachments/{final_name}"))
}

/// Open a native file picker and attach the chosen file. Returns the new
/// `attachments/<file>` path, or `None` if the user cancelled.
#[tauri::command]
#[specta::specta]
pub async fn discussion_attach_via_dialog(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let root = discussion_root_of(&db, project_id).await?;
    let folder = discussion_folder(&root, &discussion_id)?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog().file().pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(src) = picked.and_then(|p| match p {
        FilePath::Path(p) => Some(p),
        _ => None,
    }) else {
        return Ok(None);
    };
    copy_into_attachments(&folder, &src).map(Some)
}

/// Read an attachment as base64 + MIME for inline rendering. `rel_path` is the
/// `attachments/<file>` path from `discussion_get`.
#[tauri::command]
#[specta::specta]
pub async fn discussion_asset(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    rel_path: String,
) -> Result<DiscussionAsset, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let folder = discussion_folder(&root, &discussion_id)?;
    let full = secure_attachment_join(&folder, &rel_path)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Could not read the attachment: {e}"))?;
    if meta.len() > MAX_ASSET_BYTES {
        return Err("Attachment is too large (over 16MB)".to_string());
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Could not read the attachment: {e}"))?;
    let mime = mime_for(&full);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(DiscussionAsset {
        mime,
        base64: encoded,
    })
}

/// Remove one attachment file. `rel_path` is `attachments/<file>`.
#[tauri::command]
#[specta::specta]
pub async fn discussion_detach(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    rel_path: String,
) -> Result<(), String> {
    let root = discussion_root_of(&db, project_id).await?;
    let folder = discussion_folder(&root, &discussion_id)?;
    let full = secure_attachment_join(&folder, &rel_path)?;
    if full.is_file() {
        std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── promote to plan (PR-DISC 4) ──────────────────────────────────────────────

fn free_plan_path(planner_root: &Path, base: &str) -> (String, PathBuf) {
    let mut id = base.to_string();
    let mut n = 2;
    loop {
        let path = planner_root.join(format!("{id}.md"));
        if !path.exists() {
            return (id, path);
        }
        id = format!("{base}-{n}");
        n += 1;
    }
}

/// Promote a resolved discussion into a Planner plan: create a new
/// `.oculpm/planner/<id>.md` whose items are the discussion's `## 다음 단계`,
/// then mark the discussion `resolved` with a `resolution_ref` back-link. The
/// new plan_id is returned (the frontend navigates to it). LLM-free.
#[tauri::command]
#[specta::specta]
pub async fn discussion_promote_to_plan(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    discussion_id: String,
) -> Result<String, String> {
    let droot = discussion_root_of(&db, project_id).await?;
    let disc_path = find_discussion_path(&droot, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    let disc_md = std::fs::read_to_string(&disc_path).map_err(|e| e.to_string())?;
    let parsed = parse_discussion(&disc_md, &discussion_id);
    if parsed.frontmatter.resolution_plan_id.is_some() {
        return Err("This discussion was already promoted to the planner.".to_string());
    }
    if parsed.next_steps.is_empty() {
        return Err("No `## 다음 단계` items - write the next steps first.".to_string());
    }

    // Serialize against other plan writers (in-app + background reconcile).
    let plan_lock = manager.plan_write_lock(project_id).await;
    let _guard = plan_lock.lock().await;

    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let proot = planner_dir(Path::new(&project.root_path));
    std::fs::create_dir_all(&proot).map_err(|e| e.to_string())?;

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    // Base the plan id on the discussion id (already a kebab slug) for a
    // meaningful, traceable link; de-dup against existing plans.
    let (plan_id, plan_path) = free_plan_path(&proot, &discussion_id);
    let title = if parsed.frontmatter.title.trim().is_empty() {
        discussion_id.clone()
    } else {
        parsed.frontmatter.title.clone()
    };

    let mut plan_md = create_plan_skeleton(&plan_id, &title, "user", &date);
    for step in &parsed.next_steps {
        let status = if step.done {
            ItemStatus::Done
        } else {
            ItemStatus::Todo
        };
        plan_md = add_item(&plan_md, "다음 단계", &step.title, &step.step_id, status)?;
    }
    write_atomic(&plan_path, plan_md.as_bytes()).map_err(|e| e.to_string())?;

    // Link + resolve the discussion.
    //
    // 논의 파일을 고치는 구간만 문지기를 잡고 그 **안에서 다시 읽는다** — 맨 위의
    // `disc_md` 는 플랜을 만드는 동안 낡았을 수 있고, 그것으로 덮으면 그 사이
    // 들어온 본문 변경이 사라진다.
    let decided_at = chrono::Utc::now().to_rfc3339();
    let _disc_guard = doc_guard(&disc_path, &discussion_id)?;
    let fresh_disc = std::fs::read_to_string(&disc_path).map_err(|e| e.to_string())?;
    let new_disc = set_resolution(&fresh_disc, &plan_id, &decided_at, &date);
    write_atomic(&disc_path, new_disc.as_bytes()).map_err(|e| e.to_string())?;

    Ok(plan_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

/// 논의 문서의 **조용한 덮어쓰기 회귀** (2026-09-08).
///
/// 무는 것은 셋 — `plan_parallel_write.rs` 가 플래너에 대해 무는 것과 같은
/// 목록이다:
///
/// 1. 낡은 `base_hash` 로 오면 **거절하고 아무것도 안 쓴다**
/// 2. 방금 읽은 해시로는 **통과한다** (CAS 가 실제로 가능한가)
/// 3. 문지기를 남이 쥐고 있으면 **조용히 성공하지 않는다**
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager as _;

    const ID: &str = "lost-update";

    /// MockRuntime 앱 + 임시 DB + 논의 문서 하나. 반환은 (앱, 프로젝트 id, tmpdir).
    async fn fixture() -> (
        tauri::App<tauri::test::MockRuntime>,
        u32,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let db = Db::open(dir.path().join("test.db")).await.unwrap();
        let pid = db
            .create_project("t".to_string(), dir.path().to_string_lossy().into_owned())
            .await
            .unwrap();
        app.manage(db);
        app.manage(OculpmManager::new());

        let doc_dir = dir.path().join(".oculpm/discussion").join(ID);
        std::fs::create_dir_all(&doc_dir).unwrap();
        std::fs::write(
            doc_dir.join("discussion.md"),
            create_discussion_skeleton(ID, "손실", "user", "2026-09-08"),
        )
        .unwrap();
        (app, pid, dir)
    }

    fn doc_path(dir: &tempfile::TempDir) -> PathBuf {
        dir.path()
            .join(".oculpm/discussion")
            .join(ID)
            .join("discussion.md")
    }

    /// 편집기가 읽는 자리에서 해시를 얻는다 — 테스트가 따로 해싱하면 발급과
    /// 대조가 어긋나는 회귀를 못 본다.
    async fn read_raw(app: &tauri::App<tauri::test::MockRuntime>, pid: u32) -> DiscussionRaw {
        discussion_read_raw(app.state(), pid, ID.to_string())
            .await
            .unwrap()
    }

    async fn write(
        app: &tauri::App<tauri::test::MockRuntime>,
        pid: u32,
        body: &str,
        hash: &str,
    ) -> Result<Option<DiscussionDetail>, String> {
        discussion_write(
            app.state(),
            pid,
            ID.to_string(),
            body.to_string(),
            hash.to_string(),
        )
        .await
    }

    /// **읽은 뒤 남이 고쳤으면 저장은 거절된다** — 이것이 사고의 자리다.
    ///
    /// 재현은 실제 경로 그대로다: 편집기가 본문 스냅숏을 뜨고(그 사이 화면은
    /// 디스크 변경을 일부러 무시한다), 에이전트가 결론을 적고, 사용자가 저장을
    /// 누른다. 고치기 전에는 여기서 에이전트의 문단이 오류도 흔적도 없이
    /// 사라지고 화면에는 "저장했어요" 가 떴다.
    #[tokio::test]
    async fn a_stale_draft_cannot_silently_erase_what_an_agent_wrote() {
        let (app, pid, dir) = fixture().await;

        // ① 사용자가 편집기를 연다.
        let opened = read_raw(&app, pid).await;

        // ② 그 사이 에이전트가 같은 파일에 결론을 적는다 (외부 프로세스).
        let on_disk = std::fs::read_to_string(doc_path(&dir)).unwrap();
        let agents_work = on_disk.replace("## 결론\n", "## 결론\n\n에이전트가 적은 결론.\n");
        assert_ne!(agents_work, on_disk, "픽스처가 결론 절을 안 가졌다");
        std::fs::write(doc_path(&dir), &agents_work).unwrap();

        // ③ 사용자가 저장을 누른다 — 낡은 스냅숏으로.
        let err = write(&app, pid, "## 문제 정의\n내가 쓰던 것\n", &opened.hash)
            .await
            .expect_err("낡은 해시가 통과했다 — 조용한 덮어쓰기가 돌아왔다");
        assert!(
            err.starts_with(WRITE_CONFLICT_PREFIX),
            "충돌 표지가 없다: {err}"
        );

        // 아무것도 안 썼다 — 에이전트의 문단이 **그대로** 있다.
        assert_eq!(
            std::fs::read_to_string(doc_path(&dir)).unwrap(),
            agents_work,
            "거부된 저장이 파일을 건드렸다"
        );
    }

    /// **방금 읽은 해시로는 통과한다.** 이게 안 되면 위 테스트는 "아무도 저장
    /// 못 한다" 를 무는 것이라 아무 값어치가 없다.
    #[tokio::test]
    async fn the_hash_read_raw_hands_out_is_the_one_write_accepts() {
        let (app, pid, dir) = fixture().await;

        let opened = read_raw(&app, pid).await;
        write(&app, pid, "## 문제 정의\n첫 저장\n", &opened.hash)
            .await
            .expect("방금 읽은 해시가 거부됐다");
        assert!(std::fs::read_to_string(doc_path(&dir))
            .unwrap()
            .contains("첫 저장"));

        // 쓰고 나면 해시가 바뀐다 — 옛것으로 또 쓰려 하면 막힌다.
        let after = read_raw(&app, pid).await;
        assert_ne!(after.hash, opened.hash);
        write(&app, pid, "## 문제 정의\n둘째 저장\n", &opened.hash)
            .await
            .expect_err("한 번 쓴 해시가 재사용됐다");
        write(&app, pid, "## 문제 정의\n둘째 저장\n", &after.hash)
            .await
            .expect("새 해시가 거부됐다");

        // 프런트매터는 보존된다 — CAS 를 붙이면서 write_body 계약이 깨지지 않았다.
        let md = std::fs::read_to_string(doc_path(&dir)).unwrap();
        assert!(md.contains("id: lost-update"), "{md}");
        assert!(md.contains("둘째 저장"), "{md}");
    }

    /// **남이 임계구역에 있으면 쓰지 않는다** — 조용한 성공도, 정체불명 오류도
    /// 아니어야 한다. 인프로세스 뮤텍스로는 못 막는 조합(앱 ↔ MCP 서버 ↔ CLI)이
    /// 실제 사고 현장이라, 크로스프로세스 신물인 락 파일을 존중하는지로 본다.
    #[tokio::test]
    async fn a_lock_held_by_someone_else_blocks_the_write_loudly() {
        let (app, pid, dir) = fixture().await;
        let opened = read_raw(&app, pid).await;
        let before = std::fs::read_to_string(doc_path(&dir)).unwrap();

        let lock = doc_path(&dir).with_file_name(".discussion.md.lock");
        std::fs::write(&lock, br#"{"pid":999999,"at":"2099-01-01T00:00:00Z"}"#).unwrap();

        let err = write(&app, pid, "## 문제 정의\n무시하고 씀\n", &opened.hash)
            .await
            .expect_err("락을 무시하고 썼다");
        assert!(err.starts_with(WRITE_CONFLICT_PREFIX), "{err}");
        assert_eq!(
            std::fs::read_to_string(doc_path(&dir)).unwrap(),
            before,
            "못 잡은 락으로 파일을 건드렸다"
        );

        // 그 프로세스가 나가면 통과하고, 문지기는 자기 뒤를 치운다.
        std::fs::remove_file(&lock).unwrap();
        write(&app, pid, "## 문제 정의\n이제 씀\n", &opened.hash)
            .await
            .expect("락이 풀렸는데도 거부됐다");
        assert!(!lock.exists(), "락 파일이 남았다");
    }
}
