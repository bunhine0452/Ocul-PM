//! 일지·롤업의 의미검색 색인 (journal-scale-round `{#search-semantic-journal}`).
//!
//! `indexer.rs` 는 `.oculpm/` 을 **숨김 디렉터리**라는 이유로 한 번도 걷지
//! 않았다 (`WalkBuilder::standard_filters(true)` 가 `hidden(true)` 를 켠다).
//! 그래서 일지 727건·4MB 는 텍스트 검색과 관련도 랭킹으로만 잡혔고, "같은
//! 증상을 다른 말로 적은 일지" 는 찾을 길이 없었다.
//!
//! 이 모듈이 그 구멍만 메운다. 코드 색인 경로에 `.oculpm` 예외를 끼워 넣지
//! 않는 이유는 둘이 **다른 문서**이기 때문이다:
//!
//! - 코드는 AST 심볼이 청크 경계지만, 일지는 `##` 섹션이 경계다.
//! - 코드 청크는 본문이 전부지만, 일지 청크는 제목·종류·워크데이·태그를 한 줄
//!   머리말로 얹어야 임베딩이 "무슨 날 무슨 종류의 글인지" 를 안다.
//!   프론트매터 자체(schema_version·session_id·해시…)는 검색어가 될 일이 없어
//!   청크에 넣지 않는다 — 넣으면 모든 일지가 서로 닮아진다.
//! - 코드는 diff 기준선 스냅샷·심볼·의존성 그래프를 함께 만들지만, 일지는
//!   그중 어느 것도 아니다.
//!
//! **리댁션.** 캐시 투영(`cache/project.rs`)은 마스킹된 본문을 넣지만 이
//! 모듈은 디스크 원문을 읽는다. 그래서 청크 텍스트는 반드시
//! [`chunk_journal`] 안에서 [`redact_text`] 를 한 번 지난다 — 문이 하나다.
//!
//! **옵션.** 설정 키 `search_include_journal` (기본 켬). 끄면 스윕이 빈
//! 목록을 돌려주고, `index_project` 의 화해가 남은 일지 행을 지운다.

use std::path::Path;

use regex::Regex;

use crate::db::{ChunkInsert, Db};
use crate::embedding::{vec_to_bytes, Embedder};
use crate::indexer::{chunk_lines_with_offset, IndexConfig, EMBED_BATCH, MAX_CHUNK_BYTES};
use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::markdown::parse_body;
use crate::oculpm::paths;
use crate::oculpm::redact::{patterns_for_project, redact_text};

/// 설정 키 — 의미검색에 일지를 포함할지. 미설정은 **켬**이다 (4MB 규모라
/// 비용이 작고, 이 라운드의 취지가 "찾기" 다).
pub const SETTING_INCLUDE_JOURNAL: &str = "search_include_journal";

/// `chunks.kind` 에 들어가는 값 — 코드 청크(`ast`/`lines`)와 가르는 유일한
/// 표식이다. 검색 SQL 의 문서 제외/일지 제외가 이 값 하나를 본다.
pub const CHUNK_KIND: &str = "journal";

const JOURNAL_PREFIX: &str = ".oculpm/journal/";
const ROLLUP_PREFIX: &str = ".oculpm/rollups/";

/// 섹션 하나가 이보다 길면 줄 창으로 다시 쪼갠다 (머리말은 각 창에 남긴다).
const SECTION_SPLIT_LINES: usize = 60;
const SECTION_SPLIT_OVERLAP: usize = 6;

/// 설정값 문자열 → 켬/끔. 미설정·빈 값은 켬 (`"false"`/`"0"` 만 끔).
pub fn include_journal_enabled(raw: Option<&str>) -> bool {
    !matches!(raw.map(str::trim), Some("false") | Some("0"))
}

/// 이 상대 경로가 일지 색인 대상인가.
///
/// 대상은 `.oculpm/journal/**` 과 `.oculpm/rollups/**` 의 `.md` 둘뿐이다.
/// `.oculpm/index/**`(앱 관리) · planner · discussion 은 여기 안 들어온다 —
/// 접두사에서 이미 갈린다. `_template.md`·`_attachments/`·숨김 조각은
/// `watcher::classify::is_journal_entry_path` 와 같은 규칙으로 뺀다.
pub fn is_journal_index_path(rel: &str) -> bool {
    let rel = rel.trim_start_matches("./");
    if !rel.ends_with(".md") {
        return false;
    }
    let Some(tail) = rel
        .strip_prefix(JOURNAL_PREFIX)
        .or_else(|| rel.strip_prefix(ROLLUP_PREFIX))
    else {
        return false;
    };
    if tail.contains("/_attachments/") {
        return false;
    }
    !tail
        .split('/')
        .any(|seg| seg.starts_with('_') || seg.starts_with('.'))
}

/// 일지 청크 하나 — 줄 번호는 **원본 파일** 기준이다 (프론트매터 줄 포함).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalChunk {
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
}

/// 일지 한 편을 섹션 단위로 자른다.
///
/// 1. 프론트매터를 떼어내고 (청크에 넣지 않는다),
/// 2. `제목 · 종류 · 워크데이 · 태그` 한 줄을 만들어 **모든 청크 앞에** 붙이고,
/// 3. 본문을 `##`(이상) 헤딩 경계로 자른다. 첫 헤딩 앞의 머리 부분(제목 줄 +
///    도입)은 그 자체로 한 청크다,
/// 4. 각 청크 텍스트를 리댁션에 지난다.
pub fn chunk_journal(rel: &str, source: &str, redact: &[Regex]) -> Vec<JournalChunk> {
    let (fm, body) = parse_frontmatter_and_body(source);
    // 본문은 원본의 접미사다 — 줄 수 차이가 곧 프론트매터가 먹은 줄 수.
    let offset = source.lines().count().saturating_sub(body.lines().count());
    let parsed = parse_body(&body);
    let header = header_line(rel, &parsed.title, fm.parsed.as_ref());

    let mut out = Vec::new();
    for (start_idx, text) in sections(&body) {
        if text.trim().is_empty() {
            continue;
        }
        let first = (offset + start_idx + 1) as u32;
        if text.len() <= MAX_CHUNK_BYTES {
            let last = first + text.lines().count().saturating_sub(1) as u32;
            out.push(JournalChunk {
                start_line: first,
                end_line: last.max(first),
                content: format!("{header}\n{text}"),
            });
        } else {
            let cfg = IndexConfig {
                chunk_lines: SECTION_SPLIT_LINES,
                chunk_overlap: SECTION_SPLIT_OVERLAP,
                ..IndexConfig::default()
            };
            for window in chunk_lines_with_offset(&text, first as usize, &cfg) {
                out.push(JournalChunk {
                    start_line: window.start_line,
                    end_line: window.end_line,
                    content: format!("{header}\n{}", window.content),
                });
            }
        }
    }

    for chunk in &mut out {
        chunk.content = redact_text(&chunk.content, redact).0;
    }
    out
}

/// 임베딩 앞에 세우는 한 줄. 빈 조각은 빼서 `· ·` 가 생기지 않게 한다.
fn header_line(
    rel: &str,
    title: &str,
    fm: Option<&crate::oculpm::spec::JournalFrontmatter>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !title.trim().is_empty() {
        parts.push(title.trim().to_string());
    }
    // 종류는 프론트매터가 SSOT 고, 그게 깨졌으면 파일명 토큰이 메운다 —
    // `paths::type_token_of_rel` 이 캐시·MCP 와 같은 규칙을 이미 갖고 있다.
    let entry_type = fm
        .map(|fm| crate::oculpm::manager::entry_type_filename_token(fm.entry_type))
        .or_else(|| paths::type_token_of_rel(rel));
    if let Some(t) = entry_type {
        parts.push(format!("type: {t}"));
    }
    if let Some(fm) = fm {
        if !fm.tags.is_empty() {
            parts.push(format!("tags: {}", fm.tags.join(", ")));
        }
    }
    if let Some(entry_rel) = rel.strip_prefix(JOURNAL_PREFIX) {
        if let Some(workday) = paths::workday_of_rel(entry_rel) {
            parts.push(format!("workday: {workday}"));
        }
    } else if let Some(week) = rel
        .strip_prefix(ROLLUP_PREFIX)
        .and_then(|t| t.strip_suffix(".md"))
    {
        parts.push(format!("rollup: {week}"));
    }
    if parts.is_empty() {
        parts.push(rel.to_string());
    }
    format!("# {}", parts.join(" · "))
}

/// `##` 이상 헤딩을 경계로 본문을 자른다 — `(본문 내 0-기반 시작 줄, 텍스트)`.
/// 펜스 코드 블록 안의 `##` 은 경계로 세지 않는다 (일지는 코드를 인용한다).
fn sections(body: &str) -> Vec<(usize, String)> {
    let lines: Vec<&str> = body.lines().collect();
    let mut bounds: Vec<usize> = vec![0];
    let mut in_fence = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || i == 0 {
            continue;
        }
        if t.starts_with("## ") || t.starts_with("### ") || t.starts_with("#### ") {
            bounds.push(i);
        }
    }
    bounds
        .iter()
        .enumerate()
        .map(|(n, &start)| {
            let end = bounds.get(n + 1).copied().unwrap_or(lines.len());
            // 앞뒤 빈 줄은 뗀다 — 안 떼면 첫 섹션의 `start_line` 이 프론트매터
            // 바로 뒤의 빈 줄을 가리켜 "L19–34" 가 제목보다 한 줄 위를 가리킨다.
            let mut s = start;
            while s < end && lines[s].trim().is_empty() {
                s += 1;
            }
            let mut e = end;
            while e > s && lines[e - 1].trim().is_empty() {
                e -= 1;
            }
            (s, lines[s..e].join("\n"))
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// 색인 (스윕 · 파일 하나)
// ─────────────────────────────────────────────────────────────────────────────

/// `.oculpm/journal/**` + `.oculpm/rollups/**` 의 색인 대상 상대 경로.
pub fn walk_journal_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for prefix in [JOURNAL_PREFIX, ROLLUP_PREFIX] {
        let dir = root.join(prefix.trim_end_matches('/'));
        for entry in walkdir::WalkDir::new(&dir)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if is_journal_index_path(&rel) {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

/// 워처가 부르는 한 편짜리 재색인 — 리댁션 패턴을 **여기서** 읽는다.
///
/// 호출자가 패턴을 들고 오게 두지 않는 이유는 하나다: 그러면 마스킹 책임이
/// 모듈 밖으로 새고, `egress_inventory` 가 세는 리댁션 호출 자리도 하나 는다.
/// 스윕은 파일마다 config.toml 을 다시 읽지 않으려고 패턴을 미리 컴파일해
/// [`reindex_journal_file`] 을 직접 부른다.
pub async fn reindex_journal_entry(
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    root: &Path,
    rel: &str,
) -> Result<(bool, u32), String> {
    let redact = patterns_for_project(root);
    reindex_journal_file(db, embedder, project_id, root, rel, &redact).await
}

/// 일지 파일 하나를 색인한다 — `(재색인했는가, 만든 청크 수)`.
///
/// 해시 게이트: 디스크 내용의 blake3 가 `files` 행과 같으면 아무것도 안 한다
/// (`upsert_file` 이 `changed=false` 를 돌려준다). 임베딩은 그 뒤에만 돈다.
pub async fn reindex_journal_file(
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    root: &Path,
    rel: &str,
    redact: &[Regex],
) -> Result<(bool, u32), String> {
    let abs = root.join(rel);
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let (file_id, changed) = db
        .upsert_file(
            project_id,
            rel.to_string(),
            hash,
            meta.len() as i64,
            mtime,
            Some("markdown".to_string()),
        )
        .await
        .map_err(|e| e.to_string())?;
    if !changed {
        return Ok((false, 0));
    }

    let chunks = chunk_journal(rel, &content, redact);
    let mut created = 0u32;
    for batch in chunks.chunks(EMBED_BATCH) {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
        let embeddings = embedder.embed(texts).await?;
        let rows: Vec<ChunkInsert> = batch
            .iter()
            .zip(embeddings.iter())
            .map(|(c, emb)| ChunkInsert {
                kind: CHUNK_KIND.to_string(),
                start_line: c.start_line,
                end_line: c.end_line,
                content: c.content.clone(),
                embedding: vec_to_bytes(emb),
            })
            .collect();
        created += db
            .insert_chunks_with_embeddings(project_id, file_id, rows)
            .await
            .map_err(|e| e.to_string())? as u32;
    }
    Ok((true, created))
}

/// 설정을 읽어 이번 색인의 일지 대상 목록을 걷는다 — 꺼져 있으면 빈 목록.
///
/// 걷기를 [`sweep`] 안이 아니라 **앞**에 두는 이유는 진행률이다: 호출자가
/// 일지 수를 총계에 미리 더해야 막대가 코드 파일 끝에서 멈춘 것처럼 보이지
/// 않는다. 설정 판정까지 여기로 모아 두면 호출부는 한 줄이 된다.
pub async fn todo_from_settings(
    root: &Path,
    settings: &std::collections::HashMap<String, String>,
) -> Result<Vec<String>, String> {
    if !include_journal_enabled(settings.get(SETTING_INCLUDE_JOURNAL).map(String::as_str)) {
        return Ok(Vec::new());
    }
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || walk_journal_files(&root))
        .await
        .map_err(|e| e.to_string())
}

/// 진행률 보고 간격 — `index_project` 의 코드 루프와 같은 규칙(완성도 라운드
/// Phase 3): 파일마다 IPC 를 쏘면 웹뷰 렌더가 밀린다.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// 전체 색인(`index_project`)이 부르는 일지 스윕 — `(색인한 상대 경로, 청크 수)`.
///
/// 경로 목록을 **돌려주는 것이 계약**이다: `index_project` 의 화해가 "이번
/// walk 에 없는 파일" 을 지우므로, 여기서 돌려주지 않으면 방금 넣은 일지 행이
/// 같은 호출 끝에서 다시 지워진다. 옵션이 꺼져 있으면 호출자가 빈 `files` 를
/// 주고, 그 화해가 곧 청소가 된다.
///
/// `files` 를 호출자가 미리 걷어 넘기는 이유는 진행률이다: 일지 수를 **총계에
/// 미리 더해** 두지 않으면 코드 파일이 끝나는 순간 막대가 100% 에서 멈춘 채
/// 일지 727편의 임베딩을 기다리게 된다 (멈춘 것처럼 보인다).
/// `on_progress(색인 순번 1.., 경로)` 는 100ms 에 한 번, 마지막 한 편은 무조건.
pub async fn sweep(
    db: &Db,
    embedder: &Embedder,
    project_id: u32,
    root: &Path,
    files: Vec<String>,
    on_progress: impl Fn(u32, &str),
) -> Result<(Vec<String>, u32), String> {
    if files.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let redact = patterns_for_project(root);
    let mut chunks = 0u32;
    let mut indexed = Vec::with_capacity(files.len());
    let mut last: Option<std::time::Instant> = None;
    let n_files = files.len();
    for (i, rel) in files.into_iter().enumerate() {
        if i + 1 == n_files || last.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
            on_progress((i + 1) as u32, &rel);
            last = Some(std::time::Instant::now());
        }
        match reindex_journal_file(db, embedder, project_id, root, &rel, &redact).await {
            Ok((_, n)) => {
                chunks += n;
                indexed.push(rel);
            }
            // 한 편이 읽히지 않아도 나머지는 색인한다. 다만 경로는 돌려주지
            // 않는다 — 행이 없으니 화해가 지울 것도 없다.
            Err(e) => tracing::warn!(project_id, path = %rel, error = %e, "journal index: skipped"),
        }
    }
    Ok((indexed, chunks))
}

#[cfg(test)]
mod tests;
