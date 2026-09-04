---
oculpm_plan: v1
id: drag-and-drop-round
title: "끌어서 옮기기 라운드 — 탭을 창 사이로 · 세션을 페인으로"
status: archived
created: 2026-08-28
updated: 2026-09-04
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
- [x] 네이티브 드래그 차단 — `-webkit-user-drag: none` + `draggable={false}` + `onDragStart` 차단 3겹. `user-select: none` 은 **선택만** 막는다 (세손가락 드래그에서 텍스트가 끌리던 원인) {#block-native-drag}
- [ ] 실기기 확인 — 고스트가 레일 밖·페인 위·창 밖에서 제대로 따라오는지, 탭 `translateX` 가 재배열 순간에 안 튀는지, 세손가락 드래그로 탭이 끌리는지 {#feel-manual-verify}

## Phase 5 — 닫기가 포커스를 본다 (2026-08-29) {#p5-close-focus}

사용자 요청: "프로젝트 탭을 클릭하고 ⌘W 시 프로젝트 탭이 닫힘. 터미널을 작업중일
땐 터미널 닫힘 — 포커싱 말이야." 그리고 "분리된 창은 x 를 눌러도 안 닫힘."

- [x] `closeIntent` 사슬에 포커스 우선권 — `scope` 를 준 등록이 그 안에 포커스가 있을 때 순서를 건너뛴다. 도크는 다른 화면 위에 얹혀 있어 등록 순서만으로는 "지금 어디에 있는가" 를 알 수 없다 {#close-intent-focus}
- [x] 터미널을 사슬에 등록 — 여태 **없었다**. macOS 는 ⌘W 를 메뉴 accelerator 가 먹어 keydown 분기가 한 번도 안 돌았고, 터미널에서 눌러도 프로젝트 탭이 닫혔다 {#terminal-close-handler}
- [x] 닫기 실패를 삼키지 않는다 — Rust 는 창을 못 찾거나 `close()` 실패 시 로그+`Err`, 프런트는 토스트. 실패 모양이 "탭은 사라졌는데 창이 남는다" 라 조용하면 되돌릴 수도 없다 {#close-failure-visible}
- [x] 분리 창 × 근본 원인 — 잡혔다. 유령 창은 **원인이 아니라 결과**였다: `close_tab`(async 커맨드) 안의 `block_on` 이 tokio 패닉을 내고, 탭을 지운 뒤 `win.close()` 전에 태스크가 죽는다 {#detached-close-rootcause}
- [x] 유령 창 회복 — 웹뷰는 살아 있는데 레지스트리가 모르는 창은 × 도 ⌘W 도 안 먹고 OS 빨간 버튼만 통했다. `close_tab` 이 호출한 창을 알게 하고(`WebviewWindow` 주입), ⌘W 는 `active_tab_of == None` 이면 창을 닫는다. 판정은 순수 `ghost_window()` {#ghost-window-recovery}
- [x] 유령 창 **원인 경로** — `remove_tab` 과 `win.close()` **사이**에서 태스크가 패닉해 죽는다. `handle_window_closed` 의 지우는 순서는 무죄였다 {#ghost-window-rootcause}

## Phase 6 — 손에 붙는 감쇠 · 굳힌 기하 (2026-08-29) {#p6-damping}

사용자 보고: "터미널 창 이동하는 것을 더욱 부드럽게 만들어." Phase 4 는 물체가
커서를 **따라오게** 했지만 좌표를 매 프레임 커서에 그대로 박았고, 판정은 여전히
프레임마다 모든 rect 를 다시 읽었다.

- [x] 드래그 한 번 동안 기하를 굳힌다(`DragGeometry`) — 집을 때 한 번 재고, 창 크기·레일 스크롤에서만 다시 잰다(스크롤은 버블 안 하므로 캡처). 렌더 안 `dropPreview` 도 스냅샷을 본다 {#drag-geometry-freeze}
- [x] 고스트 감쇠 — 매 프레임 남은 거리의 55%, 기울기는 벌어진 거리에서 파생(최대 6°). 앉으면 프레임을 놓고 다음 pointermove 가 켠다. `prefers-reduced-motion` 이면 즉시 박는다 {#ghost-damping}
- [x] 미리보기는 제자리에서 부푼다 — 위치 전환은 되살리지 않고(#no-indicator-lag 유지) 겨눈 자리를 React key 로 주어 등장만 다시 돈다 {#drop-preview-pop}
- [x] 들려 나간 것이 물러나 앉는다 — 페인은 `.lifted`(캔버스 opacity만, 축소하면 xterm refit→PTY resize), 레일 카드는 scale(0.98) {#lifted-source}

## Phase 7 — 런타임 위의 block_on (2026-08-29) {#p7-block-on}

사용자 보고(3번째): "분리된 창은 × 도 ⌘W 도 안 먹고 빨간 버튼만 먹힌다."
회귀 시점은 PTY 호스트 전환(3a75a1a, 2026-08-25) — 그때 `kill_with_prefix` 가
동기 뮤텍스 조작에서 `block_on` 배관으로 바뀌었다.

- [x] kill 배관을 두 갈래로 — `kill_ptys_with_prefix`(async, 커맨드) / `*_blocking`(창 이벤트 훅). 동기판이 기다리는 이유는 그대로: 마지막 창 닫힘 직후 앱이 종료될 수 있어 spawn 은 종료와 경주한다 {#kill-async-split}
- [x] `release_project` 도 두 갈래 — `close_tab` 은 `await`, 창 훅은 `_blocking`. 공통 판정은 `releasable()` {#release-project-split}
- [x] 트레이 알림도 같은 뿌리였다 — emit 스레드(워처 async 태스크)에서 `block_on` → 패닉 → **리스너 뮤텍스 오염** → 세션 첫 일지 이후 Rust 쪽 이벤트 리스너가 전부 죽음. 사용자 로그에 증거 {#tray-notify-async}
- [x] 안전망 — `blocking_kill` 이 런타임 위인지 확인(`Handle::try_current`)하고 패닉 대신 크게 남기고 넘긴다 + `install_panic_logger` 로 패닉을 로그에 끌어낸다 {#panic-visibility}
- [x] 회귀 테스트 2건 — 런타임 위 `block_on` 이 정말 패닉하는지(갈래가 존재할 전제), `inside_async_runtime()` 이 그 조건을 알아보는지 {#p7-tests}
- [ ] 실기기 확인 — 탭을 끌어 창으로 뗀 뒤 × / ⌘W 로 닫기. 터미널이 살아 있는 프로젝트 탭에서도(kill 왕복이 실제로 도는 경로) {#detached-close-verify}

## Phase 8 — 완성된 모션 (2026-08-29) {#p8-motion}

사용자 요청: "창 드래그, 분리, 합치는 모션을 제발 완성시켜줘. 세손가락
드래그하면 텍스트가 드래그돼." Phase 1~7 은 **판정**을 전부 맞췄지만, 직접
조작에서 사람이 확인하는 것은 판정 결과가 아니라 손에 무엇이 들려 있고 어디에
놓이는가다.

- [~] (Phase 9 가 대체) 떼어내면 고스트가 손을 따라온다 — 줄 안에서는 탭 자신, 줄 밖에서는
      `.tabstrip-ghost`(`position: fixed`). 잡은 오프셋을 물어 손가락 아래
      **잡았던 그 자리** 그대로 떨어진다 {#tear-off-ghost}
- [~] (Phase 9 가 대체) 창 밖으로 나가면 가장자리에 붙는다(`clampGhost`) — 웹뷰는 자기 창 밖에 못
      그리므로, 안 가두면 끌어내는 순간 물체가 사라진다 {#ghost-clamp}
- [~] (Phase 9 가 대체) 놓으면 어떻게 되는지를 물체가 말한다 — `data-mode` new/merge + `data-hint`.
      스트립 농도(0.55 / 0.32)만으로는 두 결과를 구분하기 어렵다 {#ghost-hint}
- [~] (Phase 9 가 대체) 원래 탭은 `.torn` 자국으로 남는다 — 폭을 접지 않는다. 그 자리가 "취소하면
      여기" 이고, 접으면 되돌아올 때 이웃이 한 번 더 출렁인다 {#torn-slot}
- [x] 받는 스트립이 자리를 **벌리고** 자리표시자를 앉힌다 — `TabDragOver.preview`
      (이름·아이콘·색). 3px 캐럿은 자리만 알려 주고 무엇이 오는지는 말하지
      않았다 {#incoming-slot}
- [x] 겉모습은 **처음 들어선 프레임에만** 싣는다(`Registry::hovering`) — 창
      진입당 DB 조회 1회. 포인터는 초당 수십 번 움직이지만 겨누는 창이 바뀌는
      일은 드물다 {#preview-once}
- [x] 삽입 자리 산술을 `offsetLeft/offsetWidth` 로 — `getBoundingClientRect` 는
      transform 이 반영된 값이라, 벌리려 밀어 둔 탭이 다음 판정으로 되먹임돼
      자리가 진동한다 {#offset-not-rect}
- [x] 떨어진 창이 손 밑에 놓인다 — 프런트는 **새 창 안의 앵커**를 주고, 창을
      놓는 일은 Rust 가 OS 커서로 한다(`detached_origin`). 상수 오프셋
      (-120, -16)은 줌이 걸리면 그만큼 틀어졌다. 휴면 창 재사용 경로도 같이
      옮긴다 {#detach-under-hand}
- [x] 네이티브 드래그를 **기본 끄기**로 뒤집는다 — `lib/nativeDrag.ts` 가 창에
      캡처로 `dragstart` 를 한 번 걸고 `draggable="true"` 만 통과시킨다. 표면마다
      막는 방식은 다음 드래그 면이 생길 때마다 반드시 한 번 더 샌다 (결정 5)
      {#native-drag-inverted}
- [x] Escape 로 되돌린다 — 끄는 조작에는 무르는 길이 있어야 한다 {#drag-escape}
- [x] 새로 앉은 탭에 등장 모션 — 붙이기·새 탭·프로젝트 열기가 같은 길로 오므로
      판정도 한 곳(직전 렌더에 없던 id)에서 {#arrive-motion}
- [x] 감쇠를 하나로 — `lib/dragMotion.ts` 를 터미널 고스트와 창 탭 고스트가 같이
      쓴다. 두 물체가 다른 속도로 따라오면 손이 두 가지를 배워야 한다
      {#shared-damping}
- [x] 테스트 — 순수 13건 + 스트립 배선 6건 + Rust 2건 {#p8-tests}
- [ ] 실기기 확인 — ① 세손가락 드래그로 탭이 끌리는지(텍스트가 아니라),
      ② 창 두 개 사이 고스트·자리표시자 왕복, ③ 떼어낸 창이 손 밑에 뜨는지
      (앱 배율 ⌘+/- 를 바꾼 상태와 배율이 다른 외부 모니터) {#p8-manual-verify}

## Phase 9 — 크롬과 같은 물건 (2026-08-29) {#p9-real-window}

사용자 지적: "크롬 탭창 분리 이동과 똑같이 만들어달라니까?" Phase 8 이 만든
것은 **창 안에 갇힌 고스트**였다. 크롬은 줄을 벗어나는 순간 **진짜 창**이 되고
그 뒤로는 OS 가 옮긴다 — 결과의 미리보기가 아니라 결과를 직접 들고 있는 것이다.
닮은 것이 아니라 다른 물건이었고, 요청은 처음부터 크롬 쪽이었다.

- [x] `begin_tear_off` — 줄을 벗어나는 그 순간 창을 만들어 손에 들려 준다.
      원래 줄은 즉시 메워진다 {#tear-off-now}
- [x] `tab_drag_over` 가 틱 하나로 셋을 한다 — 들고 있는 창을 `cursor − anchor`
      로 옮기고, 남의 스트립을 히트테스트하고, 겨누면 그 창을 **감춘다**
      (크롬의 합치기 미리보기). hide/show 는 전이에서만 {#drag-tick}
- [x] `drop_tear_off` / `cancel_tear_off` — 놓으면 합치거나 그 자리에 남고,
      Escape 는 원래 자리(`source`·`index`)로 되돌린다 {#tear-off-finish}
- [x] `?tearoff=1` — 끌려다니는 동안 화면 마운트를 붙잡는다. 몇백 ms 를 위해
      프로젝트 init·워처·자동색인을 돌릴 이유가 없고, 합쳐 버리면 전부 낭비다.
      `TearOffSettled` 가 손을 놓아 준다 {#tearoff-hold}
- [x] 포인터 캡처를 **스트립**이 쥔다 — 떼어낸 탭은 언마운트되므로 탭에 걸면
      그 순간 캡처가 사라져 남은 move/up 이 안 온다. `lostpointercapture` 안전망
      {#capture-on-strip}
- [x] 떼어낸 창의 탭은 **새 id** 를 받는다(`reserve`→`mint`) — 옛 id 로 마무리를
      부르면 조용히 아무 일도 안 일어난다. `TearOff.tab_id` 에 기록하고 놓기·
      무르기는 id 를 받지 않는다 {#torn-tab-id}
- [x] 걷어낸 것 — 고스트·자국·스트립 흐려짐·고스트 문구·`clampGhost`·`attach_tab`
      {#drop-the-ghost}
- [x] 테스트 — Rust 3건 + 스트립 배선 6건 {#p9-tests}
- [ ] 실기기 확인 — ① 포커스 안 뺏는 창이 떠도 원래 창이 계속 move/up 을 받는가,
      ② 창 생성 지연이 손맛으로 어떤가, ③ 남의 줄 위에서 창이 사라졌다 나타나는
      전환 {#p9-manual-verify}

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

### Decision 7 — 떼어낸 것은 고스트가 아니라 **창**이다 {#d7-real-window-not-ghost}
잠금: 2026-08-29 · claude-code

탭이 줄을 벗어나면 그 자리에서 진짜 창을 만들어 손에 들려 준다. 웹뷰 안에
그리는 미리보기(고스트)는 쓰지 않는다.

근거: 웹뷰는 자기 창 밖을 그릴 수 없다 — 이 제약은 진짜다. 그래서 Phase 8 은
고스트를 창 가장자리에 가뒀는데, 그러면 화면 밖·다른 앱 위로 끌 수가 없고 손에
든 것이 결과가 아니라 결과의 그림이 된다. 제약을 피하는 답은 **그리지 않고
만드는 것**이었다: 창은 OS 가 옮기므로 어디로든 간다.

대가는 둘이고 둘 다 갚았다. ① 창 생성 비용 — `?tearoff=1` 로 화면 마운트를
붙잡아 프로젝트 init·워처·자동색인을 놓는 순간까지 미룬다. ② 탭 id 가 새로
발급된다 — 놓기·무르기가 id 를 받지 않고 백엔드 기록으로 마무리한다.

영향: #tear-off-now #tearoff-hold #torn-tab-id #drop-the-ghost

### Decision 5 — 네이티브 드래그는 표면이 아니라 창에서 막는다 {#d5-drag-guard-at-window}
잠금: 2026-08-29 · claude-code

`-webkit-user-drag: none` 을 끌 수 있는 표면마다 까는 대신, 창에 캡처 단계로
`dragstart` 를 한 번 걸어 **기본 차단**하고 `draggable="true"` 인 요소만
통과시킨다 (코드 탭 바 · 파일 트리).

근거: `-webkit-user-drag` 는 상속되지 않는다. 그래서 표면마다 까는 방식은 끌 수
있는 면(탭·세션 레일·페인 손잡이·사이드바…)이 늘어날 때마다 한 군데씩 빠뜨리게
되고, 실제로 두 번 고치고 두 번 다시 샜다. `dragstart` 를 막으면 OS 드래그
세션이 **열리지 않으므로** `pointercancel` 도 오지 않는다 — CSS 로는 닿지 않던
뿌리다. 예외를 명시적으로 밝히게 하는 쪽이 유일하게 닫히는 구조다.

영향: #native-drag-inverted

### Decision 6 — 끌려오는 탭의 겉모습은 받는 창에 실어 보낸다 {#d6-preview-in-event}
잠금: 2026-08-29 · claude-code

`TabDragOver` 에 `preview`(이름·아이콘·색)를 싣되, 스트립에 **처음 들어선**
프레임에만 싣는다. 받는 쪽은 그것을 `TabDragLeave` 까지 들고 있는다.

근거: 받는 창은 남의 탭 이름을 알 길이 없다 — 레지스트리도 프로젝트 조회도 그
창의 것이 아니다. 그런데 자리표시자에 이름이 없으면 "무엇이 오는지" 는 모른 채
"무언가 온다" 만 보이고, 창이 셋이면 그게 곧 오조준이 된다. 매 move 마다 싣지
않는 이유는 값이 DB 조회 한 번이기 때문이다 — 포인터는 초당 수십 번 움직이지만
겨누는 창이 바뀌는 일은 드물다. 그 "바뀜" 을 아는 것이 `Registry::hovering()`
이다 (`hover()` 의 반환값만으로는 첫 진입과 제자리 유지가 둘 다 `None`).

영향: #incoming-slot #preview-once

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
| 2026-08-29T15:38:00+09:00 | #block-native-drag | claude-code | →☐→[x] | 20260829/Bugs/1537_bug_native-drag-hijacks-tab-drag.md | user-select 는 선택만 막는다 |
| 2026-08-29T15:38:00+09:00 | #close-intent-focus | claude-code | →☐→[x] | 20260829/Bugs/1538_bug_close-is-not-focus-aware.md | scope 준 등록이 우선 |
| 2026-08-29T15:38:00+09:00 | #terminal-close-handler | claude-code | →☐→[x] | 20260829/Bugs/1538_bug_close-is-not-focus-aware.md | 메뉴 accelerator 가 keydown 을 먹었다 |
| 2026-08-29T15:38:00+09:00 | #close-failure-visible | claude-code | →☐→[x] | 20260829/Bugs/1538_bug_close-is-not-focus-aware.md | 로그+Err+토스트 |
| 2026-08-29T15:38:00+09:00 | #detached-close-rootcause | claude-code | →☐ | 20260829/Bugs/1538_bug_close-is-not-focus-aware.md | 미해결 — 다음 재현 대기 |
| 2026-08-29T15:51:00+09:00 | #drag-geometry-freeze | claude-code | →☐→[x] | 20260829/Refactors/1551_refactor_pane-edge-system-and-drag-damping.md | 무효화 직후 다시 재던 것을 걷어냈다 |
| 2026-08-29T15:51:00+09:00 | #ghost-damping | claude-code | →☐→[x] | 20260829/Refactors/1551_refactor_pane-edge-system-and-drag-damping.md | 관성이 아니라 감쇠 — 오버슈트 없음 |
| 2026-08-29T15:51:00+09:00 | #drop-preview-pop | claude-code | →☐→[x] | 20260829/Refactors/1551_refactor_pane-edge-system-and-drag-damping.md | 자리는 즉시, 등장만 부드럽게 |
| 2026-08-29T15:51:00+09:00 | #lifted-source | claude-code | →☐→[x] | 20260829/Refactors/1551_refactor_pane-edge-system-and-drag-damping.md | 제자리에 남은 건 자국 |
| 2026-08-29T16:41:00+09:00 | #detached-close-rootcause | claude-code | [ ]→[>] | 20260829/Bugs/1641_bug_ghost-window-cannot-be-closed.md | 유령 창 가설로 갈라 이월 |
| 2026-08-29T16:41:00+09:00 | #ghost-window-recovery | claude-code | →☐→[x] | 20260829/Bugs/1641_bug_ghost-window-cannot-be-closed.md | 빨간 버튼 말고도 닫힌다 |
| 2026-08-29T16:41:00+09:00 | #ghost-window-rootcause | claude-code | →☐ | 20260829/Bugs/1641_bug_ghost-window-cannot-be-closed.md | 원인 경로 미증명 — 로그 대기 |
| 2026-08-29T17:23:00+09:00 | #detached-close-rootcause | claude-code | [>]→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 유령 창은 결과였다 |
| 2026-08-29T17:23:00+09:00 | #ghost-window-rootcause | claude-code | [ ]→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | remove_tab 과 close() 사이의 패닉 |
| 2026-08-29T17:23:00+09:00 | #kill-async-split | claude-code | →☐→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 부르는 자리로 갈래를 나눴다 |
| 2026-08-29T17:23:00+09:00 | #release-project-split | claude-code | →☐→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | close_tab 이 await 한다 |
| 2026-08-29T17:23:00+09:00 | #tray-notify-async | claude-code | →☐→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 리스너 뮤텍스 오염까지 |
| 2026-08-29T17:23:00+09:00 | #panic-visibility | claude-code | →☐→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 다음엔 로그 한 줄로 갈린다 |
| 2026-08-29T17:23:00+09:00 | #p7-tests | claude-code | →☐→[x] | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 전제를 못 박는 카나리아 |
| 2026-08-29T17:23:00+09:00 | #detached-close-verify | claude-code | →☐ | 20260829/Bugs/1723_bug_async-block-on-kills-close-tab.md | 실기기 미확인 |
| 2026-08-29T19:10:00+09:00 | #tear-off-ghost | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 줄 밖에서는 탭이 따라올 수 없다 |
| 2026-08-29T19:10:00+09:00 | #ghost-clamp | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 창 밖에 그릴 수 없으므로 가둔다 |
| 2026-08-29T19:10:00+09:00 | #ghost-hint | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 물체가 결과를 직접 말한다 |
| 2026-08-29T19:10:00+09:00 | #torn-slot | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 자국은 "취소하면 여기" |
| 2026-08-29T19:10:00+09:00 | #incoming-slot | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 캐럿 대신 벌어진 자리 |
| 2026-08-29T19:10:00+09:00 | #preview-once | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 창 진입당 조회 1회 |
| 2026-08-29T19:10:00+09:00 | #offset-not-rect | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | transform 되먹임 차단 |
| 2026-08-29T19:10:00+09:00 | #detach-under-hand | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 상수 오프셋은 줌에서 틀어진다 |
| 2026-08-29T19:10:00+09:00 | #native-drag-inverted | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 표면마다 막으면 반드시 샌다 |
| 2026-08-29T19:10:00+09:00 | #drag-escape | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 무르는 길 |
| 2026-08-29T19:10:00+09:00 | #arrive-motion | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 놓은 자리와 앉은 자리 |
| 2026-08-29T19:10:00+09:00 | #shared-damping | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 손맛은 앱에 하나 |
| 2026-08-29T19:10:00+09:00 | #p8-tests | claude-code | →☐→[x] | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 순수 13 + 배선 6 + Rust 2 |
| 2026-08-29T19:10:00+09:00 | #p8-manual-verify | claude-code | →☐ | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 실기기 미확인 |
| 2026-08-29T19:10:00+09:00 | #d5-drag-guard-at-window | claude-code | →☐ | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 결정 잠금 |
| 2026-08-29T19:10:00+09:00 | #d6-preview-in-event | claude-code | →☐ | 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md | 결정 잠금 |
| 2026-08-29T19:49:00+09:00 | #tear-off-now | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 벗어나는 순간 창이 된다 |
| 2026-08-29T19:49:00+09:00 | #drag-tick | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 틱 하나로 셋 |
| 2026-08-29T19:49:00+09:00 | #tear-off-finish | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 놓기·무르기 |
| 2026-08-29T19:49:00+09:00 | #tearoff-hold | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 끌려다니는 동안은 안 마운트 |
| 2026-08-29T19:49:00+09:00 | #capture-on-strip | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 탭이 사라져도 제스처가 산다 |
| 2026-08-29T19:49:00+09:00 | #torn-tab-id | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 구현 중 잡은 결함 |
| 2026-08-29T19:49:00+09:00 | #drop-the-ghost | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 고스트 전량 철거 |
| 2026-08-29T19:49:00+09:00 | #p9-tests | claude-code | →☐→[x] | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | Rust 3 + 배선 6 |
| 2026-08-29T19:49:00+09:00 | #p9-manual-verify | claude-code | →☐ | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 실기기 미확인 |
| 2026-08-29T19:49:00+09:00 | #d7-real-window-not-ghost | claude-code | →☐ | 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md | 결정 잠금 — Phase 8 을 대체 |
<!-- oculpm:plan-log end -->
