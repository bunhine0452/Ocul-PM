use std::path::PathBuf;
use std::sync::Once;

use rusqlite::params;
use rusqlite::OptionalExtension;
use tokio_rusqlite::Connection;
use tracing::{info, warn};

use crate::error::Result;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/001_initial.sql")),
    (2, include_str!("../../migrations/002_chunks.sql")),
    (3, include_str!("../../migrations/003_subtasks.sql")),
    (4, include_str!("../../migrations/004_conversations.sql")),
    (5, include_str!("../../migrations/005_ast_dependencies.sql")),
    (6, include_str!("../../migrations/006_file_changes.sql")),
    (7, include_str!("../../migrations/007_changelog.sql")),
    (8, include_str!("../../migrations/008_project_overview.sql")),
    (
        9,
        include_str!("../../migrations/009_conversation_actions.sql"),
    ),
    // 파일명 번호 그대로 등록한다 — 예전엔 10 으로 등록돼 있었는데, `IF NOT EXISTS`
    // 라 어느 DB 든 결과가 같다. `migration_registry_matches_disk` 가 파일명↔번호를
    // 대조하므로 어긋난 채 둘 수 없다.
    (
        11,
        include_str!("../../migrations/011_project_blueprints.sql"),
    ),
    (12, include_str!("../../migrations/012_oculpm_journal.sql")),
    (
        13,
        include_str!("../../migrations/013_oculpm_agent_state.sql"),
    ),
    (
        14,
        include_str!("../../migrations/014_oculpm_migrations.sql"),
    ),
    (15, include_str!("../../migrations/015_file_snapshots.sql")),
    (16, include_str!("../../migrations/016_oculpm_planner.sql")),
    (
        17,
        include_str!("../../migrations/017_embedding_model_quantized.sql"),
    ),
    (18, include_str!("../../migrations/018_code_graph.sql")),
    (
        19,
        include_str!("../../migrations/019_symbol_relations.sql"),
    ),
    (
        20,
        include_str!("../../migrations/020_symbol_relations_from.sql"),
    ),
    (
        21,
        include_str!("../../migrations/021_oculpm_agent_version.sql"),
    ),
    (22, include_str!("../../migrations/022_retro_insights.sql")),
    (
        23,
        include_str!("../../migrations/023_coercion_version.sql"),
    ),
    (
        24,
        include_str!("../../migrations/024_oculpm_discussion.sql"),
    ),
    // 25 는 비어 있다 — 025_fts.sql(trigram FTS5) 은 등록된 적 없이 2026-08-30
    // 에 폐기됐다 (`code_index.rs search_text` 주석). 번호는 재사용하지 않는다.
    (
        26,
        include_str!("../../migrations/026_claude_hooks_inbox.sql"),
    ),
    (
        27,
        include_str!("../../migrations/027_project_appearance.sql"),
    ),
    (
        28,
        include_str!("../../migrations/028_journal_file_lines.sql"),
    ),
    (29, include_str!("../../migrations/029_mobile_devices.sql")),
    (30, include_str!("../../migrations/030_context_firings.sql")),
    (
        31,
        include_str!("../../migrations/031_purge_index_noise.sql"),
    ),
    (
        32,
        include_str!("../../migrations/032_chunk_embeddings_partition.sql"),
    ),
    (33, include_str!("../../migrations/033_automation.sql")),
];

/// `ALTER TABLE … ADD COLUMN` 으로 더해진 **가산 컬럼**의 전수 목록 —
/// (테이블, 컬럼, 선언). 마이그레이션 러너가 그 파일을 건너뛴 DB 를 [`Db::heal_columns`]
/// 가 이걸로 메운다.
///
/// 왜 필요한가: 적용 이력이 `PRAGMA user_version` 정수 하나뿐이라, **번호가
/// 재사용되면** 러너가 새 파일을 영영 실행하지 않는다. 실제로 그렇게 됐다 —
/// 병합되지 않은 브랜치가 028 로 `oculpm_journal` 에 컬럼을 더했고, 그 빌드를
/// 돌린 DB 는 user_version 이 28 이 된 채 main 의 **다른** 028
/// (`oculpm_journal_files.lines_added/removed`) 을 건너뛰었다. 결과가 Today 마다
/// 뜨던 `no such column: f.lines_added` 다. 마이그레이션 파일을 고쳐도 이미
/// 28 을 지나온 DB 는 스스로 낫지 못한다.
///
/// 컬럼 추가는 멱등하고(있으면 건너뛴다) 데이터가 사라지지 않으므로, 어떤
/// 경로로 어긋났든(번호 충돌·수동 편집·부분 복구) 여기서 결과가 같아진다.
/// 새 `ADD COLUMN` 마이그레이션을 쓸 때는 이 목록에도 한 줄 추가한다 —
/// `every_added_column_is_declared_for_healing` 테스트가 누락을 막는다.
// oculpm-defer: 그물이 덮는 건 ADD COLUMN 뿐 — 같은 번호 충돌로 CREATE TABLE
// 마이그레이션이 통째로 건너뛰어지면 못 잡는다; 그 사고가 한 번이라도 나면 적용
// 이력을 정수 하나에서 (버전, sql 해시) 원장으로 바꾼다.
const ADDITIVE_COLUMNS: &[(&str, &str, &str)] = &[
    (
        "file_changes",
        "entry_id",
        "INTEGER REFERENCES changelog_entries(id) ON DELETE SET NULL",
    ),
    ("symbol_relations", "from_symbol", "TEXT"),
    ("oculpm_journal", "agent_version", "TEXT"),
    (
        "oculpm_journal",
        "coercion_version",
        "INTEGER NOT NULL DEFAULT 0",
    ),
    ("projects", "icon", "TEXT"),
    ("projects", "color", "TEXT"),
    ("oculpm_journal_files", "lines_added", "INTEGER"),
    ("oculpm_journal_files", "lines_removed", "INTEGER"),
];

pub struct Db {
    conn: Connection,
    path: PathBuf,
}

/// `insert_chunks_with_embeddings` 한 행. 인덱서가 만든 청크와 그 임베딩을
/// 배치로 넘기기 위한 그릇이다 (임베딩은 vec0 가 받는 f32 리틀엔디언 바이트).
pub struct ChunkInsert {
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub embedding: Vec<u8>,
}

pub mod automation;
mod changes;
mod chat;
mod code_index;
mod firings;
mod graph;
mod planning;
mod projects;
mod settings;

impl Db {
    pub async fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        Self::register_sqlite_vec();

        let conn = Connection::open(path.clone()).await?;
        conn.call(|c| {
            // WAL + synchronous=NORMAL 은 원래대로 (커밋마다 fsync 하지 않고
            // 체크포인트에서 모아 한다). 아래 넷은 2026-08-11 에 추가:
            //
            //  busy_timeout — WAL 이라도 쓰기는 한 번에 하나다. 인덱싱 배치와
            //    워처의 증분 재인덱싱이 겹치면 예전에는 SQLITE_BUSY 로 즉시
            //    실패했다. 5초 동안 재시도한다.
            //  cache_size  — 음수는 KiB 단위. -64000 = 64MiB. 기본값 2MiB 로는
            //    청크/임베딩 테이블을 훑는 질의가 페이지를 계속 다시 읽는다.
            //  mmap_size   — 256MiB 까지 읽기를 mmap 으로 넘겨 read() 시스템콜과
            //    버퍼 복사를 줄인다.
            //  temp_store  — ORDER BY / 큰 조인의 임시 B-트리를 디스크 대신
            //    메모리에 만든다.
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA busy_timeout = 5000;
                 PRAGMA cache_size = -64000;
                 PRAGMA mmap_size = 268435456;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA journal_size_limit = 67108864;",
            )?;
            // journal_size_limit (2026-08-30): WAL 은 체크포인트 뒤에도 파일을
            // 줄이지 않아 첫 색인 크기(80MB) 로 눌러앉아 있었다. 64MiB 를 넘긴
            // 부분만 체크포인트 때 잘라낸다.
            Ok(())
        })
        .await?;

        let db = Self { conn, path };
        db.migrate().await?;
        info!(path = %db.path.display(), "database ready");
        Ok(db)
    }

    /// Borrow the underlying async sqlite connection. Used by sibling
    /// subsystems (e.g. `oculpm::cache`) that need to share the same db
    /// connection without duplicating the migration/open machinery, and by
    /// integration tests in `src-tauri/tests/` that need raw `UPDATE` access
    /// (e.g. to override `created_at` timestamps on changelog rows).
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Register sqlite-vec as a SQLite auto-extension exactly once per process.
    /// Auto-extensions are applied to every new connection, including ours.
    fn register_sqlite_vec() {
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut rusqlite::ffi::sqlite3,
                    *mut *mut i8,
                    *const rusqlite::ffi::sqlite3_api_routines,
                ) -> i32,
            >(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    async fn migrate(&self) -> Result<()> {
        self.conn
            .call(|c| {
                let current: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                for (version, sql) in MIGRATIONS {
                    if current < *version {
                        let tx = c.transaction()?;
                        tx.execute_batch(sql)?;
                        tx.pragma_update(None, "user_version", *version)?;
                        tx.commit()?;
                        info!(version, "migration applied");
                    }
                }
                Ok(())
            })
            .await?;
        self.heal_columns().await?;
        Ok(())
    }

    /// [`ADDITIVE_COLUMNS`] 중 실제 스키마에 없는 것을 다시 더한다 — 러너가
    /// 번호 때문에 건너뛴 마이그레이션의 **결과만** 복구하는 안전망이다.
    ///
    /// 없는 테이블은 건너뛴다 (그 마이그레이션 자체가 아직인 DB — 신규 설치
    /// 도중이거나 미래에 테이블이 사라진 경우). 한 컬럼이 실패해도 나머지는
    /// 계속 시도하지 않는다: ADD COLUMN 이 실패하는 상황은 스키마가 예상과
    /// 다르다는 뜻이라 조용히 넘기면 안 된다.
    async fn heal_columns(&self) -> Result<()> {
        self.conn
            .call(|c| {
                for (table, column, decl) in ADDITIVE_COLUMNS {
                    let table_exists: bool = c
                        .query_row(
                            "SELECT 1 FROM sqlite_master
                              WHERE type = 'table' AND name = ?1",
                            [table],
                            |_| Ok(true),
                        )
                        .optional()?
                        .unwrap_or(false);
                    if !table_exists {
                        continue;
                    }

                    let column_exists: bool = c
                        .query_row(
                            "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2",
                            params![table, column],
                            |_| Ok(true),
                        )
                        .optional()?
                        .unwrap_or(false);
                    if column_exists {
                        continue;
                    }

                    // 식별자는 바인딩할 수 없다 — 값은 전부 이 파일의 상수라
                    // 외부 입력이 섞이지 않는다.
                    c.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl};"))?;
                    warn!(table, column, "schema drift healed — column re-added");
                }
                Ok(())
            })
            .await?;
        Ok(())
    }

    pub async fn health(&self) -> Result<DbHealth> {
        let path = self.path.display().to_string();
        let wal_bytes = std::fs::metadata(format!("{path}-wal"))
            .map(|m| m.len() as f64)
            .unwrap_or(0.0);
        let (sqlite_version, vec_version, schema_version, db_bytes, free_bytes, top_tables) = self
            .conn
            .call(|c| {
                let sqlite_version: String =
                    c.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
                let vec_version: String = c.query_row("SELECT vec_version()", [], |r| r.get(0))?;
                let schema_version: u32 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
                let page_size: u64 = c.query_row("PRAGMA page_size", [], |r| r.get(0))?;
                let page_count: u64 = c.query_row("PRAGMA page_count", [], |r| r.get(0))?;
                let freelist: u64 = c.query_row("PRAGMA freelist_count", [], |r| r.get(0))?;
                // dbstat 은 번들 SQLite 에 켜져 있다(SQLITE_ENABLE_DBSTAT_VTAB) —
                // 그래도 실패하면 상위 표 없이 나머지만 보고한다. 큰 표 몇 개가
                // 전체의 대부분이라 8개면 충분히 설명된다.
                let top_tables = match c.prepare(
                    "SELECT name, SUM(pgsize) FROM dbstat
                     GROUP BY name ORDER BY SUM(pgsize) DESC LIMIT 8",
                ) {
                    Ok(mut stmt) => stmt
                        .query_map([], |r| {
                            Ok(DbTableSize {
                                name: r.get(0)?,
                                bytes: r.get::<_, i64>(1)?.max(0) as f64,
                            })
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()
                        .unwrap_or_default(),
                    Err(e) => {
                        warn!(error = %e, "dbstat unavailable — table sizes omitted");
                        Vec::new()
                    }
                };
                Ok((
                    sqlite_version,
                    vec_version,
                    schema_version,
                    (page_size * page_count) as f64,
                    (page_size * freelist) as f64,
                    top_tables,
                ))
            })
            .await?;
        Ok(DbHealth {
            sqlite_version,
            vec_version,
            schema_version,
            path,
            db_bytes,
            wal_bytes,
            free_bytes,
            top_tables,
        })
    }

    /// 빈 페이지를 되돌려주고 WAL 을 잘라낸다 — 색인 정리(031)·프로젝트 삭제 뒤
    /// 파일 크기는 저절로 줄지 않는다. 사용자가 진단 탭에서 직접 누른다.
    /// VACUUM 은 트랜잭션 밖이어야 하고 파일 크기만큼 임시 공간을 쓴다.
    pub async fn compact(&self) -> Result<()> {
        self.conn
            .call(|c| {
                c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
                Ok(())
            })
            .await?;
        Ok(())
    }
}

// ---------- Row mapper ----------

fn blueprint_from_row(r: &rusqlite::Row) -> rusqlite::Result<ProjectBlueprint> {
    Ok(ProjectBlueprint {
        id: r.get::<_, i64>(0)? as u32,
        name: r.get(1)?,
        idea_text: r.get(2)?,
        target_users: r.get(3)?,
        stack_choice: r.get(4)?,
        folder_name: r.get(5)?,
        folder_path: r.get(6)?,
        seed_goals_json: r.get(7)?,
        wizard_step: r.get::<_, i64>(8)? as u32,
        created_at: r.get::<_, i64>(9)? as u32,
        updated_at: r.get::<_, i64>(10)? as u32,
    })
}

fn goal_from_row(r: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: r.get::<_, i64>(0)? as u32,
        project_id: r.get::<_, Option<i64>>(1)?.map(|v| v as u32),
        title: r.get(2)?,
        description: r.get(3)?,
        status: r.get(4)?,
        priority: r.get(5)?,
        due_date: r.get(6)?,
        progress: r.get(7)?,
        created_at: r.get::<_, i64>(8)? as u32,
        updated_at: r.get::<_, i64>(9)? as u32,
    })
}

fn conversation_from_row(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get::<_, i64>(0)? as u32,
        title: r.get(1)?,
        provider: r.get(2)?,
        model: r.get(3)?,
        project_id: r.get::<_, Option<i64>>(4)?.map(|v| v as u32),
        created_at: r.get::<_, i64>(5)? as u32,
        updated_at: r.get::<_, i64>(6)? as u32,
        last_message_at: r.get::<_, Option<i64>>(7)?.map(|v| v as u32),
    })
}

fn chat_message_from_row(r: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: r.get::<_, i64>(0)? as u32,
        conversation_id: r.get::<_, i64>(1)? as u32,
        role: r.get(2)?,
        content: r.get(3)?,
        provider: r.get(4)?,
        model: r.get(5)?,
        created_at: r.get::<_, i64>(6)? as u32,
    })
}

fn project_overview_from_row(r: &rusqlite::Row) -> rusqlite::Result<ProjectOverview> {
    Ok(ProjectOverview {
        project_id: r.get::<_, i64>(0)? as u32,
        identity: r.get(1)?,
        stack_json: r.get(2)?,
        overview_md: r.get(3)?,
        source_signature: r.get(4)?,
        generated_at: r.get::<_, Option<i64>>(5)?.map(|v| v as u32),
        generated_by_model: r.get(6)?,
    })
}

fn retro_insight_from_row(r: &rusqlite::Row) -> rusqlite::Result<RetroInsight> {
    Ok(RetroInsight {
        project_id: r.get::<_, i64>(0)? as u32,
        range_key: r.get(1)?,
        signature: r.get(2)?,
        retro_md: r.get(3)?,
        generated_at: r.get::<_, i64>(4)? as u32,
        generated_by_model: r.get(5)?,
    })
}

// ---------- Types ----------

/// 페어링된 모바일 기기 (설정 '모바일' 탭 목록).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct MobileDevice {
    pub id: u32,
    pub name: String,
    pub created_at: String,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct DbHealth {
    pub sqlite_version: String,
    pub vec_version: String,
    pub schema_version: u32,
    pub path: String,
    /// 데이터베이스 파일 크기(바이트) — 페이지 수 × 페이지 크기.
    /// (f64: specta 는 u64 를 내보내지 않는다 — JS number 는 2^53 까지 정확하다.)
    pub db_bytes: f64,
    /// WAL 파일 크기(바이트). 체크포인트 전까지 커진다.
    pub wal_bytes: f64,
    /// 빈 페이지(바이트) — 삭제 뒤 남은 자리. [`Db::compact`] 가 되찾는다.
    pub free_bytes: f64,
    /// 큰 순서로 상위 표·인덱스 8개.
    pub top_tables: Vec<DbTableSize>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DbTableSize {
    pub name: String,
    pub bytes: f64,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Project {
    pub id: u32,
    pub name: String,
    pub root_path: String,
    pub created_at: u32,
    /// 아이콘 id (`"terminal"` 등). `None` 이면 프런트가 이름에서 유도한다.
    pub icon: Option<String>,
    /// 색 id (`"amber"` 등) — hex 가 아니라 id 다 (테마마다 다르게 해석된다).
    pub color: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChunkSearchResult {
    pub chunk_id: u32,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub distance: f32,
}

/// PR-R1b (A2) — a symbol hit from `search_symbols` (name LIKE over the AST
/// symbol index). Unlike `SymbolDef` it carries the owning file path.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SymbolSearchResult {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// v2 U7 (docs/20260706_v2/02-features-spec.md §2) — 팔레트 "go to anything"
/// 히트 한 건. `id` 는 kind 별 라우팅 키: journal=relative_path,
/// plan=plan_id, plan_item="plan_id#item_id", discussion=discussion_id.
/// 코드 화면 — "이 파일을 고친 일지" 역조회 한 줄
/// (`oculpm_journal_files` × `oculpm_journal`). 에디터 브레드크럼의 일지 칩이
/// 소비한다: 에이전트가 이 파일에 무슨 일을 했는지가 편집 중에 보인다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct FileJournalEntry {
    /// 일지 캐시 키 (`20260823/Bugs/….md`) — 그대로 일지 화면 점프에 쓴다.
    pub journal_path: String,
    pub title: String,
    /// bug | feature | error | refactor | chore.
    pub entry_type: String,
    pub agent_id: String,
    /// RFC3339 (frontmatter created_at).
    pub created_at: String,
    /// 그 일지에서 이 파일에 한 일 — create | update | delete | rename | correct.
    pub op: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Journal,
    Plan,
    PlanItem,
    Discussion,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EntityHit {
    pub kind: EntityKind,
    pub id: String,
    pub title: String,
    /// 보조 문맥 — 일지: "워크데이 · 타입", 플랜 항목: 플랜 제목, 토의: status.
    pub subtitle: String,
}

/// v2 U10 (C1) — 활성 플랜의 미완 항목 한 건 (스탠드업 "오늘 할 일"/"막힘" 소스).
/// v2 U12 에서 Today "다음 할 일" 위젯도 이 shape 를 소비한다 (workday brief).
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct OpenPlanItem {
    pub plan_id: String,
    pub plan_title: String,
    pub item_id: String,
    pub item_title: String,
    /// 항목이 속한 phase 헤딩 (없으면 None — UI 는 플랜 제목으로 폴백).
    pub phase: Option<String>,
    /// todo | in_progress | blocked
    pub status: String,
}

/// SQL fragment that excludes prose/documentation files from a result set by
/// path suffix (의미검색 문서 제외). Appended to `search_chunks` when the
/// caller asks for code-only results. Lives here next to the search queries so
/// the extension list stays in one place.
const DOC_EXCLUDE_SQL: &str = " AND lower(f.path) NOT LIKE '%.md' \
     AND lower(f.path) NOT LIKE '%.mdx' \
     AND lower(f.path) NOT LIKE '%.markdown' \
     AND lower(f.path) NOT LIKE '%.txt' \
     AND lower(f.path) NOT LIKE '%.text' \
     AND lower(f.path) NOT LIKE '%.rst' \
     AND lower(f.path) NOT LIKE '%.adoc' \
     AND lower(f.path) NOT LIKE '%.asciidoc' \
     AND lower(f.path) NOT LIKE '%.org'";

/// Escape LIKE wildcards so a user query is matched literally (paired with
/// `ESCAPE '\'` in the SQL). Without this, `%`/`_` in a query would act as
/// wildcards and `\` would corrupt the pattern.
fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Goal {
    pub id: u32,
    pub project_id: Option<u32>,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i32,
    pub due_date: Option<i32>,
    pub progress: f64,
    pub created_at: u32,
    pub updated_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Subtask {
    pub id: u32,
    pub goal_id: u32,
    pub title: String,
    pub done: bool,
    pub sort_order: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Conversation {
    pub id: u32,
    pub title: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub project_id: Option<u32>,
    pub created_at: u32,
    pub updated_at: u32,
    pub last_message_at: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChatMessage {
    pub id: u32,
    pub conversation_id: u32,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DashboardStats {
    pub total: u32,
    pub open: u32,
    pub in_progress: u32,
    pub done: u32,
    pub cancelled: u32,
    pub overdue: u32,
    pub due_today: u32,
    pub avg_progress: f64,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyNode {
    pub file_id: u32,
    pub path: String,
    pub language: Option<String>,
    pub size: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyEdge {
    pub source_file_id: u32,
    pub target_file_id: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DependencyGraph {
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
}

// Code graph (PR-GR1) — multi-relation, file + symbol level. Returned by
// `get_code_graph`; built by `rebuild_code_graph`. See docs/graph-upgrade/.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GraphNodeDto {
    pub id: u32,
    pub kind: String, // "file" | "symbol"
    pub label: String,
    pub sub_kind: Option<String>,
    pub language: Option<String>,
    pub file_id: u32,
    pub file_path: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct GraphEdgeDto {
    pub id: u32,
    pub edge_type: String, // imports | contains | calls | inherits | implements | similar_to
    pub source: u32,
    pub target: u32,
    pub weight: f32,
    pub direction: String,
    pub estimated: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct CodeGraph {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
}

// Change-impact (PR-GR4) — reverse-dependency BFS from a set of changed files.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ImpactNode {
    pub file_id: u32,
    pub path: String,
    pub depth: u32, // hops from the nearest changed file (1 = direct importer)
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ImpactReport {
    /// Changed paths that were found in the index (subset of the input).
    pub changed: Vec<String>,
    /// Files that (transitively) import a changed file, nearest first.
    pub affected: Vec<ImpactNode>,
}

// Symbol-level call (PR-GR3) — "which function calls/uses which".
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SymbolCall {
    /// Caller symbol in this file (None = file top-level).
    pub from_symbol: Option<String>,
    pub kind: String, // calls | inherits | implements
    pub callee: String,
    /// Resolved defining file path (None = external / unresolved).
    pub target_path: Option<String>,
    pub estimated: bool,
}

/// PR6.6 — `file_snapshots` row. `content` is raw bytes (1.0 ships
/// uncompressed; zstd is a 1.1 candidate). Not exported via specta because no
/// Tauri command returns it directly — `compute_diff` only consumes it
/// internally to produce a unified-diff string.
#[derive(Debug, Clone)]
pub struct FileSnapshot {
    pub id: u32,
    pub project_id: u32,
    pub path: String,
    pub content: Vec<u8>,
    pub hash: String,
    pub captured_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FileChange {
    pub id: u32,
    pub project_id: u32,
    pub file_path: String,
    pub change_type: String,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
    pub detected_at: u32,
    pub summary: Option<String>,
}

// (G3 Clarify/EditPrompt 타입은 감사 2026-07-16 에서 커맨드와 함께 은퇴.)

// ---------- UI-5: ConversationAction (W5) ----------

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ConversationAction {
    pub id: u32,
    pub conversation_id: u32,
    pub message_index: u32,
    pub status: String,
    pub applied_at: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ProjectOverview {
    pub project_id: u32,
    pub identity: Option<String>,
    /// JSON-encoded stack metadata. Stored as TEXT for forward compatibility
    /// (the LLM is free to add new keys without a migration).
    pub stack_json: Option<String>,
    pub overview_md: Option<String>,
    pub source_signature: Option<String>,
    pub generated_at: Option<u32>,
    pub generated_by_model: Option<String>,
}

/// F4 — one cached retrospective for a workday range. `signature` is a hash of
/// the deterministic signals; when it diverges from the current signals the
/// frontend marks the cached narrative stale. Mirrors `project_overviews`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct RetroInsight {
    pub project_id: u32,
    /// "YYYYMMDD..YYYYMMDD" (inclusive workday range).
    pub range_key: String,
    pub signature: String,
    pub retro_md: String,
    pub generated_at: u32,
    pub generated_by_model: Option<String>,
}

// ---------- G4: Greenfield Blueprint (W6) ----------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ProjectBlueprint {
    pub id: u32,
    pub name: String,
    pub idea_text: Option<String>,
    pub target_users: Option<String>,
    pub stack_choice: Option<String>,
    pub folder_name: Option<String>,
    pub folder_path: Option<String>,
    pub seed_goals_json: Option<String>,
    pub wizard_step: u32,
    pub created_at: u32,
    pub updated_at: u32,
}

#[cfg(test)]
mod tests;
