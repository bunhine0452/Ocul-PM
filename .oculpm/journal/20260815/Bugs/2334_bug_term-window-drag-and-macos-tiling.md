---
schema_version: 1
type: bug
slug: "term-window-drag-and-macos-tiling"
status: done
difficulty: medium
created_at: "2026-08-15T23:34:31+09:00"
session_id: "mcp-20260815-233431"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/windows/TerminalWindow.tsx"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/window.rs"
    op: update
related: []
tags:
  - "terminal"
  - "window"
  - "macos"
  - "menu"
  - "a11y"
  - "mcp-tool"
---
[x] 분리 터미널 창이 안 움직이던 것 · 이 앱에서만 ⌃⌥ 창 분할이 죽던 것

## 발생 원인

**① 분리 터미널 창을 상단바로 끌어도 안 움직였다.**

그 창은 `titleBarStyle: Overlay` + `hidden_title` 이라 **잡을 타이틀바가 없다** — 신호등만 콘텐츠 위에 떠 있고, 창을 옮기는 자리는 앱이 직접 내줘야 한다(`data-tauri-drag-region`). 탭 창은 `TabStrip` 이, 일반 화면은 `Toolbar` 가 그 자리를 준다. 그런데 분리 창의 유일한 상단 크롬은 `TerminalSurface` 의 탭 줄인데 거기엔 리전이 한 군데도 없었다. 결과: 창을 **아예 옮길 수 없었다**.

**② ⌃⌥←→↑↓ (macOS 창 분할)가 이 앱에서만 안 먹었다.**

이건 시스템 전역 키가 아니라 **"창" 메뉴 안 "이동 및 크기 조절" 항목의 액셀러레이터**다. AppKit 은 그 항목들을 `NSApp.windowsMenu` 로 **지정된** 서브메뉴에만 끼워 넣는다. 우리는 ⌘W 를 "창 닫기"에서 "탭 닫기"로 되찾으려고 메뉴를 직접 구성했는데(`menu.rs`), 그러면서 어느 것이 창 메뉴인지 알려 주지 않았다 — 그래서 그 항목이 애초에 생기지 않았고, 없는 메뉴 항목의 단축키는 당연히 안 먹는다.

## 해결 방법

**①** `TerminalSurface` 에 `dragRegion` prop 을 두고 **분리 창에서만** 켠다. 도크·터미널 화면에서 켜면 그쪽 탭 줄을 끌 때 앱 창 전체가 따라 움직인다. 붙이는 자리는 탭 줄 컨테이너와 빈 스페이서 둘 — Tauri 는 클릭된 엘리먼트 **자신**의 속성만 보고 조상을 타고 오르지 않으므로, 탭·버튼에는 일부러 붙이지 않아 클릭이 그대로 산다. macOS 신호등 자리(왼쪽 82px 패딩)도 컨테이너의 일부라 함께 잡힌다.

**②** `menu::build` 가 창 서브메뉴를 함께 돌려주고, 새 `menu::apply` 가 **빌드 → `set_menu` → `set_as_windows_menu_for_nsapp`** 을 한 번에 한다. 메인 메뉴에 붙인 **뒤에** 지정한다 — 순서가 뒤바뀌면 AppKit 이 아직 메뉴바에 없는 NSMenu 를 잡는다. 언어를 바꾸면 서브메뉴를 새로 만들므로 지정도 매번 다시 해야 하는데, 두 단계를 한 함수로 묶어 호출처가 빼먹을 수 없게 했다. 지정 실패는 경고만 남긴다 — 단축키 하나 때문에 앱이 안 뜰 이유는 없다.

**재발 방지 가드**: `set_menu` 를 `apply` 밖에서 부르는 새 경로가 생기면 컴파일 타임 소스 검사(`include_str!`)로 테스트가 깨진다. 이 종류의 회귀는 **화면으로는 티가 안 나고** 사용자가 "이 앱만 창 분할이 안 된다"고 느낄 뿐이라 자동 가드가 필요하다.

## 검증

- 게이트 5종 전부 exit 0 직접 확인: `pnpm typecheck` / `test` / `lint` / `build` / `cargo test`(586, +1 신규 가드). 생성물 드리프트 없음.
- `core:window:allow-start-dragging` 과 `term-*` 창 스코프가 이미 capabilities 에 있어 리전이 실제로 동작할 조건은 갖춰져 있다.
- **미검증**: 두 증상 모두 **실제 앱에서 확인하지 못했다.** 워킹트리를 다른 세션 둘이 쓰고 있어 전용 워크트리에서 작업했고 앱을 띄우지 않았다. 특히 ②는 AppKit 이 런타임에 항목을 주입하는지를 눈으로 봐야 확정된다 — 창 메뉴에 "이동 및 크기 조절" 이 생겼는지가 판정 지점이다.