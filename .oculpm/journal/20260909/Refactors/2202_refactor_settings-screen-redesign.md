---
schema_version: 1
type: refactor
slug: "settings-screen-redesign"
status: done
difficulty: high
created_at: "2026-09-09T22:02:31+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "55cc0fcc-d3a8-4c54-a4d1-ef78c5bd3ef6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/settings.css"
    op: create
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/settings/tabs/ui.tsx"
    op: update
  - path: "src/features/settings/SettingsSearch.tsx"
    op: update
  - path: "src/features/settings/tabs/AppearanceTab.tsx"
    op: update
  - path: "src/features/settings/tabs/LlmTab.tsx"
    op: update
  - path: "src/features/settings/tabs/DataTab.tsx"
    op: update
  - path: "src/features/settings/tabs/ContextTab.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/settings/MobileSettings.tsx"
    op: update
  - path: "src/windows/SettingsOverlay.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_english_render.test.tsx"
    op: update
related: []
tags:
  - "settings"
  - "design"
  - "ia"
  - "ui"
  - "mcp-tool"
---
[x] 설정 화면 전면 재설계 — 열두 탭이 한 줄에 서 있었고, 라벨이 컨트롤 위에 얹혀 있었다

## 동기

사용자 보고: "설정창이 너무 난잡하고 어렵다."

실측해 보면 근거가 셋이었다.

1. **크롬이 가로 탭 스트립 하나**였다. 탭 12개 · 7,900줄 · 항목 100개가 넘는데
   내비게이션은 `.subnav` 한 줄이고, 좁은 창에서는 `overflow-x: auto` 로 도망가
   열둘 중 대여섯만 보였다. 그룹이 없어 「그래프」와 「모바일」과 「진단」이 같은
   위계로 나란히 섰다. `TABS` 배열은 탭마다 아이콘을 들고 있었지만 렌더에서
   한 번도 쓰이지 않는 죽은 필드였다.
2. **`Field` 가 라벨을 컨트롤 위에 얹었다** (대문자 마이크로 라벨 + 세로 스택).
   항목 하나가 두 줄을 먹고, 컨트롤이 정렬될 축이 없어 스크롤하는 눈이 매번
   라벨을 다시 읽어야 했다. 항목 열둘짜리 탭이 화면 두 개 반이 됐다.
3. **탭을 열면 어디에 왔는지 말해 주지 않았다.** 제목도 설명도 없이 곧장
   `Section` 이 hairline 하나로만 갈린 채 흐른다 — 어디까지가 한 묶음인지
   경계가 안 보였다.

여기에 방언이 하나 더 얹혀 있었다. 언어 3지선다 · 밝게/어둡게/OS · 제공자 넷이
전부 shadcn 어휘(`bg-primary/10 border-primary text-primary` + `rounded-xl`)로
그려져 있었는데, 그 셋이 하필 **설정을 열면 가장 먼저 보이는 물건**이다.
`.subnav` 주석이 2026-07-30 에 같은 방언을 두고 이미 지적한 문제다.

## 변경 요약

### 1. 그룹 있는 세로 레일 (`SettingsPanel.tsx`)

열두 탭을 다섯 묶음으로 접었다 — 일반 · AI · 작업 기록 · 코드 · 시스템.
묶음의 기준은 "사용자가 무엇을 고치러 왔는가" 다.

2026-07-30 에 세로 열을 지웠던 사유는 "왼쪽에 이미 앱 사이드바가 있어 사이드바
속 사이드바가 된다" 였고, 그 지적은 **채워진 패널**에 대해 옳다. 그래서 이
레일은 배경이 없고(캔버스 그대로), 활성도 액센트 채움이 아니라 들어간
면(`--bg-inset`) + 액센트 아이콘이다. 사이드바는 채워진 물체, 레일은 목차다.

탭마다 한 줄 안내(`settings.tabDesc.*`, ko/en 12개씩)를 새로 썼고, 본문 머리가
제목 + 그 문장을 낸다.

### 2. 프리미티브 재설계 (`tabs/ui.tsx`) — 여기가 레버리지다

다섯 개(`Section`/`Field`/`Toggle`/`NumberSlider`/`Stat`)가 탭 열둘의 항목
130곳을 그린다. 탭 파일을 하나도 안 건드리고 화면 전체가 바뀐다.

- `Section` → 카드. 머리에 제목·설명, 몸통에 행들. 몸통의 **직계 자식이 곧
  행**이라(`.cfg-body > *`) 탭들이 넘기는 임의의 div 도 여백·구분선을 그대로
  받는다 — 카드 가장자리에 붙는 컨트롤이 생기지 않는다.
- `Field` → 행. 라벨·설명 왼쪽, 컨트롤 오른쪽 320px 한 열. 여러 줄 입력만
  `:has(textarea)` 로 자동 전폭이라 부르는 쪽이 플래그를 안 넘겨도 된다.
- `Toggle` → 항목마다의 테두리 상자를 버리고 카드 안의 행 + 진짜 스위치
  (`--knob`/`--shadow-knob`).
- `Section` 에 `tone="danger"` 한 갈래를 더해 되돌릴 수 없는 두 구역
  (`settings.danger` · `ctx.danger`)이 스스로를 말한다.

### 3. 검색을 레일 머리로

예전엔 가로 탭 줄 **끝**에 붙은 176px 짜리라, 탭이 넘쳐 가로 스크롤이 생기는
좁은 창에서 검색창이 화면 밖으로 밀려나 있었다 — 정확히 검색이 가장 필요한
폭에서. 이제 레일 머리에 전폭으로 서고, ↑↓+Enter 로 결과까지 키보드로 간다
(검색은 손이 이미 키보드에 있을 때 쓰는 물건이다). 결과 수를 함께 낸다.

### 4. 선택 타일 한 벌 (`.cfg-choice`)

shadcn 방언 셋(언어 · 테마 모드 · 제공자)을 집 어휘로 옮겼다. `.seg` 와 나누어
둔 이유는 크기다 — 세그먼트는 한 물체 안의 칸이고, 이건 아이콘·부제를 품는
떨어져 선 타일이다.

### 5. 그 밖

- `SettingsOverlay` 를 `max-w-4xl`→`5xl` 로 (2열이 서야 한다). 그보다 좁아지면
  `@container cfg (max-width: 720px)` 가 레일을 가로 스트립으로 눕힌다.
- `OculpmSettings`·`MobileSettings` 의 최상위 `space-y-6`(24px)를
  `.cfg-sections`(16px)로 — 같은 화면에서 카드 간격이 두 종류였다.
- `UiScaleSection` 이 손으로 다시 짠 슬라이더 마크업을 `.cfg-slider` 로.
- 새 `features/settings/settings.css` 는 자립한다 — 런처 모달은
  `styles/index.css` 없이 이 패널을 띄운다.

## 하지 않은 것

버튼 방언(shadcn `<Button>` 54 : 집 `.btn` 19)은 손대지 않았다. `<Button>` 은
설정 밖에서도 쓰이므로 설정만 옮기면 **다른 방향의 불일치**가 생긴다 —
`{#unify-toolbar-vocab}` 이 다룰 앱 전역 수렴 작업이다.

`ocul-pm` 탭 안의 `.seg` 하위 5탭(3단계 내비)도 남겼다. 레일로 올리려면 1,254줄
파일에 상태를 실어 날라야 하는데, `.seg` 는 이미 집 프리미티브라 "화면 속 컨트롤"
로 읽힌다.

## 검증

- `pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm build` 각각 exit 0.
- `pnpm test` 195파일 2,551개 전부 통과. `a11y_screens`(axe, ko/en 양쪽)와
  `i18n_english_render` 가 새 마크업을 그대로 문다.
- `i18n_english_render` 의 설정 패널 단언을 `findByText`→`findAllByText` 로
  고쳤다 — 탭 이름이 레일과 본문 머리 두 곳에 뜨는 것이 재설계의 의도다.
- 여백 래칫(`design_tokens`)이 새 CSS 의 램프 밖 값 10곳을 잡아내 전부
  `--space-*` 로 접었다.
- 육안 확인은 못 했다: 설치본이 떠 있어 dev 빌드를 띄우지 않았다
  (번들 id 공유 → app-data·SQLite·`.oculpm` 락 경합).