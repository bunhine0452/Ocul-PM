---
schema_version: 1
type: feature
slug: pr-ui1-sidebar-shell-theme
status: done
difficulty: high
created_at: "2026-05-31T18:26:32+09:00"
updated_at: "2026-05-31T18:26:32+09:00"
session_id: "20260531-m02"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/components/Sidebar.tsx
    op: create
    bytes_added: 5200
    bytes_removed: 0
  - path: src/components/Toolbar.tsx
    op: create
    bytes_added: 800
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: create
    bytes_added: 3100
    bytes_removed: 0
  - path: src/__tests__/sidebar_a11y.test.tsx
    op: create
    bytes_added: 4000
    bytes_removed: 0
  - path: src/styles/base.css
    op: update
    bytes_added: 1100
    bytes_removed: 50
  - path: src/styles/shell.css
    op: update
    bytes_added: 3600
    bytes_removed: 50
  - path: src/styles/primitives.css
    op: update
    bytes_added: 3500
    bytes_removed: 50
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 900
    bytes_removed: 0
  - path: src/contexts/WorkspaceContext.tsx
    op: update
    bytes_added: 900
    bytes_removed: 0
  - path: src/hooks/useGlobalShortcuts.ts
    op: update
    bytes_added: 1500
    bytes_removed: 200
  - path: src/lib/uiFlags.ts
    op: update
    bytes_added: 400
    bytes_removed: 200
  - path: src/App.tsx
    op: update
    bytes_added: 1400
    bytes_removed: 600
related:
  - "../Features_to_add/1801_feature_pr-ui0-token-isolation-flag.md"
tags: ["ui-v2", "final-ui-update", "pr-ui1", "sidebar", "shell", "theme", "lazy", "a11y", "shortcuts"]
---

## 추가 기능

Final UI Update 라운드 **PR-UI 1 — Sidebar / Shell / Theme**. flag-on(`ui_v2`)일 때 목업의 248px 풀 사이드바 셸을 마운트. flag-off 는 레거시 100% 보존.

- `Sidebar.tsx` — 248px 고정, 9 슬롯 (메인 4: Today/작업 일지/변경 diff/Planner · 도구 3: 코드 검색/터미널/AI 패널 · 푸터 2: 다크 토글/설정) + 브랜드 + 프로젝트 스위처. `<nav>`+`<button>` (목업의 div onClick → a11y).
- `Toolbar.tsx` — 52px 공용 툴바.
- `ShellV2.tsx` — `.app` 그리드 (248px + 1fr) + Toolbar + placeholder 화면 (PR 별 라벨).
- `base/shell/primitives.css` — 목업 styles.css 포팅.
- Icons.tsx — ui_v2 아이콘 13종 *lucide-react re-export* 추가 (§8, 자체 SVG 금지 §3.3). 레거시 hand-rolled 36 사용처는 PR-UI 7 정리 대상.
- `useGlobalShortcuts` — `uiV2Nav` 옵션 추가: flag-on 시 ⌘1~⌘7 → 7 화면, ⌘, → 설정. flag-off 레거시 ⌘1~⌘3 무변경.

## 동작 흐름

- `App` 최상위: `uiV2 && project` → `<Suspense><ShellV2/></Suspense>`, 아니면 레거시 TitleBar+StartScreen/Workspace. flag-off className 문자열 그대로 → byte-identical.
- 테마: ShellV2 가 `useTheme`(SettingsContext) 의 `resolvedTheme`/`setTheme` 사용. `data-theme` 속성으로 토큰 전환 (Decision A).
- 네비: 사이드바 클릭 → `setUiV2View` → `WorkspaceContext.uiV2View` (레거시 activeView 와 분리, Decision D).

## 검증

- `pnpm typecheck` 0, `pnpm test` **66 passed | 3 todo** (PR-UI 0 의 56 → +10: sidebar_a11y 7 + nav 3), `pnpm lint` 0.
- **토큰 격리 빌드 검증** (Decision C): `React.lazy(ShellV2)` 로 Vite 가 `ShellV2-*.css`(5.71KB) 별도 청크 분리. 메인 번들 녹색 `#12a06b` **0개** / 레거시 크림 `#e8e0d2` 1개 · ShellV2 청크 녹색 4개 + `.sidebar`/`.toolbar`/`[data-theme=dark]` 포함. flag-off 는 청크를 fetch 안 함.
- 메인 번들에 ui_v2 클래스(`.nav-item`/`.proj-switch`/`.tbadge` 등) 누출 0 확인.
- src-tauri 무변경 (cargo 재실행 생략 — PR-UI 0 에서 green 확인).

## 메모

- 새 결정 4건 (C: lazy 격리, D: uiV2View 별도 필드, E: VITE_UI_V2 env, macOS inset) → 05-implementation-checklist §0.7 잠금.
- 시각 회귀 스냅샷 16장은 §11 상 1.0 수동 비교 — dogfood 시 캡처 (DoD 보류 항목).
- dogfood: `VITE_UI_V2=true pnpm tauri dev`.
- 다음 PR-UI 2 (Today 6-블록): `ShellV2` 의 placeholder 를 실제 TodayScreen(flag-on)으로 교체 + backend `get_today_brief`/`get_today_highlights` 추가.
