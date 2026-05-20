-- Track file changes detected by manual scanning.
-- Each row represents a single detected modification, creation, or deletion.
CREATE TABLE IF NOT EXISTS file_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','modified','deleted')),
  old_hash TEXT,
  new_hash TEXT,
  detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_changes_project_date
  ON file_changes(project_id, detected_at);
