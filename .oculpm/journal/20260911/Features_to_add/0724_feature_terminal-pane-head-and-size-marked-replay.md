---
schema_version: 1
type: feature
slug: "terminal-pane-head-and-size-marked-replay"
status: done
difficulty: high
created_at: "2026-09-11T07:24:57+09:00"
session_id: "20260911-003"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "7e1f8a85-c205-4b83-a156-f9feb85a306f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/scrollback.rs"
    op: update
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host/mod.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src/features/terminal/scrollbackReplay.ts"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalPaneHead.tsx"
    op: create
  - path: "src/features/terminal/TerminalHeadBar.tsx"
    op: create
  - path: "src/features/terminal/webglRenderer.ts"
    op: create
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/TerminalAgentPill.tsx"
    op: delete
  - path: "src/features/terminal/TerminalShellStatus.tsx"
    op: delete
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_scrollback_replay.test.ts"
    op: create
related: []
tags:
  - "terminal"
  - "design"
  - "ptyhost"
  - "xterm"
  - "mcp-tool"
---
[x] 터미널 리디자인 — 페인 머리띠·확대 + 스크롤백을 찍힌 폭 그대로 재생

## 추가 기능

**① 옛 대화가 찌부러지던 버그 (⌘J 도크 ↔ 터미널 화면)**

- 원인: 도크와 화면은 같은 세션을 그리지만 xterm 을 각자 새로 만들고, 호스트 스크롤백(바이트 그대로)을 **자기 폭**으로 재생했다. claude code 가 "커서를 N 줄 올려 지우고 다시 쓴" 시퀀스는 찍힐 당시 폭 기준이라 다른 폭에서 해석하면 줄이 겹치고 같은 문단이 두 번 남는다. 기존 `adoptedCols`(폭 이어받기)는 재생이 끝난 **뒤**에 걸려 소용이 없었다.
- 수리: `SessionBuf` 가 `Resize` 마다 크기 마커(`Chunk::Size`)를 끼우고, `Attach` 스냅샷이 `sizes: [{at(UTF-16), rows, cols}]` 를 함께 돌려준다 (링에서 밀려난 구간의 마지막 크기가 `at=0` 마커). 프런트 `scrollbackReplay.ts` 가 구간마다 `term.resize` → `term.write(seg, cb)` 를 **콜백 사슬**로 재생하고(write 는 비동기라 순서 필수), 재생 중에는 `applyFit` 을 막는다. 재생 뒤 컨테이너에 맞추면 폭이 바뀐 구간은 xterm 리플로가 다루는 soft wrap 으로 남아 다시 넓히면 펴진다.
- 한계(명시): TUI 가 **좁은 폭에서 새로 찍은** 줄의 개행은 진짜 문자라 어떤 터미널도 펴지 못한다. 고친 것은 "찍힐 때 멀쩡했던 줄이 옮겨 오는 도중 망가지는" 경로.
- 호환: `sizes` 는 `serde(default)` — 구버전 호스트(업데이트를 건너온)는 빈 목록 → 종전처럼 통째로 쓴다. 프로토콜 판 유지.

**② 페인 머리띠 (디자인 업그레이드)**

- 캔버스 위에 떠 있던 에이전트 알약·손잡이·닫기 칩(셸 RPROMPT 를 덮던 것)을 없애고, 페인마다 **고정 높이** 머리띠: 상태 점 + 작업 폴더(잎만 진하게) · 지금 무슨 일(에이전트 이름·단계 / 마지막 명령·종료코드) · 경과 시계 · 손잡이·확대·닫기. 고정 높이라 에이전트가 뜨고 져도 캔버스가 안 움직인다(2026-08-28 의 refit 걱정은 가변 헤더의 것). 포커스 페인은 띠가 세션 색으로 물든다. 좁으면 경로가 양보(`max-width: 46%`), 시계는 라이브 칸 밖이라 잘리지 않는다.
- `TerminalAgentPill`·`TerminalShellStatus` 삭제(상태바 라이브 칸 제거), 판정·1초 시계는 `TerminalPaneHead` 안에.
- 머리줄 가운데에 세션 이름 + 페인 수 (`TerminalHeadBar` 로 분리).
- **페인 확대 ⇧⌘↩** — 확대된 페인을 품지 않은 칸만 `:has` 로 숨긴다(언마운트 없음).
- 파일 크기 래칫으로 `webglRenderer.ts`·`TerminalHeadBar.tsx` 분리, `SessionBuf::attach_payload` 로 호스트 본체 축소.

## 동작 흐름

attach → `sizes` 로 구간 분할 → 구간마다 resize+write(콜백 대기) → `adopt` 세팅 → `applyFit` 1회 → 라이브 청크 이어붙임.

## 검증

- `cargo test --lib ptyhost` 34 통과(마커 7건 신규: 오프셋 UTF-16·접힘·트림 이월·0 크기), clippy -D warnings 깨끗, fmt.
- `pnpm typecheck`/`test`(205 파일 2646)/`lint`(6 게이트)/`build` 모두 exit 0.
- 육안: vitest DOM 덤프 + dist CSS 를 http.server 로 띄워 라이트·다크·도크(compact) 3면 확인 (설치본이 도는 중이라 dev 빌드 금지). 실기기에서 ⌘J 왕복 재생은 미확인.