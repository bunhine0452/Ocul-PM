//! 검색의 **캐시 경로** — `oculpm_journal*` 를 읽어 [`SearchRow`] 를 만든다.
//!
//! 두 호출자가 같은 SQL 을 쓴다. 앱 안에서는 `tokio-rusqlite` 가 빌려주는
//! `&mut Connection` 위에서, MCP 서버(`oculpm-mcp`)에서는 **읽기 전용으로 연
//! 별도 커넥션** 위에서 — 그래서 여기 있는 것은 전부 동기 함수다.
//!
//! # MCP 가 앱 DB 를 읽어도 되는가 ({#search-cache})
//!
//! 이 모듈의 원래 계약은 "디스크가 SSOT, 앱이 꺼져 있어도 동작"이었고 그건
//! 그대로다. 캐시는 **빠른 길**일 뿐이고, 조금이라도 미심쩍으면 디스크로
//! 내려간다:
//!
//! * 앱 데이터 디렉터리에 DB 가 없다 → 디스크
//! * `--root` 에 해당하는 프로젝트 행이 없다 (앱에 추가된 적 없음) → 디스크
//! * 그 프로젝트의 일지가 하나도 색인돼 있지 않다 → 디스크
//! * 디스크의 (파일 수, 최신 mtime) 이 캐시의 그것과 다르다 → 디스크
//!
//! 마지막 조건이 핵심이다. 캐시는 **앱이 돌 때만** mtime 게이트로 최신이고,
//! 앱이 꺼진 동안 손으로 쓴 일지는 캐시에 없다. 디렉터리 걷기(파일을 열지
//! 않는다)는 싸고, 727건 기준 몇 ms 다 — 727개 파일을 전부 읽어 파싱하는
//! 것과는 자릿수가 다르다. 그 몇 ms 로 "앱이 켜져 있냐에 따라 답이 다르다"를
//! 통째로 없앤다.
//!
//! 쓰기는 하지 않는다 — `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only` 로 두 번
//! 잠근다. 앱이 동시에 쓰고 있을 수 있으므로 `busy_timeout` 을 짧게 건다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params_from_iter, Connection, OpenFlags};

use super::SearchRow;

/// 앱이 쓰는 것과 **같은** 파일 (`config/cli.rs` 의 `open_db` 와 같은 자리).
const APP_QUALIFIER: (&str, &str, &str) = ("com", "kimhyunbin", "ocul-pm");

/// 앱이 쓰기 중일 수 있다. 여기서 오래 기다릴 이유는 없다 — 막히면 디스크로.
const BUSY_TIMEOUT: Duration = Duration::from_millis(750);

/// SQL 로 거를 수 있는 것 — 파일을 열지 않고도 판정되는 조건들.
#[derive(Debug, Clone, Default)]
pub struct SqlFilters {
    /// `bug|feature|…` 토큰. 비었으면 제약 없음.
    pub types: Vec<String>,
    pub status: Vec<String>,
    /// 소문자 태그. **전부** 가진 일지만 (AND).
    pub tags: Vec<String>,
    /// `files_touched` 경로의 부분 일치 (소문자).
    pub file: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
}

/// 읽기 전용으로 연 앱 캐시와, 이 root 에 해당하는 프로젝트 id.
pub struct CacheHandle {
    pub conn: Connection,
    pub project_id: i64,
}

/// `<app_data>/ocul-pm.db` — 없으면 `None`.
pub fn app_db_path() -> Option<PathBuf> {
    let (q, o, a) = APP_QUALIFIER;
    let dir = directories::ProjectDirs::from(q, o, a)?;
    let path = dir.data_dir().join("ocul-pm.db");
    path.is_file().then_some(path)
}

/// 이 프로젝트 root 에 대해 캐시를 열 수 있으면 연다.
///
/// 하나라도 어긋나면 `None` — 호출자는 디스크 스캔으로 내려간다. 모듈 문서의
/// 네 조건이 그대로 이 함수의 이른 반환들이다.
pub fn open_for_root(root: &Path) -> Option<CacheHandle> {
    let conn = open_readonly(&app_db_path()?)?;
    let project_id = lookup_project_id(&conn, root)?;
    let (rows, newest) = cache_signature(&conn, project_id).ok()?;
    if rows == 0 {
        return None; // 이 프로젝트는 색인된 적이 없다.
    }
    let (disk_rows, disk_newest) = disk_signature(root);
    if rows != disk_rows || newest != disk_newest {
        return None; // 앱이 꺼진 동안 디스크가 앞서 나갔다.
    }
    Some(CacheHandle { conn, project_id })
}

/// 읽기 전용 커넥션. WAL DB 라 `-shm` 를 붙일 수 없는 상황(권한·삭제 중)에서는
/// 열기 자체가 실패하는데, 그것도 그냥 `None` 이다.
pub fn open_readonly(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.busy_timeout(BUSY_TIMEOUT).ok()?;
    // 읽기 전용 플래그 위에 한 번 더. 이 프로세스는 앱 DB 의 **독자**다.
    conn.execute_batch("PRAGMA query_only = 1;").ok()?;
    Some(conn)
}

/// 이 root 에 해당하는 `projects.id`.
///
/// 문자열 동등 비교만 하지 않는 이유: MCP 의 root 는 canonicalize 를 거치고
/// (`bin/oculpm_mcp.rs`), 앱이 저장한 `root_path` 는 폴더 선택기가 준 값
/// 그대로다. `/tmp` → `/private/tmp` 같은 심볼릭 링크 하나로 두 값이 갈린다.
pub fn lookup_project_id(conn: &Connection, root: &Path) -> Option<i64> {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut stmt = conn.prepare("SELECT id, root_path FROM projects").ok()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .ok()?;
    let mut fallback = None;
    for row in rows.flatten() {
        let (id, stored) = row;
        let stored_path = PathBuf::from(&stored);
        if stored_path == canonical {
            return Some(id);
        }
        if stored_path.canonicalize().ok().as_deref() == Some(canonical.as_path()) {
            fallback = Some(id);
        }
    }
    fallback
}

/// 캐시가 아는 (행 수, 최신 file_mtime).
pub fn cache_signature(conn: &Connection, project_id: i64) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(MAX(file_mtime), 0) FROM oculpm_journal WHERE project_id = ?1",
        [project_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// 디스크가 아는 같은 둘. `walk_journal` 은 **파일을 열지 않는다**.
pub fn disk_signature(root: &Path) -> (i64, i64) {
    let journal_root = root.join(".oculpm").join("journal");
    let files = crate::oculpm::cache::walk_journal(&journal_root);
    let newest = files.iter().map(|(_, m)| *m).max().unwrap_or(0);
    (files.len() as i64, newest)
}

/// 구조 필터에 맞는 행 전부. 질의 매칭은 여기서 하지 않는다 — 그건
/// [`super::rank`] 의 몫이고, 그래야 캐시와 디스크가 **글자 하나까지** 같은
/// 판정을 한다 (SQLite 의 `lower()` 는 ASCII 전용이라 SQL 로 내리면 갈라진다).
pub fn fetch_rows(
    conn: &Connection,
    project_id: i64,
    filters: &SqlFilters,
) -> rusqlite::Result<Vec<SearchRow>> {
    let mut sql = String::from(
        "SELECT relative_path, workday, type, status, title, slug, body_markdown, parse_ok \
         FROM oculpm_journal WHERE project_id = ?1",
    );
    let mut bound: Vec<rusqlite::types::Value> = vec![project_id.into()];
    if let Some(since) = &filters.since {
        bound.push(since.clone().into());
        sql.push_str(&format!(" AND workday >= ?{}", bound.len()));
    }
    if let Some(until) = &filters.until {
        bound.push(until.clone().into());
        sql.push_str(&format!(" AND workday <= ?{}", bound.len()));
    }
    push_in_clause(&mut sql, &mut bound, "type", &filters.types);
    push_in_clause(&mut sql, &mut bound, "status", &filters.status);
    for tag in &filters.tags {
        bound.push(tag.clone().into());
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM oculpm_journal_tags t \
              WHERE t.project_id = oculpm_journal.project_id \
                AND t.relative_path = oculpm_journal.relative_path \
                AND lower(t.tag) = ?{})",
            bound.len()
        ));
    }
    if let Some(file) = &filters.file {
        bound.push(file.clone().into());
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM oculpm_journal_files f \
              WHERE f.project_id = oculpm_journal.project_id \
                AND f.relative_path = oculpm_journal.relative_path \
                AND instr(lower(replace(f.file_path, '\\', '/')), ?{}) > 0)",
            bound.len()
        ));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(bound.iter()), |r| {
        let relative_path: String = r.get(0)?;
        let parse_ok: i64 = r.get(7)?;
        let type_token: String = r.get(2)?;
        let status_token: String = r.get(3)?;
        // frontmatter 를 못 읽은 행은 캐시의 종류·상태가 기본값이다 — 디스크
        // 경로가 그럴 때 파일명 토큰으로 메우는 것과 같은 판정을 여기서도 한다.
        let (type_token, status_token) = if parse_ok == 0 {
            (
                crate::oculpm::paths::type_token_of_rel(&relative_path)
                    .unwrap_or("?")
                    .to_string(),
                "?".to_string(),
            )
        } else {
            (type_token, status_token)
        };
        Ok(SearchRow {
            relative_path,
            workday: r.get(1)?,
            type_token,
            status_token,
            title: r.get(4)?,
            slug: r.get(5)?,
            tags: Vec::new(),
            files: Vec::new(),
            body: r.get(6)?,
            file_hit: None,
        })
    })?;
    let mut out: Vec<SearchRow> = rows.collect::<rusqlite::Result<_>>()?;
    hydrate(conn, project_id, &mut out, filters.file.as_deref())?;
    Ok(out)
}

/// 태그·파일 경로를 왕복 두 번에 붙인다 (행마다 한 번씩 묻지 않는다).
fn hydrate(
    conn: &Connection,
    project_id: i64,
    rows: &mut [SearchRow],
    file_filter: Option<&str>,
) -> rusqlite::Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let index: HashMap<String, usize> = rows
        .iter()
        .enumerate()
        .map(|(i, row)| (row.relative_path.clone(), i))
        .collect();
    let mut tags: Vec<(String, String)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT relative_path, tag FROM oculpm_journal_tags WHERE project_id = ?1")?;
        let it = stmt.query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        for row in it {
            tags.push(row?);
        }
    }
    let mut files: Vec<(String, String)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT relative_path, file_path FROM oculpm_journal_files WHERE project_id = ?1",
        )?;
        let it = stmt.query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        for row in it {
            files.push(row?);
        }
    }
    for (rel, tag) in tags {
        if let Some(i) = index.get(rel.as_str()) {
            rows[*i].tags.push(tag);
        }
    }
    for (rel, path) in files {
        if let Some(i) = index.get(rel.as_str()) {
            rows[*i].files.push(path);
        }
    }
    if let Some(want) = file_filter {
        for row in rows.iter_mut() {
            row.file_hit = row
                .files
                .iter()
                .find(|p| p.replace('\\', "/").to_lowercase().contains(want))
                .cloned();
        }
    }
    Ok(())
}

fn push_in_clause(
    sql: &mut String,
    bound: &mut Vec<rusqlite::types::Value>,
    column: &str,
    values: &[String],
) {
    if values.is_empty() {
        return;
    }
    let mut holes = Vec::with_capacity(values.len());
    for v in values {
        bound.push(v.clone().into());
        holes.push(format!("?{}", bound.len()));
    }
    sql.push_str(&format!(" AND {column} IN ({})", holes.join(", ")));
}
