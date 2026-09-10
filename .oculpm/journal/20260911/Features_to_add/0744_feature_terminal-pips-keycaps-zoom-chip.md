---
schema_version: 1
type: feature
slug: "terminal-pips-keycaps-zoom-chip"
status: done
difficulty: medium
created_at: "2026-09-11T07:44:16+09:00"
session_id: "20260911-003"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "7e1f8a85-c205-4b83-a156-f9feb85a306f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalStatusBar.tsx"
    op: create
  - path: "src/features/terminal/TerminalPaneHead.tsx"
    op: update
  - path: "src/features/terminal/TerminalHeadBar.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260911/Features_to_add/0724_feature_terminal-pane-head-and-size-marked-replay.md"
    kind: "followup"
tags:
  - "terminal"
  - "design"
  - "mcp-tool"
---
[x] 터미널 리디자인 2차 — 이력 핍·키캡 상태바·확대 칩·분할 손잡이

## 추가 기능

1차(0724)의 머리띠 위에 한 단계 더.

- **이력 핍** — 페인 머리띠 오른쪽에 최근 명령 8개의 결과가 세로 막대로 선다(초록/빨강/실행 중 숨쉬기/모름 흐림). 누르면 그 명령의 출력으로 `scrollToLine`. 데이터는 인스턴스의 `BlockApi.list()` 를 `onShellState` 시점에 읽는다 — Impl 이 `exitCode` 를 먼저 쓰고 microtask 로 콜백하므로 순서가 안전하다. 셸 통합이 없는 세션은 핍이 없다.
- **상태바 재구성** (`TerminalStatusBar` 분리) — 단축키 일곱 개짜리 문장을 지우고 손이 가장 자주 가는 넷을 키캡(`.kbd`)으로: ⌘D 분할 · ⌘F 검색 · ⇧⌘↩ 확대 · ⌘↑↓ 명령 이동. 전체 목록은 툴팁. 밀도 `<select>` → `.seg` 세그먼트, 글자 크기 스테퍼는 한 묶음. `container: terminal / inline-size` 로 면이 좁으면 키캡 라벨만 접힌다.
- **머리줄** — 세션 색을 고른 탭은 이름 앞에 색 점, 확대 중이면 "확대 중" 칩(누르면 복귀).
- **분할 손잡이** — 호버에서 가운데 알약(`::after`, 길이 `--ctl-3`)이 떠 "끌 수 있다" 를 말한다.
- **검색 상자** — `↩ 다음 · ⇧↩ 이전 · esc 닫기` 힌트.
- 기다리는 페인은 머리띠 배경도 노랑으로 옅게 물든다.
- 버그 잡음: 확대 시 남은 칸이 인라인 `flex-grow`(비율, 1 미만)만큼만 자라 반쪽이었다 → `.zooming .term-cell:has(.zoomed) { flex-grow: 1 !important }`.

## 동작 흐름

명령 경계(OSC 133 D) → Impl 이 블록 exitCode 갱신 → microtask 로 `onShellState` → Surface 가 `blocks.list().slice(-8)` 을 핍으로 → 머리띠 렌더.

## 검증

- typecheck / lint(6 게이트, ctl-height 램프 위반 1건 잡혀 `--ctl-3` 로 수정) / test(205 파일 2646) / build 모두 exit 0.
- DOM 덤프 하네스로 라이트·다크 × 분할·확대 상태 육안 확인. 실기기 확인은 미완.