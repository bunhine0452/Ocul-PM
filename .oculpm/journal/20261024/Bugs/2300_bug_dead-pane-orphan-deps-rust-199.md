---
schema_version: 1
type: bug
slug: "dead-pane-orphan-deps-rust-199"
status: done
difficulty: medium
created_at: "2026-10-24T23:00:16+09:00"
session_id: "20261024-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/ptyWrite.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/__tests__/pty_session_gone.test.ts"
    op: create
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "rust-toolchain.toml"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261024/Bugs/1024_bug_terminal-fit-bottom-row-clipped.md"
    kind: "followup"
tags:
  - "terminal"
  - "deps"
  - "toolchain"
  - "mcp-tool"
---
[x] 호스트째 사라진 세션의 페인을 종료로 · 고아 의존성 둘 · Rust 1.99.1 (다음 후보 1·3·4)

## 발생 원인

- **죽은 페인**: 설치본 로그에 `PTY 입력 거절 … unknown pty session` 31건 — 오늘 옛 PTY 호스트를 kill 한 뒤 그 호스트에 있던 페인들이 키를 보낸 흔적. 셸이 스스로 끝나면 `pty-exit` 이 와 페인이 「세션 끝남 · 다시 시작」 으로 바뀌지만, 호스트째 사라지면 그 이벤트가 없다.
- **고아 의존성**: `tokio-stream`(v2.18.0 모바일과 함께 들어옴) · 직접 의존 `objc2`(코드는 objc2-app-kit/foundation 만) — 크레이트 이름이 소스에 한 번도 안 나오는 것을 스캔해 찾았다.

## 해결 방법

- `ptyWrite.ts`: `isSessionGone(error)`(그 문구는 호스트·앱 양쪽이 같다) · `onceSessionEnded(fn)`. `TerminalInstanceImpl` 은 입력 거절이 "세션 없음" 이면 pty-exit 과 같은 `sessionGone()`(배너 · input.close · onExit → 다시 시작 손잡이)을 한 번만 부른다. 949 → 946줄(래칫 950).
- `Cargo.toml` 에서 두 줄 제거 — tokio-stream 은 잠금 파일에서도 빠짐, objc2 는 간접으로 남음.
- `rust-toolchain.toml` 1.98.0 → 1.99.1(2026-10-13 stable, static.rust-lang.org) — clippy -D warnings 가 새 lint 없이 통과.
- 후보 2(일지 변경 재조회 폭풍)는 접었다: `task queue exceeded allotted deadline` 은 xterm `TaskQueue.ts` 의 유휴 작업 경고로, 턴 종료 순간의 터미널 출력이 원인이지 재조회가 아니다.

## 검증

- typecheck · vitest 255/3259(새 3건) · lint · cargo fmt · clippy · cargo test --locked --no-fail-fast 실패 0 · cargo-deny.