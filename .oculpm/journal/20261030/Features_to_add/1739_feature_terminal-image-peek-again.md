---
schema_version: 1
type: feature
slug: "terminal-image-peek-again"
status: done
difficulty: medium
created_at: "2026-10-30T17:39:40+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/term_image.rs"
    op: create
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src/features/terminal/fileLinks.ts"
    op: create
  - path: "src/features/terminal/imagePeek.ts"
    op: create
  - path: "src/features/terminal/TermImagePeek.tsx"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/__tests__/terminal_image_peek.test.tsx"
    op: create
related: []
tags:
  - "터미널"
  - "osc8"
  - "image-peek"
  - "mcp-tool"
---
[x] 터미널: 이미지 경로에 올리면 그림을 다시 보인다

## 추가 기능

사용자 요청(10-30): 「터미널에서 이미지에 마우스 호버 시 보여주는 기능은 삭제된 거야? → 다시 넣어주고 디자인적으로 업그레이드할 수 있는 부분 진행해」.

경위: 이 기능은 3.12.0(09e7b47b)에 들어왔다. 10-28 덜어내기 때 3.x 터미널과 함께 걷혔고(b00a0bb7), 10-29 에 새로 들인 앱 안 터미널로는 옮기지 않았다. 사용자의 명시적 허락으로 다시 들였다.

- **백엔드** `commands/term_image.rs` `terminal_image_preview`: 옛 검증을 그대로 옮겼다.
  - 절대경로, 심링크를 푼 실제 파일의 확장자, 정규 파일, 16MB 이하, 첫 바이트 시그니처를 모두 본다.
  - 오류는 코드(`image_not_image` · `image_too_large` · `image_unreadable`)로 보내고, 프런트가 사전 문장으로 바꾼다.
- **PTY** 에 `FORCE_HYPERLINK=1` 을 실었다. 이 설정이 있어야 Claude Code 가 경로를 `file://` OSC 8 링크로 보낸다.
- **링크** `fileLinks.ts`:
  - OSC 8 `linkHandler`: http(s) 는 OS 브라우저로, 이미지 `file://` 은 미리보기로 보낸다.
  - 맨 글자 절대 이미지 경로 프로바이더: `ls`, 스크립트 출력처럼 하이퍼링크가 없는 경로도 잡는다. 한글 넓은 칸을 칸 좌표로 바꿔 밑줄이 제자리에 그어진다.
- **덤 고침**: 4.0 터미널에는 `linkHandler` 가 없었다. 그래서 xterm 기본 처리기(`confirm()` → `window.open()`)가 웹뷰에서 막혀, OSC 8 하이퍼링크를 눌러도 아무 일이 없었다.
- **디자인**(옛 것에서 올린 점):
  - 투명 그림 뒤에 바둑판 바탕을 깔았다.
  - 카드 한 줄에 이름(고정폭) · 크기 · 바이트 · 「눌러서 크게」를 둔다.
  - 크게 보기 아래 줄에 전체 경로 · 「경로 복사」 · 닫기를 두고, 닫기 단추로 포커스를 옮겼다가 터미널로 돌려준다.
  - 최근 넷을 캐시해 같은 그림을 다시 읽지 않는다.
  - 다른 화면으로 가면 미리보기를 닫는다.
  - 토큰만 썼다(`--shadow-pop` · `--radius-m/l` · `--z-popover/modal`).

## 동작 흐름

1. 링크에 올리면 `peekEvent(hover)` 가 오고, 120ms 머문 뒤 카드가 뜬다. 카드는 `pointer-events: none` 이라 xterm 의 leave 를 막지 않는다.
2. 누르면 `peekEvent(open)` 으로 고정되고 스크림 위에 크게 뜬다. 고정된 동안에는 다른 링크를 스쳐도 바뀌지 않는다.
3. Esc, 바깥 클릭, 닫기로 닫는다.

하네스에서 찾은 함정: 창이 뒤에 있으면 `data-app-inactive` 가 **모든** 애니메이션을 멈춘다(`lib/idleMotion.ts`, 원래는 무한 반복 애니메이션을 겨눈 것). 그래서 등장 애니메이션이 opacity 0 첫 프레임에 멈춰 카드가 보이지 않았다. macOS 는 배경 창 위에서도 호버가 되므로 실제로 생길 일이다. 등장 효과를 `@starting-style` 전환으로 바꿨다.

## 검증

- `cargo test --lib term_image` → 3 passed: 시그니처, 프로젝트 밖 그림(`Lineup.PNG`), 거절 갈래(키 파일 · 심링크 · 폴더 · 상대경로 · 없는 파일).
- `pnpm vitest run src/__tests__/terminal_image_peek.test.tsx` → 7 passed: 경로 찾기, 한글 뒤 칸 좌표, 프로바이더 범위, OSC 갈래, 카드 → 크게 → Esc, 오류 문장.
- 하네스(실제 컴포넌트 + 가짜 IPC 로 1200×630 PNG): 어두운 · 밝은 테마에서 카드와 크게 보기를 스크린숏으로 확인했다(`scratchpad/peek/`).
- 전체 게이트:
  - `pnpm typecheck` 0 · `pnpm test` Tests 955 passed · `pnpm lint` 0 · `pnpm build` 0
  - `cargo fmt --check && cargo clippy --all-targets -D warnings && cargo test --locked --no-fail-fast` → rust passed 1162 failed 0
- 실제 설치본의 Claude Code 출력에서 눈으로 보는 확인은 다음 릴리스 뒤로 남았다. 새 세션에서만 `FORCE_HYPERLINK` 가 걸린다.