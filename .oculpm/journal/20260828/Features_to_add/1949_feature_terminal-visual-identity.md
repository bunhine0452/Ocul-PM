---
schema_version: 1
type: feature
slug: terminal-visual-identity
status: done
difficulty: high
created_at: "2026-08-28T19:49:15+09:00"
session_id: "manual-20260828-194915"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/terminal/density.ts"
    op: create
  - path: "src/features/terminal/railModel.ts"
    op: create
  - path: "src/features/terminal/useSecondTick.ts"
    op: create
  - path: "src/features/terminal/TerminalRail.tsx"
    op: create
  - path: "src/features/terminal/TerminalShellStatus.tsx"
    op: create
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_rail.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - "20260825/Features_to_add/1130_feature_pty-host-survive-restart.md"
tags: [terminal, ui, design, agent-workflow, warp, cmux]
---

[x] 터미널 시각 정체성 — 가로 탭을 세로 세션 레일로, 상태를 색으로

## 추가 기능

에이전트를 서너 개 띄워 놓고 몇 시간을 보는 화면인데, 가로 탭 줄은 5개가 넘으면
이름이 `cla…` 로 뭉개지고 상태를 실을 자리가 아예 없었다. 그래서 세션 목록을
**세로 레일**로 내리고, 이미 갖고 있던 신호(OSC 133 셸 통합)를 화면에 꺼내 놓았다.

- **세로 세션 레일** — 카드 한 장에 상태 점 · 에이전트 아이콘 · 이름 · **라이브 경과
  시간** · 마지막 명령이 함께 실린다. 개수가 늘어도 아래로 흐를 뿐 카드 폭이 줄지
  않는다. ⌘⇧ 없이 머리줄의 토글로 40px 아이콘 모드로 접힌다.
- **앰비언트 상태** — 실행 중/실패한 페인은 위 가장자리에 색 띠를 두른다. 서너 개를
  띄워 두고 곁눈질만으로 "무엇이 돌고 무엇이 깨졌는지" 알기 위한 것이다.
- **비활성 페인 디밍** — 분할 중 포커스가 없는 페인은 가라앉는다(iTerm2 식).
  "어디에 타이핑되는가"를 매번 확인하지 않게 한다. 커서도 포커스 없는 페인에서는
  속이 빈다(`cursorInactiveStyle: outline`).
- **밀도 프리셋**(넉넉/표준/조밀) — 줄 높이와 페인 여백을 함께 움직인다. 글자 크기와
  **다른 축**이다: 크기는 "읽히는가", 밀도는 "숨 쉴 자리가 있는가".
- **상태바 재설계** — 좌=지금 어디(cwd, 프로젝트 루트 기준 상대) · 중앙=지금 무슨
  일(실행 중이면 1초마다 갱신) · 우=조작(밀도·글자 크기·감시).
- 페인이 떠 있는 카드가 됐다(여백·라운드·8px 분할 손잡이 안의 1px 선).

## 동작 흐름

**새 신호를 만들지 않았다.** 셸 통합(`oscShell.ts`)이 이미 알려주던 명령 경계·종료
코드·소요 시간·cwd 와 `agentDetect` 가 명령줄에서 읽어내던 에이전트를, 한 줄짜리
상태바에서 꺼내 카드 한 장 분량으로 재배치했을 뿐이다.

1. `railModel.buildRailItem` (순수) — 탭 + 포커스 페인의 `ShellState` → 카드 재료.
   통합이 꺼진 세션은 `tone: "off"` 로 두고 **아무것도 지어내지 않는다**(속 빈 점).
2. 이름 규칙 — 에이전트가 돌고 **탭 이름이 아직 자동 이름일 때만** 에이전트 이름으로
   바꾼다(`canAutoRename` 재사용). 사용자가 손으로 지은 이름은 프로세스가 덮지 않는다.
3. 시계는 `useSecondTick` 으로 **소비하는 작은 컴포넌트 안에** 가뒀다 —
   `TerminalSurface` 에 두면 1초마다 페인 트리 전체가 재렌더된다. 돌고 있는 게
   없으면 타이머 자체를 걸지 않는다.
4. 밀도는 xterm `lineHeight` + CSS `--term-pane-pad` 로 함께 나간다. 크기·줄 높이를
   **한 이펙트**에서 처리한다 — 따로 두면 연달아 바꿀 때 fit 이 두 번 돌며 PTY 에
   중간 크기가 새어 셸이 그 크기로 다시 그린다.
5. 밀도·레일 접힘은 글자 크기와 같이 앱 전역 설정(SQLite)이다 — 도크·터미널 화면·
   분리 창이 같은 값을 봐야 자리를 옮길 때 줄 간격이 튀지 않는다.

디밍은 **스크림을 얹는 방식이 통하지 않았다**: `--term-bg` 와 `--term-chrome` 이
거의 같은 색이라 눈에 아무 차이가 없었다. 캔버스를 감싼 div 에 `opacity` 를 거는
쪽으로 갔다 — 이미 합성된 레이어에 알파를 곱하는 것이라 비용이 사실상 없고,
디밍되는 페인은 정의상 포커스가 없어 타이핑 중일 수도 없다.

## 검증

- vitest 16건 신설(`terminal_rail.test.ts`) — 경과 시간 표기(분:초/시:분:초/음수·NaN),
  통합 없는 세션이 아무것도 지어내지 않음, 자동 이름↔수동 이름 우선순위, 실패 톤에
  타이머 없음, `anyRunning` 이 `elapsedMs: 0` 을 정지로 오독하지 않음, cwd 접기
  (루트 안/밖/이름이 겹치는 형제 디렉터리 `ai-pm-old` 오검출 방지), 밀도 단조성.
- 전체 스위트 그린 — 117파일 1,343건.
- `pnpm lint` 그린(내 파일 기준), `npx vite build` 성공, typecheck 내 파일 0건.
- **육안 확인** — 실제 `screens.css`/`tokens.css` 로 목업을 그려 브라우저에서 확인:
  다크/라이트 양쪽, 펼친 레일·접힌 레일(40px), compact(도크 260px). 라이트에서
  페인이 밝게 뒤집히고 상태 띠·디밍이 양쪽에서 읽히는 것까지 봤다.
- **남은 확인**: 실제 앱에서 xterm 캔버스와 함께 본 것은 아니다(목업은 크롬만
  실물 CSS). 밀도 전환 시 fit/PTY resize 왕복은 실 세션에서 한 번 봐야 한다.

## 메모

`prefers-reduced-motion` 에서 맥동을 끈다 — 색은 그대로 남는다.

이번 라운드는 **시각 정체성만**이다. 사용자와 정한 다음 두 라운드는
② 에이전트 관제탑(alt-screen 감지 + `onBell` 로 "내 입력 대기" 판정, 레일 정렬),
③ Warp 식 블록 레이어(`registerMarker`/`registerDecoration` 로 거터·overview ruler·
⌘↑↓ 점프, 블록 액션에서 **일지로 남기기·플래너에 붙이기**). 두 API 모두 xterm 5.5
코어에 있는 것을 확인했다.

작업 중 같은 워킹트리에서 **다른 세션이 페인 드래그 분할**(`paneDrop.ts`,
`termPanes.ts`, `TabStrip.tsx`)을 만들고 있었다. `screens.css` 는 내 변경만 들어
있고 `termPanes.ts` 는 손대지 않았으므로 겹침은 없다. 커밋은 하지 않았다 — 인덱스를
공유하므로 남의 WIP 를 쓸어 담을 수 있다.
