---
schema_version: 1
type: feature
slug: "ui-density-round"
status: done
difficulty: high
created_at: "2026-10-28T04:21:20+09:00"
session_id: "20261028-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/density.ts"
    op: create
  - path: "src/hooks/useDensity.ts"
    op: create
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/main.tsx"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/components/DensityToggle.tsx"
    op: create
  - path: "src/features/settings/tabs/DensitySection.tsx"
    op: create
  - path: "src/features/settings/tabs/AppearanceTab.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/EvidenceCard.tsx"
    op: create
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/planner/PlanBody.tsx"
    op: update
  - path: "src/styles/density.css"
    op: create
  - path: "src/styles/index.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/paths.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src/__tests__/sidebar_density.test.tsx"
    op: create
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
  - path: "src/__tests__/sidebar_scroll.test.tsx"
    op: update
  - path: "src/__tests__/acp_working_indicator.test.tsx"
    op: update
  - path: "src/__tests__/language_sync_toast.test.tsx"
    op: update
  - path: "src/__tests__/plan_body_upgrade.test.tsx"
    op: update
related: []
tags:
  - "ui-density-round"
  - "sidebar"
  - "today"
  - "planner"
  - "journal"
  - "settings"
  - "mcp-tool"
---
[x] UI 밀도 라운드 — 간단/전문 토글, 사이드바 세 단, 오늘 세 질문, 일지 증거 카드, 플래너 완료 조건 머리글

## 추가 기능

시안 17장(claude.ai/artifact/GUnxubRtCWw11JAJwavzSg)을 두 기준 — ① 초보~심화 모두 ② Rieseberg(고도·깊이·범위) + 코딩 에이전트 최고의 결과 — 로 점검하고, 점검에서 드러난 빈틈까지 포함해 핵심 등급 화면에 구현했다.

- **밀도 설정** — `ui_density`(SQLite, `lib/settings.ts`), `lib/density.ts`(`simple|pro`, 기본 simple, `clampUiDensity`/`toggleUiDensity`, `DENSITY_TOGGLE_EVENT`), `hooks/useDensity.ts`(프로바이더 밖에선 simple 읽기·set 무시) + `DensityShortcut` 수신기를 `main.tsx` 의 SettingsProvider 안에 **한 번** 마운트. `useGlobalShortcuts` 가 ⌘. 로 이벤트를 쏜다.
- **사이드바 세 단** — `navRegistry.NavEntry.tier`(core/viewer/hold, PROMISE 등급 그대로). `Sidebar` 는 `NavSection` 하나로 세 단을 그린다: 핵심은 항상, 간단 밀도의 도구·베타는 토글 뒤에 접힘(행 수·「결함 수정만」 태그), 그 단의 화면이 활성이면 자동 펼침. 전문은 전부 펼침·토글 없음. 옛 4그룹(main/tools/ai/ref)은 `group` 으로 남겨 두어 nav_registry 테스트 불변.
- **툴바 토글** — `DensityToggle`(seg 프리미티브)을 `Toolbar` 에 한 번 두어 열세 화면이 전부 갖는다. 프로바이더 밖이면 그리지 않는다. 설정 「모양」 첫 섹션 `DensitySection`(radio, 누구를 위한 것인가 한 줄).
- **오늘 세 질문** — 간단 밀도: `.today-cols` 세 칼럼 ① 무엇을 했나(하이라이트·어제 3) ② 믿을 수 있나(성적표·미기록·일지 없는 세션) ③ 다음은(다음 할 일·플랜 갱신·논의 대기) + `<details class="today-more">`(통계·에이전트별·주간·반복 수정·속도·롤업·커밋 그래프·빠른 터미널 — DOM 에 전부 있음). 전문: 기존 배치 그대로. `statsBlock/proGrid/proTrailing/simpleMore` 네 묶음으로 같은 카드를 두 번 그리지 않는다.
- **일지 증거 카드** — `EvidenceCard`: 「## 검증」 칸 줄(최대 8)을 등급 필(증거 있음/칸만/칸 없음)과 함께 제목 바로 아래. error·chore 는 칸이 있을 때만.
- **플래너 머리글** — 백엔드 `PlanDetail.done_when/check`(`LoadedPlan` 이 디스크에서 읽음), `PlanBody` 에 완료 조건·확인 명령(복사)·없으면 「없어요」 한 줄, 리프가 전부 닫혔는데 active 면 「항목 완료는 목표 달성이 아니에요」 띠(확인 명령 복사). `project.rs` 가 래칫에 걸려 경로 도우미 셋을 `paths.rs` 로 갈랐다(재수출로 호출부 불변).
- CSS 는 `styles/density.css` 신설(screens.css 2,469줄 래칫). 컨테이너 쿼리·`--lh-*`·`--dur-*` 토큰 규율 준수.

## 동작 흐름

앱 시작 → 설정에서 `ui_density` 를 읽어(없으면 simple) 사이드바가 핵심 4 + 접힌 두 단을 그린다 → 오늘 화면은 세 질문 칼럼, 보조 카드는 「더 보기」 → ⌘. 또는 툴바 토글/설정 라디오 → SQLite 저장 → 모든 창·화면이 전문 밀도로(세 단 펼침, 2단 격자, 토글 없는 라벨). 일지를 열면 제목 아래 증거 카드, 플랜을 열면 완료 조건 → 확인 명령 → 항목 순.

**구현하지 않은 시안**: 터미널 명령 블록·결과 끝 줄 손잡이(보류 등급 「결함 수정만」 규칙), 시작 탭 「오늘 어디서부터」, 검색/브랜치/논의/스킬 화면의 재배치(뷰어 등급 — 다듬기 범위지만 이 라운드 밖). 플랜 `{#deferred-decision}` 에 남겼다.

## 검증

- `pnpm typecheck` exit 0 · `pnpm test` 260 files / 3296 passed (새 `sidebar_density.test.tsx` 5건, `today_v2` 간단 밀도 1건; 구조 테스트 넷은 전문 밀도로 고정) · `pnpm lint` 6게이트 clean(경고 4 기존) · `pnpm build` ✓ built
- `cargo fmt` · `cargo clippy --all-targets --locked -- -D warnings` 0 · `cargo test --lib -- planner` 99 passed · `export_bindings` 재생성(PlanDetail.done_when/check)
- 설치본 육안은 `{#eyes-density}` — 사용자 몫

## 메모

- 옛 설치 플러그인 MCP 가 `done_when`/`check` 를 또 버렸다 — 플랜 파일에 손으로 넣었다. 플러그인 업데이트 전까지 매번 grep 으로 확인.
- 구조 테스트(sidebar_a11y/scroll, acp_working_indicator, today_v2)는 `vi.mock("@/hooks/useDensity")` 로 전문 밀도를 본다 — 기본이 simple 이라 접힌 행을 못 찾는다.
- 래칫: TodayScreenV2 693/800, project.rs 836(이전 852 → 줄었음), Sidebar 600대.