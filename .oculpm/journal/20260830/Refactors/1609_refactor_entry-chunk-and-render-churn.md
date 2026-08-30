---
schema_version: 1
type: refactor
slug: entry-chunk-and-render-churn
status: done
created_at: 2026-08-30T16:09:00+09:00
session_id: "manual-20260830-160900"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/i18n/index.ts
    op: update
  - path: src/main.tsx
    op: update
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src/__tests__/setup.ts
    op: update
  - path: src/__tests__/i18n.test.ts
    op: update
  - path: src/windows/SettingsOverlay.tsx
    op: update
  - path: src/windows/StartTab.tsx
    op: update
  - path: src/lib/indexProgressStore.ts
    op: create
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/features/search/SearchScreenV2.tsx
    op: update
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src/hooks/useSecondTick.ts
    op: create
  - path: src/features/terminal/useSecondTick.ts
    op: update
  - path: src/features/today/TodayMonitor.tsx
    op: update
  - path: src/features/chat/conversation/TurnRow.tsx
    op: update
  - path: src/features/chat/conversation/TraceRow.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/features/onboarding/StartScreen.tsx
    op: update
  - path: src/features/projects/ProjectManager.tsx
    op: update
  - path: src/__tests__/polish_phase2.test.tsx
    op: update
related: []
tags: [performance, bundle, i18n, render, polish-round]
---

[x] 진입 청크 538KB → 268KB (언어 사전 동적 청크) · 설정 패널·그린필드 lazy 복원 · 색인 진행률을 컨텍스트 밖으로(+Rust 100ms 스로틀) · 1초 시계 하나로

## 배경

완성도 감사(2026-08-30)의 성능 렌즈. 진입 청크의 45% 가 ko+en 사전이었고(한 사람은 한 언어만 읽는다), 설정 패널과 그린필드 마법사가 어느 시점엔가 정적 import 로 돌아와 있었다. 색인은 파일마다 IPC 를 보내고 그때마다 `WorkspaceContext` 전체가 다시 그려지며 localStorage 디바운스가 재장전됐다. 1초 시계는 다섯 군데가 각자 `setInterval` 을 들었고, 트레이스 행은 도는 단계마다 하나였다.

## 변경

- **i18n 분리**: `i18n/index.ts` 는 사전을 `import type` 으로만 알고(`I18nKey` 는 그대로 정적 타입), 값은 `loadDict(lang)` 이 동적 import. `bootI18n()` 이 `main.tsx` 에서 render **앞에** 설정의 언어를 읽어 그 사전 하나를 기다리고, 다른 언어는 `requestIdleCallback` 으로 받아 둔다(팔레트 `tAll` 용). `SettingsContext` 는 `loaded` 전엔 언어를 밀지 않는다 — 부팅이 고른 언어를 OS 로케일로 덮었다 되돌리는 깜빡임 방지. 테스트 setup 이 두 사전을 `registerDict` 로 동기 등록. 결과: `dist/assets/index-*.js` 538,242 → 267,701 B, `ko-*.js` 143KB · `en-*.js` 129KB 가 따로.
- **lazy 복원**: `SettingsOverlay` → `SettingsPanel`, `StartTab` → `GreenfieldWizard` 를 `lazy()` + Suspense 로 (ShellV2 와 같은 패턴).
- **색인 진행률**: Rust `index_project` 가 첫·마지막 파일과 100ms 마다만 보낸다(`PROGRESS_INTERVAL`). 프런트는 `lib/indexProgressStore`(useSyncExternalStore) — 읽는 화면은 검색 하나. `WorkspaceState.indexProgress` 필드와 `setIndexing(…, progress)` 인자는 제거, `indexingProjectId` 만 남김.
- **공유 시계**: `hooks/useSecondTick`(1초)·`useMinuteTick`(1분) — 켜진 구독자가 하나라도 있을 때만 인터벌 하나. 터미널 3곳(재수출로 경로 유지)·TodayMonitor·ThinkingLabel·TraceElapsed·회고 생성 경과·시작 화면/프로젝트 관리의 상대 시각이 이걸 듣는다.

## 검증

`pnpm typecheck` · `lint` · `vitest`(123 파일 · 1468: 시계 켜짐/꺼짐·타이머 수, 스토어 set/clear, i18n 계약·영어 렌더) · `build` exit 0. `cargo fmt/clippy -D warnings/test`(939) exit 0.

## 한계 / 후속

- 런타임 언어 전환 직후 사전이 아직 안 왔으면 `t()` 는 ko → 키 순으로 잠깐 폴백한다 — 부팅이 다른 언어를 한가할 때 받아 두므로 실사용에선 보이지 않는다.
- `IndexingTab` 의 재구축은 `indexingProjectId` 를 세우지 않는다(예전부터) — 검색 화면이 "만드는 중" 을 못 본다. 다음 라운드.
