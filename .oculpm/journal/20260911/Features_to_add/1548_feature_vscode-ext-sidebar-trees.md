---
schema_version: 1
type: feature
slug: "vscode-ext-sidebar-trees"
status: done
difficulty: medium
created_at: "2026-09-11T15:48:20+09:00"
session_id: "20260911-009"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/tree/journalTree.ts"
    op: create
  - path: "extension/src/tree/planTree.ts"
    op: create
  - path: "extension/src/tree/planModel.ts"
    op: create
  - path: "extension/src/tree/planTree.spec.ts"
    op: create
  - path: "extension/src/tree/commands.ts"
    op: create
  - path: "extension/src/tree/workspace.ts"
    op: create
  - path: "extension/src/deeplink.ts"
    op: create
  - path: "extension/media/activity.svg"
    op: create
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/commandRegistry.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
  - path: "extension/.vscode-test.mjs"
    op: update
  - path: "extension/package.json"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "treeview"
  - "deeplink"
  - "mcp-tool"
---
[x] VS Code 확장 사이드바 — 오늘 일지·활성 플랜 트리, 미리보기·딥링크 커맨드

## 추가 기능

플랜 `vscode-extension-round` `{#sb-tree}` + 하위 2 — Activity Bar 컨테이너 `ocul-pm`(앱 아이콘의 동심 링을 단색 SVG 로) 아래 TreeView 2개.
- **오늘 일지**: 추적 폴더가 하나면 날짜부터(여럿이면 폴더 층) → 최근 7일(오늘만 펼침, `오늘 · N`) → 타입 폴더(버그/기능/에러/리팩토링/잡일, codicon) → 항목(제목=본문 `[x] 제목`, 설명 `HH:MM · agent`, 툴팁에 경로·상태·모델).
- **활성 플랜**: `status=active` 만 → Phase(`done/total`, 다 끝났으면 접힘) → 항목(하위 1단계). 글리프 6종 → codicon+ThemeColor(`todo circle-large-outline · in_progress play-circle 노랑 · done pass-filled 초록 · blocked error 빨강 · deferred arrow-right · dropped circle-slash`). 진척은 **리프만·dropped 제외**(`progressOf`).
- 커맨드 7개 전부 READ: 클릭 → `markdown.showPreview`(`{#sb-tree-open}`), 인라인 `$(go-to-file)` 편집기로(트리엔 ⌥클릭 구분이 없어 인라인 버튼으로 대체), 컨텍스트 'Ocul-PM 에서 열기'(`oculpm://open?project=&view=journal&entry=`)·'경로 복사'(`{#sb-tree-cmds}`), 뷰 제목에 새로고침·앱 열기. 웹뷰 없음. 미추적 폴더엔 `viewsWelcome`.

## 동작 흐름

- **딥링크 인코딩 함정**: `URLSearchParams` 는 공백을 `+` 로 적는데 앱의 `percent_decode`(text.rs)는 `+` 를 공백으로 안 되돌린다 → 공백 있는 프로젝트 경로가 등록 목록과 안 맞아 거절당했을 것. `encodeURIComponent`(`%20`)로 조립, 테스트로 고정.
- **앱이 `view`/`entry` 를 아직 안 쓴다** — `ProjectTab.tsx` 의 `open` 핸들러는 `openProjectTab` 만 한다. 확장은 계약대로 보내고, 앱 쪽 항목 `{#app-deeplink-entry}` 를 Phase 3 에 추가(플랜 파일 직접 편집, 규칙 §4).
- vitest 는 `vscode` 를 못 임포트하므로 순수 부분(`progressOf`·`STATUS_ICON`·`buildOpenDeepLink`)을 `planModel.ts`·`deeplink.ts` 로 분리. mocha 는 `.vscode-test.mjs` 의 `workspaceFolder` 를 저장소 루트로 두고 **실제 `.oculpm/`** 로 트리 개수(오늘 일지·활성 플랜·첫 플랜 항목 수)를 읽기 계층과 대조한다.

## 검증

`cd extension && pnpm compile && pnpm test`: vitest 16 · mocha 4 통과, exit 0. 트리 개수 = `listJournalFiles`/`listPlans` 개수(그 둘은 앞 일지에서 순진 집계와 일치 확인). 화면 육안 확인은 `{#rel-eyes}`.