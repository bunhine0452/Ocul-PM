//! Projection: Discussion markdown SSOT → `oculpm_discussion*` SQLite cache +
//! command DTOs.
//!
//! Mirrors `oculpm::planner::project` — the markdown file is the source of
//! truth, this rebuilds the SQLite rows from it. `reproject_all` is the only
//! writer; the read commands reproject-then-read so they're always fresh even
//! before the watcher live-push lands (PR-DISC 3).

use std::path::{Path, PathBuf};

use regex::Regex;
use rusqlite::params;
use serde::Serialize;

use crate::db::Db;
use crate::oculpm::discussion::parse::{parse_discussion, ParsedDiscussion};
use crate::oculpm::redact::{compile_redact_patterns, redact_text};
use crate::oculpm::spec::OculpmConfig;

/// `<project_root>/.oculpm/discussion`.
pub fn discussion_root(project_root: &Path) -> PathBuf {
    project_root.join(".oculpm").join("discussion")
}

/// Locate the discussion folder whose `discussion.md` frontmatter `id` equals
/// `discussion_id` (the folder name may differ from the id). `None` if no match.
pub fn find_discussion_path(discussion_root: &Path, discussion_id: &str) -> Option<PathBuf> {
    for base in [
        discussion_root.to_path_buf(),
        discussion_root.join("_archive"),
    ] {
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let folder = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Skip `_archive` / hidden when scanning the top level.
            if base == discussion_root && (folder.starts_with('_') || folder.starts_with('.')) {
                continue;
            }
            let md = dir.join("discussion.md");
            let Ok(text) = std::fs::read_to_string(&md) else {
                continue;
            };
            if parse_discussion(&text, folder).frontmatter.id == discussion_id {
                return Some(md);
            }
        }
    }
    None
}

/// 제목 → 논의 폴더 이름. 한글도 살아남는다 — 구현과 근거는
/// [`crate::oculpm::frontmatter::slug_from_title`] 한 곳에 있다 (플랜 쪽과
/// 갈라져 있다가 한글 제목이 전부 `discussion` 으로 떨어지는 버그를 낳았다).
pub fn slug_for(title: &str) -> String {
    crate::oculpm::frontmatter::slug_from_title(title, "discussion")
}

// ─────────────────────────────────────────────────────────────────────────────
// Command DTOs (specta + serde)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionSummary {
    pub discussion_id: String,
    pub title: String,
    pub status: String,
    pub owner: String,
    /// First line of the problem statement, truncated — for the list preview.
    pub problem_preview: String,
    pub option_count: u32,
    pub next_step_count: u32,
    pub resolution_plan_id: Option<String>,
    pub file_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionOptionDto {
    pub option_id: String,
    pub title: String,
    pub body: String,
    pub order_idx: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionLogDto {
    pub ts: String,
    pub author: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionNextStepDto {
    pub step_id: String,
    pub title: String,
    pub done: bool,
    pub order_idx: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionAttachmentDto {
    pub rel_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DiscussionDetail {
    pub discussion: DiscussionSummary,
    pub problem: String,
    pub background: String,
    pub options: Vec<DiscussionOptionDto>,
    pub log: Vec<DiscussionLogDto>,
    pub conclusion: String,
    pub next_steps: Vec<DiscussionNextStepDto>,
    pub attachments: Vec<DiscussionAttachmentDto>,
    pub resolution_plan_id: Option<String>,
    pub resolution_decided_at: Option<String>,
    pub tags: Vec<String>,
    /// Non-fatal parse warnings — surfaced so the UI never fails silently.
    pub warnings: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AttachmentMeta {
    rel_path: String,
    kind: String,
}

struct LoadedDiscussion {
    discussion_id: String,
    file_path: String, // relative to project root, e.g. ".oculpm/discussion/x/discussion.md"
    created_at: String,
    updated_at: String,
    attachments: Vec<AttachmentMeta>,
    parsed: ParsedDiscussion,
}

fn attachment_kind(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" => "image",
        "pdf" | "md" | "markdown" | "txt" | "csv" | "json" | "log" | "doc" | "docx" => "doc",
        _ => "other",
    }
}

/// List `attachments/<file>` entries (files only, one level deep).
fn scan_attachments(attachments_dir: &Path) -> Vec<AttachmentMeta> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(attachments_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        out.push(AttachmentMeta {
            rel_path: format!("attachments/{name}"),
            kind: attachment_kind(name).to_string(),
        });
    }
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out
}

/// Parse every `<slug>/discussion.md` under `discussion_root` (and under
/// `_archive/`). Missing dir → empty.
fn load_all_discussions(discussion_root: &Path) -> Vec<LoadedDiscussion> {
    let mut out = Vec::new();
    // Secret masking on the projection (read) side — same as planner.
    let redact_patterns = discussion_root
        .parent()
        .map(|oculpm_dir| oculpm_dir.join("config.toml"))
        .and_then(|p| OculpmConfig::load(&p).ok())
        .map(|cfg| compile_redact_patterns(&cfg.git.auto_redact_patterns))
        .unwrap_or_default();

    collect_into(discussion_root, discussion_root, &redact_patterns, &mut out);
    collect_into(
        &discussion_root.join("_archive"),
        discussion_root,
        &redact_patterns,
        &mut out,
    );

    // Recent-first, deterministic tiebreak.
    out.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.discussion_id.cmp(&b.discussion_id))
    });
    out
}

fn collect_into(
    dir: &Path,
    discussion_root: &Path,
    redact: &[Regex],
    out: &mut Vec<LoadedDiscussion>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let folder_path = entry.path();
        if !folder_path.is_dir() {
            continue;
        }
        let folder = folder_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        // At the top level, `_archive` / hidden dirs aren't discussions.
        if dir == discussion_root && (folder.starts_with('_') || folder.starts_with('.')) {
            continue;
        }
        let md_path = folder_path.join("discussion.md");
        let text = match std::fs::read_to_string(&md_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let (text, _hits) = redact_text(&text, redact);
        let parsed = parse_discussion(&text, folder);

        let rel = md_path
            .strip_prefix(discussion_root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| format!("{folder}/discussion.md"));
        let file_path = format!(".oculpm/discussion/{rel}");

        let created_at = parsed
            .frontmatter
            .created
            .clone()
            .or_else(|| parsed.frontmatter.updated.clone())
            .unwrap_or_default();
        let updated_at = parsed
            .frontmatter
            .updated
            .clone()
            .or_else(|| parsed.frontmatter.created.clone())
            .unwrap_or_default();

        let attachments = scan_attachments(&folder_path.join("attachments"));

        out.push(LoadedDiscussion {
            discussion_id: parsed.frontmatter.id.clone(),
            file_path,
            created_at,
            updated_at,
            attachments,
            parsed,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO builders
// ─────────────────────────────────────────────────────────────────────────────

/// First line of `problem`, collapsed + truncated to ~140 chars (char-safe).
fn preview_of(problem: &str) -> String {
    let one_line: String = problem.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= 140 {
        one_line
    } else {
        let truncated: String = one_line.chars().take(140).collect();
        format!("{truncated}…")
    }
}

fn summary_dto(loaded: &LoadedDiscussion) -> DiscussionSummary {
    let p = &loaded.parsed;
    DiscussionSummary {
        discussion_id: loaded.discussion_id.clone(),
        title: p.frontmatter.title.clone(),
        status: p.frontmatter.status.as_str().to_string(),
        owner: p.frontmatter.owner.clone(),
        problem_preview: preview_of(&p.problem),
        option_count: p.options.len() as u32,
        next_step_count: p.next_steps.len() as u32,
        resolution_plan_id: p.frontmatter.resolution_plan_id.clone(),
        file_path: loaded.file_path.clone(),
        created_at: loaded.created_at.clone(),
        updated_at: loaded.updated_at.clone(),
    }
}

fn detail_dto(loaded: &LoadedDiscussion) -> DiscussionDetail {
    let p = &loaded.parsed;
    DiscussionDetail {
        discussion: summary_dto(loaded),
        problem: p.problem.clone(),
        background: p.background.clone(),
        options: p
            .options
            .iter()
            .map(|o| DiscussionOptionDto {
                option_id: o.option_id.clone(),
                title: o.title.clone(),
                body: o.body.clone(),
                order_idx: o.order_idx,
            })
            .collect(),
        log: p
            .log
            .iter()
            .map(|l| DiscussionLogDto {
                ts: l.ts.clone(),
                author: l.author.clone(),
                body: l.body.clone(),
            })
            .collect(),
        conclusion: p.conclusion.clone(),
        next_steps: p
            .next_steps
            .iter()
            .map(|s| DiscussionNextStepDto {
                step_id: s.step_id.clone(),
                title: s.title.clone(),
                done: s.done,
                order_idx: s.order_idx,
            })
            .collect(),
        attachments: loaded
            .attachments
            .iter()
            .map(|a| DiscussionAttachmentDto {
                rel_path: a.rel_path.clone(),
                kind: a.kind.clone(),
            })
            .collect(),
        resolution_plan_id: p.frontmatter.resolution_plan_id.clone(),
        resolution_decided_at: p.frontmatter.resolution_decided_at.clone(),
        tags: p.frontmatter.tags.clone(),
        warnings: p.warnings.clone(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owned row data for the SQLite write (moved into the connection closure)
// ─────────────────────────────────────────────────────────────────────────────

struct DiscussionRow {
    discussion_id: String,
    title: String,
    status: String,
    owner: String,
    problem: Option<String>,
    tags: Option<String>,
    option_count: i64,
    next_step_count: i64,
    resolution_plan_id: Option<String>,
    file_path: String,
    created_at: String,
    updated_at: String,
}
struct LogRow {
    discussion_id: String,
    ts: String,
    author: String,
    body: String,
}
struct AttachmentRow {
    discussion_id: String,
    rel_path: String,
    kind: String,
    added_at: String,
}
#[derive(Default)]
struct ProjectionRows {
    discussions: Vec<DiscussionRow>,
    logs: Vec<LogRow>,
    attachments: Vec<AttachmentRow>,
}

fn build_rows(loaded: &[LoadedDiscussion]) -> ProjectionRows {
    let mut rows = ProjectionRows::default();
    for ld in loaded {
        let p = &ld.parsed;
        let problem = if p.problem.trim().is_empty() {
            None
        } else {
            Some(p.problem.clone())
        };
        let tags = if p.frontmatter.tags.is_empty() {
            None
        } else {
            Some(p.frontmatter.tags.join(","))
        };
        rows.discussions.push(DiscussionRow {
            discussion_id: ld.discussion_id.clone(),
            title: p.frontmatter.title.clone(),
            status: p.frontmatter.status.as_str().to_string(),
            owner: p.frontmatter.owner.clone(),
            problem,
            tags,
            option_count: p.options.len() as i64,
            next_step_count: p.next_steps.len() as i64,
            resolution_plan_id: p.frontmatter.resolution_plan_id.clone(),
            file_path: ld.file_path.clone(),
            created_at: ld.created_at.clone(),
            updated_at: ld.updated_at.clone(),
        });
        for l in &p.log {
            rows.logs.push(LogRow {
                discussion_id: ld.discussion_id.clone(),
                ts: l.ts.clone(),
                author: l.author.clone(),
                body: l.body.clone(),
            });
        }
        for a in &ld.attachments {
            rows.attachments.push(AttachmentRow {
                discussion_id: ld.discussion_id.clone(),
                rel_path: a.rel_path.clone(),
                kind: a.kind.clone(),
                added_at: ld.updated_at.clone(),
            });
        }
    }
    rows
}

// ─────────────────────────────────────────────────────────────────────────────
// DiscussionCache
// ─────────────────────────────────────────────────────────────────────────────

pub struct DiscussionCache<'a> {
    db: &'a Db,
}

impl<'a> DiscussionCache<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Parse every discussion file and rebuild this project's SQLite projection.
    /// Returns the loaded discussions so callers build DTOs without re-parsing.
    async fn reproject_all(
        &self,
        project_id: u32,
        discussion_root: &Path,
    ) -> Result<Vec<LoadedDiscussion>, String> {
        let loaded = load_all_discussions(discussion_root);
        let pid = project_id as i64;
        let rows = build_rows(&loaded);

        self.db
            .conn()
            .call(move |c| -> Result<(), tokio_rusqlite::Error> {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM oculpm_discussions WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_discussion_log WHERE project_id = ?1",
                    params![pid],
                )?;
                tx.execute(
                    "DELETE FROM oculpm_discussion_attachments WHERE project_id = ?1",
                    params![pid],
                )?;

                for d in &rows.discussions {
                    tx.execute(
                        "INSERT INTO oculpm_discussions
                         (project_id, discussion_id, title, status, owner, problem, tags,
                          option_count, next_step_count, resolution_plan_id, file_path,
                          created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                        params![
                            pid,
                            d.discussion_id,
                            d.title,
                            d.status,
                            d.owner,
                            d.problem,
                            d.tags,
                            d.option_count,
                            d.next_step_count,
                            d.resolution_plan_id,
                            d.file_path,
                            d.created_at,
                            d.updated_at
                        ],
                    )?;
                }
                for l in &rows.logs {
                    tx.execute(
                        "INSERT INTO oculpm_discussion_log
                         (project_id, discussion_id, ts, author, body)
                         VALUES (?1,?2,?3,?4,?5)",
                        params![pid, l.discussion_id, l.ts, l.author, l.body],
                    )?;
                }
                for a in &rows.attachments {
                    tx.execute(
                        "INSERT INTO oculpm_discussion_attachments
                         (project_id, discussion_id, rel_path, kind, bytes, added_at)
                         VALUES (?1,?2,?3,?4,NULL,?5)",
                        params![pid, a.discussion_id, a.rel_path, a.kind, a.added_at],
                    )?;
                }
                tx.commit()?;
                Ok(())
            })
            .await
            .map_err(|e| e.to_string())?;

        Ok(loaded)
    }

    /// Reproject + return discussion summaries (recent-first).
    pub async fn list(
        &self,
        project_id: u32,
        discussion_root: &Path,
    ) -> Result<Vec<DiscussionSummary>, String> {
        let loaded = self.reproject_all(project_id, discussion_root).await?;
        Ok(loaded.iter().map(summary_dto).collect())
    }

    /// Reproject + return one discussion's full detail. `None` when not found.
    pub async fn get(
        &self,
        project_id: u32,
        discussion_root: &Path,
        discussion_id: &str,
    ) -> Result<Option<DiscussionDetail>, String> {
        let loaded = self.reproject_all(project_id, discussion_root).await?;
        Ok(loaded
            .iter()
            .find(|l| l.discussion_id == discussion_id)
            .map(detail_dto))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 한글 폴더 이름이 **디스크에서 실제로 왕복하는지**. slug 를 유니코드로
    /// 연 변경의 진짜 위험 지점이라 순수 함수 단언이 아니라 파일을 만든다
    /// (APFS 는 이름을 정규화해 비교하므로 만든 이름과 읽은 이름이 다를 수 있다).
    #[test]
    fn hangul_folder_name_survives_a_real_filesystem_round_trip() {
        let tmp = tempdir().unwrap();
        let root = discussion_root(tmp.path());
        let slug = slug_for("사용자가 찾은 버그들");
        assert_eq!(slug, "사용자가-찾은-버그들");

        let dir = root.join(&slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("discussion.md"), DISC).unwrap();

        // 이름으로 다시 읽힌다.
        let listed: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(listed.iter().any(|n| n == &slug), "listed: {listed:?}");

        // 조회는 폴더 이름이 아니라 frontmatter id 로 하므로 그것도 확인.
        let found = find_discussion_path(&root, "demo-topic").expect("found by id");
        assert_eq!(found, dir.join("discussion.md"));

        // 투영도 통과한다 (파싱이 한글 경로에서 깨지지 않는다).
        let all = load_all_discussions(&root);
        assert_eq!(all.len(), 1, "loaded: {}", all.len());
    }

    /// 제목이 달라도 폴더가 이미 있으면 `-2` 가 붙는 기존 규칙은 그대로여야 한다.
    /// (한글을 열었다고 충돌 처리가 사라지면 조용히 덮어쓰게 된다.)
    #[test]
    fn hangul_slugs_still_collide_into_distinct_names() {
        assert_eq!(slug_for("같은 제목"), slug_for("같은 제목"));
        assert_ne!(slug_for("같은 제목"), slug_for("다른 제목"));
    }

    const DISC: &str = r#"---
oculpm_discussion: v1
id: demo-topic
title: "데모 토의"
status: open
created: 2026-06-29
updated: 2026-06-29T10:00:00+09:00
owner: user
tags: ["a", "b"]
---

## 문제 정의
무엇을 할지 결정해야 한다.

## 후보 해결 방안
### 방안 A {#opt-a}
- 장점 1
### 방안 B {#opt-b}
- 단점 1

## 토의 / 메모
<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-06-29T10:00:00+09:00 | user | A 가 나아 보임 |
<!-- oculpm:discussion-log end -->

## 다음 단계
- [ ] 첫 작업 {#n1}
- [x] 둘째 작업 {#n2}
"#;

    fn write_discussion(root: &Path, slug: &str, body: &str) {
        let dir = discussion_root(root).join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("discussion.md"), body).unwrap();
    }

    #[tokio::test]
    async fn projection_round_trip_list_get() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        write_discussion(&root, "demo-topic", DISC);
        // an attachment sidecar file
        let att = discussion_root(&root)
            .join("demo-topic")
            .join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        std::fs::write(att.join("note.md"), b"hi").unwrap();

        let db = Db::open(dir.path().join("test.db")).await.expect("open db");
        let pid = db
            .create_project("demo".into(), root.to_string_lossy().to_string())
            .await
            .expect("create project");

        let cache = DiscussionCache::new(&db);
        let droot = discussion_root(&root);

        // list
        let summaries = cache.list(pid, &droot).await.expect("list");
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.discussion_id, "demo-topic");
        assert_eq!(s.title, "데모 토의");
        assert_eq!(s.status, "open");
        assert_eq!(s.option_count, 2);
        assert_eq!(s.next_step_count, 2);
        assert!(s.problem_preview.contains("결정해야"));
        assert_eq!(s.file_path, ".oculpm/discussion/demo-topic/discussion.md");

        // get
        let detail = cache
            .get(pid, &droot, "demo-topic")
            .await
            .expect("get")
            .expect("found");
        assert_eq!(detail.options.len(), 2);
        assert_eq!(detail.options[0].option_id, "opt-a");
        assert_eq!(detail.log.len(), 1);
        assert_eq!(detail.log[0].author, "user");
        assert_eq!(detail.next_steps.len(), 2);
        assert!(detail.next_steps[1].done);
        assert_eq!(detail.tags, vec!["a", "b"]);
        assert_eq!(detail.attachments.len(), 1);
        assert_eq!(detail.attachments[0].rel_path, "attachments/note.md");
        assert_eq!(detail.attachments[0].kind, "doc");

        // missing → None
        let none = cache.get(pid, &droot, "nope").await.expect("get");
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn archived_discussion_in_subfolder_is_listed() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let archived = "---\nid: old-topic\ntitle: \"오래된\"\nstatus: archived\nupdated: 2026-01-01\n---\n## 문제 정의\n과거\n";
        let adir = discussion_root(&root).join("_archive").join("old-topic");
        std::fs::create_dir_all(&adir).unwrap();
        std::fs::write(adir.join("discussion.md"), archived).unwrap();

        let db = Db::open(dir.path().join("t.db")).await.unwrap();
        let pid = db
            .create_project("p".into(), root.to_string_lossy().to_string())
            .await
            .unwrap();
        let cache = DiscussionCache::new(&db);
        let droot = discussion_root(&root);

        let summaries = cache.list(pid, &droot).await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].discussion_id, "old-topic");
        assert_eq!(summaries[0].status, "archived");
        assert_eq!(
            summaries[0].file_path,
            ".oculpm/discussion/_archive/old-topic/discussion.md"
        );
    }
}
