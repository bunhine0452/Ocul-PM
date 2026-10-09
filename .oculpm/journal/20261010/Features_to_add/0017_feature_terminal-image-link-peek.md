---
schema_version: 1
type: feature
slug: "terminal-image-link-peek"
status: done
difficulty: medium
created_at: "2026-10-10T00:17:17+09:00"
session_id: "20261010-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/commands/fsutil.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/features/terminal/urlLinks.ts"
    op: update
  - path: "src/features/terminal/useTerminalFileLinks.tsx"
    op: create
  - path: "src/features/terminal/TerminalImagePeek.tsx"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_url_links.test.ts"
    op: update
  - path: "src/__tests__/terminal_image_peek.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "terminal"
  - "claude-code"
  - "osc8"
  - "mcp-tool"
---
[x] 터미널 이미지 경로 미리보기 — Claude Code 가 찍은 그림 경로에 올리면 바로 보인다

## 추가 기능

내장 터미널에서 Claude Code 가 그림을 만든 뒤 찍는 `› [image] /private/tmp/…/x.png (1.9MB)` 경로에 마우스를 올리면 그 자리에 미리보기 카드가 뜨고, 누르면 크게 고정된다(Esc·바깥 클릭으로 닫힘).

## 동작 흐름

- **왜 경로 글자가 아니라 OSC 8 인가**: Claude Code 는 TERM_PROGRAM 목록에 없는 터미널을 하이퍼링크 미지원으로 보고 경로를 맨 글자로 찍는다. 좁은 폭에서는 Ink 가 경로를 열(column) 안에서 줄을 넘겨 찍어, 글자만으로는 다시 이을 수 없다. Claude Code 바이너리는 iTerm/kitty 인라인 이미지 프로토콜 코드가 없다(`1337;File=` 0건) — 그림 데이터는 오지 않고 경로만 온다.
- PTY 환경에 `FORCE_HYPERLINK=1` (`commands/terminal.rs`). pty 실측: 없으면 OSC 8 0건, 있으면 `ESC]8;id=…;url` 로 감싸 보냄. rc 의 `FORCE_HYPERLINK=0` 이 나중에 돌아 이긴다.
- `urlLinks.ts`: `allowNonHttpProtocols` 를 켜고 `file://` 를 화면으로 보냄 — 이미지(previewKindFor)는 hover/open, 그 밖의 파일은 프로젝트 안이면 기존 파일 메뉴, 밖이면 안내 토스트. **이 두 번째 갈래는 필수**: xterm 은 같은 칸의 링크 중 먼저 등록된 프로바이더(코어 OSC)를 고르므로, 빠지면 Claude Code 가 찍은 `src/foo.ts` ⌘클릭이 조용히 죽는다. 받을 곳이 없거나 열 수 없는 스킴은 밑줄을 긋지 않는다.
- 새 커맨드 `terminal_image_preview(path)`: 프로젝트 루트 밖(Claude 스크래치패드)도 읽어야 하므로 secure_join 대신 **그림 말고는 돌려줄 수 없게** 좁힘 — 절대경로 · canonicalize 후 실제 파일 확장자 · 열기 전 is_file(FIFO 멈춤 방지) · 16MB · 선두 바이트 시그니처(`fsutil::sniff_image_mime`). 반환형은 `CodeAsset` 재사용.
- 프런트: `useTerminalFileLinks`(120ms 머문 뒤 표시·고정 중엔 다른 링크 무시) + `TerminalImagePeek`(카드는 pointer-events none — 가로채면 xterm 이 leave 를 쏴 깜빡임). TerminalInstanceImpl 은 래칫(957줄) 안에서 배선.

## 한계

- 이미 떠 있는 셸(PTY 호스트가 살린 세션)은 새 환경 변수를 못 받는다 — 새 탭/새 셸부터.
- `FORCE_HYPERLINK` 는 supports-hyperlinks 를 쓰는 Node CLI 가 파이프로 내보낼 때도 OSC 8 을 싣게 한다.
- 다른 CLI 가 글자로만 찍은 이미지 경로(OSC 8 없음)는 여전히 기존 파일 메뉴(빠른 미리보기)로만.

## 검증

- cargo test 2032 통과(이미지 판정·거절 케이스 신규 3) · clippy -D warnings · fmt / vitest 3322 통과(신규 `terminal_image_peek` 9 + url_links 갱신) · typecheck · lint 6종 · build 0.
- 빌드된 실제 CSS 로 카드(라이트·다크)·확대 화면 정적 렌더 스크린샷 확인. **설치본 실기기(실제 Claude Code 출력에 올리기) 미확인** — 설치본이 돌아 dev 빌드 안 함. 미커밋.