-- Migration 005: AST-based dependency graph
-- Store parsed symbol definitions for files
CREATE TABLE IF NOT EXISTS symbol_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL, -- e.g. "function", "class", "struct", "trait", "interface", "type", "method"
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_symbol_definitions_file ON symbol_definitions(file_id);
CREATE INDEX IF NOT EXISTS idx_symbol_definitions_name ON symbol_definitions(name);

-- Store file-to-file dependency edges
CREATE TABLE IF NOT EXISTS file_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE(source_file_id, target_file_id)
);

CREATE INDEX IF NOT EXISTS idx_file_dependencies_project ON file_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_file_dependencies_source ON file_dependencies(source_file_id);
CREATE INDEX IF NOT EXISTS idx_file_dependencies_target ON file_dependencies(target_file_id);
