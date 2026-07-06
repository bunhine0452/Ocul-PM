-- v2 U11 (docs/20260706_v2/03-performance-spec.md §3) — 텍스트 검색 FTS5 인덱스.
--
-- `search_text` 의 `content LIKE '%…%'` 는 인덱스를 못 타는 풀스캔이라 청크가
-- 수만 행이 되면 검색이 선형으로 느려진다. external-content FTS5 로 교체한다.
--
-- 토크나이저 = trigram (SQLite 3.34+, 번들 3.50): 기존 LIKE 와 동일한
-- **substring 의미**를 보존한다 (unicode61 은 토큰-prefix 매치라
-- `fallback` 으로 `parseFallbacks` 를 못 찾는 회귀가 생김). 3자 미만 쿼리는
-- trigram 이 매치할 수 없으므로 Rust 쪽이 LIKE 로 폴백한다.
--
-- 심볼 검색(symbol_definitions.name)은 의도적으로 LIKE 유지 — 행 수가 작아
-- 스캔이 싸고, substring 의미가 필수라 이득이 없다.

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id',
  tokenize='trigram'
);

-- external-content 테이블은 원본과 자동 동기화되지 않는다 — 트리거 3종으로
-- 인덱서의 insert/delete/update 경로를 그대로 따라간다 (Rust 변경 불필요).
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE OF content ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO chunk_fts(rowid, content) VALUES (new.id, new.content);
END;

-- 기존 인덱스 백필 (신규 DB 에선 no-op).
INSERT INTO chunk_fts(rowid, content) SELECT id, content FROM chunks;
