-- 045: 하는 일이 없는 색인 셋 걷기 (최적화 라운드, 2026-11-05).
--
-- 셋 다 같은 표의 기본 키 · UNIQUE 제약이 이미 만든 색인의 **앞부분과 똑같다**. SQLite 는
-- (project_id, relative_path) 로 찾는 질의에 기본 키 색인 (project_id, relative_path, …) 을
-- 그대로 쓴다. 그래서 이 셋은 읽기에 쓰이지 않고, 쓰기 때마다 고쳐 쓸 거리만 늘린다.
-- 일지를 다시 읽어 들일 때(`index/` 재구성)는 표 전체를 다시 쓰므로 그 몫이 크다.
-- 설치본 실측(dbstat): 1,708KB + 1,032KB + 약 170KB.
--
--   idx_oculpm_journal_files_lookup (project_id, relative_path)
--       ⊂ PRIMARY KEY (project_id, relative_path, file_path)      — 012
--   idx_oculpm_journal_tags_lookup  (project_id, relative_path)
--       ⊂ PRIMARY KEY (project_id, relative_path, tag)            — 012
--   idx_file_snapshots_project      (project_id)
--       ⊂ UNIQUE (project_id, path)                               — 015
--
-- `idx_oculpm_journal_tags_search (project_id, tag)` 는 태그로 찾는 질의가 쓰므로 남긴다.
-- 이 세 이름은 다시 쓰지 않는다.

DROP INDEX IF EXISTS idx_oculpm_journal_files_lookup;
DROP INDEX IF EXISTS idx_oculpm_journal_tags_lookup;
DROP INDEX IF EXISTS idx_file_snapshots_project;
