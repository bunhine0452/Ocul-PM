---
schema_version: 1
type: refactor
slug: "fs-ramp-caps-icon-stroke-sidebar"
status: done
difficulty: high
created_at: "2026-09-09T22:07:42+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/base.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/nav-ia.css"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
related: []
tags:
  - "design"
  - "typography"
  - "sidebar"
  - "i18n"
  - "mcp-tool"
---
[x] 위계를 무게 혼자 지고 있었다 — 램프 반 단·한글 캡스·아이콘 획·사이드바

## 동기

디자인 감사를 돌렸다. 활성 플랜 `design-consistency-round` 가 이미 값 일관성(램프·어휘)을 20항목으로 덮고 있어서, **그 플랜이 보지 않는 층**만 실측했다 — 조판, 위계, 언어별 조판, 광학 무게, 네이티브 스크롤 동작. 확정된 결함 여섯과, 사용자가 지적한 사이드바.

## 변경 요약

**1. 액센트 6색 중 5색에서 「기능」 배지가 깨져 있었다.** 트리거 배지 다섯 중 `.t-feature` 만 자기 색이 아니라 `--accent-text` 를 썼다. 짝인 `--t-feature-soft` 는 `:root` 와 `[data-theme="dark"]` 두 곳에만 있고 `[data-accent]` 열 블록 어디에도 없다 — 액센트를 초록에서 바꾸면 **초록 바탕에 파란(보라·주황·빨강·청록) 글자**가 됐다. 기본 초록만 우연히 맞았다. 이 배지는 `triggerMeta.tsx` 한 곳에서 나와 일지·Today·변경·검색에 전부 뜬다.

**2. 글자 램프 13단 → 10단.** `{#fs-scale-up}` 이 리터럴 20종을 접으면서 잡음을 신호로 보존했다 — 10.5·11.5·12.5 가 살아남았다. 이웃과 구분되지 않는데 이름을 갖고 있어, 램프가 없앴어야 할 "이건 어느 단인가" 를 다시 고르게 했다(그 셋만 274회). 반 단은 **위로** 접었다: 최빈값이 11px(327회)이고, 아래로 접으면 대비 하한에 걸린 10px 구간이 두꺼워진다. 참조 1,012곳 기계 치환.

함께 `{#hierarchy-by-weight-only}`: 글자 크기 사용 1,011회 중 948회(94%)가 9~13px 한 뭉치였고 14px 이상은 전부 합쳐 63회였다. 색도 같은 방향이라 `--text-3`(381) > `--text`(248) > `--text-2`(216) — **가장 약한 글자색이 최빈값**. 위계를 크기도 색도 아닌 무게 혼자 지고 있었다. 화면 제목 15px → 17px, `.section-title`·`.nav-section-label` 의 색을 `--text-2` 로.

**3. 한글에 대문자화 29곳.** `text-transform: uppercase` 는 한글에 아무 일도 안 하는데 짝인 캡스 자간은 그대로 걸린다. 캡스 자간은 라틴 올캡스의 빽빽함을 푸는 **보정**이라, 한글에 걸면 보정할 대상 없이 라벨만 풀어진다. 같은 클래스가 라틴에서는 제대로 작동한다는 게 증거 — 코드 맵의 `.sym-kind`(FUNCTION)는 캡스가 되고 논의의 `.disc-section-title`(「문제 정의」)은 자간만 벌어졌다. 한 클래스가 두 결과를 냈다. `--caps-transform` / `--caps-track` / `--caps-track-lg` 를 `:root:lang(ko)` 에 매달았다 — `<html lang>` 은 `SettingsContext` 가 이미 `:lang()` 용으로 유지하고 있었고, 영어 모드에서는 캡스가 옳은 조판이라 되살아난다.

**4. 스크롤바가 폭을 먹는데 자리를 예약하지 않았다.** `base.css` 가 `::-webkit-scrollbar { width: 10px }` 를 선언하는 순간 WebKit 은 오버레이를 끄고 레이아웃 폭을 차지하는 고전 스크롤바로 바꾼다. 그런데 `scrollbar-gutter` 는 0곳, `overflow: auto` 컨테이너는 49곳 — 목록이 접히는 선을 넘으면 본문이 10px 왼쪽으로 튀었다. `.scroll` 에 `scrollbar-gutter: stable`. macOS 13·14 에서는 무시되고 예전 동작으로 퇴화한다(안전한 쪽).

**5. 아이콘 획이 크기에 정비례했다.** viewBox 24 고정이라 `strokeWidth` 는 비율이고, 실효 두께가 11px→0.92 · 13px→1.08 · 15px→1.25 · 30px→2.50 이었다. 최빈 두 크기(15px 252회 · 13px 236회)가 같은 툴바에 서는데 획이 15% 차이. 손으로 `strokeWidth={2.2}`·`{2.5}` 를 붙인 자리 넷이 그 증상이었다. 크기별 광학 보정을 `base.css` 한 블록에 뒀다 — `width` 는 lucide(`.lucide`)와 수제(`.lucide-icon`)가 둘 다 내보내는 속성이고 CSS 가 presentation attribute 를 이기므로, 호출부 137파일을 한 줄도 안 고치고 전부 따라온다. 실효 두께 범위가 2.7배 → 1.5배로 줄고, dominant 쌍의 차이는 15% → 4%.

**6. 고아 줄 제어가 없었다** (`text-wrap` 0곳). `keep-all` 이 어절 단위 줄바꿈까지는 가져왔지만 마지막 줄에 한 어절만 남는 것은 못 막는다. 제목은 `balance`, 산문은 `pretty`.

**7. 사이드바.** 스크린샷에서 바로 보이던 것들:
- **「터미널」이 목록에 두 번** — 화면(⌘7)과 도크 토글(⌘J)이 같은 이름이었다. 도크는 `term.dock.*`·`keys.dock` 이 이미 쓰는 「터미널 도크」로.
- **첫 그룹만 라벨이 없었다** — 셋은 도구·AI·참고를 달고 하나만 없으면 그 하나가 "전부"로, 나머지가 "예외"로 읽힌다. `sidebar.mainSection` = 「작업」 추가.
- **켜진 도크가 「지금 이 화면」과 픽셀 단위로 같았다** — `terminalDockOpen` 이 `.active` 를 붙이고 있었다. 상태는 `aria-pressed` 가 이미 정확히 말하고 있어서 그것을 그린다. 발밑 셋 중 둘은 동작이고 하나만 목적지라 `.nav-util` 로 갈랐다.
- **활성 표현이 248px 폭 액센트 슬래브 + 링 그림자** — 창 전체에서 가장 대비가 센 물체인데 말하는 내용은 좌표뿐이고, 흰 글자만 광학 무게가 달라 목록 리듬이 그 줄에서 끊겼다. 같은 앱에 더 조용한 '선택됨'이 이미 둘 있었다(`.proj-pop-item.on` 은 `--accent-soft`, `.subnav-item[aria-current]` 은 `--bg-inset`) — 사이드바만 혼자 슬래브였다. 틴트 + 왼쪽 3px 표시자로 바꿔 셋이 같은 문법을 쓴다. 표시자를 함께 두는 이유는 액센트와 표면의 명도가 가까운 프리셋(세피아·고대비)에서 틴트가 거의 안 보이기 때문 — 위치는 어느 팔레트에서도 읽힌다.
- **프로젝트 스위처가 사이드바에서 가장 무거운 물체였다** — 카드 그림자 + hover 승격까지 달고 있었다. 그림자를 빼고 테두리 한 겹만 남겼다.
- **경로가 이 화면만 원시 경로** — `/Users/kimhyunbin/De…` 로 집 경로가 폭을 다 쓰고 정작 프로젝트 이름이 잘렸다. 시작 화면 카드·프로젝트 관리가 이미 쓰는 `tildePath` 로.

## 검증

`pnpm typecheck` · `pnpm test`(195파일 2551건) · `pnpm lint`(6게이트, 경고 9 = 기존 상한) · `pnpm build` 모두 exit 0. `design_tokens.test.ts` 에 램프 계약을 다시 못박았다 — "열 단으로 끝난다 · 이웃과 1px 이상 · 전부 정수" 라 반 단이 다시 생기면 붉어진다.

병렬 세션이 같은 플랜을 작업 중이라 커밋은 임시 인덱스 + `commit-tree` + CAS `update-ref` 로 구성했다. `ko.ts`·`en.ts`·`code.css` 등에 상대 세션의 미커밋 변경이 섞여 있어서, 그 파일들은 워킹트리가 아니라 **HEAD 에 내 기계 변경만 얹은 블롭**으로 스테이지했다. 커밋 후 상대 작업이 워킹트리에 온전한지 확인했다(`settings.group.*` 잔존, 수정 파일 102개).