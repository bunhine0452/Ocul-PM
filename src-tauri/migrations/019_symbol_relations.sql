-- Migration 019: raw code relations (PR-GR2). One row per distinct
-- (callee/parent) reference found in a file by tree-sitter. Unresolved — the
-- graph builder (rebuild_code_graph) resolves `name` to a defining file and
-- emits file→file `calls`/`inherits`/`implements` edges into graph_edges.
-- Kept separate from symbol_definitions/file_dependencies so the deterministic
-- rebuild has a stable source to resolve from.
CREATE TABLE IF NOT EXISTS symbol_relations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,   -- 'calls' | 'inherits' | 'implements'
  name    TEXT NOT NULL    -- callee / parent identifier (unresolved)
);
CREATE INDEX IF NOT EXISTS idx_symbol_relations_file ON symbol_relations(file_id);
CREATE INDEX IF NOT EXISTS idx_symbol_relations_name ON symbol_relations(name);
