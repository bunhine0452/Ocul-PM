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
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let cache = JournalCache::new(db);
    let entries: Vec<RangeEntry> = cache
        .range_entries(project_id, since, until)
        .await
        .map_err(|e| e.to_string())?;

    if entries.is_empty() {
        return Err("No journal entries to export in this period.".to_string());
    }

    let mut out = String::new();
    out.push_str(&format!("# {} — 작업 일지\n\n", project.name));
    out.push_str(&format!(
        "> 기간 {} ~ {} · 총 {}개 · Ocul 내보냄\n",
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
        out.push_str(&format!(
            "\n### [{}] {}\n\n",
            type_label(&e.entry_type),
            e.title
        ));
        let files = if e.files.is_empty() {
            "—".to_string()
        } else {
            e.files
                .iter()
                .map(|f| format!("`{f}`"))
                .collect::<Vec<_>>()
                .join(", ")
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

    save_text(
        &app,
        &format!("oculpm-journal-{since}-{until}.md"),
        ("Markdown", "md"),
        &md,
    )
    .await
}

/// 영수증 HTML 의 상한 — 영수증은 몇 KB 다. 이보다 크면 영수증이 아니다.
const RECEIPT_HTML_MAX: usize = 2 * 1024 * 1024;

/// 바깥에 닿거나 스스로 도는 것 — 영수증 HTML 에 있으면 안 된다. 본문 글자는 프런트가 이스케이프하므로
/// (`<` → `&lt;`) 여기 걸리는 것은 문서 뼈대가 실은 태그뿐이다.
const RECEIPT_DENY_TAGS: &[&str] = &[
    "<script",
    "<iframe",
    "<object",
    "<embed",
    "<link",
    "<img",
    "<base",
    "<form",
    "<svg",
    "<video",
    "<audio",
    "<source",
    "http-equiv=\"refresh\"",
];

/// 영수증 HTML 이 자체완결인가 (11-23) — 스크립트 · 바깥 자원 없이 인라인 CSS 하나. 프런트(`receiptHtml.ts`)가
/// 만들지만, 기기 밖으로 나갈 파일이라 쓰기 전에 한 번 더 본다.
fn check_receipt_html(html: &str) -> Result<(), String> {
    if html.len() > RECEIPT_HTML_MAX {
        return Err("receipt html too large".into());
    }
    let lower = html.to_ascii_lowercase();
    if !lower.starts_with("<!doctype html>") {
        return Err("receipt html must be a full document".into());
    }
    if let Some(tag) = RECEIPT_DENY_TAGS.iter().find(|t| lower.contains(*t)) {
        return Err(format!("receipt html must be self-contained ({tag})"));
    }
    // 스타일 안의 바깥 자원 — 본문 글자에는 `url(` 이 있을 수 있어 <style> 안만 본다.
    let style = lower
        .split_once("<style>")
        .and_then(|(_, rest)| rest.split_once("</style>"))
        .map(|(css, _)| css)
        .unwrap_or("");
    if style.contains("url(") || style.contains("@import") {
        return Err("receipt html must be self-contained (css)".into());
    }
    Ok(())
}

/// 대화상자가 처음 보일 이름 — 경로 구분자 · 제어 글자를 걷고 길이를 줄인다. 확장자는 우리가 붙인다.
fn safe_file_name(raw: &str, ext: &str) -> String {
    let stem: String = raw
        .trim_end_matches(&format!(".{ext}"))
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    let stem = stem.trim().trim_matches('.');
    let stem = if stem.is_empty() {
        "ocul-receipt"
    } else {
        stem
    };
    format!("{stem}.{ext}")
}

/// 영수증 한 장을 HTML 파일로 저장한다 (11-23 love-round #reviewer-mode-share-link). 저장 대화상자에서
/// 사용자가 고른 로컬 파일 하나에 쓴다 — 네트워크는 없고, 문서는 스크립트 · 바깥 자원이 없는 자체완결이다.
/// 취소하면 `None`.
#[tauri::command]
#[specta::specta]
pub async fn save_receipt_html(
    app: tauri::AppHandle,
    default_name: String,
    html: String,
) -> Result<Option<String>, String> {
    check_receipt_html(&html)?;
    save_text(
        &app,
        &safe_file_name(&default_name, "html"),
        ("HTML", "html"),
        &html,
    )
    .await
}

/// 네이티브 저장 대화상자 + 원자적 쓰기. 취소하면 `None`.
///
/// 여기서 나가는 것은 사용자가 고른 로컬 파일 하나뿐이고, 네트워크는 없다.
async fn save_text(
    app: &tauri::AppHandle,
    default_name: &str,
    (filter, ext): (&str, &str),
    body: &str,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter, &[ext])
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(FilePath::Path(path)) = picked else {
        return Ok(None); // cancelled (or a non-path target)
    };

    write_atomic(&path, body.as_bytes()).map_err(|e| e.to_string())?;
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

    const DOC: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{color:#111}</style></head><body><p>refresh url( &lt;script&gt;</p></body></html>";

    /// 11-23 — 영수증 HTML 은 스크립트 · 바깥 자원 없는 자체완결만 쓴다. 본문 글자(이스케이프된 것)는 막지 않는다.
    #[test]
    fn receipt_html_must_be_self_contained() {
        assert!(check_receipt_html(DOC).is_ok());
        for bad in [
            DOC.replace("<p>", "<script>x</script><p>"),
            DOC.replace("<p>", "<img src=\"https://x\"><p>"),
            DOC.replace("<p>", "<link rel=\"stylesheet\" href=\"https://x\"><p>"),
            DOC.replace("color:#111", "background:url(https://x)"),
            DOC.replace("color:#111", "@import 'https://x'"),
            DOC.replace(
                "<meta charset=\"utf-8\">",
                "<meta http-equiv=\"refresh\" content=\"0;url=https://x\">",
            ),
            DOC.replace("<!doctype html>", ""),
            format!("{DOC}{}", " ".repeat(RECEIPT_HTML_MAX)),
        ] {
            assert!(
                check_receipt_html(&bad).is_err(),
                "{}",
                &bad[..bad.len().min(120)]
            );
        }
    }

    #[test]
    fn receipt_file_name_is_one_plain_name() {
        assert_eq!(
            safe_file_name("ocul-receipt-feat/x", "html"),
            "ocul-receipt-feat-x.html"
        );
        assert_eq!(
            safe_file_name("../../etc/passwd", "html"),
            "-..-etc-passwd.html"
        );
        assert_eq!(safe_file_name("a.html", "html"), "a.html");
        assert_eq!(safe_file_name("  ", "html"), "ocul-receipt.html");
        assert_eq!(
            safe_file_name(&"가".repeat(200), "html").chars().count(),
            85
        );
    }
}
