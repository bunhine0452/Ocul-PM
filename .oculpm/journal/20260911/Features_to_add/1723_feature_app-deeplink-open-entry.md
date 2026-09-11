---
schema_version: 1
type: feature
slug: "app-deeplink-open-entry"
status: done
difficulty: low
created_at: "2026-09-11T17:23:15+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/deeplink/deepLinkPlan.ts"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/__tests__/deep_link.test.tsx"
    op: update
related: []
tags:
  - "deeplink"
  - "vscode"
  - "extension"
  - "app"
  - "mcp-tool"
---
[x] oculpm://open 이 view/entry 를 실제로 쓴다 — 확장의 'Ocul-PM 에서 열기'가 그 일지로 착지

## 추가 기능

플랜 `vscode-extension-round` `{#app-deeplink-entry}` — `ProjectTab` 의 `open` 승인 핸들러가 `openProjectTab` 대신 **`trayOpenMain(openNavFor(link, id, UI_V2_VIEWS))`** 를 부른다. 메뉴바 팝오버가 이미 쓰는 경로(`open_project_tab_with_nav` → 그 창에만 `TrayNavigate` emit → `ShellV2` 가 `setJournalOpenEntry` + journal 화면)라 백엔드·bindings 변경 0.

## 동작 흐름

`openNavFor` 순수 함수: `entry` 는 확장이 보내는 **일지 절대경로**, 앱 안 주소는 `.oculpm/journal/` 기준 상대경로 → 그 프로젝트의 `.oculpm/journal/` 접두 + 경로 규약 정규식을 통과할 때만 `entry_path` 로(다른 프로젝트·`..`·임의 파일은 버리고 화면만). entry 가 있으면 view 는 journal 로 강제, 없으면 알려진 화면 이름만 받고 아니면 today.

## 검증

vitest 신규 2(deep_link 11 통과): 규격 일지 → `{view:"journal", entry_path: 상대경로}`, 타 프로젝트·탈출·미지 view 처리. 전체 `pnpm test` 210 파일 2681 통과, `pnpm typecheck`·`lint:js`·`lint:i18n`·`lint:bindings` OK. 확장 → 앱 실제 착지는 EVALS 6번(실기기).