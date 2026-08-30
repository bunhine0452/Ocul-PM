-- 032: chunk_embeddings 에 project_id PARTITION KEY (완성도 라운드 Phase 3, 2026-08-30).
--
-- 의미 검색의 KNN 은 vec0 가 **모든 프로젝트**의 벡터를 훑은 뒤 files.project_id
-- 로 걸렀다 — 프로젝트가 늘수록 검색이 느려지고, 다른 프로젝트가 큰 만큼 5배
-- 과다 조회(k)도 모자랐다. sqlite-vec 의 partition key 는 KNN 을 파티션 안에서만
-- 돈다 (`WHERE embedding MATCH ? AND project_id = ?`).
--
-- vec0 는 ALTER 가 없으므로 임시 표로 옮겼다가 다시 만든다. 임베딩은 **보존**한다
-- (017 처럼 지우면 모든 프로젝트를 다시 색인해야 한다 — 수만 청크에 분 단위).
-- 벡터 컬럼을 SELECT 하면 f32 blob 이 그대로 나오고 INSERT 도 같은 blob 을 받는다.
DROP TRIGGER IF EXISTS chunks_after_delete;

CREATE VIRTUAL TABLE chunk_embeddings_tmp USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
INSERT INTO chunk_embeddings_tmp (chunk_id, embedding)
  SELECT chunk_id, embedding FROM chunk_embeddings;

DROP TABLE chunk_embeddings;

CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  project_id INTEGER PARTITION KEY,
  embedding FLOAT[384]
);
INSERT INTO chunk_embeddings (chunk_id, project_id, embedding)
  SELECT t.chunk_id, f.project_id, t.embedding
  FROM chunk_embeddings_tmp t
  JOIN chunks c ON c.id = t.chunk_id
  JOIN files f ON f.id = c.file_id;

DROP TABLE chunk_embeddings_tmp;

CREATE TRIGGER IF NOT EXISTS chunks_after_delete
  AFTER DELETE ON chunks
BEGIN
  DELETE FROM chunk_embeddings WHERE chunk_id = OLD.id;
END;
