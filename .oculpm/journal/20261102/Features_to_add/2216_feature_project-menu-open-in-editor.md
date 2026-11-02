---
schema_version: 1
type: feature
slug: "project-menu-open-in-editor"
status: done
difficulty: low
created_at: "2026-11-02T22:16:41+09:00"
session_id: "20261102-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/project_attention.test.tsx"
    op: update
  - path: "src/__tests__/shell_v4.test.tsx"
    op: update
related: []
tags:
  - "창"
  - "shell"
  - "editor"
  - "mcp-tool"
---
[x] 창: 프로젝트 폴더를 VS Code 로 연다

## 추가 기능
윗줄 프로젝트 ▾ 메뉴(⌘O)에 「VS Code 에서 열기」 항목을 넣었다. 이 창의 프로젝트 폴더를 통째로 설정 「파일 열기」 의 편집기로 연다. 사용자 요청(11-02) — 동결 중 사용자 예외.

## 동작 흐름
- 이름은 설정을 따른다: `vscode`/`cursor` 면 그 이름, `auto` 면 `detect_editor` 가 찾은 것(VS Code 먼저), 기본 앱 · 직접 입력이면 「편집기에서 열기」.
- 백엔드는 그대로 — `open_in_editor(root, "", cmd, null)` 의 빈 상대 경로가 이미 프로젝트 폴더 자체를 연다. VS Code 는 `vscode://file/<폴더>` 를 그 폴더의 창으로 연다. 새 커맨드 · 새 프로세스 자리 없음.
- 실패하면 토스트 「프로젝트 폴더를 열지 못했어요 — …」.

## 검증
- pnpm test 1010 passed (새 테스트: 메뉴 항목 클릭 → inExternalEditor("/b", "", "auto", null)) · typecheck/lint/build 0
- 설치본에서 실제 VS Code 창이 뜨는지는 아직 눈으로 보지 않았다.