---
schema_version: 1
type: feature
slug: "terminal-font-size-in-settings"
status: done
difficulty: medium
created_at: "2026-08-15T22:07:52+09:00"
session_id: "mcp-20260815-220752"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/fontSize.ts"
    op: create
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_dock.test.tsx"
    op: update
related: []
tags:
  - "settings"
  - "terminal"
  - "i18n"
  - "migration"
  - "mcp-tool"
---
[x] 설정에서 터미널 글자 크기를 px 로 — 앱 전역 값으로 승격

## 추가 기능

설정 → 모양에 **터미널 글자 크기** 섹션. 슬라이더 + px 직접 입력(9~22) + **실제 터미널 폰트로 그린 미리보기**. 슬라이더만 있으면 "9px 이 얼마나 작은지"를 터미널 화면에 가서야 알게 된다.

## 동작 흐름

**값을 프로젝트별 워크스페이스(localStorage)에서 앱 전역 설정(SQLite `terminal_font_size`)으로 옮겼다.** 설정 화면에 넣으려면 그래야 했다:

- 설정 패널은 **프로젝트가 없을 때도** 열린다(시작 탭에서). 프로젝트별 값을 앱 전역 화면에 두면 "지금 무엇을 고치는 중인지"가 성립하지 않는다.
- 프로젝트마다 다를 이유가 없는 개인 취향이다.
- SQLite 라 **창을 여러 개 띄워도 한 값**이다 — 터미널 화면·도크·분리 창이 함께 움직인다 (localStorage 였다면 분리 창이 따로 놀았다).

범위·클램프는 `@/features/terminal/fontSize` 로 뺐다. `TerminalSurface` 에 두면 **설정 청크가 그 파일을 타고 xterm 을 통째로 끌고 온다** — 터미널을 한 번도 안 여는 사용자에게 지우지 않으려던 비용이다.

⌘+/⌘−/⇧⌘0 과 터미널 상태바의 px 입력도 같은 설정을 쓴다. ⌘± 의 델타는 **화면에 보이는 값** 기준이라, 설정이 범위 밖 값을 들고 있어도 한 번 누르면 보이는 크기에서 한 칸 움직인다.

## 되돌릴 수 없는 부분 (일방향)

과거 프로젝트 레코드의 `terminalFontSize` 는 `loadFromStorage` 에서 삭제한다 — 기존 값은 **한 번 13px 로 초기화된다.** 두 저장소를 가로지르는 마이그레이션(“SQLite 에 키가 없고 + 어느 프로젝트의 localStorage 값을 쓸 것인가”)은 이 값 하나를 살리자고 끌어들이기엔 취약한 장치라 넣지 않았다.

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` / `test`(877) / `lint` / `build` / `cargo test`.
- 신규 테스트 3건 — 클램프 경계(0·999·14.6·NaN), SQLite 키 왕복(`terminal_font_size` ↔ `entriesToSettings("17") = 17`), 과거 레코드 키의 일방향 삭제.
- **미검증**: 설정 화면의 실제 렌더(미리보기 박스·슬라이더). jsdom 은 CSS 를 적용하지 않고, 병렬 세션의 `tauri dev` 가 떠 있어 두 번째 인스턴스를 띄우지 않았다.