-- 041: 같은 파일 · 같은 범위 · 같은 내용의 청크/심볼 사본 걷기 (2026-10-10,
-- perf-security-audit-2026-10-08 {#idx-low-value}).
--
-- 워처의 증분 색인(`indexer::reindex_single_file`)이 `upsert_file` 의 `changed=false`
-- 를 무시하고 청크·심볼을 또 넣었다. 같은 파일의 증분 둘이 겹치면(퍼밋 2개 · 해시
-- 없는 이벤트) 뒤의 것이 지우지 않고 덧붙였다. 설치본 실측: 청크 112,027 중
-- 19,987(17.8%) · 심볼 39,999 중 7,595(19%)가 그런 사본이었고, 하루에 천 행 넘게
-- 늘고 있었다. 원인은 Rust 에서 막았다(해시가 그대로면 아무것도 안 함 + 교체는 해시
-- CAS 한 트랜잭션). 이미 들어간 행은 파일이 다시 바뀔 때까지 스스로 나가지 않는다.
--
-- 각 묶음에서 id 가 가장 작은 행 하나만 남긴다 — 남는 행은 지워지지 않으므로 지우는
-- 순서와 무관하다. 청크를 지우면 `chunks_after_delete` 트리거가 vec0 벡터를,
-- 심볼을 지우면 FK CASCADE 가 `graph_nodes` 를 함께 지운다 (그래프는 다음 색인 때
-- 다시 짓는다). 실측 DB 사본에서 판정 쿼리는 0.5초였다.
DELETE FROM chunks
 WHERE EXISTS (SELECT 1 FROM chunks d
                WHERE d.file_id = chunks.file_id
                  AND d.id < chunks.id
                  AND d.start_line = chunks.start_line
                  AND d.end_line = chunks.end_line
                  AND d.kind = chunks.kind
                  AND d.content = chunks.content);

DELETE FROM symbol_definitions
 WHERE EXISTS (SELECT 1 FROM symbol_definitions t
                WHERE t.file_id = symbol_definitions.file_id
                  AND t.id < symbol_definitions.id
                  AND t.name = symbol_definitions.name
                  AND t.kind = symbol_definitions.kind
                  AND t.start_line = symbol_definitions.start_line
                  AND t.end_line = symbol_definitions.end_line
                  AND t.start_byte = symbol_definitions.start_byte
                  AND t.end_byte = symbol_definitions.end_byte);
