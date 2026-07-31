---
schema_version: 1
type: feature
slug: hook-plan-context
status: done
created_at: 2026-07-31T18:57:00+09:00
session_id: "manual-20260731-185700"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: plugin/oculpm/hooks/plan-context.sh, op: create }
  - { path: plugin/oculpm/hooks/hooks.json, op: update }
  - { path: src-tauri/tests/plugin_manifest.rs, op: update }
  - { path: docs/claude-integration/06-plugin-contract.md, op: update }
  - { path: plugin/oculpm/README.md, op: update }
related: []
tags: [ponytail, hooks, context-injection, subagent]
difficulty: medium
---

[x] 훅 플랜 컨텍스트 주입 — 세션·서브에이전트가 "현재 계획"을 알고 시작

## 추가 기능

훅을 이벤트 싱크에서 컨텍스트 주입기로 확장 (ponytail 패턴):

- **plan-context.sh**: 활성 플랜(frontmatter `status: active` 만)의 미완 항목(`[ ]`/`[~]`/`[!]`)을 ≤24줄·1,600자(줄 경계 컷+절단 표식)로 요약, "지시가 아님" 프레이밍+펜스로 감싸 `hookSpecificOutput.additionalContext` JSON 으로 출력. stdin 즉시 소비(블록 금지)·네트워크 없음·실패는 빈 출력.
- **SessionStart 2번째 훅 + SubagentStart**: 서브에이전트에는 SessionStart 컨텍스트가 닿지 않는 구멍(ponytail #252) 대응 — 같은 스크립트 재주입.
- 매니페스트 훅 계약 테스트 4이벤트로 확장(JSON 출력·프레이밍·상한·절단 표식·실행 비트), 계약 문서·플러그인 README 갱신.

## 동작 흐름

Claude Code 세션/Task 서브에이전트 시작 → 훅이 활성 플랜 요약을 컨텍스트로 주입 → 에이전트가 plan_status 호출 전에도 현재 계획을 인지.

적대 리뷰 반영: **(HIGH)** plain stdout 은 SubagentStart 에서 버려져 침묵 무동작이던 것을 JSON additionalContext 로 교체(이벤트명은 payload 파싱), **(MED)** 비신뢰 플랜 텍스트의 프롬프트 주입 표면 — 데이터 프레이밍, **(LOW)** 본문 예시의 status 오판 — frontmatter 스코프, 무표식 절단 — 표식 추가.

## 검증

스크립트 스모크: 이 저장소 실플랜으로 SubagentStart payload 주입 → 유효 JSON·이벤트명 전달·절단 표식·펜스 온전 확인. `cargo test --test plugin_manifest` 7/7.
