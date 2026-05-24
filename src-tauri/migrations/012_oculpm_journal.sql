-- W3-PR2: .oculpm/journal/ SQLite cache + per-project oculpm_settings.
--
-- See docs/major_update/oculpm/01-backend.md §9 (SSOT for column shape) and
-- docs/major_update/oculpm/W3/PR2-cache-sqlite.md.
--
-- These tables are a **lossy cache** over the on-disk journal. They can be
-- dropped wholesale and rebuilt via oculpm_reindex_cache; no user data is
-- ever lost. Inserts must always be in lockstep with disk writes via
-- JournalCache::apply_path_change / reindex_*.

CREATE TABLE IF NOT EXISTS oculpm_journal (
    project_id        INTEGER NOT NULL,
    relative_path     TEXT    NOT NULL,                -- "20260524/Bugs/0925_bug_x.md"
    workday           TEXT    NOT NULL,                -- "20260524"
    type              TEXT    NOT NULL,                -- bug | feature | error | refactor | chore
    slug              TEXT    NOT NULL,
    status            TEXT    NOT NULL,                -- planned | in_progress | done | abandoned
    difficulty        TEXT,                            -- verylow | low | medium | high | superhigh
    title             TEXT    NOT NULL,
    checkbox          INTEGER,                         -- NULL / 0 / 1 — body first-line marker
    session_id        TEXT    NOT NULL,
    agent_id          TEXT    NOT NULL,
    language          TEXT    NOT NULL,
    verified_by_user  INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL,                -- RFC3339 from frontmatter
    updated_at        TEXT,
    file_mtime        INTEGER NOT NULL,                -- unix seconds — drives incremental reindex
    body_markdown     TEXT    NOT NULL,
    body_md_hash      TEXT    NOT NULL,                -- blake3 hex — short-circuit mtime-only updates
    parse_ok          INTEGER NOT NULL DEFAULT 1,      -- 0 when frontmatter is unparseable
    parse_warnings    TEXT,                            -- JSON array of strings; NULL = no warnings
    PRIMARY KEY (project_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_journal_workday
    ON oculpm_journal(project_id, workday);
CREATE INDEX IF NOT EXISTS idx_oculpm_journal_session
    ON oculpm_journal(project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_oculpm_journal_type
    ON oculpm_journal(project_id, type);

CREATE TABLE IF NOT EXISTS oculpm_journal_files (
    project_id    INTEGER NOT NULL,
    relative_path TEXT    NOT NULL,
    file_path     TEXT    NOT NULL,                    -- frontmatter files_touched[].path
    op            TEXT    NOT NULL,                    -- create | update | delete | rename | correct
    bytes_added   INTEGER,
    bytes_removed INTEGER,
    PRIMARY KEY (project_id, relative_path, file_path)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_journal_files_lookup
    ON oculpm_journal_files(project_id, relative_path);

CREATE TABLE IF NOT EXISTS oculpm_journal_tags (
    project_id    INTEGER NOT NULL,
    relative_path TEXT    NOT NULL,
    tag           TEXT    NOT NULL,
    PRIMARY KEY (project_id, relative_path, tag)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_journal_tags_lookup
    ON oculpm_journal_tags(project_id, relative_path);
CREATE INDEX IF NOT EXISTS idx_oculpm_journal_tags_search
    ON oculpm_journal_tags(project_id, tag);

CREATE TABLE IF NOT EXISTS oculpm_sessions_cache (
    project_id        INTEGER NOT NULL,
    session_id        TEXT    NOT NULL,                -- "YYYYMMDD-NNN"
    workday           TEXT    NOT NULL,
    started_at        TEXT    NOT NULL,
    ended_at          TEXT,
    ended_reason      TEXT,
    file_event_count  INTEGER NOT NULL DEFAULT 0,
    files_unique      INTEGER NOT NULL DEFAULT 0,
    agent_label_guess TEXT,
    PRIMARY KEY (project_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_sessions_cache_workday
    ON oculpm_sessions_cache(project_id, workday);

CREATE TABLE IF NOT EXISTS oculpm_settings (
    project_id   INTEGER PRIMARY KEY,
    config_toml  TEXT    NOT NULL,                     -- round-tripped raw TOML
    initialized  INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT    NOT NULL
);
