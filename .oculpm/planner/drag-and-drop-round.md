---
oculpm_plan: v1
id: drag-and-drop-round
title: "끌어서 옮기기 라운드 — 탭을 창 사이로 · 세션을 페인으로"
status: active
created: 2026-08-28
updated: 2026-08-29
owner: claude-code
---

사용자 요청: "상단에 보이는 탭을 드래그해서 분리하거나 다시 붙여넣기, 터미널도
드래그해서 탭을 양측으로 분리하는 기능 — UX 적으로 편안하게 정교하게."

출발점: 떼어내기(`detach_tab`)는 2026-08-11 라운드에서 들어갔지만 **돌아올 길이
없었다** (당시 주석: "다른 창의 스트립에 드롭해서 합치는 건 2차 — Rust 화면좌표
히트테스트 필요"). 터미널도 분할은 ⌘D 뿐이라 이미 떠 있는 세션 둘을 나란히 놓을
방법이 없었다.

원칙 — **판정은 아는 쪽이 한다.** 창 기하는 Rust 만 알고, 탭 폭은 CSS 만 안다.
한 쪽이 다 하려 하면 반드시 어긋나므로 몫을 나누고 드래그 내내 주고받는다.

## Phase 1 — 창 탭 다시 붙이기 {#p1-attach-tab}
- [x] `Registry::move_tab` — 인덱스 삽입 + 원래 창 비움 판정. `close_tab` 경로 재사용 금지(프로젝트를 놓아주면 살아 있는 셸이 죽는다) {#move-tab}
- [x] drop-hint 상태(대상 창 + 인덱스) + `hover`/`unhover`/`note_drop_index` — 대상이 바뀌면 인덱스 폐기, 늦게 온 남의 보고 무시 {#drop-hint}
- [x] 커맨드 4개 `tab_drag_over`·`tab_drop_hint`·`attach_tab`·`tab_drag_end` + 이벤트 `TabDragOver`/`TabDragLeave` + lib.rs 등록 + bindings 재생성 {#tab-drag-commands}
- [x] 커서를 OS 에 직접 묻는다(`cursor_position`, 물리 px) — 웹뷰 줌에 흔들리지 않는 유일한 좌표계 {#cursor-source}
- [x] `TabStrip` — 스트립 밖에서만 질의, 붙이기 우선(못 붙일 때만 떼어내기), 받는 쪽 삽입 캐럿 계산 후 회신 {#tabstrip-wiring}
- [x] 캐럿은 절대 위치 — 탭 사이에 끼우면 tablist 자식 규약이 깨진다 (axe) {#caret-a11y}
- [x] 내주는 스트립 0.32 / 받는 스트립 액센트 링 — 놓기 전에 "새 창"과 "합치기"를 구분 {#handoff-visual}
- [x] Rust 8건 + vitest 6건 {#p1-tests}

## Phase 2 — 터미널 드래그 분할 {#p2-terminal-drag}
- [x] `paneDrop.ts` (순수) — 비율 거리 기준 가장자리 판정 + 미리보기 상자. 가운데는 취소이고 아무것도 그리지 않는다 {#pane-drop-pure}
- [x] `termPanes.splitPaneWith` — 서브트리 삽입 + `before`(좌/우·상/하) {#split-with}
- [x] `dragOps.ts` (순수) — 순서·합치기·페인 이동·빼내기 4종. 무변경이면 받은 상태를 그대로 반환 {#drag-ops}
- [x] 세션 카드 → 페인 가장자리 = 나란히 · 레일 안 = 순서 바꾸기 {#rail-drag}
- [x] 페인 손잡이(⠿) → 페인 가장자리 = 자리 바꾸기 · 레일 = 독립 세션으로 빼내기 {#pane-grip}
- [x] 포인터 캡처 + ×·이름편집에 pointerdown 전파 차단 (캡처가 걸리면 click 이 카드로 재조준된다) {#pointer-capture}
- [x] 드롭 미리보기 상자(z-index 6) + 기준 페인 링 + 레일 캐럿 {#drop-preview}
- [x] vitest 27건 {#p2-tests}

## Phase 3 — 남은 것 {#p3-followup}

실기기 확인은 **설치본 `ocul-pm.app` 이 안 돌 때** 해야 한다 (2026-08-28 보류).
dev 빌드는 번들 id 가 같아 app-data·SQLite·`.oculpm` 락을 설치본과 다툰다 — 살아 있는
ACP 세션이 있으면 그쪽이 먼저 깨진다. 다음에 앱을 직접 띄울 때 아래 두 항목을 본다.

- [ ] 실기기 확인 — 창 두 개를 띄워 스트립 사이로 끌어 보기. 특히 앱 배율(⌘+/-)을 바꾼 상태와 배율이 다른 외부 모니터 {#manual-verify-windows}
- [ ] 실기기 확인 — 살아 있는 에이전트 세션을 끌어 분할했을 때 xterm fit/PTY resize 왕복 {#manual-verify-terminal}
- [x] 키보드 등가물 — 탭 컨텍스트 메뉴(우클릭 · Shift+F10 · 메뉴 키)로 창을 골라 옮긴다. ⌘K 팔레트가 아니라 메뉴로 간 이유는 결정 4 {#keyboard-move-tab}
- [ ] 터미널 세션을 **창 밖으로** 떼어내기 — 분리 터미널 창이 프로젝트당 하나(`term-<id>`)라 그 규약부터 바꿔야 한다 {#session-to-window}
- [x] 탭이 많아 스트립이 넘칠 때 — **전제가 틀렸다.** 폭이 줄어드는 게 아니라 96px 에서 멈추고 나머지가 잘려 닿지 않는 탭이 생겼다. 하한을 68px 로 내려 주석이 약속한 축소를 실제로 성립시켰다 {#strip-overflow-drag}
  - [ ] 붐비는 스트립 육안 확인 — 탭 10개 이상에서 아이콘·활동 점·닫기가 겹치지 않는지 {#crowded-strip-verify}

## Phase 4 — 손맛 (2026-08-29) {#p4-feel}

사용자 보고: "드래그해서 창 붙여넣기 하는 게 자연스럽지 않고 뻑뻑하게 느껴져."
Phase 1·2 는 **판정**을 맞췄지만 **손맛**을 안 봤다 — 끌리는 물체가 커서를 따라오지
않았고(직접 조작의 전제), 유일한 지시자에는 전환이 걸려 있었으며, 페인 사이 틈은
놓을 수 없는 죽은 자리였다.

- [x] 커서를 따라오는 물체 — 터미널은 고스트(`.term-ghost`, 레일이 `overflow: hidden` 이라 카드 자신은 못 나간다) · 창 탭은 탭 자신이 `translateX` (재배열 시 제자리 재측정 보정 포함) {#drag-follows-cursor}
- [x] 위치 지시자에서 전환 제거 — `.term-drop` · `.term-rail-caret` · `.tabstrip-caret`. 따라오는 것은 하나로 충분하고 지시자는 스냅이 정답 {#no-indicator-lag}
- [x] 틈까지 흡착 — `pickDropTarget`/`distanceToBox`/`clampToBox` (순수), `SNAP_PX` 20px 로 8px 손잡이와 8px 캔버스 여백을 덮는다. 상자 안 한가운데는 그대로 취소 {#snap-to-nearest-pane}
- [x] 포인터를 rAF 로 묶고, 겨눈 자리가 그대로면 setState 생략 — 예전엔 move 마다 살아 있는 xterm 페인 전부를 다시 그리고 모든 rect 를 다시 읽었다 {#raf-coalesce-drag}
- [x] 접힌 레일을 아이콘 한 개로 — 점은 모서리 배지, `ok`/`idle`/`off` 는 안 그린다 (페인 상태 띠와 같은 규칙) {#collapsed-rail-single-glyph}
- [x] 깨진 CSS 복원 — `.term-rail[data-collapsed]` 셀렉터 중간에 41줄이 복붙돼 `.term-rail-add` 의 접힘 스코프가 전역으로 샜다 {#collapsed-css-paste-bug}
- [ ] 실기기 확인 — 고스트가 레일 밖·페인 위·창 밖에서 제대로 따라오는지, 탭 `translateX` 가 재배열 순간에 안 튀는지 {#feel-manual-verify}

## 결정

### Decision 1 — 판정을 셋으로 나눈다 {#d1-split-responsibility}
잠금: 2026-08-28 · claude-code

창 간 드래그에서 "어느 창 위인가"는 Rust(창 기하), "어느 탭 사이인가"는 받는 창의
프런트(탭 폭은 CSS 가 정한다), "이동"은 Rust(레지스트리가 SSOT).

근거: 한 쪽이 다 하려면 어느 쪽이든 모르는 것을 추측해야 한다 — Rust 가 탭 폭을
알 수 없고, 프런트가 남의 창 위치를 알 수 없다. 손을 놓는 순간에 물어보면 왕복이
한 번 늦으므로 드래그 내내 미리 주고받아 두고, 놓는 순간은 읽기로 끝낸다.

영향: #tab-drag-commands #tabstrip-wiring

### Decision 2 — 커서는 이벤트가 아니라 OS 에서 받는다 {#d2-cursor-from-os}
잠금: 2026-08-28 · claude-code

`PointerEvent.screenX/Y` 대신 `AppHandle::cursor_position()`(물리 px)을 쓴다.

근거: 앱이 웹뷰 줌(`setZoom`, 0.7~1.6)을 쓴다. CSS px·논리 px·물리 px 이 셋 다
달라지는데, 그 사이에서 유일하게 흔들리지 않는 것이 OS 가 주는 물리 좌표다. 창마다
그 창의 배율로 나누므로 모니터별 배율이 달라도 맞는다. (기존 `detach_tab` 의
`screenX` 는 새 창 **위치 지정**에만 쓰이므로 조금 어긋나도 무해하다 — 그대로 둔다.)

영향: #cursor-source

### Decision 3 — 가장자리 판정은 비율 거리 {#d3-edge-by-ratio}
잠금: 2026-08-28 · claude-code

네 변까지의 정규화 거리 중 최소를 고르고, 그 값이 0.3 이하일 때만 분할로 본다.

근거: 사분면으로 나누면 모서리 근처에서 45° 선을 따라 위/왼쪽 판정이 요동친다.
거리 기준은 그 선 위에서만 갈리므로 손이 떨려도 결과가 안 튄다. 0.3 은 "가장자리를
노리면 반드시 잡히고 한가운데는 확실히 취소" 가 둘 다 성립하는 지점 — 0.5 면 취소할
자리가 사라지고, 0.15 면 좁은 도크에서 겨냥이 불가능해진다.

영향: #pane-drop-pure

### Decision 4 — 키보드 등가물은 팔레트가 아니라 탭 메뉴 {#d4-menu-over-palette}
잠금: 2026-08-28 · claude-code

"이 탭을 다른 창으로" 를 ⌘K 팔레트가 아니라 **탭 컨텍스트 메뉴**로 넣는다
(우클릭 · Shift+F10 · 메뉴 키 셋 다 같은 메뉴를 연다).

근거: 팔레트는 **어느 탭**이 대상인지 말할 방법이 없다 — 활성 탭으로 고정하면
"배경 탭을 옮기고 싶다" 를 못 하고, 탭까지 고르게 하면 2단이 된다. 메뉴는 연 자리가
곧 대상이라 그 모호함이 없다. 덤으로 포인터 사용자에게도 길이 하나 는다: 창이
겹쳐 있으면 드래그로 조준하는 것보다 메뉴가 빠르다. 팔레트에는 나중에 "활성 탭을 …"
형태로 얹을 수 있고, 그때도 이 메뉴가 실제 동작의 정본이다.

영향: #keyboard-move-tab

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | agent | 전이 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-28T20:05:00+09:00 | #move-tab | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | release_project 우회가 핵심 |
| 2026-08-28T20:05:00+09:00 | #drop-hint | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 늦은 보고 무시 |
| 2026-08-28T20:05:00+09:00 | #tab-drag-commands | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | bindings 재생성 포함 |
| 2026-08-28T20:05:00+09:00 | #cursor-source | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 줌 무관 좌표계 |
| 2026-08-28T20:05:00+09:00 | #tabstrip-wiring | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 붙이기 우선 |
| 2026-08-28T20:05:00+09:00 | #caret-a11y | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | axe 유지 |
| 2026-08-28T20:05:00+09:00 | #handoff-visual | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 두 상태 구분 |
| 2026-08-28T20:05:00+09:00 | #p1-tests | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | Rust 8 + vitest 6 |
| 2026-08-28T20:05:00+09:00 | #pane-drop-pure | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 비율 거리 |
| 2026-08-28T20:05:00+09:00 | #split-with | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | splitPane 은 얇은 래퍼로 |
| 2026-08-28T20:05:00+09:00 | #drag-ops | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 무변경이면 동일 참조 |
| 2026-08-28T20:05:00+09:00 | #rail-drag | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 세로 레일 위에 재설계 |
| 2026-08-28T20:05:00+09:00 | #pane-grip | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 캔버스와 안 싸우게 손잡이 |
| 2026-08-28T20:05:00+09:00 | #pointer-capture | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | × 재조준 회귀 방지 |
| 2026-08-28T20:05:00+09:00 | #drop-preview | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | z-index 6 |
| 2026-08-28T20:05:00+09:00 | #p2-tests | claude-code | →☐→[x] | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 순수 27건 |
| 2026-08-28T20:05:00+09:00 | #manual-verify-windows | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 실기기 미확인 |
| 2026-08-28T20:05:00+09:00 | #manual-verify-terminal | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 실기기 미확인 |
| 2026-08-28T20:05:00+09:00 | #keyboard-move-tab | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 미착수 |
| 2026-08-28T20:05:00+09:00 | #session-to-window | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 의도적 제외 |
| 2026-08-28T20:05:00+09:00 | #strip-overflow-drag | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 미착수 |
| 2026-08-28T20:05:00+09:00 | #d1-split-responsibility | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 결정 잠금 |
| 2026-08-28T20:05:00+09:00 | #d2-cursor-from-os | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 결정 잠금 |
| 2026-08-28T20:05:00+09:00 | #d3-edge-by-ratio | claude-code | →☐ | 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md | 결정 잠금 |
| 2026-08-28T20:22:00+09:00 | #keyboard-move-tab | claude-code | [ ]→[x] | 20260828/Features_to_add/2022_feature_tab-context-menu-keyboard.md | 메뉴가 대상 모호함을 없앤다 |
| 2026-08-28T20:22:00+09:00 | #d4-menu-over-palette | claude-code | →☐ | 20260828/Features_to_add/2022_feature_tab-context-menu-keyboard.md | 결정 잠금 |
| 2026-08-28T20:38:00+09:00 | #strip-overflow-drag | claude-code | [ ]→[x] | 20260828/Bugs/2038_bug_tab-strip-clips-tabs.md | 전제가 틀렸다 — 잘림이 문제 |
| 2026-08-28T20:38:00+09:00 | #crowded-strip-verify | claude-code | →☐ | 20260828/Bugs/2038_bug_tab-strip-clips-tabs.md | 육안 미확인 |
| 2026-08-29T14:40:00+09:00 | #drag-follows-cursor | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 직접 조작의 전제 — 뻑뻑함의 8할 |
| 2026-08-29T14:40:00+09:00 | #no-indicator-lag | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 지시자는 스냅 |
| 2026-08-29T14:40:00+09:00 | #snap-to-nearest-pane | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | SNAP_PX 20 · 순수 테스트 8건 |
| 2026-08-29T14:40:00+09:00 | #raf-coalesce-drag | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 동일 결과면 setState 생략 |
| 2026-08-29T14:40:00+09:00 | #collapsed-rail-single-glyph | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 점은 모서리 배지로 |
| 2026-08-29T14:40:00+09:00 | #collapsed-css-paste-bug | claude-code | →☐→[x] | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 41줄 복붙이 셀렉터를 반토막 냈다 |
| 2026-08-29T14:40:00+09:00 | #feel-manual-verify | claude-code | →☐ | 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md | 설치본 꺼진 뒤 육안 확인 |
<!-- oculpm:plan-log end -->
