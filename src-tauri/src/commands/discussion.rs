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
use crate::oculpm::atomic_io::write_atomic;
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

/// Read the raw (un-redacted) body markdown (everything after the frontmatter)
/// for the in-app editor. Unlike `discussion_get` (redacted projection for
/// display), this returns exactly what's on disk so a save round-trip is
/// lossless — the user is editing their own file. `discussion_write` saves it.
#[tauri::command]
#[specta::specta]
pub async fn discussion_read_raw(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
) -> Result<String, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (_fm, body) = parse_frontmatter_and_body(&md);
    Ok(body.trim_start_matches('\n').to_string())
}

// ─── write side (PR-DISC 1) ───────────────────────────────────────────────────
//
// App writes go through these (atomic temp+rename); external agents edit the
// `.md` directly per AGENTS.md (PR-DISC 5). Both are absorbed by the watcher /
// reproject-on-read. Single-user tool, so concurrent in-process edits are
// last-write-wins (no separate lock yet — mirrors planner PR-PLN 1).

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
) -> Result<Option<DiscussionDetail>, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let path = find_discussion_path(&root, &discussion_id)
        .ok_or_else(|| format!("discussion '{discussion_id}' not found"))?;
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if is_body_locked(&md, &discussion_id) {
        return Err(LOCKED_MSG.to_string());
    }
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = write_body(&md, &body_md, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;
    DiscussionCache::new(&db)
        .get(project_id, &root, &discussion_id)
        .await
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
    let md = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let new_md = set_status(&md, &status, &date);
    write_atomic(&path, new_md.as_bytes()).map_err(|e| e.to_string())?;

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

/// Copy an external file (known absolute path, e.g. a drag-drop) into the
/// discussion's `attachments/` sidecar. Returns the new `attachments/<file>`.
#[tauri::command]
#[specta::specta]
pub async fn discussion_attach(
    db: State<'_, Db>,
    project_id: u32,
    discussion_id: String,
    source_path: String,
) -> Result<String, String> {
    let root = discussion_root_of(&db, project_id).await?;
    let folder = discussion_folder(&root, &discussion_id)?;
    copy_into_attachments(&folder, &PathBuf::from(&source_path))
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
    let decided_at = chrono::Utc::now().to_rfc3339();
    let new_disc = set_resolution(&disc_md, &plan_id, &decided_at, &date);
    write_atomic(&disc_path, new_disc.as_bytes()).map_err(|e| e.to_string())?;

    Ok(plan_id)
}
