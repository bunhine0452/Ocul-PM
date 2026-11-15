---
schema_version: 1
type: feature
slug: "design-base-one-set"
status: done
difficulty: high
created_at: "2026-11-15T07:26:55+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/lib/page.mjs"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
  - path: "scripts/check-critical-css.mjs"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "scripts/design-accent-ring.mjs"
    op: create
  - path: "src/App.css"
    op: update
  - path: "src/__tests__/boot_splash_v2.test.tsx"
    op: create
  - path: "src/__tests__/cheatsheet_view_contract.test.tsx"
    op: create
  - path: "src/__tests__/confirm_danger.test.tsx"
    op: create
  - path: "src/__tests__/confirm_dialog.test.tsx"
    op: update
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
  - path: "src/__tests__/dialogs_v2.test.tsx"
    op: create
  - path: "src/__tests__/firstrun_honesty.test.tsx"
    op: update
  - path: "src/__tests__/primitives_v2.test.ts"
    op: create
  - path: "src/__tests__/states_v2.test.tsx"
    op: create
  - path: "src/__tests__/toaster_v2.test.tsx"
    op: create
  - path: "src/components/BootSplash.tsx"
    op: update
  - path: "src/components/EmptyState.tsx"
    op: update
  - path: "src/components/ErrorBoundary.tsx"
    op: update
  - path: "src/components/ErrorCard.tsx"
    op: update
  - path: "src/components/LoadingState.tsx"
    op: update
  - path: "src/components/OculSpinner.tsx"
    op: delete
  - path: "src/components/ShortcutCheatsheet.tsx"
    op: update
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/components/bootsplash.css"
    op: update
  - path: "src/components/ui/AppDialog.tsx"
    op: update
  - path: "src/components/ui/Skeleton.tsx"
    op: update
  - path: "src/components/ui/Toaster.tsx"
    op: update
  - path: "src/components/ui/button.tsx"
    op: delete
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/deeplink/DeepLinkSheet.tsx"
    op: update
  - path: "src/features/tour/TourDialog.tsx"
    op: update
  - path: "src/features/tour/tour.css"
    op: update
  - path: "src/hooks/useConfirm.tsx"
    op: update
  - path: "src/hooks/useModalBehavior.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/lib/toast.ts"
    op: update
  - path: "src/main.tsx"
    op: update
  - path: "src/styles/base.css"
    op: update
  - path: "src/styles/empty.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/windows/window.css"
    op: update
related: []
tags:
  - "디자인"
  - "ui"
  - "quality-round"
  - "mcp-tool"
---
[x] 디자인: 세그먼트 · 대화상자 · 부트를 한 벌로 맞췄다

## 추가 기능

다섯 화면이 함께 쓰는 바닥을 고쳤다(업그레이드 라운드 레인 「디자인 바닥」, 계획 quality-round-20261115).

- **세그먼트 · 단추(DS-01)**: 다크에서 고른 칸이 트랙보다 어두워 빈 구멍처럼 보이던 것을 새 `--seg-on` 으로 밝게. 막힌 주 단추는 옅은 채운 단추가 아니라 보통 단추 모양(질문이 걸린 오늘에 채운 단추가 둘로 보이던 것). 주 단추 아래 초록 그림자(글로우) 걷음. 위험 확인은 첫 포커스가 「취소」, 확정은 ⌘↩ 로만.
- **열자마자 서는 창(DS-02)**: 새 창마다 1.06초 고정 애니메이션이 내용을 가리던 것을, 첫 창이 300ms 안에 안 설 때만 스플래시를 띄우고 첫 내용이 서는 순간 걷게. 테마는 첫 렌더 전에 붙여 밝은 판이 먼저 그려졌다 뒤집히지 않는다.
- **상태 한 벌(DS-03)**: 로딩은 스피너 없이 300ms 뒤 정지 글자, 빈 상태는 왼쪽 정렬 한 모양, 오류 카드 한 벌.
- **대화상자 한 벌(DS-04)**: 머리 · 본문(유일한 스크롤 칸) · 바닥, Tab 가두기, 단축키 표는 지금 화면 묶음 먼저 · 단으로 흐름.
- **알림 기둥 하나(DS-05)**: 토스트와 업데이트 배너가 한 기둥에 쌓여 겹치지 않는다.

## 동작 흐름

`primitives.css` 가 세그먼트 · 단추 상태를 한 곳에서 정하고, `AppDialog` 가 대화상자 뼈대를, `Toaster` 가 알림 기둥을 쥔다. `BootSplash` 는 rAF 로 `.topbar, .start, .err-card` 가 서는지 보고 걷힌다. 디자인 게이트 규칙 22 가 `--accent-ring` 그림자를 포커스 테에만 허용한다.

## 검증

- 레인 게이트: typecheck · lint · build exit 0, vitest 115 files passed. 독립 리뷰 둘(major 3) 반영 뒤 같은 게이트 통과.
- 합류 뒤(통합 브랜치 28077f31): `pnpm test` 1652 passed · typecheck · lint exit 0 · `cargo test` 1202 passed 0 failed. 설치본에서 눈으로 보지는 않았다.

## 메모

- 단축키 표의 「지금 화면」 은 윗줄 DOM(`.topbar .topnav > button[aria-current=page]`)에서 읽는다 — `cheatsheet_view_contract.test.tsx` 가 계약을 문다.
- 남은 것은 이음 레인으로: 세그먼트 고른 상태 선택자를 aria-checked · aria-pressed 까지 넓혀 변경 화면 · 오늘의 사본 규칙을 걷는다.