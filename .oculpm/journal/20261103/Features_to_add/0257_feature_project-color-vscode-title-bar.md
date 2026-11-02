---
schema_version: 1
type: feature
slug: "project-color-vscode-title-bar"
status: done
difficulty: low
created_at: "2026-11-03T02:57:45+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/vscode_color.rs"
    op: create
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/projects.ts"
    op: update
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/project_color.test.tsx"
    op: update
related: []
tags:
  - "창"
  - "shell"
  - "vscode"
  - "mcp-tool"
---
[x] 창: 프로젝트 색을 VS Code 에도 맞춘다

## 추가 기능
사용자 요청(11-03): 프로젝트에 정한 색을 VS Code 창 색에도 맞춘다. 색을 고르면 그 프로젝트의 `.vscode/settings.json` `workbench.colorCustomizations` 에 제목 표시줄 다섯 키(active/inactive 배경 · 글자, 테두리)를 쓴다(Peacock 과 같은 자리). 「색 없음」 이면 그 다섯 키만 걷고, 우리 키뿐이던 파일은 지운다(빈 `.vscode/` 도).

## 동작 흐름
- `vscode_color.rs`: 순수 `render(기존, 색)` + IO `apply`. 경로는 `secure_join_managed`(마지막 구간 링크 거부).
- **주석 · 끝 쉼표가 있는 settings.json(JSONC)은 손대지 않는다.** `serde_json` 으로 다시 쓰면 주석이 사라진다 → `skipped` 로 돌려주고 토스트로 알린다.
- 다른 설정 · 다른 colorCustomizations 키 · 키 순서는 그대로(`preserve_order`).
- 글자색은 배경 휘도로 흰색/짙은색 중 대비가 큰 쪽.
- 앱 색 저장이 먼저고, VS Code 파일만 실패해도 목록은 다시 읽는다.

## 검증
- cargo test --lib 937 passed(새 `vscode_color` 5건: 새 파일 · 다른 설정 보존 · 우리 키만 걷기 · JSONC 건너뜀 · 파일 만들고 지우기), egress 두 원장 통과, clippy 깨끗
- pnpm test 1022 passed, typecheck/lint/build 0
- 설치본 · 실제 VS Code 육안 확인은 아직