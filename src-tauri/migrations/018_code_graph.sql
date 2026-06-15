-- Migration 018: code graph (multi-relation, file + symbol level).
-- docs/graph-upgrade/01-data-model-and-schema.md. graph_nodes/graph_edges are
-- a full rebuild from files / symbol_definitions / file_dependencies, run at the
-- end of each index (graph::rebuild_code_graph). file_dependencies stays as-is
-- so get_dependency_graph keeps its exact output (backward compat, D-E).
--
-- PR-GR1 fills `contains` (file→symbol) + `imports` (file→file). calls/inherits
-- (PR-GR2) and similar_to (PR-GR3) reuse the same tables. summary/layer columns
-- are the optional LLM semantic overlay (PR-GR3); NULL = not generated.

CREATE TABLE IF NOT EXISTS graph_nodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  kind        TEXT NOT NULL,            -- 'file' | 'symbol'
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id   INTEGER REFERENCES symbol_definitions(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  sub_kind    TEXT,                     -- symbol kind (function/class/struct/…)
  language    TEXT,
  start_line  INTEGER,
  end_line    INTEGER,
  summary     TEXT,                     -- LLM 의미층 캐시 (PR-GR3). NULL = 미생성
  layer       TEXT,
  enriched_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_project ON graph_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(file_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  edge_type   TEXT NOT NULL,            -- imports|contains|calls|inherits|implements|similar_to
  source_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  weight      REAL NOT NULL DEFAULT 1.0,
  direction   TEXT NOT NULL DEFAULT 'forward',
  estimated   INTEGER NOT NULL DEFAULT 0,  -- 1 = 이름매칭 추정(calls, PR-GR2)
  UNIQUE(project_id, edge_type, source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_project ON graph_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
