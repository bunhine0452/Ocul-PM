---
schema_version: 1
type: bug
slug: "open-in-vscode-without-code-cli"
status: done
difficulty: medium
created_at: "2026-11-02T20:23:48+09:00"
session_id: "20261102-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2e16d24e-1a21-4384-b5ea-51a94216db8a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/editor_choice.rs"
    op: create
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/api/fileOpen.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/features/settings/EditorRow.tsx"
    op: create
  - path: "src/features/settings/DisplaySection.tsx"
    op: update
  - path: "src/features/settings/prefs.css"
    op: update
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/terminal/TermFileMenu.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/settings_editor_row.test.tsx"
    op: create
  - path: "src/__tests__/terminal_file_menu.test.tsx"
    op: update
related:
  - ref: "20261031/Bugs/0206_bug_terminal-file-ref-menu-back.md"
    kind: "followup"
tags:
  - "편집기"
  - "설정"
  - "터미널"
  - "mcp-tool"
---
[x] 편집기: code 명령 없이도 VS Code 로 연다

## 발생 원인
외부 편집기 기본값이 셸 명령 `code "%path"` 였다. macOS 에서 VS Code 를 깔아도 `code` 셸 명령은 따로 설치해야 하고(이 기기에도 없었다 — `/Applications/Visual Studio Code.app` 은 있지만 `which code` 없음), 설치해도 Finder 로 띄운 앱은 셸 PATH 를 물려받지 않는다. 그래서 변경 화면 「편집기로 열기」와 터미널 경로 ⌘클릭 → 외부 편집기가 오류 토스트만 띄웠다. 설정 화면에는 명령을 바꿀 칸이 없었고(키만 있었다), 기본 명령에 `%line` 이 없어 줄 번호도 버렸다. 작업 일지 「파일로 열기」는 혼자 OS 기본 앱으로 열었다.

## 해결 방법
- `commands/editor_choice.rs` 신설 — 설정 값 `auto`(빈 값 · 옛 기본값 포함) · `vscode` · `cursor` · `system` · 셸 명령 템플릿. auto 는 앱 번들(macOS) / PATH(그 밖)로 VS Code → Cursor → 기본 앱 순으로 찾는다.
- VS Code · Cursor 는 `vscode://file/<경로>:<줄>:1` 주소를 OS 오프너(`open_native`)로 연다 — 셸 명령 없이 열리고 줄로 간다. 경로는 퍼센트 인코딩.
- `open_in_editor` 와 일지 열기(`oculpm_open_entry_in_editor` 에 `editor_cmd` 인자)가 같은 `open_file_with` 를 지난다. `detect_editor` 커맨드 추가.
- 설정 · 표시에 「파일 열기」 줄(자동 (VS Code) · VS Code · Cursor · 기본 앱 · 직접 입력). 터미널 메뉴의 편집기 항목은 늘 선다.
- 기동 원장(egress_spawn_ledger) 의 편집기 자리를 `open_file_with` 로 옮기고 open_native 사유에 편집기 주소를 적었다.

## 검증
- `pnpm typecheck` 0 · `pnpm vitest run` Tests 1005 passed · `pnpm lint` 0(기존 경고 1, main 과 같음) · `pnpm build` ✓ built
- `cargo test --locked --no-fail-fast` 927 passed (lib) 외 전 스위트 통과 — 원장 갱신 뒤 `--test egress_spawn_ledger --test egress_inventory` 6 · 8 passed · clippy -D warnings 0 · fmt --check 0
- 실기기: `open "vscode://file/…/README.md:30:1"` exit 0 — VS Code 가 30번째 줄에서 열렸다