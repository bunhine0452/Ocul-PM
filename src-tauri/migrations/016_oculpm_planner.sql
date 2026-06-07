-- 016_oculpm_planner.sql — Planner Upgrade (PR-PLN 0)
--
-- SQLite projection (cache) of the file-based Planner SSOT at
-- `.oculpm/planner/<slug>.md`. The markdown is the source of truth; the watcher
-- re-parses on change and rebuilds these rows. Everything here is reconstructible
-- from disk, so a DROP + re-project is always safe.
--
-- See docs/planner-upgrade/01-data-model-and-markdown-spec.md §3.

CREATE TABLE IF NOT EXISTS oculpm_plans (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,            -- frontmatter `id` (stable slug)
    title        TEXT    NOT NULL,
    status       TEXT    NOT NULL,            -- active | done | archived
    owner_agent  TEXT    NOT NULL,
    progress     REAL    NOT NULL DEFAULT 0   -- weighted rollup (0..1)
        CHECK (progress >= 0 AND progress <= 1),
    file_path    TEXT    NOT NULL,            -- .oculpm/planner/<slug>.md
    updated_at   TEXT    NOT NULL,
    PRIMARY KEY (project_id, plan_id)
);

CREATE TABLE IF NOT EXISTS oculpm_plan_items (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    item_id      TEXT    NOT NULL,            -- {#id}
    phase        TEXT,                        -- "Phase A — …" (nullable)
    title        TEXT    NOT NULL,
    status       TEXT    NOT NULL,            -- todo|in_progress|done|blocked|deferred|dropped
    order_idx    INTEGER NOT NULL,
    parent_item  TEXT,                        -- nested subitem (nullable)
    note         TEXT,                        -- ⟶ reason (nullable)
    last_agent   TEXT,                        -- derived from update log (nullable)
    last_update  TEXT,                        -- derived from update log (nullable)
    PRIMARY KEY (project_id, plan_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_plan_items_plan
    ON oculpm_plan_items(project_id, plan_id);

-- Append-only attribution history. Who changed which item, when, from→to.
CREATE TABLE IF NOT EXISTS oculpm_plan_item_updates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    item_id      TEXT    NOT NULL,
    ts           TEXT    NOT NULL,
    agent_id     TEXT    NOT NULL,            -- journal agent_id ∪ inapp:* ∪ user
    from_status  TEXT,
    to_status    TEXT,
    journal_ref  TEXT,                        -- linked journal entry (nullable)
    note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_oculpm_plan_item_updates
    ON oculpm_plan_item_updates(project_id, plan_id, item_id, ts);

CREATE TABLE IF NOT EXISTS oculpm_plan_decisions (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    decision_id  TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    locked_at    TEXT,
    agent_id     TEXT,
    affects      TEXT,                        -- affected item_id CSV
    PRIMARY KEY (project_id, plan_id, decision_id)
);
