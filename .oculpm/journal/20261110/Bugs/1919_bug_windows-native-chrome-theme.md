---
schema_version: 1
type: bug
slug: "windows-native-chrome-theme"
status: done
difficulty: low
created_at: "2026-11-10T19:19:30+09:00"
session_id: "manual-20261110-191930"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/theme/apply.ts"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/windows/window.css"
    op: update
  - path: "src-tauri/capabilities/windows-caption.json"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src/__tests__/window_theme_sync.test.tsx"
    op: create
related:
  - ref: "20261110/Features_to_add/1801_feature_windows-app-title-bar.md"
    kind: "followup"
tags:
  - "창"
  - "windows"
  - "theme"
---
[x] 창: 어두운 테마에서 밝게 남던 조각을 고친다

## 발생 원인
- 제목줄 없는 Windows 창의 1px 위 테두리와 시스템 메뉴는 OS 가 **창의** 테마로 그린다. 앱은 테마를 `<html data-theme>` 에만 걸고 창에는 알리지 않았다. OS 가 밝으면 어두운 창 위에 밝은 선이 남았다(실측 맨 윗줄 #F3F3F3).
- 시작 창: 테마를 따르는 `color-scheme` 이 base.css(셸 청크)에만 있었다. 처음 뜬 시작 창의 스크롤바는 늘 밝은 기본 막대였다. Windows 의 스크롤바는 늘 서 있어 눈에 띈다.

## 해결 방법
- Windows 에서 `SettingsContext` 가 창 테마를 맞춘다. 밝게 · 어둡게는 그대로 보내고, 「시스템」은 `null`(OS 를 따른다)로 보낸다(`windowThemeFor`).
- 「시스템」 을 고정값으로 보내면 안 된다. Windows 의 Tauri 는 창 테마를 웹뷰의 `prefers-color-scheme` 에도 건다(tauri-runtime-wry 의 ThemeChanged → `webview.set_theme`). 고정하면 앱이 따라가야 할 OS 신호가 끊긴다. `null` 이면 tao 가 OS 테마로 되돌리고 웹뷰도 그 값을 다시 받는다.
- 권한 `core:window:allow-set-theme` 은 `windows-caption.json`(Windows 만)에 넣었다. macOS 는 건드리지 않는다(D3).
- window.css 에 `:root[data-platform]` 한정 `color-scheme` 두 줄을 두었다(macOS 시작 창은 그대로).

## 검증
- `pnpm vitest run window_theme_sync · theme_apply · i18n_settings_wiring` → 15 passed. `pnpm test` → 106 files · 1085 passed. typecheck · lint · build → 0
- 실기기 개발판(OS 밝음, 앱 어둡게): 맨 윗줄 #F3F3F3 → #202020. 시작 창 스크롤바 바탕은 규칙을 빼면 #FCFCFC(흰 막대), 넣으면 #2C2C2C 로 같은 창에서 비교했다.
