---
schema_version: 1
type: feature
slug: code-tab-keyboard-ux
status: done
difficulty: medium
created_at: "2026-08-24T01:35:00+09:00"
session_id: "manual-20260824-013500"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/code/codeTabs.ts"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeTabsBar.tsx"
    op: update
  - path: "src/features/code/CodeContextMenu.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/__tests__/code_tabs.test.ts"
    op: update
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
related:
  - "20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md"
tags: [code, tabs, keyboard, ux]
---

[x] 코드 화면 탭 키보드 UX — ⌘W 탭 닫기 · ⌃Tab 순환 · ⇧⌘T 재열기 · ⌘N 새 파일

## 추가 기능

사용자 요청: "코드 기능에서 ⌘W 로 열었던 코드 창을 닫게 해달라 + 이런 UX 를 더".

- **⌘W → 코드 탭 닫기**: 이미 있는 "안쪽부터 닫기" 사슬(`lib/closeIntent`)에
  코드 화면이 합류. 열린 편집 탭이 있으면 포커스된 창의 활성 탭을 닫고, 없으면
  사슬을 받지 않아 기존대로 프로젝트 탭이 닫힌다. 미저장 편집은 버퍼 캐시에
  남으므로(기존 × 닫기와 동일) 확인 창 없이 닫아도 잃는 것이 없다.
- **⌃Tab / ⌃⇧Tab · ⇧⌘] / ⇧⌘[** — 포커스된 창 안 탭 순환 (끝에서 감아 돎).
  순수함수 `cycleTab` 으로 codeTabs 에 추가. 괄호 키는 ⇧ 조합·비영어 자판에서
  `key` 가 갈라져 `e.code` 로 판정.
- **⇧⌘T — 닫은 탭 다시 열기**: UI 로 닫은 탭(⌘W·×·가운데클릭·다른 탭 닫기)을
  최근 순 스택(상한 20)에 기억. 삭제·외부 소실로 닫힌 것은 넣지 않고, 되살리기
  전에 `codeRead` 로 생존을 확인해 사라진 파일은 토스트로 알린다.
- **⌘N — 새 파일**: 보고 있던 파일의 폴더에 인라인 이름 입력을 연다.
- **발견 가능성**: 탭 우클릭 메뉴에 「닫은 탭 다시 열기」항목 추가 + 메뉴
  단축키 힌트(⌘W·⇧⌘T, `CodeMenuItem.hint`) + 빈 화면 치트시트에 4개 추가.

## 동작 흐름

1. macOS 는 메뉴 액셀러레이터가 웹뷰 keydown 보다 먼저 ⌘W 를 소비한다 — 그래서
   ⌘W 만은 keydown 이 아니라 `registerCloseHandler` 사슬로 받는다 (menu.rs 의
   CLOSE_TAB → CloseIntent 이벤트 → TabbedWindow 의 `runCloseIntent`). keydown
   에 또 달면 두 번 닫히므로 달지 않았다.
2. 프로젝트 탭은 배경에서도 마운트된 채라 이 화면이 창에 여럿 살 수 있다 —
   `rootRef.getClientRects()` 로 레이아웃 상자가 있는(보이는) 화면만 입력을
   받는다 (AcpConversation 의 ⌘W 처리와 같은 잣대).
3. 나머지 단축키는 화면 레벨 window keydown 하나로: `defaultPrevented`(CM 키맵
   선점)와 가시성을 먼저 거른 뒤 분기. `startCreate` 선언 뒤에 effect 를 둬야
   TDZ 에 걸리지 않는다.

## 검증

- `pnpm typecheck` · `pnpm lint` · `pnpm build` 모두 통과.
- `pnpm test` 109파일 1277개 전부 그린 — cycleTab 순수 로직 4건 + 화면 통합 7건
  신규 (닫기 사슬 소비/통과·배경 탭 미반응·순환·재열기·소실 파일 방어·메뉴
  재열기·⌘N 폴더 판정).

## 메모

- jsdom 은 레이아웃이 없어 `getClientRects` 가 늘 빈 목록 — 테스트에서
  prototype 스파이로 상자를 흉내냈다.
- 재열기 스택은 세션 비영속(리로드하면 빈다). 영속할 가치가 보이면
  WorkspaceContext 로 승격이 다음 수순.
