-- AD-1: 발동 원장 (docs/agent-discipline/00-master-plan.md D1).
--
-- Claude Code transcript(JSONL)에서 관측한 "실제로 걸린 것"의 파생 캐시다.
-- SSOT 는 여전히 transcript — 통째로 비워도 재스캔으로 복구되며, 여기에만
-- 있는 사용자 데이터는 없다 (retro_insights 와 같은 lossy 캐시 규율).
--
-- 행 단위를 (규칙|스킬, workday, 세션파일)로 잡은 이유: 세션 수를 정확히
-- 세려면 distinct 세션이 필요한데, 증분 스캔(파일 뒤에 append)에서 집계행
-- 하나에 누적하면 세션 수를 되돌릴 수 없다. 파일별로 쪼개면 같은 파일을 다시
-- 스캔해도 UPSERT 가 멱등하다.

CREATE TABLE IF NOT EXISTS context_firings (
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'rule'(규칙 조건부 주입) | 'skill'(Skill 도구 발동)
  kind         TEXT    NOT NULL,
  -- 규칙 = 파일 절대경로 · 스킬 = 스킬 이름(`oculpm:oculpm-journal` 형태 포함)
  key          TEXT    NOT NULL,
  -- 로컬 캘린더 YYYYMMDD (home.rs workday_key 와 같은 규약)
  workday      TEXT    NOT NULL,
  -- transcript 파일 식별자 `<프로젝트슬러그>/<session>.jsonl`
  session_file TEXT    NOT NULL,
  count        INTEGER NOT NULL,
  -- 규칙 주입 바이트(컨텍스트 예산). 스킬은 0.
  bytes        INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind, key, workday, session_file)
);

CREATE INDEX IF NOT EXISTS idx_context_firings_window
  ON context_firings(project_id, workday);

-- 증분 스캔 재개점. transcript 는 append-only 라 바이트 오프셋이면 충분하다
-- (claude_hooks 인박스와 같은 규약). 파일이 줄었으면 회전으로 보고 0 부터.
CREATE TABLE IF NOT EXISTS context_firing_scan (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_file   TEXT    NOT NULL,
  bytes_consumed INTEGER NOT NULL,
  scanned_at     INTEGER NOT NULL,
  PRIMARY KEY (project_id, session_file)
);
