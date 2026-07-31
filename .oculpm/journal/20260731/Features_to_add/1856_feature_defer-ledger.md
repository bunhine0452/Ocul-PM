---
schema_version: 1
type: feature
slug: defer-ledger
status: done
created_at: 2026-07-31T18:56:00+09:00
session_id: "manual-20260731-185600"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src-tauri/src/oculpm/defer_ledger.rs, op: create }
  - { path: src-tauri/src/commands/retro.rs, op: update }
  - { path: src-tauri/src/oculpm/agents/templates/master_ko.md.tpl, op: update }
  - { path: src-tauri/src/oculpm/agents/templates/master_en.md.tpl, op: update }
  - { path: src/features/retro/DeferLedger.tsx, op: create }
  - { path: src/features/retro/RetroScreenV2.tsx, op: update }
  - { path: src/lib/bindings.ts, op: update }
related: []
tags: [ponytail, defer-ledger, retro, template-v8]
difficulty: medium
---

[x] 미룬 지름길(defer) 원장 — 템플릿 v8 규칙 + 결정적 수확 + 회고 카드

## 추가 기능

ponytail 부채 원장 이식 — "무엇을 안 하기로 했나"의 구조화:

- **템플릿 v8**: 의도적 지름길은 코드 주석 defer 마커(천장`;`재방문 트리거)로 표시하라는 규칙 1줄 (ko 3,504·en 5,116 chars — 크기 가드 내).
- **defer_ledger.rs**: 마커 파서(주석 토큰 **인접** 게이트) + 수확(인덱서 walk 재사용 — gitignore 존중·500KB·NUL 프로브, 경로 정렬로 상한 절단 결정성, 파일 2,000·마커 200 상한 truncated 표시). 트리거 없는 마커는 no_trigger 우선 정렬 ("조용히 썩는 것").
- **defer_signals 커맨드** + 회고 "미룬 지름길" 자기은닉 카드(0건이면 미표시, no-trigger 앰버 배지, path:line 클릭 → 에디터).

## 동작 흐름

에이전트/사용자가 코드에 마커 주석 → 회고 화면이 수확해 원장 표시 → 트리거 없는 항목이 위로 → 클릭해 코드로 이동.

적대 리뷰 반영: **(HIGH)** 템플릿 v8 규칙 줄의 백틱 예시가 AGENTS.md 로 전 프로젝트에 배포돼 지울 수 없는 유령 항목을 만들던 자기수확 — **문서 확장자(md/tpl 등) 수확 제외** + 주석 토큰 인접 게이트(URL `//`·문자열 리터럴 오탐 차단)로 해소. docstring/블록 주석 중간 줄 미탐과 대형 저장소 walk 비용은 한계로 문서화 (후속: 결과 캐시).

## 검증

`cargo test --lib defer` 8/8 (인접·문서 제외 회귀 테스트 포함), 전체 lib 그린, vitest defer_ledger_v2 2/2. 이 저장소 자기수확 시뮬레이션에서 유령 항목 0건 확인.
