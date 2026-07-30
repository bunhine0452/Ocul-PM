---
schema_version: 1
type: feature
slug: "greenfield-inception-kickoff"
status: done
difficulty: low
created_at: "2026-07-31T02:54:25+09:00"
session_id: "mcp-20260731-025425"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
related: []
tags:
  - "greenfield"
  - "inception"
  - "dispatch"
  - "plugin-round"
  - "mcp-tool"
---
[x] Greenfield 위저드 → 인셉션 킥오프 예약 (IN1)

## 추가 기능

plugin-round Phase C {#in1-wizard}. GreenfieldWizard 가 프로젝트 생성에 성공하면, 위저드의 아이디어·대상 사용자 입력으로 **project-inception 스킬 발화 프롬프트**를 조립해 `dispatchBus` 에 예약한다 — 새 프로젝트에서 터미널을 여는 순간 `claude "…"` 가 프리필돼 있고(IN2 소비 경로 재사용), 실행은 Enter 로. 입력은 공백 정규화+길이 컷(300/150자)+셸 이스케이프(`"`·`\`·`$`).

## 동작 흐름

위저드 5단계 완료 → 프로젝트 생성·시드 plan → 킥오프 예약 → 사용자가 터미널 열기 → 프리필 확인 후 Enter → 인셉션 스킬이 discussion→plan→EVALS→rules 시드.

## 검증

- typecheck/lint/vitest 336/build 그린 (dispatchBus 소비 경로는 IN2 에서 배선·검증됨).
- 실기기(위저드 생성→터미널 프리필 확인)는 A0d 동승.