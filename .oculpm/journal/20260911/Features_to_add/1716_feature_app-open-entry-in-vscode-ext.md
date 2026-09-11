---
schema_version: 1
type: feature
slug: "app-open-entry-in-vscode-ext"
status: done
difficulty: medium
created_at: "2026-09-11T17:16:59+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/vscode_ext.rs"
    op: create
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "extension/src/uriHandler.ts"
    op: create
  - path: "extension/src/uriHandlerModel.ts"
    op: create
  - path: "extension/src/uriHandler.spec.ts"
    op: create
  - path: "extension/src/tree/journalTree.ts"
    op: update
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
  - path: "extension/package.json"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "deeplink"
  - "app"
  - "mcp-tool"
---
[x] 앱 → VS Code 왕복 — 확장 설치 감지 시 일지를 vscode:// URI 로 열어 사이드바까지 선택

## 추가 기능

플랜 `vscode-extension-round` `{#app-editor-open}`.
- **앱**: `src-tauri/src/vscode_ext.rs` — `~/.vscode/extensions/oculpm.ocul-pm-<ver>`(안정판 우선, insiders 다음) 폴더 유무로 확장 설치를 감지한다. `code --list-extensions` 를 안 부르는 이유는 패키징 .app 이 셸 PATH 를 안 물려받아 `code` 가 없어서(external_editor.rs 캐비앗). 설치돼 있으면 일지 모달의 '편집기로 열기'(`oculpm_open_entry_in_editor`)가 `open <path>` 대신 `open vscode://oculpm.ocul-pm/open?entry=<절대경로>` 로 간다 — 같은 `open` 셸아웃이라 opener-scope 회귀와 무관. percent-encoding 은 `encodeURIComponent` 집합과 동일(확장 `deeplink.ts` 와 대칭, 테스트로 고정).
- **확장**: `registerUriHandler` + `activationEvents: onUri`. `resolveEntryTarget` 이 **열린 워크스페이스 폴더 안의 `.oculpm/journal/**/*.md`** 만 통과시킨다(URI 하나로 임의 파일이 열리는 길 차단, `..` 탈출 정규화). 미리보기로 열고 `TreeView.reveal(select, expand)` — 그러려고 `JournalTreeProvider.getParent` 와 노드별 안정 `id` 를 추가. 프로젝트가 이 창에 없으면 '프로젝트 폴더 열기' 제안.

## 동작 흐름

- 항목 문구의 "앱 코드 화면" 쪽(`open_in_editor`, `code "%path"` 템플릿)은 **그대로 뒀다** — 코드 파일은 사이드바와 무관해 `code --goto` 가 이미 정답이고, 확장 URI 로 보내면 오히려 줄 번호 점프를 잃는다. 확장 URI 는 일지 전용.
- 세 `#[cfg]` 로 같은 본문을 세 번 쓴 `open_native_url` 을 하나로 접었다(오프너 명령은 `open_native` 가 이미 OS 별로 고른다).

## 검증

- Rust `cargo test --lib vscode_ext` 2 통과(안정판 우선·파일(비폴더) 무시·인코딩), `cargo clippy -D warnings`·`cargo fmt --check` 통과. bindings.ts 변화 없음(커맨드 서명 불변).
- 확장 mocha 신규 1(9 passing): 오늘 마지막 일지 절대경로로 `openEntry` → `views.journal.selection[0]` 이 그 일지, 폴더 밖 경로는 false. vitest 신규 2(25 통과). 루트 `pnpm lint` exit 0. 앱→VS Code 실제 왕복은 EVALS 6번(실기기).