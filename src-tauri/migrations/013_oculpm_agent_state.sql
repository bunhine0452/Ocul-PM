-- W4-PR4: per-adapter last-write hash for drift detection.
--
-- See docs/major_update/oculpm/W4/PR4-adapter-drift.md §1 (SSOT) and
-- docs/major_update/oculpm/phases/W4-agents-dual-layer.md §1 W4-PR4.
--
-- `agents::sync_active` upserts (project_id, agent_id, last_hash,
-- last_written_at) after every successful write. The watcher then compares
-- the *current* on-disk hash of an adapter marker file against `last_hash`
-- and emits `OculpmAgentDrift` when they differ.
--
-- For ManagedBlock-mode adapters (Claude Code, Gemini) the hash is computed
-- over the inner block content only — edits outside the markers are not
-- considered drift (the file is shared with the user).

CREATE TABLE IF NOT EXISTS oculpm_agent_state (
    project_id      INTEGER NOT NULL,
    agent_id        TEXT    NOT NULL,
    last_hash       TEXT    NOT NULL,        -- blake3 hex of the bytes we owned
    last_written_at INTEGER NOT NULL,        -- unix seconds
    PRIMARY KEY (project_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_agent_state_project
    ON oculpm_agent_state(project_id);
