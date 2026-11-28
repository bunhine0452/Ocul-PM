---
schema_version: 1
type: bug
slug: "quit-teardown-dock-reopen"
status: done
difficulty: medium
created_at: "2026-11-28T19:30:41+09:00"
session_id: "20261128-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "6fe2b56e-24f4-4ecc-9cdf-cb61ec923378"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/commands/window/registry.rs"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/mod.rs"
    op: update
  - path: "src-tauri/src/terminal_clipboard.rs"
    op: update
  - path: "src/features/oculpm/useOculpmLive.ts"
    op: update
  - path: "src/lib/updater.ts"
    op: update
related:
  - ref: "20261119/Bugs/1644_bug_mac-update-applying-overlay.md"
    kind: "followup"
tags:
  - "종료"
  - "터미널"
  - "창"
  - "업데이트"
  - "최적화"
  - "mcp-tool"
---
[x] 종료: ⌘Q 가 정리와 묻기를 지나게 한다

## 발생 원인

설치본 로그 2주치(11-15 ~ 11-28)에서 종료 정리 줄 `released project locks on shutdown` 이 업데이트 재시작 3번에만 찍히고, 그 밖의 종료 뒤 기동 9번에는 한 번도 없었다. 세션 마감 사유도 `AppQuit` 1건에 크래시 복구가 여럿이었다.

- macOS 앱 메뉴의 종료 항목은 OS 가 주는 것(`terminate:`)이었다. tao 는 이것을 `applicationWillTerminate` → `RunEvent::Exit` 로만 알린다. `RunEvent::ExitRequested` 는 마지막 창이 파괴될 때와 `app.exit(code)` 에서만 온다. 그래서 ⌘Q · Dock 종료 · 로그아웃은 `teardown_for_exit`(터미널 셸 거두기 · 세션 `AppQuit` 마감 · 락 해제)를 지나지 않았고, 「끄기 전에 묻기」(도는 터미널 세션)도 macOS 에서는 뜬 적이 없다.
- 마지막 창을 닫으면 창을 숨기고 레지스트리에서만 뺐다. 숨은 웹뷰는 닫은 프로젝트 화면을 그대로 들고 돌았고, Dock 을 누르면 레지스트리가 모르는 창이 그대로 다시 보였다. 워처는 프로젝트를 담은 창에만 파일 변경을 보내므로 그 창은 실시간 갱신이 오지 않았다.
- 업데이트를 받아 두고 기다리는 동안 「지금 재시작」 과 다시 보기(사건 · 10초 간격)가 겹치면 바꾸기가 두 번 불렸다. macOS 에서 다시 띄우기가 실패하면 「바꾸고 있어요」 덮개가 남았다.
- 세션 액터가 프로젝트마다 쉬는 동안에도 250ms 마다 깼다(프로젝트 9개면 초당 36번).
- 보이지 않는 창도 일지 · 계획 사건마다 목록을 다시 읽었다.
- 11-26 로그: OSC 52 복사가 `pasteboard refused the text` 로 한 번 사라졌다.

## 해결 방법

- `RunEvent::Exit` 에서도 `teardown_for_exit` 를 부른다(두 번째 호출은 빈 표를 보고 곧장 돌아온다).
- 앱 메뉴의 종료를 앱의 항목(`menu:quit`, ⌘Q)으로 바꿨다. `request_quit` 이 도는 세션이 있으면 그 창에 묻고, 없으면 `app.exit(0)` 으로 `ExitRequested` → 정리 → 종료의 길을 지난다.
- 마지막 창을 숨길 때 그 창에 「이제 시작 창」 을 알리고 담고 있던 프로젝트를 적어 둔다. Dock 을 누르면(`window::reopen`) 아는 창이 있으면 앞으로, 없으면 숨긴 창이 그 프로젝트로 새로 읽어 돌아오고, 프로젝트가 지워졌으면 시작 창이다.
- 업데이트 바꾸기는 한 번만(`applying`), 다시 띄우기 실패는 오류 상태로 풀어 다시 누를 수 있다.
- 세션 액터의 틱은 쓸 것이 있을 때만 깬다.
- 일지 · 계획 사건은 창이 보이지 않으면 적어만 두고 다시 보일 때 한 번 읽는다.
- 클립보드 쓰기는 거절되면 한 번 더 비우고 쓴다.

## 검증

- `cargo test --locked --lib -- commands::window menu:: oculpm::session terminal:: keep_awake oculpm::manager` → `test result: ok. 206 passed; 0 failed`
- `cargo clippy --locked --all-targets -- -D warnings` → `Finished` (경고 0, macOS)
- `pnpm typecheck` exit 0 · `pnpm test` → `Tests 2275 passed (2275)` · `pnpm lint` → 6 게이트 통과
- 못 한 것: 실제 앱에서 ⌘Q · Dock 다시 열기를 눈으로 보지 않았다(설치본이 도는 중이라 개발 빌드를 띄우지 않았다). Windows · Linux 컴파일과 전체 `cargo test` · `pnpm build` 는 돌리지 않았다.