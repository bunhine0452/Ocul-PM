---
schema_version: 1
type: feature
slug: "a2a-phase5-ui"
status: done
difficulty: medium
created_at: "2026-09-03T15:32:26+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/a2a.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/today/A2aCard.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/a2a_card.test.tsx"
    op: create
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1511_feature_a2a-phase4-tools-rules.md"
    kind: "followup"
tags:
  - "a2a"
  - "ui"
  - "mcp-tool"
---
[x] A2A Phase 5 — 협업 상태가 화면에 보인다 (혼자일 땐 안 보이고)

## 추가 기능

Today 화면의 `A2aCard` — 참여자 · 넘어온 작업(수락/거절) · 잡힌 구역(놓기) ·
침범 경고. 커맨드 3종(`a2a_overview` · `a2a_decide_task` · `a2a_release_lease`)과
`oculpmApi` 래퍼, ko/en 13키.

## 동작 흐름

**혼자 일할 때는 아무 것도 안 그린다.** 참여자가 하나뿐이고 잡힌 구역도 넘어온
작업도 없으면 카드 자체가 없다 — 대부분의 프로젝트는 끝까지 그 상태이고,
거기에 빈 카드를 놓으면 Today 가 쓰지도 않는 기능의 안내판이 된다. 새 사이드바
항목을 만들지 않은 것도 같은 이유다(D4): 협업 상태는 "오늘 무슨 일이 있나"의
일부이지 별도의 목적지가 아니다.

**조회는 한 번에 한 시각으로** 한다(`A2aOverview`). 셋을 따로 부르면 서로 다른
순간의 사실이 한 화면에 섞인다 — "A 가 쥐고 있다" 옆에 "A 는 없다".

**승인 전에는 아무 일도 없다**(D5). 넘어온 작업은 사람이 눌러야 `working` 으로
간다. 테스트가 "누르기 전에는 호출이 안 나갔다"를 단언한다. 갱신은 폴링이 아니라
`OculpmA2aChanged`·`OculpmA2aTrespass` 구독으로 — 원장은 앱 밖 프로세스가 쓴다.

## 걸린 함정 셋

1. `lint:bindings` — 새 파일은 `commands` 직접 임포트가 금지다. 조회·쓰기는
   `oculpmApi` 로, 이벤트 구독도 래퍼(`onA2aChanged`/`onA2aTrespass`)로 옮겼다.
   래퍼가 비-Tauri(jsdom)에서 조용히 no-op 하는 규약도 그대로 얻는다.
2. `lint:i18n` — 테스트의 한국어가 걸렸다. 이 저장소는 "한국어 렌더를 단언하는
   테스트"를 목록으로 허용한다(번역하는 게 틀린 대응). 목록에 넣었다.
3. `today_v2.test.tsx` 의 API 목이 새 호출을 몰라 10건이 무너졌다 — Today 가
   부르는 표면이 늘었으니 목도 늘어야 한다. 카드를 목 없이도 버티게 만드는 쪽은
   테스트를 위해 제품을 방어적으로 만드는 것이라 택하지 않았다.

## 검증

`cargo fmt --check` 0 · `clippy -D warnings` 0 · `cargo test` 1279 passed ·
`pnpm typecheck` 0 · `pnpm test` **160 files 2077 passed**(신설 4: 혼자일 때
안 그림 · 참여자 표시 · 승인 전 무동작 · 구역 놓기) · `pnpm lint` 0.