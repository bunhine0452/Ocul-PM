---
schema_version: 1
type: feature
slug: project-appearance
status: done
created_at: 2026-08-12T22:24:06+09:00
session_id: "manual-20260812-222406"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/migrations/027_project_appearance.sql
    op: create
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src/features/onboarding/home/projectAppearance.ts
    op: create
  - path: src/features/onboarding/home/AppearancePicker.tsx
    op: create
  - path: src/features/onboarding/home/ProjectCard.tsx
    op: update
  - path: src/features/onboarding/home.css
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/windows/StartTab.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/project_appearance.test.ts
    op: create
  - path: src/__tests__/start_screen.test.tsx
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260812/Refactors/2130_refactor_home-grid-overhaul.md
tags: [home, cards, identity, a11y, migration]
---

[x] 프로젝트 겉모습 — 카드 전체 클릭 · 색 8종 · 아이콘 10종

## 추가 기능

**① 카드 전체가 클릭 판정.** 예전에는 이름 글자만 눌렸다. 카드를 통째로 `<button>` 으로 감싸는 방법은 쓸 수 없다 — 안의 ✎/🗑 이 중첩 인터랙티브가 되어 axe 위반이다. 이 코드베이스에 이미 있던 "스트레치 오픈" 규약을 그대로 쓴다: 작은 버튼 하나(`.home-open`)가 `::after` 로 카드를 덮고, 액션 버튼은 `.home-above` 로 그 위에 뜬다.

**② 프로젝트별 색 8종** (slate·green·blue·violet·amber·rose·teal·orange).

**③ 프로젝트별 아이콘 10종** (폴더·터미널·브랜치·일지·목표·반짝임·봇·퍼즐·검색·별).

②③ 은 이름 변경 다이얼로그를 **프로젝트 편집**으로 넓혀서 한 자리에서 고른다 (⌘E·✎ 진입로 그대로).

## 동작 흐름

**저장하는 값은 hex 나 컴포넌트가 아니라 id 문자열이다** (`"terminal"`, `"amber"`). 이유 둘:

- 라이트/다크/프리셋 5종에서 같은 hex 는 성립하지 않는다. id 로 두면 각 테마가 자기 팔레트로 해석한다 (`[data-pc]` 블록이 라이트/다크 두 벌).
- 아이콘은 React 컴포넌트라 애초에 값으로 저장할 수 없다.

**고르지 않은 프로젝트는 이름 해시로 결정적 기본값을 받는다.** 무작위가 아니라 해시인 이유: 같은 프로젝트가 창을 옮기거나 앱을 재실행해도 같은 색이어야 "색으로 구별한다" 는 목적이 성립한다. 중성색(slate)은 유도에서 제외한다 — 안 고른 프로젝트가 전부 회색이면 기능 자체가 없는 것과 같다.

색은 **아이콘 자리에서만** 살아 있다. 본문 글자색은 건드리지 않는다 — 카드 8장이 각자 다른 글자색을 가지면 목록이 읽히지 않는다. 색은 **식별자**지 의미가 아니다.

탭 스트립도 같은 아이콘·색을 쓴다 (`TabInfo` 에 두 필드 추가). 두 화면에서 같은 프로젝트가 다르게 보이면 식별이라는 목적이 무너진다.

선택기는 라디오 그룹 두 개다 — 각 축에서 정확히 하나, ←→ 로 이동, 그룹당 탭 스톱 1개. 고른 아이콘은 **지금 고른 색으로** 미리 보인다.

## 검증

`pnpm typecheck` · `pnpm test`(59파일 **736**) · `pnpm lint` · `pnpm build`(+CSS 가드) · `cargo test`(12스위트 0실패) 전부 exit 0 을 직접 확인.

신규 프런트 테스트 13개 — 목록 개수·id 유일성, 저장값 우선, **결정성**(같은 이름 = 항상 같은 색), 유도가 중성색을 안 쓴다, 알 수 없는 id 는 유도로 폴백, 이름이 다르면 색이 갈린다. 카드 쪽은 히트박스 구조(`.hg-name.home-open` 존재 + 카드가 `<button>` 이 아님)와 색·아이콘 실림을 고정했다.

## 메모

- **마이그레이션 SQL 을 만들고 `db.rs` 의 `MIGRATIONS` 배열에 등록하지 않았다.** 파일만 있으면 아무 일도 일어나지 않는다 — `lite_w6_safety_net` 통합 테스트가 `no such column: icon` 으로 정확히 잡았다. 유닛 테스트는 전부 통과하고 있었다.
- **시각 의존 플레이크 하나를 함께 고쳤다** (내 변경과 무관, 22:20:xx 에 밟았다). `create_manual_entry_handles_filename_collision_with_suffix` 는 파일명의 `HHMM` 이 같아야 충돌이 나는데 두 번만 써서, 분 경계를 넘으면 접미사가 안 붙어 실패했다. 세 번 쓰도록 바꿨다 — 마이크로초 단위 테스트가 분 경계를 두 번 넘을 수는 없으므로 적어도 둘은 같은 분이다.
- **실기기 확인 필요**: 카드 아무 데나 눌러 열리는지(✎/🗑 은 각자 동작), 편집에서 고른 색·아이콘이 카드와 **탭**에 함께 반영되는지, 다크/프리셋에서 8색이 전부 읽히는지.

---

## 후속 (22:32) — 도구 아이콘 → 성격 있는 글리프

사용자 피드백: *"아이콘 이런거 말고 진짜 좀 귀여운것들로"*. 폴더·터미널·브랜치·목표…는 **도구 아이콘**이라, 열 개를 나란히 놓아도 서로 구별되기보다 "설정 화면 같은" 인상만 남았다.

새 10종: 고양이 · 발바닥 · 유령 · 로켓 · 선인장 · 버섯 · 행성 · 커피 · 꽃 · 아이스크림.

### 왜 이모지가 아닌가

색이 아이콘에 입혀지는 구조(`--pc`)라 **이모지는 쓸 수 없다** — 자기 색을 가지고 있어 `currentColor` 를 따르지 않는다. 프로젝트 색을 고르는 기능 전체가 무의미해진다. 그래서 앱의 기존 선화 언어(`viewBox 24`, `currentColor`, round cap)로 직접 그렸다.

고를 때의 기준은 "귀엽다" 만이 아니라 **15px 실루엣 구별**이다. 동물 얼굴을 여럿 넣으면 작은 크기에서 전부 같은 원으로 보인다 — 뾰족(로켓)·둥금(유령)·기둥(선인장)·물결(아이스크림)처럼 윤곽이 겹치지 않게 골랐다.

### 회귀 방지

직접 그린 선화는 `d` 오타 하나면 **아무 것도 안 그려진 빈 사각형**이 된다 — 타입도 렌더도 통과하고 화면에서만 사라진다. 열 개 전부를 렌더해 도형이 1개 이상 있고 `path` 의 `d` 가 비어 있지 않은지 확인하는 테스트를 넣었다. `stroke="currentColor"` 검사도 함께 — 그게 깨지면 프로젝트 색이 조용히 안 먹는다.

게이트 5종 exit 0 (프런트 **738**, cargo 12스위트 0실패).

### 남은 것

**모양 자체는 눈으로 확인하지 못했다.** 테스트는 "비어 있지 않다" 까지만 보증한다 — 선이 어긋나 이상한 형태로 그려지는 것은 실기기에서 봐야 한다.
