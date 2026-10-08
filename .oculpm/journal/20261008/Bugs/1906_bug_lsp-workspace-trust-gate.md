---
schema_version: 1
type: bug
slug: "lsp-workspace-trust-gate"
status: done
difficulty: medium
created_at: "2026-10-08T19:06:36+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/trust.rs"
    op: create
  - path: "src-tauri/src/lsp/state.rs"
    op: update
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/commands/lsp/mod.rs"
    op: update
  - path: "src-tauri/src/config/schema.rs"
    op: update
  - path: "src-tauri/src/config/planner.rs"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/CodeStatusBar.tsx"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/features/code/codeTrust.ts"
    op: create
  - path: "src/__tests__/code_trust.test.tsx"
    op: create
related:
  - ref: "20261007/Bugs/1010_bug_automation-device-consent.md"
    kind: "followup"
tags:
  - "security"
  - "lsp"
  - "mcp-tool"
---
[x] 언어 서버는 이 기기에서 프로젝트를 신뢰한 뒤에만 띄운다

## 발생 원인
`lsp_open` → `ensure_for_file` 가 언어 서버를 아무 관문 없이 띄웠고, rust-analyzer 는 initializationOptions 없이 떴다. 기본값은 `build.rs` · proc-macro 실행이다. 옵션으로 꺼도 부족하다. 그 전에 부르는 `cargo metadata` 부터 저장소의 `rust-toolchain.toml`(경로 툴체인)과 `.cargo/config.toml`(`build.rustc`)이 고른 실행 파일을 쓴다. pyright 는 저장소 venv 의 python, TS 서버는 저장소 `node_modules` 의 tsserver 를 띄울 수 있다. 남이 만든 저장소에서 `.rs` 하나를 여는 것으로 코드가 돌았다.
덤으로 찾은 것: 선언적 설정 문서가 `code_lsp_cmd_<언어>`(언어 서버 실행 명령)를 「옮길 수 있는 키」로 쓸 수 있었다.

## 해결 방법
- `lsp::trust`: SQLite `code_trust.<project_id>` 가 `"true"` 일 때만 기동한다. 신뢰 전에는 `LspServerState::Untrusted` 를 내고 띄우지 않는다. `status()` 도 설치된 서버를 Untrusted 로 보고한다.
- 상태줄 칩이 「언어 서버 꺼짐 · 신뢰하고 켜기」 버튼이 된다(title 이 무엇을 허락하는지 말한다). 누르면 `trustEpoch` 로 같은 파일을 다시 연다. 설정 › 코드에 신뢰 · 거두기 행이 있고, 거두면 떠 있던 서버를 정리한다.
- `config::schema::DEVICE_ONLY_PREFIXES` = automation_consent · code_trust · code_lsp_cmd_. 문서가 내보내지도 쓰지도 못한다.
- `lsp/spec.rs`(1164줄 래칫)는 Indexing 주석을 한 줄로 줄여 순증을 0으로 맞췄다.

## 검증
cargo `lsp::trust`(DB 왕복) · `code_trust_and_lsp_command_are_device_only` 통과, vitest `code_trust.test.tsx` 4건 통과(칩 버튼 · 라벨 · 키 모양 Rust 대조). 전체 게이트와 PR #76 CI 초록. 실기기 육안(칩 → 서버 기동)은 다음 설치본에서 한다.