---
schema_version: 1
type: feature
slug: chrome-tear-off-real-window
status: done
created_at: 2026-08-29T19:49:00+09:00
session_id: manual-20260829-194900
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/windowRoute.ts
    op: update
  - path: src/main.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/lib/nativeDrag.ts
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: update
  - path: src/__tests__/multi_window.test.tsx
    op: update
  - path: src/__tests__/drag_motion.test.ts
    op: update
related:
  - 20260829/Features_to_add/1910_feature_tear-off-and-merge-motion.md
tags: [tabs, windows, drag, chrome, tauri]
---

[x] 탭을 끌면 **진짜 창**이 떨어져 나와 커서를 따라온다 — 크롬과 같은 물건으로

## 발생 원인

사용자 지적: "크롬 탭창 분리 이동과 똑같이 만들어달라니까?"

바로 앞 라운드(1910)에서 만든 것은 **창 안에 갇힌 고스트**였다. 탭 모양의
`position: fixed` 조각이 커서를 따라다니고, 커서가 창 밖으로 나가면 웹뷰가 자기
창 밖을 못 그리므로 가장자리에 붙어 멈췄다. 놓아야 비로소 창이 생겼다.

크롬은 다르다. 탭이 줄을 벗어나는 **그 순간** 창이 되고, 그 뒤로는 OS 가 창을
옮긴다. 사용자는 결과의 미리보기를 보는 게 아니라 **결과를 직접 들고 있다.**
그래서 화면 밖으로도, 다른 앱 위로도 자유롭게 간다.

두 개는 닮은 것이 아니라 **다른 물건**이다. 요청은 처음부터 크롬 쪽이었다.

## 해결 방법

### 줄을 벗어나는 순간 창이 된다

`begin_tear_off` — 탭을 원래 창 레지스트리에서 빼고, 그 자리에서 진짜 창을
만들어 `tearing` 으로 기억한다. 원래 창의 줄은 즉시 메워진다(크롬과 같다).
포인터가 움직일 때마다 `tab_drag_over` 가 세 가지를 한 번에 한다.

1. 들고 있는 창을 `cursor − anchor` 로 옮긴다. 커서는 OS 에서 물리 px 로 받아
   그 창의 배율로 나눈다 (결정 2 — 웹뷰 줌에 안 흔들리는 유일한 좌표계).
2. 남의 스트립을 겨누는지 히트테스트한다 (들고 있는 창은 제외).
3. 겨누면 들고 있는 창을 **감춘다** — 크롬의 합치기 미리보기다. 그쪽 줄에는
   이미 자리가 벌어져 있으므로(1910 의 `.tabstrip-slot`), 놓기 전에 결과가
   그대로 보인다. hide/show 는 **바뀔 때만** 부른다 (매 틱이면 깜빡인다).

놓으면 `drop_tear_off`: 겨누던 창이 있으면 그리로 합치고(들고 있던 창은 비어서
닫힌다), 없으면 그 자리에 그대로 남는다. Escape 는 `cancel_tear_off` 로 탭을
**원래 자리**(`source`·`index`)에 돌려놓는다.

### 끌려다니는 동안에는 화면을 마운트하지 않는다

떼어낸 창은 `?tearoff=1` 로 뜬다. 탭 줄만 그리고 `.tabpanes` 는 비운다 —
끌려다니는 몇백 ms 동안 프로젝트 init·워처·자동색인을 돌릴 이유가 없고, 도로
남의 창에 합치면 그 창은 그대로 닫히므로 **그 전부가 순수 낭비**다. 손을 놓는
순간 `TearOffSettled` 가 그 손을 풀어 준다. 부트 스플래시도 그동안은 안 띄운다
(탭 줄을 덮으면 무엇을 들었는지 안 보인다).

### 포인터 캡처를 스트립이 쥔다

떼어내는 순간 그 탭은 이 창에서 **언마운트된다.** 캡처를 탭 엘리먼트에 걸어
두면 그때 캡처가 함께 사라져 남은 `pointermove`/`pointerup` 이 오지 않는다 —
창이 손을 놓친 채 커서만 따라다니게 된다. 그래서 캡처도 핸들러도 스트립으로
올렸다. 안전망으로 `lostpointercapture` 를 놓기로 취급한다.

### 떼어낸 창의 탭은 **새 id** 를 받는다

구현 도중 잡은 결함이다. 창을 만들 때 탭이 새로 발급되므로(`reserve` →
`register` → `mint`), 프런트가 들고 있던 옛 id 로 놓기·무르기를 부르면 그 탭은
어디에도 없다. 실패 모양이 고약하다: 창은 떴는데 놓아도 합쳐지지 않고 Escape 도
안 먹는다. 그래서 새 id 를 `TearOff.tab_id` 에 기록하고, `drop_tear_off` /
`cancel_tear_off` 는 **id 를 아예 받지 않는다** — 들고 있는 쪽이 자기 기록으로
마무리한다.

### 걷어낸 것

고스트(`.tabstrip-ghost`)와 그 자국(`.torn`), 스트립 흐려짐(`is-detaching` /
`is-handoff`), 고스트 문구 i18n 2개, `clampGhost`, 그리고 `attach_tab` 커맨드
(`drop_tear_off` 가 대신한다). 자리표시자(`.tabstrip-slot`)와 등장 모션은
그대로 남는다 — 그건 받는 쪽 이야기라 크롬과 같은 자리에 있다.

## 검증

- `pnpm typecheck` · `pnpm test`(1450건) · `pnpm lint` · `pnpm build` ·
  `cargo test`(921건) 전부 exit 0.
- Rust 3건: `?tearoff=1` URL, hide/show 가 전이에서만 보고하는지,
  **떼어낸 창이 새 탭 id 를 발급하는지**(위 결함의 회귀 카나리아).
- 스트립 배선 6건: 줄을 벗어나면 이동량이 지워지고 `onTearOff` 가 한 번만 도는지,
  캡처를 스트립이 쥐는지, Escape 가 창을 물리는지, 문턱 전 취소는 창을 안 만드는지.
- **실기기 확인이 남았다.** 두 가지는 헤드리스로 증명할 수 없다: ① 포커스를
  뺏지 않는 창이 떠도 원래 창이 계속 `pointermove`/`pointerup` 을 받는가(macOS 는
  mouseDown 을 받은 창에 드래그를 계속 배달하므로 성립할 것으로 본다 — 안전망은
  깔았다), ② 창 생성 지연(웹뷰 부팅) 이 손맛으로 느껴지는 정도.

## 메모

"고스트냐 진짜 창이냐" 는 구현 선택이 아니라 **무엇을 만드는가**의 차이였다.
사용자는 크롬을 지목했는데 나는 "창 밖으로는 못 그리니까" 라는 제약에서
출발해 다른 물건을 만들었다. 제약이 진짜였어도(웹뷰는 자기 창 밖을 못 그린다)
결론이 틀렸다 — 답은 그리는 게 아니라 **창을 만드는 것**이었다.
