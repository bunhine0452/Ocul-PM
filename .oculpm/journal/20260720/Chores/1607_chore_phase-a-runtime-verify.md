---
schema_version: 1
type: chore
slug: phase-a-runtime-verify
status: done
difficulty: low
created_at: "2026-07-20T16:07:05+09:00"
session_id: "20260720-008"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: true
files_touched:
  - path: .oculpm/config.toml
    op: update
  - path: .gitignore
    op: update
related:
  - 20260720/Features_to_add/1411_feature_claude-hooks-bridge.md
  - 20260720/Features_to_add/1449_feature_oculpm-mcp-server.md
tags: ["claude-integration", "runtime-verify", "PR-CI0", "PR-CI2", "dogfooding"]
---

[x] Phase A 실기기 확인 — 훅 브리지·MCP 서버 실앱 동작 검증

사용자가 설정 → Agents 에서 훅 연동 "켜기" + MCP 서버 "등록" 을 실행한 뒤, 실제 Claude
Code 세션으로 전 경로를 검증했다.

## 검증

**PR-CI0 훅 브리지 — 통과.** 설치 결과 `.claude/settings.local.json` 에 3 이벤트 훅이
들어가고 **기존 사용자 `permissions.allow` 100여 항목이 그대로 보존**됨 (설치기의 핵심
계약이 실데이터로 확인). 실세션 1회 →
- 인박스에 SessionStart/Stop/SessionEnd 3건 적재 (동일 claude session id)
- 앱 로그에 `[FLOW] claude hook event` 3건 소비
- `sessions.json`: `20260720-008 | agent_label_guess=claude-code | ended_reason=agent_exit`
  → **실측 라벨 + 정밀 종료**, 세션 중복 0·유령 0. (같은 방식으로 PySpace 에서도 발화 확인.)

**PR-CI2 MCP 서버 — 통과.** 앱 UI 가 쓴 `.mcp.json`(stdio + `--root`)으로 실제 Claude
세션이 `plan_status` 호출 → 라이브 플랜 응답 `claude-integration — 4/14 done`. 즉 앱이
등록한 설정이 그대로 사용 가능함을 확인 (도구 3종 왕복 자체는 PR-CI2 헤드리스 E2E 에서
이미 검증).

**미검증(잔여)**: PR-CI1 일지 자동 초안 — 토글 off 상태로 확인해 미발동(설계대로).
Claude Desktop 실연결. 둘 다 플래너에 남김.

## 메모

- `.mcp.json` 은 이 레포에서 **gitignore** 로 결정: 서버 바이너리 경로가 머신 전용이라
  공유 시 팀원에게 깨진 설정이 된다 (설정 UI 가 이미 고지 중). PR-CI8 플러그인 패키징이
  경로 문제를 해소하면 재검토.
- config.toml 의 `active` 에 `claude-code` 추가는 사용자의 어댑터 활성 조작 결과.
- 세션 004~007 의 `crash_recovered` 는 오늘 dev 재시작(Ctrl+C) 반복의 흔적 — 정상.
