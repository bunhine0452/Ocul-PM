---
schema_version: 1
type: refactor
slug: retro-gen-single-flight-per-key
status: done
difficulty: medium
created_at: 2026-09-01T19:22:00+09:00
session_id: manual-20260901-192200
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/retro/retroGen.ts
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/retro_gen_bus.test.ts
    op: create
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260901/Bugs/1912_bug_window-global-state-leaks-across-tabs.md
tags:
  - retro
  - tabs
  - llm
---

[x] 회고 생성 단일 비행을 창 전역에서 키 단위로

## 동기

앞선 감사(`related`)에서 남겨 둔 한 건. `startRetroGen` 의 가드는
`if (running && …) return false` — **무엇이든** 돌고 있으면 막았다. 창 하나가
프로젝트 하나이던 시절엔 "같은 회고를 두 번 만들지 마라" 와 같은 말이었지만,
크롬식 탭 이후로는 아니다: 프로젝트 B 에서 누른 명시적 클릭이 A 의 생성 때문에
최대 STALL_MS(3분) 막히고, B 화면엔 아무것도 안 도는데 "이미 생성 중" 만 떴다.

코드 주석은 이유를 "백엔드 LLM 호출을 겹치지 않게" 라고 적어 두었으나
`commands/retro.rs::generate_retro` 를 읽어 보니 **전역 락도 공유 가변 상태도
없다** — 신호를 읽고 LLM 을 부른 뒤 `(project_id, range_key)` 행에 upsert 할
뿐이라 겹쳐 돌아도 깨지지 않는다. 즉 백엔드 제약이 아니라 단일 프로젝트 시절의
프런트 정책이었다.

그리고 결정적으로, 이 모듈은 이미 `key = ${projectId}:${rangeKey}` 를 계산해
두고도 **가드에는 쓰지 않았다** (표시·결과 입양에만 썼다). 막아야 할 진짜
위험 — 같은 프로젝트·같은 기간의 중복 생성(토큰 낭비 + 같은 행 경합) — 은 그
키가 이미 표현하고 있었다.

## 변경 요약

- `running`/`lastDone` 슬롯 하나 → `Map<key, …>`. 가드·스톨 시효 회수·완료
  정리 전부 키 단위. 전역 동시 상한은 두지 않았다(YAGNI) — 매 시작이 사용자의
  명시적 클릭이고, 키당 1건이라는 자연 상한이 이미 있다.
- `getRetroGenRunning()` → `getRetroGenRunning(key)`. 화면은
  `runningGen?.key === myGenKey` 비교 대신 자기 키로 직접 묻는다.
- `_resetRetroGen()` 테스트 훅 추가 (`resetAcpWorking` 규약).
- 완료 토스트에 프로젝트 이름을 넣었다 (`retro.genReadyFor`). 이제 둘이 겹쳐
  돌 수 있으므로 이름 없는 "회고가 준비됐어요" 는 어느 것인지 알 길이 없다.
  이름을 모르면 기존 문구로 떨어진다.
- `retro.alreadyRunning` 문구는 그대로 두었다 — 이제 false 는 **바로 이
  회고가** 돌고 있다는 뜻이라 문구가 비로소 정확해졌다.

## 검증

새 스위트 `retro_gen_bus.test.ts` 6건을 먼저 빨갛게 세웠다: 같은 키 두 번은
막고 · 다른 프로젝트는 서로 안 막고 · 같은 프로젝트의 다른 기간도 안 막고 ·
한쪽이 끝나도 다른 쪽은 계속 돌고 · 완료 결과는 자기 키만 입양하고(1회 소비) ·
끝난 키는 다시 시작된다. `pnpm typecheck` · `pnpm test`(142 파일 / 1728 통과) ·
`pnpm lint:i18n` · `pnpm lint:storage` exit 0.

## 메모

`lint:bindings` 는 여전히 붉지만 병렬 세션의 미추적 WIP(`api/plugins.ts` ·
`features/deeplink/`)와 `api/declarativeConfig.ts` 를 짚는 것으로 이 변경과
무관하다.
