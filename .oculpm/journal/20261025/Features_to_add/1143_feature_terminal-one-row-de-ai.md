---
schema_version: 1
type: feature
slug: "terminal-one-row-de-ai"
status: done
difficulty: medium
created_at: "2026-10-25T11:43:18+09:00"
session_id: "20261025-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2a1d0079-cc16-453f-acab-dc425538e24b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalHeadBar.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/terminal/TerminalStatusBar.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/TerminalViewMenu.tsx"
    op: create
  - path: "src/features/terminal/useShellInstalled.ts"
    op: create
  - path: "src/features/terminal/tabTitle.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_one_row.test.tsx"
    op: create
related: []
tags:
  - "terminal"
  - "design"
  - "de-ai"
  - "mcp-tool"
---
[x] 터미널 머리줄 한 줄 · 보기 메뉴 Aa · 상태만 남긴 상태바 · 페인 장식 걷기

## 추가 기능

사용자가 Orca 를 보고 "터미널 디자인을 심플하고 실용성 있게" 와 "페인 머리띠가 너무 AI 같다" 를 요청했다. 아티팩트 시안(https://claude.ai/artifact/Jvw4BhsFN8tMVYW175t6zj)에서 A(한 줄로 합치기)를 골랐다.

- **머리줄 한 줄**: 터미널 화면 위에 화면 툴바(제목·셸 통합 부제·도크로)와 세션 줄(레일 토글·가운데 세션 이름·검색·분할)이 따로 있었다. `TerminalSurface` 가 `screenTitle` 을 받으면 머리줄이 `Toolbar` 로 그려져 「터미널 / 세션」 + 검색·분할·Aa·도크로 내리기가 한 줄에 모인다. 도크·분리 창은 화면 툴바가 없으므로 얇은 머리줄 그대로다(세션 이름은 가운데 → 왼쪽).
- **보기 메뉴 Aa** (`TerminalViewMenu`): 상태바에 상시로 있던 글자 크기 스테퍼·밀도 세그먼트를 팝오버 하나로. 팝오버는 `position: fixed` — `.toolbar-actions` 가 가로 스크롤 상자라 절대 위치면 잘린다.
- **상태바는 상태만**: 셸 통합 점(꺼졌을 때만 「켜기」) · 일지 감시 점 · 지금 보기 값 · `?`(⌘/ 단축키 표). 작업 폴더는 페인 머리띠가 페인마다 말하므로 뺐다. 셸 통합 세 갈래 판정과 설치 여부 조회(`useShellInstalled`)를 화면에서 표면으로 옮겨 도크·분리 창도 같은 말을 한다.
- **페인 장식 걷기**: 위 가장자리에서 흘러나오던 그라디언트 선과 숨쉬기, 포커스 4px 후광, 초록으로 물들던 머리띠, 초록 경과 시계, 레일 점 맥동, 거터 숨쉬기를 모두 걷었다. 포커스는 테두리 한 줄이 진해지는 것뿐, 상태는 멈춘 점과 글자로만.
- **세션 이름 `.`**: Claude Code 가 처음 보낸 창 제목 `.` 이 자동 이름으로 굳어 머리줄 가운데에 점 하나만 떠 있었다. 글자·숫자가 없는 제목은 버리고(`~`·`/` 만 예외), 회전 기호(✳ 등)는 떼며, 이미 `.` 로 굳은 탭은 `canAutoRename` 이 참이라 다음 제목에서 낫는다.

## 동작 흐름

터미널 화면: `TerminalScreenV2` → `TerminalSurface(screenTitle, headerActions=도크로)` → `TerminalHeadBar` 가 `Toolbar(leading=레일 토글, title=「터미널 / 세션」, actions=도구+Aa+도크로)`. 상태바는 `deriveIntegrationStatus(포커스 페인, useShellInstalled())`.

## 검증

- typecheck · lint 6 게이트 · vitest 256 파일 3,265 · build 통과, PR #97 CI 초록 → main `471788c0`·`e1d71478`.
- 빌드 CSS 하네스로 라이트/다크 · 단일/분할 · Aa 열림을 헤드리스 크롬으로 찍어 육안 확인. 실기기(화면·도크·분리 창)는 플랜 #term-eyes 로 이월.
- 실수 하나: 새 테스트 파일을 만들기 전에 돌린 lint 를 믿고 커밋해 CI 의 한글 하드코딩 게이트에 걸렸다 — 테스트 문자열을 i18n 키로 바꿔 재푸시.