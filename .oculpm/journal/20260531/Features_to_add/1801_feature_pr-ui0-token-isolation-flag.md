---
schema_version: 1
type: feature
slug: pr-ui0-token-isolation-flag
status: done
difficulty: medium
created_at: "2026-05-31T18:01:32+09:00"
updated_at: "2026-05-31T18:01:32+09:00"
session_id: "20260531-m01"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/styles/tokens.css
    op: create
    bytes_added: 3400
    bytes_removed: 0
  - path: src/styles/base.css
    op: create
    bytes_added: 320
    bytes_removed: 0
  - path: src/styles/shell.css
    op: create
    bytes_added: 300
    bytes_removed: 0
  - path: src/styles/primitives.css
    op: create
    bytes_added: 360
    bytes_removed: 0
  - path: src/styles/screens.css
    op: create
    bytes_added: 320
    bytes_removed: 0
  - path: src/styles/index.css
    op: create
    bytes_added: 700
    bytes_removed: 0
  - path: src/lib/uiFlags.ts
    op: create
    bytes_added: 1200
    bytes_removed: 0
  - path: src/__tests__/ui_v2_flag.test.ts
    op: create
    bytes_added: 1300
    bytes_removed: 0
  - path: src/__tests__/theme_toggle.test.ts
    op: create
    bytes_added: 3600
    bytes_removed: 0
  - path: src/contexts/SettingsContext.tsx
    op: update
    bytes_added: 520
    bytes_removed: 60
  - path: src/contexts/WorkspaceContext.tsx
    op: update
    bytes_added: 2000
    bytes_removed: 0
  - path: src/App.tsx
    op: update
    bytes_added: 900
    bytes_removed: 80
related: []
tags: ["ui-v2", "final-ui-update", "pr-ui0", "tokens", "feature-flag", "theme", "data-theme"]
---

## 무엇을 / 왜

Final UI Update 라운드(Ocul-PM 1.0 출시 직전 UI 전면 개편, PR-UI 0~7)의 **PR-UI 0 — Foundation** 을 구현. 다른 모든 시각 PR 의 *선행 조건* 인 회귀 보호망 + 토큰 시스템 격리 + `ui_v2` feature flag 도입이 목표. 이 PR 자체는 *화면을 바꾸지 않는다* — flag-off / flag-on 둘 다 기존 레거시 UI 를 그대로 렌더하는 것이 DoD.

## 어떻게

- **토큰 시스템 격리**: 목업 `Ocul-PM1.0/styles.css` 의 CSS variable 을 `src/styles/tokens.css` 로 포팅 (`:root` + `[data-theme="dark"]`, 03-design-system §1~§3 과 글자 단위 일치). `base/shell/primitives/screens.css` 는 빈 placeholder, `index.css` 가 5 파일 번들 진입점. **전역 import 는 하지 않음** — 신 `--accent`(녹색)가 레거시 `App.css` 의 `--accent`(크림)와 이름 충돌하여 flag-off UI 가 변색되기 때문. 전역 주입은 PR-UI 1 (ui_v2 shell 스코프)로 미룸.
- **`ui_v2` flag**: `src/lib/uiFlags.ts` 의 모듈 const `isUiV2Enabled()` (기본 OFF) + 테스트용 `__setUiV2Override`. settings KEYS 레지스트리 *밖* 에 둬서 `no_feature_flags.test.ts` green 유지 (Decision B).
- **App seam**: `App.tsx` 에 `WorkspaceShell` 도입 — flag 분기 지점. 현재는 양쪽 모두 기존 `<Workspace>` 위임 (flag-off byte-identical 보장).
- **테마 = `data-theme` 속성**: 신규 `ThemeContext` 신설 대신, 이미 테마를 소유한 `SettingsContext` 의 적용 effect 가 레거시 `.dark` class 와 신 `data-theme` 속성을 *동시* 토글하도록 한 줄 확장 (Decision A). `localStorage["oculpm-theme"]` 별도 store 미사용 → lint 무관.
- **WorkspaceContext read-compat**: 신규 키 11 종(journalFilter / diff* / plannerOpen / search* / terminal* / ai*) default 추가. write/deletion 마이그레이션은 PR-UI 7 로 미룸. themeMode 는 Decision A 로 제외(12→11).

## 검증

- `pnpm typecheck` 0 오류. `pnpm test` 56 passed | 3 todo (베이스라인 50 → +6: ui_v2 flag 3, theme toggle 3). `pnpm lint`(localStorage) 위반 0. `cargo test` 0 failed (백엔드 무변경 확인).
- flag-off 무변경은 `WorkspaceShell` 이 기본 OFF 일 때 `<Workspace>` 를 그대로 위임함을 diff 로 확인.

## 다음

- PR-UI 1: `src/components/Sidebar.tsx`(248px) + `Toolbar.tsx`(52px) + shell.css/primitives.css 채움 + `index.css` 를 ui_v2 shell 에 스코프 import + ⌘1~⌘7 단축키(flag-on 분기) + 시각 회귀 스냅샷 16 장 베이스라인.
- 추가 결정 2건(Decision A 테마 SSOT, Decision B flag 위치)은 05-implementation-checklist.md §0.6 에 잠금.
