-- 024_oculpm_discussion.sql — 문제 해결(Discussion) (PR-DISC 0)
--
-- SQLite projection (cache) of the file-based Discussion SSOT at
-- `.oculpm/discussion/<slug>/discussion.md`. The markdown is the source of
-- truth; the watcher / read commands re-parse on change and rebuild these rows.
-- Everything here is reconstructible from disk, so a DROP + re-project is
-- always safe. Mirrors the planner projection (016).
--
-- See docs/discussion-feature/01-data-model-and-markdown-spec.md §3.

CREATE TABLE IF NOT EXISTS oculpm_discussions (
    project_id          INTEGER NOT NULL,
    discussion_id       TEXT    NOT NULL,        -- frontmatter `id` (= folder slug)
    title               TEXT    NOT NULL,
    status              TEXT    NOT NULL,         -- open | resolved | archived
    owner               TEXT    NOT NULL,         -- first author agent_id
    problem             TEXT,                     -- "## 문제 정의" body (search/preview, redacted)
    tags                TEXT,                     -- CSV (nullable)
    option_count        INTEGER NOT NULL DEFAULT 0,
    next_step_count     INTEGER NOT NULL DEFAULT 0,
    resolution_plan_id  TEXT,                     -- resolution_ref.plan_id (nullable)
    file_path           TEXT    NOT NULL,         -- .oculpm/discussion/<slug>/discussion.md
    created_at          TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    PRIMARY KEY (project_id, discussion_id)
);

-- Append-only discussion log (the "## 토의 / 메모" managed block).
CREATE TABLE IF NOT EXISTS oculpm_discussion_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL,
    discussion_id  TEXT    NOT NULL,
    ts             TEXT    NOT NULL,
    author         TEXT    NOT NULL,              -- user | <agent_id> | (later) inapp:*
    body           TEXT    NOT NULL               -- redacted
);

CREATE INDEX IF NOT EXISTS idx_oculpm_discussion_log
    ON oculpm_discussion_log(project_id, discussion_id, ts);

-- Research attachments sidecar (`<slug>/attachments/*`). Metadata only; the
-- bytes live on disk and are read on demand (discussion_asset, PR-DISC 2).
CREATE TABLE IF NOT EXISTS oculpm_discussion_attachments (
    project_id     INTEGER NOT NULL,
    discussion_id  TEXT    NOT NULL,
    rel_path       TEXT    NOT NULL,              -- attachments/<file>
    kind           TEXT    NOT NULL,              -- image | doc | other
    bytes          INTEGER,
    added_at       TEXT    NOT NULL,
    PRIMARY KEY (project_id, discussion_id, rel_path)
);
