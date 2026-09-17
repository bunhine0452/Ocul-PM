---
schema_version: 1
type: bug
slug: "macos27-tray-left-click-shows-menu"
status: done
difficulty: medium
created_at: "2026-09-17T20:03:01+09:00"
session_id: "20260917-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "290a8fb0-9f4c-49fa-920f-30e191ab7dbf"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/tray.rs"
    op: update
related:
  - ref: "20260915/Bugs/1148_bug_macos27-tray-icon-reexec-pidversion.md"
    kind: "followup"
tags:
  - "tray"
  - "macos27"
  - "tray-icon"
  - "regression"
  - "upstream"
  - "mcp-tool"
---
[x] macOS 27 에서 메뉴바 아이콘 왼쪽 클릭이 팝오버 대신 「열기/종료」 메뉴를 띄움 — 메뉴를 오른쪽 클릭 순간에만 붙였다 뗀다

## 발생 원인

3.1.1 로 아이콘을 되살린 뒤 드러난 두 번째 macOS 27 회귀. 아이콘을 왼쪽 클릭하면 상태 팝오버 대신 「Ocul-PM 열기 / Ocul-PM 종료」 컨텍스트 메뉴가 뜬다. `tray.rs` 는 7월 이후 바뀐 적이 없고, 트리거는 9/15 OS 업데이트다.

tray-icon 0.23 은 `NSStatusItem.setMenu` 로 메뉴를 상시 붙여 두고, 버튼 위에 투명 뷰(`TrayTarget`)를 얹어 mouseDown 을 가로챈 뒤 "왼쪽 = 앱에 `Click` 이벤트, 오른쪽 = `performClick` 으로 메뉴" 로 가른다. macOS 27 은 상태 아이템을 FrontBoard 씬으로 호스팅하면서, 메뉴가 붙어 있으면 AppKit 이 클릭을 먼저 소비해 왼쪽 클릭에도 메뉴를 띄운다 — 가로채기 뷰에는 이벤트가 오지 않아 `toggle_popover` 는 한 번도 불리지 않는다. 상류 이슈 tauri-apps/tray-icon#355, 수정 #365 → 0.25.1 (2026-09-16). Tauri 2.11.x 는 `tray-icon ^0.24` 라 그 버전을 못 받고, 3.0 은 alpha.

## 해결 방법

상류 #365 와 같은 수법을 앱 쪽에서 재현했다 — `TrayIconBuilder` 에 `.menu()` 를 붙이지 않고, `TrayIconEvent::Click { Right, Down }` 에서 `show_context_menu`: `tray.set_menu(Some(menu)) → with_inner_tray_icon(|t| t.show_menu()) → set_menu(None)`. `show_menu`(performClick) 는 메뉴 추적이 끝날 때까지 돌아오지 않는 중첩 이벤트 루프라 돌아온 순간 떼면 다음 왼쪽 클릭은 다시 우리 손에 온다. 트레이 이벤트 핸들러는 메인 스레드에서 돌고 `run_item_main_thread!` 는 메인 스레드면 제자리 실행이라 세 호출이 순서대로 동기 실행된다. 메뉴 이벤트(`on_menu_event`)는 muda 전역 핸들러라 부착 여부와 무관하게 계속 온다. 27 이전 macOS 에서도 같은 순서로 동작한다(메뉴 없음 → 오른쪽 클릭에 highlight 만 → 우리가 띄움).

Tauri 가 tray-icon ≥0.25.1 을 싣는 날 `.menu(&menu)` 로 되돌리고 `show_context_menu` 를 지우면 된다 — 주석에 적어 뒀다.

## 검증

- 별도 identifier 프로브 번들(`tauri build --bundles app --config '{"identifier":"com.kimhyunbin.ocul-pm.trayprobe",…}'`, `createUpdaterArtifacts:false`) 을 `open` 으로 기동해 설치본과 나란히 띄움. 사용자 실기기 확인: 왼쪽 클릭 → 팝오버, 오른쪽 클릭 → 메뉴 ("이제 잘 뜬다").
- 프로브 첫 기동은 시작 탭이 닫히며 6초 만에 종료됐다 — 프로브 DB 에 `tray.keep_running=1` 을 넣어 재기동. 로그 디렉터리는 `ProjectDirs` 하드코딩이라 프로브도 설치본 로그에 섞여 쓴다.
- `cargo build` · clippy `-D warnings` · fmt 깨끗. 트레이 단위 테스트 4개 그대로 통과.