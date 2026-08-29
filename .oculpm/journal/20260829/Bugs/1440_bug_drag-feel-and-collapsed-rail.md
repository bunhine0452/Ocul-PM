---
schema_version: 1
type: bug
slug: drag-feel-and-collapsed-rail
status: done
created_at: 2026-08-29T14:40:00+09:00
session_id: manual-20260829-144000
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/styles/screens.css
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/features/terminal/paneDrop.ts
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/term_pane_drop.test.ts
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: update
related:
  - 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md
tags: [terminal, tabs, drag, ux, performance]
---

[x] 끌어서 옮기기가 뻑뻑했다 — 손을 따라오는 물체가 없었다 · 접힌 레일이 두 덩어리로 읽혔다

## 발생 원인

사용자 보고: "접혔을 때 터미널의 모습이 이상하고, 터미널 드래그해서 창 붙여넣기
하는 게 자연스럽지 않고 뻑뻑하게 느껴져. 프로젝트 창도 마찬가지고."

원인은 서로 다른 세 갈래였다.

**1. 끌리는 물체가 커서를 따라오지 않았다 (뻑뻑함의 8할).**
`.term-sess.dragging` 은 제자리에서 `opacity: 0.4` 로 흐려지기만 했고,
`.tabstrip-tab.dragging` 은 그림자만 얹혔다 — 둘 다 `transform` 이 없다. 직접
조작은 손과 물체가 1:1 로 붙어야 성립하는데, 손만 움직이고 물체는 가만히 있으니
캐럿이 한 칸씩 튈 때마다 걸리는 느낌이 났다.

**2. 유일한 피드백에까지 전환이 걸려 커서보다 늦게 도착했다.**
`.term-drop`(left/top/width/height 0.1s) · `.term-rail-caret`(top 0.12s) ·
`.tabstrip-caret`(left 140ms). 위치 지시자가 100~140ms 뒤에서 미끄러져 오니
고무줄에 묶인 것처럼 보였다.

**3. 놓을 수 없는 죽은 틈이 넓었다.** `hitPane` 이 `.term-pane` 사각형 **안**만
봤는데, 페인 사이에는 8px 분할 손잡이가, 캔버스 둘레에는 8px 여백(`--term-body-pad`)이
있다. 페인에서 페인으로 건너가는 동안 미리보기가 꺼졌다 켜지고, 하필 그 틈에서
손을 놓으면 `endMovePointer` 가 조용히 return 했다 — "붙였는데 안 붙는다".

**4. 포인터 이벤트마다 setState + 강제 리플로우.** `onMovePointer`/`onPointerMove`
가 move 마다 **항상 새 객체**로 상태를 갈아 끼웠고(겨눈 자리가 그대로여도),
`TerminalSurface` 는 살아 있는 xterm 페인 전부를 안고 다시 그린 뒤 그 렌더 안에서
`dropPreview` 가 또 `getBoundingClientRect` 를 불렀다. 다음 move 의 `hitPane` 은
**모든 페인**의 rect 를 다시 읽었다 — 레이아웃을 더럽히고 곧바로 다시 재는 짓을
프레임마다 반복했다.

**5. 접힌 레일이 두 덩어리로 읽혔다.** 접힘 규칙이 `.ts-main`·`.ts-x` 만 숨기고
6px 상태 점과 14px 아이콘을 **나란히** 남겼다. 카드 폭은 32px(레일 44 − 리스트
패딩 12)이라 좌우에 3.5px 밖에 안 남는다. 크기가 다른 글리프 둘이 그 간격으로
붙어 있으면 "상태가 붙은 터미널"이 아니라 정체 모를 두 덩어리로 보인다.

**6. CSS 가 실제로 깨져 있었다.** `.term-rail[data-collapsed]` 셀렉터와
`.term-rail-add {` 사이에 41줄(alert·ts-done·rail-add 블록)이 통째로 복붙돼
셀렉터가 반토막 났다. 그 결과 `.term-rail-add { margin: 0 5px 5px; padding: 7px 0 }`
가 접힘 조건을 잃고 전역 적용돼, 펼친 레일의 "+ 새 세션" 버튼도 좌우 패딩 0 으로
눌려 있었다.

## 해결 방법

**고스트 하나가 손을 따라간다.** `.term-ghost`(`position: fixed`) 를 하나 두고
좌표는 rAF 안에서 `transform` 으로 **직접** 쓴다. 레일 카드 자신을 옮기지 않은
이유는 레일이 `overflow: hidden` 이고 목록이 세로 스크롤이라, 카드를 페인 쪽으로
끌면 경계에서 잘려 사라지기 때문이다. 창 탭은 잘릴 일이 없으므로 탭 **자신**이
`translateX` 로 커서를 따라간다 (Chrome 과 같은 거동). 재배열로 탭이 다른 칸에
가면 제자리가 바뀌므로, 시작 x 만 기억하고 매 프레임 현재 제자리를 다시 재
보정한다 — 안 하면 순서가 바뀌는 순간 탭 폭만큼 튄다.

**전환 제거.** `.term-drop` · `.term-rail-caret` · `.tabstrip-caret` 에서 위치
전환을 걷어냈다. 따라오는 것은 고스트 하나로 충분하고, 지시자는 스냅이 정답이다.

**틈까지 흡착.** `paneDrop.ts` 에 순수 함수 3개를 더했다 — `distanceToBox`(안이면 0,
모서리 밖은 대각선) · `clampToBox` · `pickDropTarget`(가장 가까운 상자로 `SNAP_PX`
= 20px 까지 흡착 후, **끌어당긴 점**으로 가장자리 판정). 20px 은 양쪽 여백(8+8)을
덮으면서 캔버스 한복판까지는 안 끌어당기는 지점이다. 상자 **안**의 한가운데는
그대로 취소로 남긴다.

**포인터를 프레임 단위로 묶었다.** 양쪽 다 좌표만 ref 에 적고 rAF 한 번으로 몰아서
판정한다. 그리고 **겨눈 자리가 그대로면 setState 를 하지 않는다** — 한 페인의
오른쪽 띠 안에서 커서를 흔드는 동안 재렌더는 0 번이다. rAF 콜백은 예약 시점의
렌더 클로저를 들고 있으므로 판정 재료는 `movingRef`/`dragRef` 에서 읽고, `pointerdown`
때 상태보다 **ref 를 먼저** 채운다 (첫 move 가 렌더보다 먼저 올 수 있다).

**접힘은 아이콘 한 개로.** 점을 아이콘 모서리 배지(7px, 카드 배경색 2px 링)로
내리고 상태색은 아이콘이 입는다. 페인 상태 띠와 같은 규칙으로 `ok`/`idle`/`off`
에는 배지를 안 그린다 — 44px 에서 모든 카드에 회색 점이 붙으면 하나도 안 튄다.
대기 카드의 왼쪽 2px 띠도 접힘에서는 뺐다 (배지와 겹치는 신호인데 32px 폭에서
아이콘 중심을 눈에 띄게 민다). 깨진 CSS 41줄은 걷어내고 원래 한 줄을 복원했다.

## 검증

- `pnpm typecheck` · `pnpm lint` · `pnpm test`(120 파일 1424건) · `pnpm build` 전부 exit 0.
- 새 테스트 8건 — `pickDropTarget` 이 8px 손잡이 위·캔버스 여백에서 맞닿은 변을
  집고, 흡착 폭 밖은 없음이며, 상자 안 한가운데는 여전히 취소임을 못 박았다.
- `tab_strip` 드래그 테스트 7건은 rAF 한 프레임을 돌리도록 고쳤다 (`movePointer`
  헬퍼). 판정이 프레임 단위로 묶였다는 사실 자체를 테스트가 기록한다.

## 메모

실기기 육안 확인은 아직이다 — 설치본이 돌 때 dev 빌드를 띄우면 번들 id 를 공유해
app-data·SQLite·`.oculpm` 락을 다툰다. 플래너 `#feel-manual-verify` 로 남겼다.
