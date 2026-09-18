---
schema_version: 1
type: bug
slug: "tab-close-reentry-lsp-gate"
status: done
created_at: "2026-09-18T20:59:40+09:00"
session_id: "20260918-003"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
related:
  - ref: "20260918/Bugs/2018_bug_config-missing-keys-load-defaults.md"
    kind: "followup"
tags:
  - "bug-hunt"
  - "tabs"
  - "lsp"
  - "logging"
  - "mcp-tool"
---
[x] 탭 × 두 번 누름이 확인 대화상자를 겹치고 유령 close_tab 을 내던 것 · 에디터가 못 연 파일에 LSP didOpen 을 보내던 것</title>
<parameter name="difficulty">low

## 발생 원인

3·4라운드에서 "재현 없이는 손댈 곳이 없다 / 의도된 가드" 로 남겨 둔 두 로그 모양을 다시 봤다.

1. **`close_tab: 레지스트리에 없는 탭` (WARN, ghost=false)** — `closeTabGuarded` 는 `runTabCloseGuard` 를 기다린 뒤(백엔드 왕복) 도는 작업이 있으면 확인 대화상자까지 띄운다. 그 사이 × 를 다시 누르면 가드가 두 번 돌고 대화상자가 겹치며, 첫 닫기가 끝난 뒤 두 번째 `close_tab` 이 이미 지운 탭으로 떨어져 저 WARN 이 된다. 백엔드 주석이 "× 를 두 번 눌렀을 때" 를 정상 경로로 적어 둔 그 갈래다.
2. **`lspOpen failed: Path escapes the project root` (ERROR)** — `code_read` 가 프로젝트 밖을 가리키는 심볼릭 링크를 거부해 에디터는 오류 카드를 보이는데, `useLsp` 는 `activePath` 만 보고 didOpen 을 보내 같은 거절을 ERROR 로 한 번 더 남기고 상태줄이 "실패" 를 가리켰다. 이미지·바이너리·too-large 도 같은 길로 didOpen 이 나갔다.

## 해결 방법

1. `closingRef: Set<number>` — 닫기가 진행 중인 탭의 재진입은 무시한다. 가드 후 실제 닫기는 `closeTabAfterGuard` 로 분리.
2. `useLsp` 에 넘기는 경로를 `fileView.kind === "editor"` 일 때로 한정 — 에디터가 실제로 연 파일에만 LSP 가 붙는다. 백엔드 가드는 그대로(보안 정책 무변경). 파일 크기 래칫(800)에 걸려 호출부를 두 줄로 접었다.

## 검증

- `pnpm typecheck` · `pnpm lint` exit 0 (CodePane 795줄) · `vitest` 2740 · `pnpm build` 성공
- Rust 무변경