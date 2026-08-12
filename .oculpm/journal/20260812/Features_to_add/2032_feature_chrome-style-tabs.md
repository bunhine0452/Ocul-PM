---
schema_version: 1
type: feature
slug: chrome-style-tabs
status: done
created_at: 2026-08-12T20:32:14+09:00
session_id: "manual-20260812-203214"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: docs/20260811_three-features/01b-chrome-tabs.md
    op: create
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/capabilities/default.json
    op: update
  - path: src/main.tsx
    op: update
  - path: src/lib/windowRoute.ts
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: create
  - path: src/windows/ProjectTab.tsx
    op: create
  - path: src/windows/ProjectWindow.tsx
    op: delete
  - path: src/windows/LauncherWindow.tsx
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: create
  - path: src/features/shell/tabOrder.ts
    op: create
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/hooks/useGlobalShortcuts.ts
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: create
  - path: src/__tests__/multi_window.test.tsx
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260812/Features_to_add/2000_feature_multi-project-windows.md
tags: [multi-window, tabs, tauri, drag-and-drop, a11y]
---

[x] 크롬식 탭 — 한 창이 프로젝트 여러 개를 탭으로 물고, 탭을 끌어 떼어낸다

## 추가 기능

`docs/20260811_three-features/01b-chrome-tabs.md` 구현. 같은 날 끝낸 멀티 창(Phase 1) 위에 Chrome 의 탭 모델을 얹었다 — 창도 여러 개, 창마다 탭도 여러 개. 사용자 결정: 탭 모델은 "창 안에 탭", 드래그는 1차에 **순서 변경 + 창 밖으로 떼어내기**까지 (다른 창에 합치기는 2차).

Phase 1 의 불변식이 한 단계씩 내려갔다. I1 "프로젝트당 창 하나" → **"프로젝트당 탭 하나, 전역 유일"**, I3 "창의 프로젝트는 안 바뀐다" → **"탭의 프로젝트는 안 바뀐다"**. I1 이 탭으로 내려가도 D2(프로젝트당 watcher 하나)는 그대로 성립한다 — `OculpmManager` 는 여전히 refcount 가 없고 전역 유일성이 그걸 계속 보장한다.

가장 값싸게 얻은 것: **Phase 1 의 프로젝트별 localStorage 분리(T3)와 PTY sid 접두사(T4)가 손대지 않고 그대로 맞았다.** 둘 다 창이 아니라 **프로젝트** 기준이라, 프로젝트가 창을 옮겨 다녀도 상태와 셸이 따라간다. 떼어낸 탭의 터미널이 스크롤백까지 살아 있는 건 그래서다.

## 동작 흐름

라벨이 `project-<id>` → `win-<n>` 으로 바뀌면서 "이 창이 무슨 프로젝트냐"를 라벨에서 읽을 수 없게 됐다. 그래서 **백엔드가 탭 레지스트리를 소유**한다 (`WindowTabs`: `label → {order, active}` + `last_focused` + 라벨 카운터). 백엔드가 SSOT 여야 하는 이유 셋 — ① 전역 유일성은 창을 가로지르는 심판이 필요하고(프런트는 자기 창만 안다), ② 창을 닫을 때 "이 창의 탭 전부"를 알아야 PTY·watcher 를 정리할 수 있으며(프런트 `beforeunload` 는 강제 종료에서 안 돈다), ③ 새 창을 만들며 탭을 옮기는 건 Rust 만 할 수 있다.

커맨드 8종(`open_project_tab` / `close_project_tab` / `activate_project_tab` / `reorder_project_tabs` / `detach_project_tab` / `get_window_tabs` / `list_open_project_ids` / `focus_launcher_window`)과 이벤트 `WindowTabsChanged` 로 프런트가 미러링한다.

설계에서 한 판단 중 되짚을 만한 것:

- **`open_project_tab(window: None)` 이 새 창이 아니라 마지막 포커스 창**이다. 1차에는 "합치기"가 없으므로 런처가 매번 새 창을 열면 사용자가 탭으로 모을 방법이 사라진다. 반대 방향(떼어내기)은 1차에 있으니, 기본을 "합치기"로 두면 없는 기능을 아무도 필요로 하지 않는다.
- **한 번도 활성이 아니었던 탭은 마운트를 미룬다.** 전부 즉시 마운트하면 창을 여는 순간 N개 프로젝트의 init·watcher·자동색인이 동시에 터진다. 한 번 열린 뒤로는 언마운트하지 않아 백그라운드에서 계속 돈다 (Chrome 의 지연 탭 복원과 같은 절충).
- **떼어내기는 탭이 하나뿐인 창에서 no-op** 이다. 그러면 원본 창이 닫히고 같은 내용의 새 창이 뜨는 셈이라 순수 손해다.
- **재정렬은 요청 순서를 현재 탭 집합으로 걸러서** 적용한다. 프런트가 낡은 목록을 보내도 탭이 사라지거나 남의 탭이 끼어들지 않는다.

프런트는 `TabbedWindow`(스트립 + 탭 패널들) → 탭마다 `WorkspaceProvider` → `ProjectTab`(그 프로젝트의 전체 셸). 비활성 탭이 마운트된 채라 "창에 하나만 있어야 하는 것"은 전부 `active` 로 게이트했다: `useGlobalShortcuts`(⌘1 이 탭 수만큼 발화), `NAV_BUS` 창 전역 CustomEvent 두 개, `CommandPalette`·`SettingsOverlay`. 터미널은 손댈 게 없었다 — `TerminalInstanceImpl` 의 `ResizeObserver` 가 이미 `display:none → block` 0→N 점프를 처리하고 있었다.

드래그 산술은 `tabOrder.ts` 순수 함수로 떼어냈다 (`tabDropIndex` / `reorderTabs` / `isDetachGesture`). 포인터 캡처로 커서가 창 밖으로 나가도 move/up 을 받고, 스트립 세로 범위를 44px 넘게 벗어나면 떼어내기로 전환한다. `pointerup` 의 `screenX/Y` 는 CSS 픽셀 화면 좌표라 Tauri `LogicalPosition` 과 단위가 맞는다.

## 검증

`pnpm typecheck` · `pnpm test`(58파일 719테스트) · `pnpm lint` · `pnpm build` · `cargo test`(12 스위트 0실패) 전부 exit 0 을 직접 확인.

Rust 는 레지스트리를 순수 자료구조로 만들어 Tauri 런타임 없이 16개를 고정했다 — 전역 유일(같은 프로젝트 두 번 붙여도 탭 하나), 활성 탭 닫으면 오른쪽 이웃으로(없으면 왼쪽), 마지막 탭 제거 시 창도 사라짐, 재정렬이 미지의 id 를 거르고 빠진 탭을 잃지 않음, `preferred_window` 가 죽은 라벨을 안 돌려줌, PTY 접두사 비포섭.

프런트는 순수 산술 13개(`multi_window`)와 **포인터 배선 14개**(`tab_strip`)로 나눴다. 드래그는 배선을 틀려도 타입이 안 잡아주는 자리라 실제 이벤트를 쏴서 확인한다 — 안 움직인 포인터는 활성화이지 재배열이 아님, 스트립 안이면 재배열, 밖으로 나가면 `onDetach(id, screenX, screenY)`, **떼어내다 돌아오면 다시 재배열**, 닫기에서 시작한 포인터가 드래그로 안 번짐.

a11y 는 axe 로 잡았고 실제로 두 번 걸렸다 (아래 메모).

## 메모

- **axe 가 잡은 것 두 개.** ① `+` 버튼이 `role="tablist"` 안에 있어 `aria-required-children` 위반 → 탭들만 감싸는 안쪽 `tablist` 를 두고 `+`·드래그 리전을 밖으로 뺐다. ② 닫기 `<button>` 이 `role="tab"` 안에 있어 `nested-interactive` 위반. `presentation` 껍데기로 형제 만들기를 시도했더니 이번엔 `aria-required-children` 이 다시 걸렸다(tablist 는 tab 을 **직계** 자식으로 요구) — 결국 VS Code 와 같은 구조로 갔다: 닫기는 탭 안에 두되 `aria-hidden` + 비포커스, 키보드 등가물로 Delete/Backspace. 좌우 화살표 탭 이동도 함께 넣었다.
- **트레이 딥링크가 창 수명 내내 재사용되던 함정.** URL 파라미터를 탭마다 넘기면, 나중에 그 창에서 연 다른 프로젝트도 같은 일지로 점프한다. 창이 한 번만 배달하고 소비 후 비우도록 고쳤다 (`onDeepLinkConsumed`).
- **`tabStrip.ts` 와 `TabStrip.tsx` 는 macOS 에서 공존할 수 없다** (대소문자 무시 파일시스템 → tsc `differs only in casing`). 순수 모듈을 `tabOrder.ts` 로 개명했다.
- **1차 범위 밖**: 다른 창의 스트립에 드롭해서 합치기(Rust 화면좌표 히트테스트 필요), 고스트 탭 미리보기, 앱 재시작 시 탭 세션 복원.
- **수동 검증 8종(01b §7)은 아직 안 돌렸다** — 특히 백그라운드 탭의 터미널 생존과 떼어내기 후 스크롤백 복원은 실기기 확인이 필요하다.
