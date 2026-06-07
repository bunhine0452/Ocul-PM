---
schema_version: 1
type: feature
slug: pr-ui8b-dark-purge
status: done
difficulty: high
created_at: "2026-06-04T20:36:58+09:00"
updated_at: "2026-06-04T20:36:58+09:00"
session_id: "20260604-m02"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: true
files_touched:
  - path: src/App.css
    op: update
    bytes_added: 4200
    bytes_removed: 3900
  - path: src/contexts/SettingsContext.tsx
    op: update
    bytes_added: 500
    bytes_removed: 600
  - path: src/components/Markdown.tsx
    op: update
    bytes_added: 600
    bytes_removed: 400
  - path: src/features/chat/ChatPanel.tsx
    op: update
    bytes_added: 600
    bytes_removed: 700
  - path: src/features/onboarding/GreenfieldWizard.tsx
    op: update
    bytes_added: 200
    bytes_removed: 300
  - path: src/components/ui/button.tsx
    op: update
    bytes_added: 0
    bytes_removed: 500
  - path: src/features/diff/diffParse.ts
    op: create
    bytes_added: 3600
    bytes_removed: 0
  - path: src/legacy/diff/LocalDiffView.tsx
    op: rename
    bytes_added: 0
    bytes_removed: 0
  - path: src/__tests__/theme_toggle.test.ts
    op: update
    bytes_added: 100
    bytes_removed: 700
related:
  - "../Refactors/2015_refactor_pr-ui8a-legacy-move.md"
tags: ["ui-v2", "pr-ui8", "dark-purge", "theming", "shadcn", "data-theme"]
---

## 추가 기능

PR-UI 8b — **`dark:` purge 완결 + 대시보드/오버레이를 ui_v2 톤으로 통일**. 사용자 결정 **Option 2(변수 remap)**: shadcn CSS 변수 *값* 을 ui_v2 토큰 팔레트로 교체 → 대시보드(StartScreen)·전역 오버레이가 녹색/macOS 톤을 입음(레이아웃은 shadcn 유지).

- `App.css`: shadcn 변수 remap(`--primary`→녹색 #12a06b/#2bc488, `--background/card/muted/secondary`→ui_v2 surface, `--destructive`→`--t-bug`, `--ring`→accent). `:root`+`[data-theme=dark]` 양쪽.
- `.dark` 셀렉터 45곳 → `[data-theme="dark"]`(var 블록 + glassy/hljs/code-editor 규칙), `@custom-variant dark` → `[data-theme]`.
- `SettingsContext`: `classList.toggle("dark")` 제거 → data-theme 속성만(Decision A 의 `.dark` 병행 종료; shadcn 도 data-theme 으로 테마).
- `dark:` variant 23개 제거: shadcn `ui/*`(14, base 가 var 로 테마) · ChatPanel(5: 우선순위 배지→`--t-*` var, prose-invert 래퍼 제거) · GreenfieldWizard(2) · Markdown(2: prose-invert 를 useTheme 조건부).
- `LocalDiffView` 순수 파서 → `diffParse.ts` 추출(DiffScreenV2+safety-net import 갱신), 컴포넌트(dark: 4)는 `src/legacy/diff/` 이동.

## 검증

- **grep `dark:` → 0** · **grep `classList.toggle("dark")` → 0**. typecheck/test(88)/lint/build green.
- 시각 dogfood: 대시보드/오버레이가 라이트/다크 양쪽 정상, 녹색 톤 자연스러움 — **사용자 사인-오프**.

## 메모

- 시각 튜닝 여지: shadcn `--accent`(hover)가 dashboard=gray / in-project 오버레이=green(전역 `--accent` 충돌) — 필요시 조정.
- 머지 `911c333`, 태그 `pre-cut-PR-UI8b`. **Final UI Update 라운드(PR-UI 0~8b) 전체 완결.**
