---
schema_version: 1
type: feature
slug: "v4-terminal-back-in-app-sessions"
status: done
difficulty: high
created_at: "2026-10-29T11:38:58+09:00"
session_id: "20261029-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/terminal.rs"
    op: create
  - path: "src-tauri/src/commands/terminal.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: create
  - path: "src/features/terminal/runPrompt.ts"
    op: create
  - path: "src/features/terminal/imeBridge.ts"
    op: create
  - path: "src/api/terminal.ts"
    op: create
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "CLAUDE.md"
    op: update
related:
  - ref: "20261029/Refactors/1103_refactor_v4-simpler-today-one-column.md"
    kind: "followup"
tags:
  - "v4"
  - "terminal"
  - "ui"
  - "ime"
  - "mcp-tool"
---
[x] 앱 안 터미널을 작게 다시 — 다섯째 탭(⌘5), 앱 안 세션, 「다음」 은 거기서 claude 를 연다

## 동기

사용자: 「터미널도 디자인 새롭게 해 주고, 내가 처음에 말한 목표를 기억해 봐」. 어느 터미널인지 물었고, 「앱 안 터미널을 다시」를 골랐다.

처음 목표에 비춰 기준을 세웠다.

- **② 하드 유저:** 하드 유저가 사는 곳은 터미널이다. 그래서 「기록 → 믿음 → 다음」 고리를 한 창 안에서 닫는다.
- **④ 덜어내기:** 10월 결함 1위였던 3.x 구조는 들이지 않는다. 앱 밖 PTY 호스트, 떼어낸 창, 셸 rc 통합이 그것이다.
- **범위 동결:** 대신 걷을 표면을 정했다. 클립보드 프롬프트 복사 경로다.

계획은 `terminal-v4-20261029` 이다.

## 변경 요약

- **백엔드 `terminal.rs`**
  - portable-pty 세션을 앱 프로세스 안에 둔다. 명령은 `term_open/write/resize/close/list` 다섯이다.
  - 출력은 Channel 로 보내고, UTF-8 이 읽기 경계에 걸려 잘리면 다음 읽기까지 남겨 둔다.
  - 창이 닫히면 그 창의 세션을, 앱이 끝나면 전부를 죽인다.
  - 종료 코드는 EOF 뒤 자식이 거둬질 때까지 잠깐 다시 본다. 부하가 있을 때 바로 한 번만 보면 코드를 「모름」으로 적었기 때문이다(전체 스위트에서 한 번 실패해서 잡았다).
- **「다음」 실행.** 프롬프트를 `OCULPM_PROMPT` 환경 변수로 넘기고, 셸에 `claude "$OCULPM_PROMPT"` 한 줄을 쳐 넣는다.
  - 오늘 「다음」(키 c → r), 계획 「다음/끝까지」, 시작 창 「이어서 작업」이 모두 이 길로 간다.
  - 세 곳의 클립보드 경로는 지웠다.
- **화면.** 다섯째 탭(⌘5)이다. 화면은 지연 청크로 두어 xterm(323KB)이 따로 로드된다.
  - 왼쪽 세션 목록 한 칸: 이름 · 도는 중/끝남 코드 · 시작 뒤 일지 수
  - 오른쪽: xterm
  - 새 세션은 ⌘T 다.
  - WebGL 렌더러는 보이는 세션에만 붙이고, 내려가면 반납한다.
- **3.x 에서 되살린 것.** 실측으로 다듬어진 것만 가져왔다.
  - 한글 입력 브리지와 그 테스트
  - `--term-*` 팔레트
  - 번들 한글 글꼴 스택. 세션을 열기 전에 글꼴을 미리 받게 했다. 안 그러면 첫 화면의 한글이 「플 랜」처럼 벌어진다(하네스에서 잡았다).
- **원장·문서.** 기동 원장에 셸 두 자리와 테스트 왕복을 분류했다. CLAUDE.md 범위 동결에 「Brought back」 항목을 더했다. CHANGELOG · README · 랜딩 · 위키를 맞췄다.

## 검증

- `cargo test --lib terminal::` → 4 passed. 진짜 PTY 왕복으로 한글 「한글」 입력·출력, 크기 바꾸기, 종료 코드 3, 창 닫기 정리를 확인했다.
- `cargo test --locked --no-fail-fast` → 36 suites, 1150 passed, 0 failed (부하 속 재실행)
- `cargo fmt --check` · `cargo clippy --all-targets --locked -- -D warnings` ✓
- `pnpm typecheck` exit 0
- `pnpm test` → `Test Files 77 passed (77) · Tests 931 passed (931)`
- `pnpm lint` 6 게이트 ✓ · `pnpm build` ✓
- 하네스(가짜 PTY)로 1360px 터미널 탭과 「오늘 → 터미널에서 실행」 흐름을 찍어 봤다. 한글 글꼴을 미리 받기 전후를 대조했다.
- 아직 못 본 것. 헤드리스 Chrome 에는 GPU 가 없어서, 설치본에서 눈으로 볼 몫으로 남겼다.
  - 실제 WKWebView 에서의 한글 입력
  - WebGL 렌더링
  - 창 닫기 정리