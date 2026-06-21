---
schema_version: 1
type: refactor
slug: legacy-dead-code-removal
status: done
difficulty: medium
created_at: "2026-06-22T01:38:00+09:00"
updated_at: "2026-06-22T01:38:00+09:00"
session_id: "20260622-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/code/fileTreeNav.ts
    op: create
    bytes_added: 3592
    bytes_removed: 0
  - path: src/legacy
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/components/TitleBar.tsx
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/components/GitBranchChip.tsx
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/features/terminal/TerminalPanel.tsx
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/features/overview/api.ts
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/features/planner/hooks.ts
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/locales/ko.json
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/lib/todayNavigate.ts
    op: delete
    bytes_added: 0
    bytes_removed: 0
  - path: src/__tests__/lite_w6_safety_net.test.ts
    op: update
    bytes_added: 320
    bytes_removed: 1200
  - path: src/lib/theme.tsx
    op: update
    bytes_added: 0
    bytes_removed: 180
  - path: src/lib/settings.ts
    op: update
    bytes_added: 0
    bytes_removed: 290
  - path: scripts/check-no-localstorage.mjs
    op: update
    bytes_added: 120
    bytes_removed: 260
  - path: package.json
    op: update
    bytes_added: 0
    bytes_removed: 120
  - path: src-tauri/Cargo.toml
    op: update
    bytes_added: 0
    bytes_removed: 140
related:
  - ../../20260604/Refactors/2015_refactor_pr-ui8a-legacy-move.md
tags: ["legacy", "dead-code", "cleanup", "dev-report", "deps"]
---

[x] 레거시·죽은 코드 ~13.6k줄 삭제 (개발 보고서 항목 1)

## 동기

개발 보고서(`docs/20260622_dev-report/`)의 다중 에이전트 감사 결과, `src/legacy/**`(35파일·11,827줄)는 `tsconfig`/`vitest`/스토리지 린트에서 이미 제외돼 앱에 번들되지 않는 죽은 무게였다. 일부 파일은 더 이상 존재하지 않는 경로를 import 해 재포함 시 컴파일조차 안 되는 방치 상태였다. 비-legacy 활성 트리에도 ~1.8k줄의 죽은 코드가 남아 있었다. 이 무게는 의미 검색·AI 컨텍스트·grep 노이즈를 키워 (이 레포가 자기 자신을 도그푸딩하므로) 분석 품질을 직접 떨어뜨렸다.

## 변경 요약

- **삭제 전제 — 헬퍼 이전**: `src/legacy/FileExplorer.tsx` 의 순수 헬퍼 `flattenVisibleNodes`/`nextFocusedPath`(+`FlatNode`)를 `src/features/code/fileTreeNav.ts`(신규)로 이전하고, `lite_w6_safety_net.test.ts` 의 import 를 재배선. legacy 삭제 **전에** 테스트 42 passed 를 먼저 확인.
- **`src/legacy/**` 전체 삭제**(35파일).
- **비-legacy 죽은 코드 삭제**: `TitleBar`+`GitBranchChip`(PR-UI 7 상단 크롬 제거 잔재), `TerminalPanel.tsx`, `features/overview/`, `planner/hooks.ts`, 미사용 shadcn primitive 7개(badge·card·dialog·popover·progress·select·tabs), `locales/ko.json`(i18n 미배선 스캐폴드), `lib/todayNavigate.ts`, `theme.tsx` 의 no-op `ThemeProvider`, `settings.ts` 의 미사용 `resolveModel`, 스캐폴드 SVG 3개.
- **의존성 제거**: npm `@fontsource-variable/geist`·`recharts`·`date-fns`(31 패키지 정리), cargo `gray_matter`·`fs2`.
- **린트 정리**: `check-no-localstorage.mjs` allowlist 에서 삭제된 `TerminalPanel.tsx` 항목 제거.
- 순 **−13,587줄**(lockfile 제외). 검증용 grep 에서 shadcn primitive 의 legacy 오염(`grep -o` 가 경로를 제거) 1건을 경로 기반 재검증으로 바로잡음.

## 검증

`pnpm typecheck` 0 · `pnpm test` 125 passed(15 files) · `pnpm lint` 0 · `pnpm build` 0 · `cargo build` Finished — 커밋 전 게이트 전부 직접 확인(exit 0).

## 메모

- 의도적으로 보류(별도 패스): 고아 백엔드 커맨드 ~30개 + 마이그레이션 shim(1,911줄)은 "삭제 vs 재활성화" 결정이 필요(`docs/20260622_dev-report/01-code-cleanup.md §3`). `WorkspaceContext` 죽은 조각·`SettingsContext.setMany`·에디터 설정 그룹은 안전망 테스트가 순수 함수로 핀하거나 ⚠️결정 항목이라 보류.
- cargo `slug` 는 마이그레이션 shim 이 아직 사용하므로 유지.
- `related`: `pr-ui8a-legacy-move`(코드를 `src/legacy/` 로 옮긴 작업)의 완결.
