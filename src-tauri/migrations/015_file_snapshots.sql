-- PR6.6 (2026-05-31, migration version 15) — file_snapshots for LocalDiffView's non-git / HEAD-less fallback.
-- File numbered 015 to match version 15 (version 10 is occupied by 011_project_blueprints.sql,
-- version 11 was never used). Spec referenced "migration 010"; renumbered during PR6.6.
--
-- Each row stores the *last indexed* content of a single tracked path so the
-- diff command can compare it against the current on-disk content when git
-- cannot serve a baseline (fresh repo with no commits, project not initialised
-- as git, file untracked, etc.).
--
-- 1.0 scope (see master-prompt §5.3 / 05-index-comparison.md §4.2):
--   * Per-path single row (UNIQUE on project_id + path). The 50-LRU policy
--     from the original §0.6 lock is deferred to 1.1; current UX only needs
--     one baseline.
--   * Raw BLOB. zstd compression is deferred to 1.1.
--   * Written by indexer (`index_project` / `reindex_paths`) and the new
--     `resnapshot_paths` command. The watcher is intentionally not modified
--     so invariants #1 and #2 stay untouched.
CREATE TABLE IF NOT EXISTS file_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  hash TEXT NOT NULL,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_snapshots_project
  ON file_snapshots(project_id);
