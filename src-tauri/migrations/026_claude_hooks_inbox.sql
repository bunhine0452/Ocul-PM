-- PR-CI0 (docs/claude-integration/00-master-plan.md D1) — Claude Code 훅
-- 인박스(.oculpm/hooks/claude-events.jsonl)의 소비 오프셋.
--
-- 인박스는 훅 프로세스가 append-only 로 쓰고 앱은 절대 truncate 하지 않는다
-- (동시 append 와의 경합 방지). 대신 어디까지 소비했는지를 여기 영속해
-- 앱 재시작 후에도 이어서 소비한다. 키는 프로젝트 절대경로 — projects 행이
-- 재생성돼도 안정적이다.
CREATE TABLE IF NOT EXISTS claude_hooks_inbox (
    root           TEXT PRIMARY KEY,
    consumed_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER
);
