---
schema_version: 1
type: bug
slug: tabstrip-css-in-lazy-chunk
status: done
created_at: 2026-08-12T21:28:27+09:00
session_id: "manual-20260812-212827"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/styles/tabs.css
    op: create
  - path: src/styles/shell.css
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
related:
  - .oculpm/journal/20260812/Features_to_add/2101_feature_start-tab-and-theme-sync.md
tags: [css, tabs, chunking, regression]
---

[x] 탭 스트립이 무스타일로 떠서 세로로 쌓이던 문제 — CSS 가 lazy 청크 안에 있었다

## 발생 원인

탭 스트립 CSS 를 `src/styles/shell.css` 에 넣었는데, 그 파일은 `styles/index.css` 를 통해 **`ShellV2` 만** 임포트한다. `ShellV2` 는 프로젝트 탭이 마운트될 때 로드되는 lazy 청크다.

그래서 **시작 탭만 있는 창**(= 앱을 켜자마자 보는 화면)에는 `.tabstrip` / `.winroot` / `.tabpanes` 규칙이 아예 없었다. 결과:

- `.tabstrip` 의 `display:flex` 가 없어 아이콘·이름·×·+ 가 **세로로 쌓였다**
- `.winroot` 배경이 없어 창 상단이 흰 띠로 남았다 (앱은 다크인데)
- `.tabpane` 의 `position:absolute` 가 없어 시작 화면이 스트립 **아래로 밀려** 잘렸다

`App.css` 는 이미 이 함정을 주석으로 경고하고 있었다 — *"⚠️ styles/index.css(base/shell/primitives/screens)는 절대 전역화하지 말 것"*. 그 경고는 "index.css 를 전역화하지 마라"였는데, 나는 반대 방향의 실수를 했다: **항상 필요한 것을 lazy 쪽에 넣었다.**

## 해결 방법

탭·창 셸 CSS 를 `src/styles/tabs.css` 로 떼어내고 `TabbedWindow` 가 직접 임포트한다. 탭은 트레이를 뺀 **모든** 창에 항상 있으므로 셸 청크에 얹힐 이유가 없다. 파일 상단에 왜 여기 있어야 하는지(그리고 index.css 계열에 두면 무슨 증상이 나는지)를 못 박아 뒀다.

토큰은 `App.css` 가 이미 `styles/tokens.css` 를 전역화해 둔 덕에 그대로 쓸 수 있었다 — 색·간격·모션 변수는 어느 창에서나 살아 있다.

`.tabpane` 에 `background: var(--bg-window)` 를 준 것도 같은 맥락이다. 예전 런처는 별도 창이라 body 배경을 썼는데, 시작 화면이 탭이 되면서 그 배경을 물려받을 곳이 없어졌다.

## 검증

`pnpm build` 로 `TabbedWindow` CSS 청크가 19.0KB → 23.3KB 로 늘어난 것을 확인 — 탭 CSS 가 실제로 그 청크에 들어갔다는 뜻이다. typecheck / test(725) / lint / build / `cargo test` 전부 exit 0.

## 메모

스크린샷이 아니었으면 못 잡았을 종류의 버그다. 코드·타입·테스트 어느 쪽도 "이 CSS 가 이 창에 도달하는가"를 검사하지 않는다. jsdom 은 CSS 를 적용하지 않으므로 vitest 도 영원히 통과한다 — **번들 경계를 넘는 스타일 의존은 자동 검증 사각지대**다.
