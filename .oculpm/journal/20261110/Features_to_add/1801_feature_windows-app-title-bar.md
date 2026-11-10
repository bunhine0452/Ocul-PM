---
schema_version: 1
type: feature
slug: "windows-app-title-bar"
status: done
difficulty: medium
created_at: "2026-11-10T18:01:39+09:00"
session_id: "manual-20261110-180139"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/windows/CaptionButtons.tsx"
    op: create
  - path: "src/windows/AppWindow.tsx"
    op: update
  - path: "src/windows/window.css"
    op: update
  - path: "src/lib/platform.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/caption_buttons.test.tsx"
    op: create
  - path: "src/__tests__/platform_keys.test.ts"
    op: update
  - path: "src-tauri/tauri.windows.conf.json"
    op: update
  - path: "src-tauri/capabilities/windows-caption.json"
    op: create
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/commands/window/mod.rs"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "docs/20260923_cross-platform/00-master-plan.md"
    op: update
related:
  - ref: "20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md"
    kind: "followup"
tags:
  - "창"
  - "windows"
  - "cross-platform"
---
[x] 창: Windows 제목줄을 윗줄에 합쳤다

## 추가 기능
사용자가 Windows 에서 처음 클론해 띄워 보고 요청했다. 맥처럼 창 단추가 앱과 한 몸이면 좋겠다는 것이다.

- 예전(크로스플랫폼 라운드 `#ui-chrome`)에는 Windows 도 네이티브 제목줄이었다. 44px 셸 윗줄 위에 OS 제목줄 띠가 하나 더 섰고, 다크 테마에서도 그 띠만 흰색이었다.
- 이제 Windows 창은 제목줄이 없다(`decorations: false`). 셸 윗줄 · 시작 창 머리줄이 제목줄이다.
- 최소화 · 최대화(복원) · 닫기는 `windows/CaptionButtons.tsx` 가 창 오른쪽 위 구석에 띄운다. 단추 46px, 윗줄 높이 전체, Segoe Fluent Icons 글리프, 닫기만 빨강(#c42b1c)이다. 창이 뒤에 있으면 글리프가 옅어진다.
- macOS 는 한 글자도 바뀌지 않는다(D3). Linux 는 네이티브 제목줄 그대로다.

## 동작 흐름
- `platform.ts` 에 `drawsOwnTitleBar()`(mac · windows)와 `drawsCaptionButtons()`(windows)를 두었다. `dragRegion()` 이 이제 Windows 에도 `data-tauri-drag-region` 을 단다. 끌기 · 두 번 눌러 최대화 · 화면 가장자리 스냅은 Tauri 의 drag.js 가 한다.
- 단추 줄은 `AppWindow` 가 창마다 하나, 바깥 오류 경계 밖에 그린다. 시작 창 · 프로젝트 창 · 부트 스플래시 · 깨진 화면 어디서든 닫기가 남는다. z-top 이라 모달 위에서도 눌린다(맥 신호등과 같다).
- 윗줄은 `:root[data-platform="windows"] .topbar` 오른쪽 여백으로 단추 자리를 비운다. `useTopbarFit` 이 여백을 재므로 접기 단계가 그대로 맞는다. 460 아래(480 창에 글자 125%)에서는 단추가 40px 로 준다.
- 최소화 · 최대화는 `windowApi.minimize` · `toggleMaximize`(Tauri 창 API, 권한은 `capabilities/windows-caption.json` 에서 Windows 만)로 간다. 닫기는 기존 `close_window` 라 도는 터미널 세션이 있으면 먼저 묻는다.
- 단추 모양(□ ↔ ❐)은 `onResized` 마다 `isMaximized` 를 다시 읽어 따라간다. 스냅이나 두 번 눌러 확대도 같이 따라간다.
- 첫 창은 `tauri.windows.conf.json` 이 통째로 다시 적는다(병합 패치는 배열을 갈아 끼운다). 나머지 창은 `spawn_window` 가 `decorations(false)` 로 띄운다. 세 곳의 크기가 어긋나지 않는지는 새 Rust 테스트가 본다.
- window-state 플러그인이 저장된 `decorated` 를 되살리지 않게 `DECORATIONS` 플래그를 뺐다. 4.9 이하 Windows 사용자의 상태 파일에는 `true` 가 남아 있어, 되살리면 OS 제목줄이 한 번 더 선다.

## 검증
- `pnpm test` → Test Files 105 passed · Tests 1081 passed (caption_buttons 4건 · platform_keys 새 2건 포함). `pnpm typecheck` · `pnpm lint` · `pnpm build` → exit 0
- `cargo test --lib commands::window` → 36 passed (first_window_config_matches_spawned_windows · caption_permissions_are_windows_only 포함). `cargo build` · `cargo clippy --lib --tests -- -D warnings` → Finished, 경고 0
- 실기기(Windows 11, 배율 150%, 별도 식별자 개발판): 창 스타일에 캡션 없음, 최대화 단추 클릭 → IsZoomed=True · 창 = 작업 영역 2488×1600 · 글리프 ❐, 복원 → 1729×1174 · □, ✕ → 창 닫히고 앱 종료. 다크 테마에서 제목줄까지 어둡다. 388px 폭에서 탭 아이콘 · 설정 · 단추가 한 줄에 든다.

## 메모
- 못 본 것: 실제 마우스의 호버(닫기 빨강), 끌어서 옮기기 · 스냅, Alt+Space 시스템 메뉴. 사용자가 다른 창을 쓰는 중이라 실제 커서 · 키 입력을 쓰지 않고 PostMessage · PrintWindow 로만 봤다.
- 잃은 것: Windows 11 최대화 단추 위 스냅 레이아웃 플라이아웃(Win+Z 는 남는다), 제목줄 우클릭 시스템 메뉴.
