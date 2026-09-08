//! 스키마 등록부 — 마이그레이션 목록과 컬럼 복구 그물.
//!
//! `db/mod.rs` 에서 떼어냈다 (파일 크기 게이트). 자리를 옮기는 김에 세운 경계
//! 이기도 하다: 이 두 표는 **선언**이고 나머지 `mod.rs` 는 그것을 실행하는
//! 코드다. 표 하나를 늘리는 일이 러너 코드를 스크롤해 지나가야 하는 일이 아니게
//! 됐다.
//!
//! 두 표는 짝이다. 새 `ADD COLUMN` 마이그레이션은 **양쪽에** 적는다 —
//! `every_added_column_is_declared_for_healing` 이 누락을 막고,
//! `migration_registry_matches_disk` 가 파일명↔번호를 대조한다.

pub(super) const MIGRATIONS: &[(i64, &str)] = &[
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
    (34, include_str!("../../migrations/034_project_theme.sql")),
    (35, include_str!("../../migrations/035_context_recall.sql")),
    (36, include_str!("../../migrations/036_firing_quotes.sql")),
    (
        37,
        include_str!("../../migrations/037_oculpm_agent_session.sql"),
    ),
    (
        38,
        include_str!("../../migrations/038_drop_retro_insights.sql"),
    ),
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
pub(super) const ADDITIVE_COLUMNS: &[(&str, &str, &str)] = &[
    (
        "file_changes",
        "entry_id",
        "INTEGER REFERENCES changelog_entries(id) ON DELETE SET NULL",
    ),
    ("symbol_relations", "from_symbol", "TEXT"),
    ("oculpm_journal", "agent_version", "TEXT"),
    ("oculpm_journal", "agent_session", "TEXT"),
    (
        "oculpm_journal",
        "coercion_version",
        "INTEGER NOT NULL DEFAULT 0",
    ),
    ("projects", "icon", "TEXT"),
    ("projects", "color", "TEXT"),
    ("oculpm_journal_files", "lines_added", "INTEGER"),
    ("oculpm_journal_files", "lines_removed", "INTEGER"),
    ("projects", "theme_id", "TEXT"),
    ("context_firings", "last_prompt", "TEXT"),
    ("context_firings", "last_ts", "INTEGER NOT NULL DEFAULT 0"),
    ("context_firing_scan", "last_prompt", "TEXT"),
];
