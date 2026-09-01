-- 회상 관련도 통계 (Osaurus 라운드 Phase 5 `#recall-decay`).
--
-- 무엇에 쓰나: 회상 예산(≤800토큰)을 넘는 후보가 있을 때 **무엇을 먼저 담을지**
-- 를 정한다. "쓰이지 않는 사실은 흐려진다" 는 Osaurus 의 규칙을 그대로 옮긴다.
--
-- **파생 캐시다.** 이 표를 통째로 비워도 기능은 유지된다 — 점수가 없으면 균등
-- 점수로 되돌아갈 뿐이다. `.oculpm` 온디스크가 SSOT 라는 원칙은 불변이고,
-- 여기에는 사용자 콘텐츠가 들어가지 않는다 (경로와 숫자뿐).
--
-- 감쇠는 배경 작업이 아니라 **읽을 때 계산**한다 (`effective_score`):
-- 저장된 score 는 last_used 시점의 값이고, 지금 값은 반감기 30일로 깎아 낸다.
-- 스케줄러를 하나 더 만들지 않으려는 선택이고, 결과는 같으며 결정적이다.
CREATE TABLE IF NOT EXISTS recall_stats (
  project_id INTEGER NOT NULL,
  -- journal | plan | rule | skill
  kind       TEXT    NOT NULL,
  -- 경로 또는 id (`*` = 그 종류 전체를 가리키는 집합 항목)
  ref        TEXT    NOT NULL,
  -- 0..1, last_used 시점의 값
  score      REAL    NOT NULL,
  use_count  INTEGER NOT NULL DEFAULT 0,
  -- ISO8601 UTC. NULL 이면 한 번도 안 쓰인 것.
  last_used  TEXT,
  PRIMARY KEY (project_id, kind, ref)
);

CREATE INDEX IF NOT EXISTS idx_recall_stats_project ON recall_stats(project_id, score DESC);
