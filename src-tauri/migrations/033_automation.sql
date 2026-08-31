-- Osaurus 벤치마크 라운드 Phase 0 — 자동화 런타임 상태
-- (docs/20260831_osaurus-bench/01-automation.md §0.4, Decision 1).
--
-- **정의는 여기 없다.** 스케줄·워처 정의는 `.oculpm/automation/{schedules,
-- watchers}/<id>.md` 가 SSOT 이고(사람이 읽고 고치고 git 에 올리는 사용자
-- 콘텐츠), 이 두 테이블은 파생 런타임 상태만 담는다 — 통째로 비워도 정의
-- 파일에서 재생성된다. 정의 파일이 사라지면 상태 행도 지운다
-- (`Db::automation_prune_orphans`, `oculpm_init` 에서 호출).
--
-- 마이그레이션 번호는 계획 시점 예약분이다 (master-plan R6):
-- 033=automation(P0) · 034=project_theme(P4) · 035=context_recall(P5).

CREATE TABLE IF NOT EXISTS automation_state (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 정의 파일의 `id` (= 파일 stem). 정의가 SSOT 이므로 외래키가 아니라 문자열.
  automation_id TEXT    NOT NULL,
  -- ISO8601. 스케줄만 채운다 (워처는 시계가 아니라 정착에 반응한다).
  next_run_at   TEXT,
  last_run_at   TEXT,
  -- ok | failed | skipped | dropped | cancelled
  last_status   TEXT,
  last_error    TEXT,
  PRIMARY KEY (project_id, automation_id)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  automation_id TEXT    NOT NULL,
  -- `sched-YYYYMMDD-HHMMSS` / `auto-YYYYMMDD-HHMMSS` (Decision 8 — 접두형).
  -- 접미형 `<workday>-sNN` 은 SessionKind::Unknown 으로 떨어져 쓰지 않는다.
  session_id    TEXT    NOT NULL,
  started_at    TEXT    NOT NULL,
  ended_at      TEXT,
  -- 드롭·스킵도 행으로 남는다: "강등하되 소실 없음" — 안 돈 이유를 모르는 것이
  -- 자동화 디버깅에서 가장 나쁜 상태다.
  status        TEXT    NOT NULL,
  journal_path  TEXT,
  note          TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_lookup
  ON automation_runs(project_id, automation_id, started_at DESC);
