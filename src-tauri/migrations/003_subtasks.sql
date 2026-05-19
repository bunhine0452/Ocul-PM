-- Subtasks: checklist items under goals (M4)
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subtasks_goal ON subtasks(goal_id);
