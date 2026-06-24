//! C2 — shareable journal export (.md bundle).
//!
//! Flattens the journal entries of a workday range into a single self-contained
//! Markdown file the user can hand to a teammate/manager — the most organic
//! word-of-mouth channel for a local-first tool, which had no export path at
//! all. **Strictly read-only + offline.** Bodies come from the SQLite cache,
//! which is already secret-masked on projection (R1), so the digest inherits
//! that safety by construction. The native save dialog + file write live here
//! in the backend (mirrors `select_project_folder`), so the frontend just calls
//! one command and shows a toast.

use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::db::Db;
use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::cache::{JournalCache, RangeEntry};

/// Korean label for a frontmatter entry type (shareable doc reads nicer than
/// `feature`/`bug`). Unknown types pass through verbatim.
fn type_label(t: &str) -> &str {
    match t {
        "feature" => "기능",
        "bug" => "버그",
        "error" => "에러",
        "refactor" => "리팩토링",
        "chore" => "잡일",
        other => other,
    }
}

/// "20260624" → "2026-06-24" (display). Non-8-char input passes through.
fn fmt_workday(w: &str) -> String {
    if w.len() == 8 {
        format!("{}-{}-{}", &w[0..4], &w[4..6], &w[6..8])
    } else {
        w.to_string()
    }
}

/// Render the digest Markdown for a workday range. Pure-ish (reads the cache).
async fn render_digest(
    db: &Db,
    project_id: u32,
    since: &str,
    until: &str,
) -> Result<String, String> {
    let project = db.get_project(project_id).await.map_err(|e| e.to_string())?;
    let cache = JournalCache::new(db);
    let entries: Vec<RangeEntry> = cache
        .range_entries(project_id, since, until)
        .await
        .map_err(|e| e.to_string())?;

    if entries.is_empty() {
        return Err("이 기간에 내보낼 일지가 없습니다.".to_string());
    }

    let mut out = String::new();
    out.push_str(&format!(
        "# {} — 작업 일지\n\n",
        project.name
    ));
    out.push_str(&format!(
        "> 기간 {} ~ {} · 총 {}개 · Ocul-PM 내보냄\n",
        fmt_workday(since),
        fmt_workday(until),
        entries.len()
    ));

    let mut last_workday = String::new();
    for e in &entries {
        if e.workday != last_workday {
            out.push_str(&format!("\n## {}\n", fmt_workday(&e.workday)));
            last_workday = e.workday.clone();
        }
        out.push_str(&format!("\n### [{}] {}\n\n", type_label(&e.entry_type), e.title));
        let files = if e.files.is_empty() {
            "—".to_string()
        } else {
            e.files.iter().map(|f| format!("`{f}`")).collect::<Vec<_>>().join(", ")
        };
        out.push_str(&format!(
            "- 상태: {} · 에이전트: {} · 파일: {}\n\n",
            e.status, e.agent_id, files
        ));
        // Body from the (already secret-masked) cache row.
        if let Ok(Some(full)) = cache.get_entry(project_id, &e.relative_path).await {
            let body = full.body_markdown.trim();
            if !body.is_empty() {
                out.push_str(body);
                out.push('\n');
            }
        }
        out.push_str("\n---\n");
    }

    Ok(out)
}

/// Render the range digest, open a native save dialog (default `.md` name), and
/// write the file. Returns the saved path, or `None` if the user cancelled.
/// `since`/`until` are inclusive "YYYYMMDD" workdays.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_export_digest(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    project_id: u32,
    since: String,
    until: String,
) -> Result<Option<String>, String> {
    // Render first so a 0-entry range errors before we pop a dialog.
    let md = render_digest(&db, project_id, &since, &until).await?;

    let default_name = format!("oculpm-journal-{since}-{until}.md");
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(FilePath::Path(path)) = picked else {
        return Ok(None); // cancelled (or a non-path target)
    };

    write_atomic(&path, md.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_str().map(String::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_label_maps_known_and_passes_unknown() {
        assert_eq!(type_label("feature"), "기능");
        assert_eq!(type_label("refactor"), "리팩토링");
        assert_eq!(type_label("weird"), "weird");
    }

    #[test]
    fn fmt_workday_formats_8char_and_passes_other() {
        assert_eq!(fmt_workday("20260624"), "2026-06-24");
        assert_eq!(fmt_workday("all"), "all");
    }
}
