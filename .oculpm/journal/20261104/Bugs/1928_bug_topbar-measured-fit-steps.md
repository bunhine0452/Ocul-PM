---
schema_version: 1
type: bug
slug: "topbar-measured-fit-steps"
status: done
difficulty: medium
created_at: "2026-11-04T19:28:03+09:00"
session_id: "20261104-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2d22bf7f-6405-4d02-807b-8e7aa8da8901"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/useTopbarFit.ts"
    op: create
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/__tests__/topbar_fit.test.ts"
    op: create
related:
  - ref: "20261104/Features_to_add/1824_feature_start-window-tile-choices-mono-icon.md"
    kind: "followup"
tags:
  - "윗줄"
  - "ui"
  - "shell"
  - "mcp-tool"
---
[x] 윗줄: 재서 접어 새 세션 단추가 안 잘린다

## 발생 원인

사용자 스크린숏(11-04, 4.7.0 설치본, 터미널 탭, 약 750pt 창): 「상단에 굵은 줄 없애고, 새 세션 · 찾기 버튼이 창이 협소할 때 잘리는 부분을 해결해」.

- 윗줄은 640 · 780 · 900 같은 고정 폭 선(@media)으로 접혔다. 그런데 「화면 동작」 폭은 화면마다 다르다: 작업 일지 86px, 터미널은 「+ 새 세션 ⌘T · 나란히 · 위아래 · 여럿에서」 283px.
- 그래서 한쪽에 선을 맞추면 다른 쪽이 깨졌다. 앞 작업(#166)의 780 · 900 선은 작업 일지에 맞췄다. 하네스 실측으로 터미널 창 800~1000 에서 프로젝트 이름이 0~82px 로 짓눌렸다(800 에서 점 하나).
- 4.7.0 은 640 선이라, 그 위 폭에서 줄 안 스크롤 칸이 「새 세션 ⌘T」 를 잘랐다.
- 위 가장자리의 3px 색 띠(`inset 0 3px 0 var(--pc)`)는 사용자가 「굵은 줄」 이라 했다.

## 해결 방법

- **재서 접기:** `features/shell/useTopbarFit.ts` 가 윗줄이 실제로 들어가는지 재서(`neededWidth`) 한 단계씩 올린다. `data-fit` 단계:
  1. 단축키 표시(⌘T · ⌘K)를 감추고 찾기는 돋보기
  2. 탭 이름을 아이콘으로
  3. 화면 동작을 「⋯」 메뉴로
- **들어간다는 뜻:** 프로젝트 이름이 제 폭(길면 140px)을 받고도 줄이 넘치지 않는 것이다.
- **되돌리기:** 단계마다 잰 필요 폭을 기억해, 앞 단계가 다시 들어가면(여유 12px) 내린다.
- **다시 재기:** 화면 동작 칸의 내용이 바뀌면(MutationObserver, 화면 전환) 처음부터 다시 잰다. CSS 로 감추는 것은 내용 변화가 아니라서 단계 ↔ 측정이 서로를 부르지 않는다.
- **CSS:** @media 640 / 780 / 900 덩어리를 걷고 `.topbar[data-fit…]` 규칙으로 옮겼다. ≤460 미디어는 그대로다. 화면 동작은 `flex-shrink: 0` 이라 잘리지 않고, 이름은 56px 아래로 짓눌리지 않는다.
- **색 띠:** 3px 띠를 걷었다. 창은 윗줄 면과 이름 알약만으로 갈린다.

## 검증
- 하네스 실측:
  - 터미널: 1100 → 0, 1000 → 1, 900 → 2, 800 · 640 → 3, 520 → 3(이름 125px)
  - 작업 일지: 900 → 0, 760 → 2(「+ 새 일지」 보임), 640 → 3
  - 어느 폭에서도 잘린 단추와 0px 이름이 없다.
- `pnpm typecheck` · `pnpm lint` · `pnpm build`: 0. `pnpm test`: 1069 passed. 새 `topbar_fit.test.ts` 가 폭 선 · 3px 띠가 없고 단계 규칙이 있는지 본다.