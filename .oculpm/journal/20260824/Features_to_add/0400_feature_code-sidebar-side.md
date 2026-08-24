---
schema_version: 1
type: feature
slug: code-sidebar-side
status: done
difficulty: low
created_at: "2026-08-24T04:00:00+09:00"
session_id: "manual-20260824-040000"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
related:
  - "20260824/Features_to_add/0135_feature_code-tab-keyboard-ux.md"
tags: [code, sidebar, layout]
---

[x] 코드 화면 트리 사이드바 좌/우 배치

## 추가 기능

사용자 요청: "코드 사이드바를 왼쪽 또는 오른쪽에 보게 하고싶어."

- 사이드바 헤더(새 파일·새 폴더 옆)에 좌/우 토글 버튼 — 왼쪽일 땐
  PanelRight("파일 트리를 오른쪽으로"), 오른쪽일 땐 PanelLeft.
- 선택은 `WorkspaceContext.codeSidebarSide`("left"|"right", 기본 left)로
  영속 — terminalDockPos 와 같은 결. 알 수 없는 값은 왼쪽 취급.

## 동작 흐름

- row-reverse 로 뒤집지 않고 **DOM 순서를 화면 순서와 같게** 유지한다 —
  aside JSX 를 `sidebarEl` 로 추출해 `.code-editors` 앞/뒤 두 자리 중 한
  곳에 렌더 (터미널 도크가 세운 원칙: Tab 이동이 보이는 차례와 같아야 한다).
- 경계선은 CSS `.code-sidebar.on-right` 가 border-right→left 로 뒤집는다
  (안 뒤집으면 편집면과 사이 선이 사라지고 창 끝에 선이 선다).
- additive 필드라 스키마 버전 무증가 — loadFromStorage 의 defaults 병합이
  옛 레코드를 자동 보정.

## 검증

- 신규 테스트 1: 토글 → aside 가 `.code-body` 마지막 자식 + `.on-right`
  클래스 + 워크스페이스 영속(`codeSidebarSide":"right"`) → 되돌리기.
- `pnpm typecheck` / `test` 1278 / `lint` / `build` 전부 exit 0.
