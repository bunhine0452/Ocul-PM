-- Code chunks (text content + line range, references files)
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'lines',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);

-- Vector store for chunk embeddings (sqlite-vec extension).
-- Dimension matches MultilingualE5Small (384). If the embedding model changes,
-- this table must be recreated and chunks re-embedded.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);

-- vec0 is a virtual table and isn't reached by foreign-key cascades,
-- so mirror chunk deletes manually.
CREATE TRIGGER IF NOT EXISTS chunks_after_delete
  AFTER DELETE ON chunks
BEGIN
  DELETE FROM chunk_embeddings WHERE chunk_id = OLD.id;
END;
