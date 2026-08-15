---
schema_version: 1
type: feature
slug: "terminal-dock-right-position"
status: done
difficulty: low
created_at: "2026-08-15T23:19:49+09:00"
session_id: "mcp-20260815-231949"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/terminal/TerminalDock.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_dock.test.tsx"
    op: update
related: []
tags:
  - "terminal"
  - "dock"
  - "ui"
  - "mcp-tool"
---
[x] 터미널 도크 오른쪽 자리 — 아래·왼쪽·오른쪽 한 바퀴

## 추가 기능

터미널 도크의 자리에 **오른쪽**을 더했다. 자리 바꾸기 버튼은 이제 **아래 → 왼쪽 → 오른쪽 → 아래** 로 한 바퀴 돈다.

## 동작 흐름

순환은 `nextDockPos` 순수 함수로 뺐다 — 버튼·테스트가 같은 규칙을 본다. 버튼 하나로 도는 이유는 자리가 셋뿐이고, 세그먼티드 컨트롤을 놓기엔 도크 헤더가 좁기 때문이다(탭 줄을 탭에게서 뺏는다). 아이콘·문구는 **다음** 자리를 가리킨다 — 지금 자리를 그리면 "누르면 어디로 가는지"를 매번 추론해야 한다.

아이콘·라벨·힌트를 삼항 두 겹 대신 `Record<TerminalDockPos, …>` 표 셋으로 옮겼다. 자리가 하나 더 늘 때 고칠 곳이 표 안으로 모인다.

**세로 두 자리는 폭을 함께 쓴다** (`terminalDockWidth`). 좌↔우로 옮길 때 폭이 유지되는 편이 자연스럽고, 자리마다 따로 기억할 값이 아니다.

**DOM 순서를 화면 순서와 맞췄다.** 왼쪽 도크만 콘텐츠 앞에 오고, 아래·오른쪽은 둘 다 뒤에 온다 — 방향은 CSS 가 정한다(`dock-bottom` = column, `dock-right` = row). `order` 로 시각 순서만 뒤집으면 키보드 탭 이동이 눈에 보이는 차례와 어긋난다(WCAG 1.3.2).

리사이즈는 오른쪽에서 방향이 뒤집힌다 — 손잡이가 도크의 **왼쪽** 가장자리에 붙고(`rect.right - clientX`), 왼쪽으로 끌수록 넓어진다.

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` / `test`(879) / `lint` / `build` / `cargo test`. 생성물 드리프트 없음.
- 신규 테스트 2건 — 순환 순서(아래→왼쪽→오른쪽→아래), 어느 자리에서 시작해도 세 번이면 제자리.
- **미검증**: 실제 화면. 워킹트리를 다른 세션 둘이 쓰고 있어(`fix/today-…` 브랜치) 전용 워크트리에서 작업했고 앱을 띄우지 않았다.