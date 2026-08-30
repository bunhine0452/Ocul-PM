-- 개선점 감사 라운드 (2026-08-30, .oculpm/planner/improvement-audit-round.md
-- #indexer-gitignore · #chunker-dedupe) — 색인 소음 한 번 걷어내기.
--
-- 인덱서가 두 가지로 오염돼 있었다: (1) `.git` 없는 프로젝트에서 `.gitignore` 가
-- 무시돼 node_modules 가 통째로 들어왔고 (2) AST 청커가 한 줄에 심볼 N개면 그
-- 줄을 N번 복제해 minified 파일 하나가 청크 104MB 가 됐다. 규칙은 Rust 에서
-- 고쳤지만 색인은 blake3 해시 게이트라 이미 들어간 행은 스스로 나가지 않는다.
--
-- `files` 삭제는 FK CASCADE + `chunks_after_delete` 트리거로 chunks · embeddings ·
-- symbol_definitions · symbol_relations · file_dependencies 까지 따라 내려간다
-- (foreign_keys 는 open() 에서 마이그레이션 전에 ON). 지운 파일 중 정당한 것은
-- 다음 색인·워처 변경에서 새 규칙으로 다시 들어온다.
--
-- 64KB: 새 청커 상한(16KB) 을 크게 넘는 병리적 행만 지운다. 16~64KB 의 정상 거대
-- 심볼은 파일이 다음에 바뀔 때 워처가 다시 쪼갠다 — 지금 지우면 그때까지 그
-- 파일의 검색 결과가 비니까.
DELETE FROM files
 WHERE id IN (SELECT DISTINCT file_id FROM chunks WHERE LENGTH(content) > 65536);

-- 벤더·캐시 디렉터리 — 걷기의 DENY_DIR_NAMES 와 같은 이름들. 경로는 프로젝트
-- 루트 기준 상대경로라 맨 앞 또는 `/` 뒤에 온다.
DELETE FROM files
 WHERE path LIKE 'node_modules/%' OR path LIKE '%/node_modules/%'
    OR path LIKE '.venv/%'        OR path LIKE '%/.venv/%'
    OR path LIKE 'target/%'       OR path LIKE '%/target/%'
    OR path LIKE '__pycache__/%'  OR path LIKE '%/__pycache__/%';

-- diff 기준선 스냅샷도 같은 경로를 들고 있다 (project_id, path 로 별도 표).
DELETE FROM file_snapshots
 WHERE path LIKE 'node_modules/%' OR path LIKE '%/node_modules/%'
    OR path LIKE '.venv/%'        OR path LIKE '%/.venv/%'
    OR path LIKE 'target/%'       OR path LIKE '%/target/%'
    OR path LIKE '__pycache__/%'  OR path LIKE '%/__pycache__/%';
