---
schema_version: 1
type: bug
slug: "terminal-fit-bottom-row-clipped"
status: done
difficulty: medium
created_at: "2026-10-24T10:24:15+09:00"
session_id: "20261024-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
related:
  - ref: "20261018/Bugs/0827_bug_claude-code-fullscreen-renderer.md"
    kind: "followup"
tags:
  - "terminal"
  - "xterm"
  - "release"
  - "mcp-tool"
---
[x] 내장 터미널 맨 아랫줄이 잘리던 것 — fit 이 여백까지 높이로 셌다 (v3.13.3)

## 발생 원인

사용자 보고: 내장 터미널에서 Claude Code 를 쓰면 아래가 살짝 잘린다. `@xterm/addon-fit` 0.11 의 `proposeDimensions` 는 부모(`.term-screen`)의 computed `height`·`width` 에서 `.xterm` **자신의** padding 만 뺀다. 앱 전역이 `* { box-sizing: border-box }` 라 그 값에 `.term-screen` 의 padding(페인 9px·도크 8px 사방, 왼쪽 +7px)이 들어 있어, 위아래 18px(도크 16px)만큼 — 대략 한 줄 — 행을 더 잡았고 마지막 줄이 `overflow: hidden` 에 반쯤 잘렸다. 오른쪽도 몇 칸 넘쳤다. 오래된 결함이지만 v3.13.2 에서 Claude Code 를 fullscreen 렌더러로 띄우며 입력창이 맨 아랫줄에 고정돼 드러났다.

## 해결 방법

xterm 을 `.term-screen` 안의 여백 없는 칸 `.term-xterm`(width/height 100%)에 연다 (`xtermHostRef`). fit 이 읽는 부모 높이가 콘텐츠 박스가 되고 모양은 그대로다. 래칫(950줄) 때문에 설명은 screens.css 쪽에 적었다. v3.13.3 긴급 릴리스(사용자 지시: PR CI 생략, main 직행 — release.yml gate 는 그대로 main CI 를 기다림).

같은 보고의 다른 증상(터미널을 켜면 `getcwd: Operation not permitted` + fnm 패닉)은 별개다: PTY 호스트가 10-04 의 v3.6.0 실행 파일로 세션 10개를 쥔 채 살아 있고, 업데이트로 그 실행 파일이 지워져 macOS 가 데스크탑 폴더 접근을 거부한다. 호스트 소켓에 진단 셸을 띄워 재현(`~/Desktop` EPERM, `/tmp` 정상). 코드 수정은 이중 호스트 설계가 필요해 플랜 `#carry-ptyhost-stale-tcc` 로 넘겼다.

## 검증

- headless Chrome 에 실제 xterm 5.5 + addon-fit 으로 패딩 칸 재현: 이전 rows 22·화면 아래끝 405px > 칸 400px(잘림), 이후 rows 21·787px ≤ 콘텐츠 끝 791px.
- typecheck · vitest 3355 통과 · lint(파일 크기 949/950) · `cargo test --test plugin_manifest` 11 통과.