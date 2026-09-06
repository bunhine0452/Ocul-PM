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
use crate::oculpm::index::branch::{BranchLink, BranchStory};

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

    save_markdown(&app, &format!("oculpm-journal-{since}-{until}.md"), &md).await
}

/// 네이티브 저장 대화상자 + 원자적 쓰기. 취소하면 `None`.
///
/// 브랜치 이야기 내보내기({#branch-digest})가 같은 자리를 쓴다 — 대화상자
/// 처리를 두 벌 만들지 않는다. 여기서 나가는 것은 사용자가 고른 로컬 파일
/// 하나뿐이고, 네트워크는 어느 쪽에도 없다.
pub(crate) async fn save_markdown(
    app: &tauri::AppHandle,
    default_name: &str,
    md: &str,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_file_name(default_name)
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

/// {#branch-digest} — 브랜치 이야기 한 장. 순수 함수라 테스트로 못 박는다.
///
/// 일지 다이제스트와 달리 **본문을 싣지 않는다**. 이 문서가 답하는 질문은
/// "이 브랜치가 무엇을 했나"이지 "그날 무슨 일이 있었나"가 아니다 — 제목·근거·
/// 커밋·기록률이면 충분하고, 자세한 이야기는 일지 다이제스트가 이미 한다.
pub(crate) fn render_branch_digest(story: &BranchStory, project_name: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {} — {}\n\n", project_name, story.branch));
    let base = story.base.as_deref().unwrap_or("—");
    out.push_str(&format!(
        "> 기준 {} · 커밋 {}개 · 일지 {}개 · 바뀐 파일 {}개 (기록 {}개) · Ocul-PM 내보냄\n",
        base,
        story.commits.len(),
        story.entries.len(),
        story.files.len(),
        story.recorded_files,
    ));
    if story.truncated {
        out.push_str("> 커밋 상한에 걸렸다 — 아래는 최근 것만이다.\n");
    }

    if !story.entries.is_empty() {
        out.push_str("\n## 기록\n\n");
        for e in &story.entries {
            let why = match e.link {
                BranchLink::Entry => "일지 파일이 이 브랜치에 있음",
                BranchLink::Files => "바꾼 파일이 겹침",
            };
            out.push_str(&format!(
                "- [{}] {} — {} · {} · {} ({})\n",
                type_label(&e.entry_type),
                e.title,
                e.status,
                e.agent_id,
                fmt_workday(&e.workday),
                why,
            ));
        }
    }

    if !story.plan_items.is_empty() {
        out.push_str("\n## 플랜\n\n");
        for p in &story.plan_items {
            out.push_str(&format!(
                "- {} · {} — {}\n",
                p.plan_title, p.item_title, p.status
            ));
        }
    }

    if !story.commits.is_empty() {
        out.push_str("\n## 커밋\n\n");
        for c in &story.commits {
            out.push_str(&format!(
                "- `{}` {} — {} · {}\n",
                c.short_sha,
                c.subject,
                c.author_name,
                fmt_workday(&c.workday)
            ));
        }
    }

    let unrecorded: Vec<&str> = story
        .files
        .iter()
        .filter(|f| !f.recorded)
        .map(|f| f.path.as_str())
        .collect();
    if !unrecorded.is_empty() {
        out.push_str("\n## 기록되지 않은 변경\n\n");
        for p in &unrecorded {
            out.push_str(&format!("- `{p}`\n"));
        }
    }
    out
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

    use crate::oculpm::index::branch::{BranchCommit, BranchEntry, BranchFile};

    fn story() -> BranchStory {
        BranchStory {
            branch: "feat/x".to_string(),
            base: Some("main".to_string()),
            merge_base: Some("abc".to_string()),
            is_current: true,
            since_workday: "20260905".to_string(),
            until_workday: "20260907".to_string(),
            commits: vec![BranchCommit {
                sha: "abcdef1234".to_string(),
                short_sha: "abcdef1".to_string(),
                subject: "feat: 무언가".to_string(),
                author_name: "Kim".to_string(),
                timestamp: 1,
                workday: "20260906".to_string(),
                file_count: 2,
                journal_count: 1,
            }],
            entries: vec![BranchEntry {
                relative_path: "20260906/Features/x.md".to_string(),
                workday: "20260906".to_string(),
                entry_type: "feature".to_string(),
                status: "done".to_string(),
                agent_id: "claude-code".to_string(),
                title: "브랜치 축".to_string(),
                link: BranchLink::Entry,
                matched_files: 1,
            }],
            plan_items: Vec::new(),
            files: vec![
                BranchFile {
                    path: "src/a.rs".to_string(),
                    commits: 1,
                    uncommitted: false,
                    recorded: true,
                },
                BranchFile {
                    path: "src/b.rs".to_string(),
                    commits: 1,
                    uncommitted: false,
                    recorded: false,
                },
            ],
            recorded_files: 1,
            uncommitted_files: 0,
            journal_files: 1,
            truncated: false,
        }
    }

    #[test]
    fn branch_digest_names_the_branch_and_the_unrecorded_files() {
        let md = render_branch_digest(&story(), "ocul-pm");
        assert!(md.starts_with("# ocul-pm — feat/x"));
        assert!(md.contains("기준 main · 커밋 1개 · 일지 1개"));
        assert!(md.contains("[기능] 브랜치 축"));
        assert!(md.contains("일지 파일이 이 브랜치에 있음"));
        assert!(md.contains("## 기록되지 않은 변경"));
        assert!(md.contains("`src/b.rs`"));
        // 기록된 파일은 그 절에 들어가지 않는다.
        let tail = md.split("## 기록되지 않은 변경").nth(1).unwrap();
        assert!(!tail.contains("src/a.rs"));
    }

    #[test]
    fn branch_digest_skips_empty_sections() {
        let mut s = story();
        s.entries.clear();
        s.commits.clear();
        s.files.clear();
        let md = render_branch_digest(&s, "ocul-pm");
        assert!(!md.contains("## 기록"));
        assert!(!md.contains("## 커밋"));
    }
}
