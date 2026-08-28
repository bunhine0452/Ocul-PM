---
schema_version: 1
type: feature
slug: tab-context-menu-keyboard
status: done
difficulty: medium
created_at: "2026-08-28T20:22:00+09:00"
session_id: "manual-20260828-202200"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/shell/TabStrip.tsx"
    op: update
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/styles/tabs.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/tab_strip.test.tsx"
    op: update
related:
  - "20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md"
tags: [tabs, a11y, keyboard, multi-window, context-menu]
---

[x] 탭 메뉴 — 끌지 않고도 창 사이로 옮긴다

## 추가 기능

앞 라운드에서 창 간 탭 이동을 만들면서 **포인터 전용**이라는 걸 스스로 적어 뒀다
(`#keyboard-move-tab`). 드래그를 못 하면 그 기능은 있는 게 아니라 없는 것이다.

탭에 컨텍스트 메뉴를 붙였다. 여는 길이 셋인데 전부 **같은 메뉴**다.

- 우클릭 (마우스)
- **Shift+F10** · **메뉴 키** (키보드 — WAI-ARIA 가 권하는 등가 제스처)

항목: `「사주」 창으로 옮기기`(열려 있는 다른 창마다 한 줄) · `새 창으로 떼어내기` ·
`탭 닫기`. 마지막 탭에는 떼어내기를 안 그린다 — 원래 창이 닫히고 같은 내용의 새 창이
뜰 뿐이라 순수 손해이고, 백엔드도 거절한다. 보낼 창이 없으면 메뉴를 비우는 대신
"옮길 다른 창이 없습니다" 를 적는다: **빈 메뉴는 고장으로 읽힌다.**

덤으로 포인터 사용자도 이득이다 — 창이 겹쳐 있으면 남의 탭 줄을 조준하는 것보다
메뉴에서 이름을 고르는 쪽이 빠르다.

## 동작 흐름

1. `list_app_windows` — 라벨 · 활성 탭의 **프로젝트 id** · 탭 수. 이름은 안 싣는다
   (백엔드는 UI 문자열을 만들지 않는다). 프런트가 이미 든 프로젝트 목록으로 스트립과
   **같은** 이름을 붙이고, 시작 탭만 있는 창은 스트립과 같이 "새 탭" 이 된다.
2. 목록은 **메뉴가 열릴 때마다** 새로 읽는다. 다른 창이 새로 뜨는 건 이 창에
   이벤트로 오지 않는다 — `WindowTabsChanged` 는 창별로만 배달되고, 시작 탭만 있는
   창은 열린 프로젝트 집합도 안 바꾼다. 이벤트를 늘리는 대신 한 번만 물어보는 쪽이
   싸고 항상 옳다.
3. `move_tab_to_window(tab_id, window)` — 자리는 맨 뒤다. 메뉴에는 겨눈 지점이
   없으므로 지어내지 않는다.
4. 드래그(`attach_tab`)와 메뉴가 **같은 길**(`commit_move`)을 쓴다. 나뉘어 있으면
   한쪽만 고쳐져 "끌면 되는데 메뉴로는 안 되는" 종류의 어긋남이 생긴다.
5. `detach_tab` 의 좌표를 `Option<f64>` 로 바꿨다. 포인터로 떼어낼 때만 좌표가
   있고, 메뉴에서는 `null` — 창 자리를 OS 기본에 맡긴다. 예전에는 f64 필수라
   메뉴 경로가 좌표를 지어내야 했다.

메뉴는 `role="tablist"` **바깥**에 절대 위치로 둔다(자식 규약). 위아래 화살표가 끝에서
감싸고, Escape 로 닫으면 **포커스가 원래 탭으로 돌아간다** — 안 되돌리면 키보드
사용자가 메뉴를 닫는 순간 문서 맨 앞으로 튕긴다.

## 검증

- vitest 9건 신설 — 우클릭·Shift+F10·메뉴 키로 열림, 열 때 목록 재조회, 창 선택이
  라벨로 전달, 떼어내기가 좌표 없이(`null`) 불림, 마지막 탭엔 떼어내기 없음, 보낼
  창이 없을 때 이유 표시, 화살표 순회와 첫 항목 자동 포커스, Escape 후 포커스 복귀,
  그리고 **메뉴가 열린 채로 axe 위반 0**.
- 전체 게이트 직접 확인 — `pnpm typecheck` / `pnpm test`(118파일 **1,385건**) /
  `pnpm lint` / `pnpm build` / `cargo test` 전부 exit 0.
- **남은 확인**: 실기기에서 실제로 창 둘을 띄워 메뉴로 옮겨 보는 것. 설치본이 돌고
  있어 dev 빌드를 못 띄운다(같은 플래너 Phase 3 의 조건과 동일).

## 메모

⌘K 팔레트가 아니라 메뉴로 간 이유는 플래너 결정 4 에 잠갔다 — 팔레트는 **어느 탭**이
대상인지 말할 방법이 없다. 활성 탭으로 고정하면 배경 탭을 못 옮기고, 탭까지 고르게
하면 2단이 된다. 메뉴는 연 자리가 곧 대상이라 그 모호함이 없다.

Chrome 의 탭 메뉴에 있는 "다른 탭 모두 닫기 / 오른쪽 탭 모두 닫기" 는 **일부러 뺐다.**
이번 항목은 접근성 구멍을 막는 것이고, 그 둘은 별개의 기능 요청이다.
