---
schema_version: 1
type: feature
slug: tear-off-and-merge-motion
status: done
created_at: 2026-08-29T19:10:00+09:00
session_id: manual-20260829-191000
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src/lib/nativeDrag.ts
    op: create
  - path: src/lib/dragMotion.ts
    op: create
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/App.css
    op: update
  - path: src/main.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/drag_motion.test.ts
    op: create
  - path: src/__tests__/tab_strip.test.tsx
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - 20260829/Bugs/1537_bug_native-drag-hijacks-tab-drag.md
  - 20260829/Bugs/1440_bug_drag-feel-and-collapsed-rail.md
tags: [tabs, windows, drag, motion, webkit, macos, a11y]
---

[x] 떼어내기·합치기의 **모션**을 끝냈다 — 손에 물체가 있고, 놓일 자리가 보이고,
    세손가락 드래그가 텍스트를 훔치지 않는다

## 발생 원인

사용자 보고: "창 드래그, 분리, 합치는 모션을 제발 완성시켜줘. 세손가락
드래그하면 텍스트가 드래그돼."

판정(어느 창·어느 자리·실제 이동)은 Phase 1~7 에서 다 맞췄는데도 "완성" 으로
읽히지 않았다. 이유를 나눠 보면 넷이다.

**① 스트립을 벗어나는 순간 손에 아무것도 없었다.** 끌리는 탭은 `translateX` 로
커서를 따라오지만 `.tabstrip-tabs` 가 `overflow: hidden` 이고 스트립은 창 맨 위
38px 이다. 즉 **떼어내는 방향으로는 따라올 수 없다.** 그 순간부터 유일한 신호는
스트립이 흐려지는 것뿐이라, 무엇을 떼어내는지도 어디로 가는지도 안 보였다.

**② 받는 창은 3px 캐럿 한 줄이었다.** 자리는 알려 주지만 **무엇이** 오는지는
말하지 않는다. 창이 셋이면 겨눈 창이 맞는지 확인할 방법이 없다.

**③ 떨어진 창이 손에서 멀찍이 떴다.** `screenX` 에 상수 오프셋(-120, -16)을 더해
"타이틀바 근처" 를 노렸는데, 웹뷰 줌(0.7~1.6)이 걸리면 그 상수가 그대로 틀어진다.

**④ 세손가락 드래그가 여전히 텍스트를 끌었다.** 2026-08-29 15:37 라운드에서
`-webkit-user-drag: none` + `draggable={false}` + `onDragStart` 3겹을 깔았지만
**표면마다** 깔았다 — `-webkit-user-drag` 는 상속되지 않으므로 끌 수 있는 면이
늘어날 때마다 한 군데씩 빠뜨리게 된다. 실제로 두 번 고치고 두 번 다시 샜다.

## 해결 방법

### ① 떼어내면 고스트가 손을 따라온다

줄 안에서는 지금처럼 탭 자신이 움직이고, 줄을 벗어나면 `.tabstrip-ghost`
(`position: fixed`)가 물체를 넘겨받는다. 원래 탭은 제자리에 `.torn` 자국으로
남는다 — 폭을 접지 않는 이유는 그 자리가 "취소하면 여기" 이기 때문이다.

- 잡은 오프셋을 문다 (`grabX`/`grabY`) — 손가락 아래 **잡았던 그 자리**가 그대로
  떨어져 나온다. 커서 끝에 붙이면 한 번 튀고, 그 한 번이 의심을 만든다.
- 커서가 창 밖으로 나가면 `clampGhost` 로 가장자리에 붙인다. 웹뷰는 자기 창 밖에
  그릴 수 없으므로, 안 가두면 끌어내는 **순간** 물체가 사라진다.
- 놓으면 어떻게 되는지를 물체가 직접 말한다 — `data-mode="new" | "merge"` +
  `data-hint` (문자열은 i18n 이 준다).

### ② 받는 창은 자리를 **벌리고** 자리표시자를 앉힌다

`TabDragOver` 에 `preview`(이름·아이콘·색·시작탭 여부)를 실어, 받는 스트립이
탭 모양 그대로 자리를 차지하고 뒤 탭들이 비켜선다. 겉모습은 **스트립에 처음
들어선 프레임에만** 싣는다 (`Registry::hovering()` 으로 판정) — 포인터는 초당
수십 번 움직이지만 겨누는 창이 바뀌는 일은 드물어, DB 조회는 창 진입당 1회다.

삽입 자리 산술은 `getBoundingClientRect` → `offsetLeft/offsetWidth` 로 바꿨다.
rect 는 **transform 이 반영된** 값이라, 자리를 벌리려 밀어 둔 탭이 다음 프레임의
판정으로 되먹임돼 자리가 앞뒤로 진동한다.

### ③ 떨어진 창은 잡았던 자리가 커서 밑에 오도록 놓인다

프런트는 화면 좌표 대신 **새 창 안의 앵커**(창 좌상단 → 커서 밑에 올 지점)를
넘기고, 창을 놓는 일은 Rust 가 OS 커서(`cursor_position`, 물리 px)로 한다 —
결정 2 와 같은 이유로 줌에 흔들리지 않는 유일한 좌표계다. 순수 함수
`detached_origin(cursor, scale, anchor)` 로 못 박았다. 휴면 창을 재사용하는
경로도 같이 옮긴다 — 안 옮기면 끌어낸 결과가 직전에 숨은 자리에서 튀어나온다.

### ④ 네이티브 드래그를 **기본 끄기**로 뒤집는다

`lib/nativeDrag.ts` — 창에 캡처 단계로 `dragstart` 를 한 번 걸고, 스스로
`draggable="true"` 라고 밝힌 요소(코드 탭 바·파일 트리)에서 시작한 것만
통과시킨다. 나머지는 전부 `preventDefault` 라 OS 드래그 세션이 아예 열리지
않는다 — 그래서 `pointercancel` 도 오지 않는다. 세 갈래 창 **위**(main.tsx)에서
한 번 건다. 덤으로 드래그가 도는 동안 `<html>` 에 `is-pointer-dragging` 을 걸어
지나는 자리의 텍스트가 칠해지지 않게 한다.

### 그 밖

- **Escape 로 되돌린다.** 끄는 조작에는 무르는 길이 있어야 한다 — 없으면 잘못
  집었을 때 빠져나갈 길이 "원래 자리에 정확히 되놓기" 뿐인데, 그 자리는 이미
  이웃들이 비켜서서 어디였는지 알 수 없다.
- **새로 앉은 탭에 등장 모션.** 붙이기·새 탭·프로젝트 열기가 모두 같은 길로
  오므로 판정도 한 곳(직전 렌더에 없던 id)에서 한다. 예고 없이 나타나면 놓은
  자리와 앉은 자리가 같은지조차 눈으로 확인할 수 없다.
- **감쇠를 하나로.** `lib/dragMotion.ts` 로 터미널 고스트와 창 탭 고스트가 같은
  `advanceGhost` 를 쓴다. 두 물체가 다른 속도로 따라오면 같은 앱에서 손이 두
  가지를 배워야 한다.

## 검증

- `pnpm typecheck` · `pnpm test`(1450건) · `pnpm lint` · `pnpm build` ·
  `cargo test`(853건) 전부 exit 0.
- 새 테스트: 순수 13건(`drag_motion.test.ts` — 오버슈트 없음·반드시 앉음·창
  가두기), 스트립 배선 6건(고스트 등장·자국·모드 전환·Escape 되돌리기·자리표시자
  이름·자리 벌리기·등장 모션), Rust 2건(`hovering` 첫 진입 판정·`detached_origin`).
- 세손가락 드래그와 창 두 개 사이 실제 왕복은 헤드리스로 재현할 수 없다 — OS
  제스처 합성과 두 번째 웹뷰가 필요하다. 플래너 `#p8-manual-verify` 로 남겼다.

## 메모

이 라운드의 교훈은 **"판정이 맞았다" 와 "완성됐다" 는 다른 말**이라는 것이다.
Phase 1~7 은 어느 창 위인지, 어느 자리인지, 무엇을 옮길지를 전부 맞췄는데도
사용자에게는 미완으로 보였다 — 직접 조작에서 사람이 확인하는 것은 판정 결과가
아니라 **손에 무엇이 들려 있고 어디에 놓이는가**이기 때문이다.

네이티브 드래그 차단도 같은 모양이다. 표면마다 막는 방식은 "다음 드래그 면"이
생길 때마다 반드시 한 번 더 샌다. 판정을 한 곳으로 올리고 예외를 명시적으로
밝히게 하는 쪽이 유일하게 닫히는 구조다.
