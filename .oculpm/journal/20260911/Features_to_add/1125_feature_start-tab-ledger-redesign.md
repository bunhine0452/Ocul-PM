---
schema_version: 1
type: feature
slug: "start-tab-ledger-redesign"
status: done
difficulty: high
created_at: "2026-09-11T11:25:53+09:00"
session_id: "20260911-005"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "src/features/onboarding/home/homeModel.ts"
    op: update
  - path: "src/features/onboarding/home/ProjectRow.tsx"
    op: create
  - path: "src/features/onboarding/home/LeadBand.tsx"
    op: create
  - path: "src/features/onboarding/home/ProjectCard.tsx"
    op: delete
  - path: "src/features/onboarding/home/chrome.tsx"
    op: update
  - path: "src/features/onboarding/home/tiles.tsx"
    op: update
  - path: "src/features/onboarding/home/rows.tsx"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "scripts/check-critical-css.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/start_screen.test.tsx"
    op: update
related: []
tags:
  - "home"
  - "start-tab"
  - "design"
  - "ledger"
  - "mcp-tool"
---
[x] 시작 탭(새 탭 화면) 전면 리디자인 — 사용자 요청 "공격적으로 수정해서 전면 업그레이드"

## 추가 기능

**진단.** 2026-08-12 격자(같은 크기의 카드 14장)는 "전부 보인다" 는 지켰지만 **순위** 를 잃었다 — 상자 14개가 같은 무게로 늘어서면 눈은 위계가 아니라 패턴을 읽고, 1위의 그림자 한 겹은 14장 사이에서 안 보였다. 검색 밴드는 흐름 레일 위까지 전폭으로 뻗어 폭만 먹었고, 바닥은 초안 두 줄·명령 네 개·커서 이름을 세운 액션 바가 세 줄이었다. 이건 정확히 "SaaS 카드 키트" 였다.

**원장 리디자인** (`home.css` 재작성 · 클래스 접두 `hl-`):

1. **사령탑 밴드** (`LeadBand.tsx`) — 순위 1위 하나가 창 전폭 밴드로 승격. 이름은 램프 꼭대기 `--fs-9` bold, 그 아래 mono 경로·시각·「오늘 N건」, 다음 할 일 한 줄. 오른쪽에 14일 맥박(200×48, 막대 6px)과 「14일 N건」, 활성 플랜이 있으면 제목 + 진행 막대. 2026-08-12 의 교훈(340px 타일이 화면 절반)을 지켜 높이는 텍스트가 정하는 약 110px. 첫 집계 전에도 밴드는 서고 집계 칸만 스켈레톤 — 밴드 통째로 스켈레톤이면 커서 평면의 첫 행(=탭 스톱)이 화면에 없는 벤토 회귀가 되살아난다(테스트가 잡았다).
2. **시간대 원장** (`ProjectRow.tsx` · `homeModel.groupByRecency`) — 나머지를 「오늘 / 7일 안 / 14일 안 / 2주 넘게 조용함」 묶음으로. 헤더가 순위의 **근거** 를 글자로 말하고(사이드바 섹션 라벨과 같은 hairline 꼬리 문법), 경계는 `isQuiet` 와 같은 자를 써서 흐린 행과 조용함 묶음이 어긋나지 않는다. 행은 `[마크 24 | 이름·경로 / 다음 할 일 | 태그 auto | 맥박 64 | 시각 60 | 액션 56]` 고정 열 — 이름·할 일 길이가 오른쪽 열을 흔들지 않아 세로로 훑힌다. 커서는 왼쪽 3px 액센트(사이드바 활성 표시자와 같은 어휘). 검색 중에는 사령탑·묶음이 빠지고 점수순 단일 목록.
3. **면** — 페이지 `--bg-content`, 상자·그림자 0. 흐름 레일만 `--bg-sidebar` + 왼쪽 hairline 으로 한 톤 가라앉아 "곁" 임을 말한다. 검색은 전폭 밴드에서 원장 머리(44px, 밑줄 포커스)로 내려와 흐름 머리와 한 선에서 만난다.
4. **바닥 한 줄** — 초안을 한 줄로 접고(`이름 · N 단계에서 멈춤`), 액션 바의 커서 이름을 뺀 고정 키 힌트(`HomeKeyHints`)로 바꿨다. 이름 폭이 매번 변해 줄바꿈→띠 높이→원장 높이가 튀던 2026-09-02 문제의 원인 자체를 제거.
5. 추가 카드(격자 마지막 칸) 삭제 — 레일 버튼과 바닥 ⌘O·⌘N 이 이미 두 번 말한다. 레일 버튼은 `.btn ghost sm` / `.btn primary sm` 프리미티브로.

빌드 게이트 `check-critical-css.mjs` 의 필수 선택자를 `.hg-grid/.hg-card` → `.hl-lead/.hl-ledger/.hl-row` 로. `primitives.css` 칩 가족의 `.hg-lead-chip` → `.hl-chip`. 새 i18n 키 5개(`home.group*` 4 + `home.pulseLabel`).

## 동작 흐름

데이터·핸들러·키보드 계약은 무변경: `home_brief` 1콜, 로빙 tabindex, 스트레치 오픈(`.home-open::after`), ⌘E/⌘⌫ 는 포커스 행에만, IME 조합 가드, `flat` 순서 = 화면 순서(사령탑→묶음 순 원장→초안→명령). 모델은 `lead`·`groups` 두 필드만 늘었다.

## 검증

- typecheck · lint 6게이트 · vitest 205파일 2647건 · build(critical-css 게이트 포함) 전부 exit 0. `start_screen.test` 는 격자 선택자를 원장으로 옮기고 묶음 헤더 계약 1건을 더했다.
- 설치본이 돌고 있어 dev 빌드 대신 하네스(vitest DOM 덤프 14프로젝트 fixture + 빌드 CSS + http.server + Chrome 스크린샷)로 라이트/다크·행 hover(이름 프로젝트색·✎🗑 노출)·조용함 묶음 흐림·검색 밑줄 포커스를 봤다. 하네스 파일은 지웠다.
- WKWebView 실기기·프리셋 5종·1080px 이하 접힘은 안 봤다 → v3-release `{#eyes-start-ledger}` 로 이월.