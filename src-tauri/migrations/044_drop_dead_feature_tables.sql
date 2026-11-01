-- 044: 독자를 잃은 표 걷기 (최적화 라운드, 2026-11-01).
--
-- 043 이 코드 색인을 걷은 뒤에도 스키마에는 **코드가 한 줄도 읽고 쓰지 않는** 표가
-- 18개 남아 있었다. 각 표의 마지막 독자·필자를 코드로 확인했다 (grep 0 — 마이그레이션
-- 파일과 `ADDITIVE_COLUMNS` 말고는 이름이 나오지 않는다):
--
--   goals · subtasks                       — 1.x 목표/하위 작업 (화면 없음)
--   conversations · chat_messages ·
--   conversation_actions                   — AI 패널 대화 (2026-10-28 걷음)
--   changelog_entries · changelog_files ·
--   file_changes                           — 옛 SQLite 체인지로그 (`.oculpm/` 이 대체.
--                                            지금의 파일 변경은 `file_changes.ndjson`)
--   project_blueprints                     — 새 프로젝트 마법사 (4.0 걷음)
--   oculpm_discussions · oculpm_discussion_log ·
--   oculpm_discussion_attachments          — 토론 화면 (4.0 걷음)
--   context_firings · context_firing_scan  — 설정 「컨텍스트」 탭 (2026-10-28 걷음).
--                                            설치본 실측 4,965행 · 약 1.9MB 로 이 중 가장 컸다
--   automation_state · automation_runs     — 자동화 (4.0 걷음)
--   recall_stats                           — AI 패널 회상 (2026-10-28 걷음)
--   oculpm_sessions_cache · oculpm_settings — 만들어만 두고 쓰지 않은 캐시
--   oculpm_migrations                      — 쓰인 적 없는 이력 표 (적용 이력은 user_version)
--
-- **남기는 것:** `mobile_devices`(029) 는 CLAUDE.md 가 남기기로 정한 표라 그대로 둔다.
-- `project_overviews` 는 시작 창 집계(`home.rs`)가 아직 읽는다. 사용자의 `.oculpm/`
-- 파일(`discussion/` · `automation/` …)은 건드리지 않는다 — 앱이 읽지 않을 뿐이다.
--
-- 순서: FK 의 자식부터 (foreign_keys=ON 에서 부모를 먼저 지우면 암묵 DELETE 가 자식으로
-- 번진다). 없는 표(새 설치 · 부분 복구)는 `IF EXISTS` 로 지나간다. 지운 자리는 freelist
-- 로 돌아갈 뿐이라 파일은 설정 → 진단의 「DB 정리」(VACUUM)가 줄인다. 이름은 재사용하지
-- 않는다.
DROP TABLE IF EXISTS subtasks;
DROP TABLE IF EXISTS goals;

DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS conversation_actions;
DROP TABLE IF EXISTS conversations;

DROP TABLE IF EXISTS file_changes;
DROP TABLE IF EXISTS changelog_files;
DROP TABLE IF EXISTS changelog_entries;

DROP TABLE IF EXISTS project_blueprints;

DROP TABLE IF EXISTS oculpm_discussion_attachments;
DROP TABLE IF EXISTS oculpm_discussion_log;
DROP TABLE IF EXISTS oculpm_discussions;

DROP TABLE IF EXISTS context_firings;
DROP TABLE IF EXISTS context_firing_scan;

DROP TABLE IF EXISTS automation_runs;
DROP TABLE IF EXISTS automation_state;

DROP TABLE IF EXISTS recall_stats;
DROP TABLE IF EXISTS oculpm_sessions_cache;
DROP TABLE IF EXISTS oculpm_settings;
DROP TABLE IF EXISTS oculpm_migrations;
