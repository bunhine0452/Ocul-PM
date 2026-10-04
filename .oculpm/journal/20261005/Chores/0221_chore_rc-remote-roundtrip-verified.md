---
schema_version: 1
type: chore
slug: "rc-remote-roundtrip-verified"
status: done
difficulty: low
created_at: "2026-10-05T02:21:20+09:00"
session_id: "20261005-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20261005_native-agent-drivers/00-master-plan.md"
    op: update
related:
  - ref: "20261005/Chores/0215_chore_native-agent-drivers-decisions-plan.md"
    kind: "followup"
tags:
  - "acp"
  - "claude-code"
  - "research"
  - "mcp-tool"
---
[x] 헤드리스 claude 의 /rc 원격 왕복 검증 — 폰 발화가 턴으로 돈다, 본문은 stdout 에 없고 트랜스크립트에

## 무엇을 했나

커밋된 재현 스크립트(`docs/20261005_native-agent-drivers/spike/claude_remote_control_spike.py`)를 10분 창으로 띄우고, 사용자가 폰에서 세션 URL 을 열어 "안녕" 을 보냈다. 앞선 두 창(5분·15분)은 원격 입력이 없어 미검증이던 R7.

## 결과 — 된다

- 17.85s `command_lifecycle` queued → started → `system/init` → `assistant`("안녕하세요! …") → `rate_limit_event` → `system/post_turn_summary` → `result/success`(end_turn) → `command_lifecycle` completed.
- **CLI 가 원격 턴을 스스로 돌리고 결과만 흘린다.** 클라이언트에게 처리를 넘기지 않는다 → 드라이버는 "내가 보내지 않은 턴" 을 그려야 한다.
- **원격 발화 본문은 stdout 에 없다** (`type:"user"` 0건). 트랜스크립트 `~/.claude/projects/<cwd>/<session>.jsonl` 에 `origin:{kind:"human"}` · `entrypoint:"sdk-cli"` 로 남는다 → 기존 트랜스크립트 리더로 채운다.
- 덤: `rate_limit_event{rate_limit_info.unifiedWindows.five_hour/seven_day}` — ACP `_meta._claude/rateLimit` 대체재.

## 문서 반영

§2.2 표(왕복 · 원격 발화 본문 · 사용량 3행), §0 요약, D4 에 "원격에서 시작된 턴" 절, P3 완료 조건, R7 → 검증됨(남은 것: 본문 stdout 부재 · 원격 턴의 권한 요청 경로 미확인).

## 검증

- events.log: command_lifecycle 3상태 · assistant · result/success 확인. 트랜스크립트에서 USER '안녕' origin human 확인.
- 원격 턴 1회 비용 표시 total_cost_usd 0.24(구독 — 캐시 생성 29,776 토큰).