-- 지운 프로젝트의 파생 캐시 걷기 (2026-10-04).
--
-- `.oculpm/` 캐시 표들은 `projects` 에 FK 가 없어, 프로젝트를 지워도 행이 남았다
-- (설치본 실측: 지운 프로젝트 7개의 일지 482건·플랜 항목 1,175건 등 약 1만 행).
-- 이제 `Db::delete_project` 가 같은 트랜잭션에서 지우고, 이 파일은 그 전에 남은
-- 고아를 한 번 걷는다. 전부 디스크에서 다시 만드는 캐시라 잃는 것은 없다 — 같은
-- 폴더를 다시 추가하면 새 id 로 다시 색인된다 (id 는 AUTOINCREMENT 라 재사용되지 않는다).
--
-- 표 목록은 `db::PROJECT_CACHE_TABLES` 와 같다.
DELETE FROM oculpm_agent_state WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_discussion_attachments WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_discussion_log WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_discussions WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_journal WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_journal_files WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_journal_tags WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_plan_decisions WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_plan_item_updates WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_plan_items WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_plans WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_sessions_cache WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM oculpm_settings WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM recall_stats WHERE project_id NOT IN (SELECT id FROM projects);
