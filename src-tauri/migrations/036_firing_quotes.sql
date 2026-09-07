-- 발동 순간의 인용 (플랜 skill-invocation-visibility Phase 2 `#firing-quotes`).
--
-- 원장은 여태 "몇 번 걸렸나" 만 셌다. 사용자가 목록 앞에서 묻는 건 "그래서 이게
-- 언제 걸리나" 이고, 거기에 가장 강한 답은 산문 설명이 아니라 **자기 프로젝트에서
-- 실제로 그것을 부른 말**이다. 스캐너는 이미 transcript 를 읽고 있으므로 새로
-- 읽을 것은 없다 — 지나가던 사용자 프롬프트를 붙잡아 두기만 하면 된다.
--
-- 집계 행에 얹는다(별도 표가 아니라). 행 단위가 (kind, key, workday, session_file)
-- 이라 "그날 그 세션에서 마지막으로 이걸 부른 말" 한 줄이 남는다. 하루에 여러 번
-- 부른 경우 중간 것들은 잃지만, 화면이 묻는 것은 "최근 몇 건" 이라 손실이 없다.
--
-- 파생 캐시 규율은 그대로다: 통째로 비워도 재스캔으로 복구되고, transcript 가
-- 여전히 SSOT 다. 다만 인용은 **사용자가 쓴 말**이라 적재 전에 redact 를 태운다.

ALTER TABLE context_firings ADD COLUMN last_prompt TEXT;
ALTER TABLE context_firings ADD COLUMN last_ts INTEGER NOT NULL DEFAULT 0;

-- 증분 스캔의 이월 슬롯. 사용자 프롬프트와 그것이 부른 Skill 호출 사이에 재개점이
-- 놓이면(스캔이 턴 중간에 돌면) 그 발동은 인용을 영원히 잃는다 — 청크 경계 너머로
-- 한 줄만 들고 넘어가면 그 구멍이 닫힌다.
ALTER TABLE context_firing_scan ADD COLUMN last_prompt TEXT;
