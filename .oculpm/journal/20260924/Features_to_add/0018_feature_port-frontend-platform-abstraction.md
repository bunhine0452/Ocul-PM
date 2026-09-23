---
schema_version: 1
type: feature
slug: "port-frontend-platform-abstraction"
status: done
difficulty: high
created_at: "2026-09-24T00:18:16+09:00"
session_id: "20260924-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/platform.ts"
    op: create
  - path: "src/lib/kbd.ts"
    op: create
  - path: "src/features/terminal/terminalPlatform.ts"
    op: create
  - path: "src/hooks/useWindowTabKeys.ts"
    op: create
  - path: "src/i18n/index.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/features/terminal/terminalSurface/useTerminalKeys.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/windows/TerminalWindow.tsx"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/__tests__/platform_keys.test.ts"
    op: create
  - path: "src/__tests__/terminal_platform.test.tsx"
    op: create
  - path: "src/__tests__/window_tab_keys.test.tsx"
    op: create
  - path: "src/__tests__/modifier_glyph_gate.test.ts"
    op: create
  - path: ".github/workflows/portability.yml"
    op: create
  - path: ".gitattributes"
    op: create
related:
  - ref: "20260923/Chores/2308_chore_cross-platform-plan-and-portability-ci.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "ci"
  - "terminal"
  - "i18n"
  - "mcp-tool"
---
[x] 프런트엔드 플랫폼 추상화 — OS 판정·수정키·셸 키 양보·⌘ 표기 (L-UI, PR #31)

## 추가 기능

크로스플랫폼 라운드 W2 · L-UI 레인(병렬 worktree 세션)의 결과를 합류했다. W0(portability.yml · .gitattributes)가 같은 PR 로 main 에 들어갔다.

- `src/lib/platform.ts` — OS 판정 단일 창구. `navigator.platform` 을 먼저 보고(WebKitGTK 가 UA 를 맥 Safari 로 꾸밀 수 있어서) 비었을 때만 UA. 모르면 mac. `navigator.platform` 을 직접 읽던 4곳 교체.
- `src/lib/kbd.ts` — 매칭(`isModKey`·`isCmdKey`·`readChord`·`yieldsToShell`)과 표기(`kbd`). **모든 분기가 `isMac()` 에서 먼저 갈라져 macOS 는 예전 식 그대로**(`metaKey||ctrlKey`, 원문 반환).
- Windows·Linux: Ctrl 매칭(AltGr 제외), 터미널 안 Ctrl+글자는 셸에 양보하고 앱 단축키는 Ctrl+Shift(⇧⌘ 는 Ctrl+Alt+Shift), 복사/붙여넣기 Ctrl+Shift+C/V, ⌘T/⌘W 는 `useWindowTabKeys` keydown.
- 표기: 사전은 맥 표기가 정본, `t()` 가 렌더 때 OS 표기로. `term.*` 는 터미널 가족. src 의 ⌘ 리터럴 0 을 AST 게이트 테스트가 지킨다.
- 창 크롬: 드래그 영역 mac 한정, 비-mac 글꼴 폴백(Segoe UI·Malgun Gothic / Noto Sans CJK KR, 터미널은 Cascadia Mono·Consolas·DejaVu Sans Mono).
- 터미널 입력: 한글 입력 브리지(WKWebView 우회)는 macOS 에서만, 비-mac 은 xterm 기본 CompositionHelper.

## 동작 흐름

터미널 포커스에서 Windows 사용자가 Ctrl+C → `yieldsToShell` 참 → 전역 단축키가 비켜 셸이 SIGINT 를 받는다. Ctrl+Shift+D → `readChord(e,"terminal")` 가 ⌘D 로 읽어 분할.

## 결정

- 자리표시자(`{mod}`) 대신 `t()` 출구 변환 — 조합 단위라야 Ctrl+Shift+D 순서를 세울 수 있고, mac 에서 원문 그대로가 구조로 보장된다.
- 합류 순서 설계(L-UI 는 W2 마지막)를 뒤집었다 — src/** 만 소유라 W1 과 독립, 먼저 합류.

## 오케스트레이터 검토

- mac 불변을 직접 읽어 확인: 교체된 핸들러 9곳의 mac 조건 동치, `readChord` mac 경로, `attachTerminalInput` mac → `attachImeBridge` 그대로, `terminalFontFamily` mac → 예전 스택 그대로, `t()` mac → `kbd` 원문 반환.

## 검증

- portability run 35877998437 「프런트 — windows-latest」 success: vitest 243파일 3,013건(새 4파일 포함) Windows 러너에서 통과.
- PR #31 ci.yml 3잡 SUCCESS(ubuntu 프런트 typecheck·test·lint·build, macOS cargo test·bindings, cargo-deny) → rebase 머지 c96a5ad8.
- CI 로 못 본 것: 실제 IME, WebKitGTK navigator.platform 실값, 실기기 글꼴 셀 폭 → #w3-ime-cdp · #w5-eyes.