---
schema_version: 1
type: feature
slug: "plugin-refix-warning-hook"
status: done
difficulty: medium
created_at: "2026-11-02T17:56:13+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/refix.rs"
    op: create
  - path: "src-tauri/src/oculpm/refix_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "plugin/oculpm/hooks/refix-warn.sh"
    op: create
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: update
related: []
tags:
  - "플러그인"
  - "plugin"
  - "hooks"
  - "mcp-tool"
---
[x] 플러그인: 재수정 직전에 지난 버그를 알린다

## 추가 기능
에이전트(Claude Code)가 파일을 고치기 직전에 플러그인 PreToolUse 훅이 돈다. 그 파일이 최근 7일 안의 버그 일지 `files_touched` 에 있으면, 그 버그 제목 · 일지 경로 · 그때 검증 칸의 확인 명령을 `additionalContext` 로 들려준다. 버그 일지의 47% 가 7일 안에 같은 파일을 다시 고쳤다(PROMISE.md 측정)는 것이 근거다.

## 동작 흐름
- `hooks/refix-warn.sh`: stdin payload 에서 `file_path`(없으면 `notebook_path`)와 session_id 를 뽑아 `oculpm-mcp refix` 를 부른다. 판단은 셸에 두지 않는다.
  - BSD sed 에는 `\|` 가 없어서 열쇠를 차례로 본다.
- `oculpm/refix.rs`: `.oculpm/journal/` 을 디스크에서 읽는다(앱이 꺼져 있어도 된다).
  - 경로를 프로젝트 기준으로 정규화한다. 루트 밖 · `.oculpm/` 은 거절한다.
  - 버그 일지만 본다. 최신 3건을 고르고, 검증 칸의 첫 인라인 코드를 확인 명령으로 쓴다.
  - 훅 JSON 은 Rust 가 만든다. 셸에서 JSON 을 이스케이프하지 않기 위해서다.
- 막지 않는다. `permissionDecision` 을 내면 사용자의 권한 묻기를 건너뛰므로 내지 않는다. 테스트가 이 금지를 잠근다.
- 대화마다 파일당 1회만 알린다. 경고한 파일은 `.oculpm/hooks/.refix-<대화>` 에 적는다.
- Codex 판에는 싣지 않는다. matcher 가 Claude 도구 이름이라 Codex 에서는 걸리지 않는다(`CLAUDE_ONLY_EVENTS`).
- 계약 문서 · help 스킬 · landing plugin.html(ko/en)에 한 줄씩 더했다.

## 검증
- `cargo test --lib oculpm::refix`: 3 passed. 최신순 · 검증 칸 코드만 · 경로 정규화 · 대화당 1회를 확인했다.
- 이 저장소 실데이터로 훅을 직접 실행했다. `src/styles/shell.css` 편집 payload 로 버그 일지 2건과 `pnpm vitest run src/__tests__/shell_v4.test.tsx` 가 나왔다. 같은 대화 두 번째와 관계없는 파일은 침묵했다.
- `cargo test --locked`: 1070 passed, 0 failed. `cargo fmt --check` · `cargo clippy -D warnings` 0. `pnpm test` 993 passed, typecheck · lint · build 0.