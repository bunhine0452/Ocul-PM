-- 043: 코드 색인·의미 검색 걷기 (4.0 엔진 덜어내기, 2026-10-29).
--
-- 4.0 은 코드 색인(파일 걷기 · 청크 · 임베딩 · AST 심볼 · import 그래프)과 그 위의
-- 의미 검색 화면을 걷었다. 에이전트는 자기 grep 이 있고, 설치본 실측에서 DB 837MB 중
-- `chunk_embeddings` 232MB · `chunks` 126MB 가 이 색인이었다. 아래 표는 전부 그 색인만
-- 읽고 썼다 (각 표의 마지막 독자·필자를 코드로 확인했다):
--
--   chunks · chunk_embeddings(vec0)  — 의미/텍스트 검색 · 일지 의미검색
--   symbol_definitions                — 심볼 검색
--   file_dependencies                 — 변경 화면의 「영향」 (import 그래프)
--   symbol_relations · graph_nodes · graph_edges — 2026-10-24 코드 맵과 함께 독자를 잃은 채
--                                       남아 있던 것 (files·symbol_definitions 를 FK 로 가리킨다)
--   files                             — 색인의 파일 행 (해시 게이트). diff 기준선
--                                       `file_snapshots` 는 (project_id, path) 로 따로 서서
--                                       이 표를 가리키지 않는다 — 그대로 둔다.
--
-- **남기는 것:** `file_snapshots`(diff 기준선 — 약속 3번), `project_overviews`(시작 탭이
-- 아직 읽는다), 그 밖의 캐시 표 전부. 사용자의 `.oculpm/` 파일은 건드리지 않는다.
--
-- 순서가 있다: FK 의 자식부터 지운다 (foreign_keys=ON 에서 부모를 먼저 지우면 암묵
-- DELETE 가 자식으로 캐스케이드된다). vec0 가상 표는 sqlite-vec 모듈이 로드돼 있어야
-- DROP 되고(그림자 표 `chunk_embeddings_*` 도 모듈이 함께 지운다), 그래서
-- `Db::register_sqlite_vec` 는 이 마이그레이션 때문에 남는다. 이미 없는 표(새 설치 ·
-- 부분 복구)는 `IF EXISTS` 로 지나간다. 032 의 임시 표와 옛 `compact()` 의 재건 표가
-- 중간에 죽어 남았을 수도 있어 함께 걷는다.
--
-- 지운 자리는 freelist 로 돌아갈 뿐 파일은 저절로 줄지 않는다 — 설정 → 진단의
-- 「DB 정리」(VACUUM)가 디스크를 돌려준다. 이름은 재사용하지 않는다.
DROP TRIGGER IF EXISTS chunks_after_delete;

DROP TABLE IF EXISTS chunk_embeddings;
DROP TABLE IF EXISTS chunk_embeddings_tmp;
DROP TABLE IF EXISTS chunk_embeddings_rebuild;

DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
DROP TABLE IF EXISTS symbol_relations;
DROP TABLE IF EXISTS symbol_definitions;
DROP TABLE IF EXISTS file_dependencies;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS files;
