-- F4: 회고/인사이트 캐시.
-- 기간(워크데이 범위)별로 LLM이 작성한 한국어 회고를 보존한다. 같은 기간이라도
-- 그 기간의 결정적 신호(출시/저항/노력 집중/에이전트 기여)가 바뀌면 signature 가
-- 달라지므로, 프런트는 cached.signature != 현재 signals.signature 일 때 "오래됨"
-- 배지를 띄우고 재생성을 권한다. project_overviews 패턴과 동일한 lossy 캐시 —
-- 통째로 비워도 재생성으로 복구되며 사용자 데이터는 SSOT(.oculpm)에 없다.

CREATE TABLE IF NOT EXISTS retro_insights (
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 워크데이 범위 키 "YYYYMMDD..YYYYMMDD" (포함 양끝)
  range_key           TEXT    NOT NULL,
  -- 결정적 신호 해시 (blake3 hex) — 변하면 회고가 오래됨
  signature           TEXT    NOT NULL,
  -- 한국어 마크다운 회고 본문
  retro_md            TEXT    NOT NULL,
  generated_at        INTEGER NOT NULL,
  generated_by_model  TEXT,
  PRIMARY KEY (project_id, range_key)
);
