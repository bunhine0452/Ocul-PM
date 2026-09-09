---
schema_version: 1
type: refactor
slug: "screen-container-queries"
status: done
difficulty: medium
created_at: "2026-09-10T00:40:38+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
related: []
tags:
  - "design"
  - "layout"
  - "container-query"
  - "gate"
  - "mcp-tool"
---
[x] 창 크기는 화면이 쓸 수 있는 폭이 아니다 — 그리고 컨테이너를 한 칸 안쪽에 둬야 했던 이유

## 동기

`{#layout-container-query}`. 플래너가 2026-08-23 에 `.pln-body` 로 컨테이너 쿼리 패턴을 세워 두고 사유까지 주석에 적어 놨는데, 그 뒤로 다른 화면에 퍼지지 않았다. 프로젝트 셸의 폭 기반 `@media` 는 딱 둘(`.date-rail` 940 · `.sess-board` 900)이었고 **둘 다 뷰포트 기준**이었다 — 사이드바 248px 나 터미널 도크를 열면 창은 그대로인데 화면만 좁아지는데, `@media` 는 그걸 못 본다.

정본이 이미 있고 한 자리에만 적혀 있던, 이 라운드에서 세 번째로 나온 형태다.

## 실측이 항목을 뒤집은 곳

항목은 접을 격자로 `.stat-row` · `.grid-2` · `.entry-row2` · `.diff-screen` 을 들었다.

- **`.entry-row2` 는 닿지 않는다.** `ManualEntryModalV2` 안, 즉 모달이다. 모달은 `.content-main` 밖으로 포털되므로 containment 가 도달하지 않는다 — 플래너 주석이 이미 "모달 `AppDialog` 는 이 칸 밖" 이라고 적어 둔 그 경우다.
- **`.diff-screen`(284px 1fr) 은 접을 게 아니다.** 좁을 때 파일 목록을 숨기면 돌아올 길이 필요하다. 그건 일관성 수정이 아니라 기능이라 범위 밖으로 뒀다.

## 컨테이너를 `.content-main` 이 아니라 `.page` 에 둔 이유

항목은 `.content-main` 에 걸라고 했다. 걸어 보고 되돌렸다.

`container-type` 은 containment 라 **안쪽의 `position: fixed` 가 뷰포트가 아니라 컨테이너를 기준으로 삼는다.** 플래너가 `PlanHoverCard` 를 body 로 포털해야 했던 이유가 정확히 그것이고, 그 파일 머리 주석이 그렇게 적혀 있다.

`.content-main` 안의 `position: fixed` 열 개를 세어 포털 여부를 확인했더니 넷이 포털하지 않고 있었다 — `.term-ghost` · `.term-block-menu` · `.term-sess-menu`(터미널을 도크가 아니라 **화면**으로 볼 때 `.content-main` 안이다) · `.disc-modal-scrim`(`inset: 0` 인데 화면 칸에 갇히면 창을 못 덮는다). 넷을 포털로 고치는 건 이 항목이 아니다.

접어야 할 격자 다섯은 **전부 `.page` 안**에 있고, 그 넷은 **전부 `.page` 밖**에 있다. 그래서 컨테이너를 한 칸 안쪽에 둔다.

## 접히는 선은 한 벌

`@container screen` 의 **640 / 460**. 컨테이너 조건에는 `var()` 를 못 써서 리터럴일 수밖에 없고, 그래서 값이 흩어지기 제일 쉬운 자리다 — 한 벌로 못 박고 정의 자리에 적었다.

환산도 적어 뒀다: 시트 ≈ 창폭 − 258(사이드바 248 + 셸 여백 10), `.page` 콘텐츠 상자 = 시트 − 56(좌우 28). 옛 `@media 940` 은 이 칸으로 626, `@media 900` 은 586 — 640 이 그 자리를 이어받는다.

붙인 곳: `.date-rail` 숨김 · `.sess-board` 2→1 · `.grid-2` 2→1 · `.stat-row` 4→2(640) → 1(460).

## 게이트

**규칙 18** (`checkViewportMedia`) — 폭 기반 `@media` 를 쓰면 위반. `prefers-*`·`print`·`hover`·`pointer` 는 창 폭과 무관하니 안 본다. 예외는 사이드바도 도크도 없는 전창 표면 둘뿐(시작 탭 `home.css`, 시작 창 `welcome.css`) — 거기서는 창 폭이 곧 화면 폭이라 `@media` 가 옳다. 조건이 여러 줄에 걸칠 수 있어 줄 단위가 아니라 별도 패스다.

## 검증

probe 를 여러 형태로: 한 줄 `@media (max-width:)` · 여러 줄 조건(`@media\n (min-width:) and (max-width:)`) 둘 다 정확한 줄로 잡혔고, `prefers-color-scheme` · `print` · `hover`+`pointer` · `@container` · `design-ignore` 다섯은 통과했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 196파일/2570 · build.

**눈으로 볼 것:** `.page` 에 containment 가 생겼다. 접히는 동작(창을 좁히거나 터미널 도크를 열어 Today·일지·세션을 볼 것)과 함께, `.page` 안의 `position: absolute` 가 바깥 기준을 쓰고 있던 자리가 없는지 확인이 필요하다 — 정적으로는 다 확인했지만 이건 눈이 마지막이다.