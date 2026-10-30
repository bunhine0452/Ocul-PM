---
schema_version: 1
type: bug
slug: "window-scoped-events"
status: done
difficulty: medium
created_at: "2026-10-30T16:14:51+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/api/invoke.ts"
    op: update
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/api/deeplink.ts"
    op: update
  - path: "src-tauri/src/deeplink.rs"
    op: update
  - path: "src-tauri/src/commands/window/focus.rs"
    op: update
  - path: "src-tauri/src/commands/window/registry.rs"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src/__tests__/subscribe_here.test.ts"
    op: create
related:
  - ref: "20261009/Bugs/0407_bug_code-exec-boundary-acp-git-plugin.md"
    kind: "followup"
tags:
  - "창"
  - "terminal"
  - "deeplink"
  - "multi-window"
  - "mcp-tool"
---
[x] 창: 한 창에 보낸 확인이 모든 창에 뜨던 것

## 발생 원인

사용자 보고: 창을 닫을 때 「터미널에서 Claude 가 실행 중」 확인이 다른 창에도 떴다.

- 백엔드는 `TermCloseAsked` 를 `emit_to(창 라벨)` 로 그 창에만 보낸다.
- 하지만 프런트는 `bindings.ts` 의 `events.X.listen` 을 썼고, 이것은 `@tauri-apps/api` 의 전역 `listen` 이다. 전역 `listen` 의 대상은 `{ kind: 'Any' }` 다.
- tauri 2.12.5 의 `match_any_or_filter` 는 대상이 `Any` 인 리스너에게 모든 이벤트를 넘긴다. 그래서 다른 창에 보낸 이벤트까지 받았다.
- 더 나쁜 결과도 있었다. 다른 창에서 「닫기」를 누르면 `term_end_window` 와 `close_window` 가 **그 창**의 세션을 끝내고 그 창을 닫았다.

같은 꼴이 셋 더 있었다.
- ⌘Q 끄기 확인: 같은 `TermCloseAsked` 이벤트(`quit: true`)를 쓴다.
- 도움말 › 처음 쓰는 법(`TourRequested`): 열린 창마다 투어가 떴다.
- 딥링크 확인 시트: `app.emit` 으로 전역 발송해서, 프로젝트 창마다 시트가 떠 배경 창에 남았다.

## 해결 방법

- `api/invoke.ts` 에 `subscribeHere` 를 더했다. tauri-specta 의 `events.X(getCurrentWebviewWindow()).listen` 으로 **현재 창 대상** 리스너(`WebviewWindow{label}`)를 건다.
  - 이 리스너는 `AnyLabel{label}` 로 보낸 것(`emit_to(&str)`)과 전역 발송만 받는다. tauri `filter_target` 소스로 확인했다.
  - 웹뷰 밖에서는 빈 해제 함수를 돌려준다.
- `terminalApi.onCloseAsked` · `windowApi.onTourRequested` · `onDeepLink` 를 이 함수로 옮겼다.
- 딥링크는 백엔드도 고쳤다.
  - `Registry::project_window` 가 프로젝트를 담은 창 하나를 고른다. 순서는 포커스 창 → 마지막 포커스 창 → 라벨 순이다.
  - `focused_project_window` 가 그 창에만 `emit_to` 한다.
  - 프로젝트 창이 없으면 예전처럼 전역으로 보낸다(시트는 프로젝트 창에만 있다).
- `windowProjectChanged` · `windowNavigate` 는 이미 페이로드(창 라벨 · 프로젝트 id)로 걸러서 그대로 두었다. `windowNavigate` 는 항상 프로젝트 id 를 싣는다(`open_project_nav`).

## 검증

- 새 테스트 `src/__tests__/subscribe_here.test.ts`: 세 구독이 `@project-7` 창 대상이고, 웹뷰 밖에서는 빈 해제 함수를 준다. 고치기 전 코드로 돌리면 2 failed 다.
- `cargo test --lib window::` → 25 passed (새 `a_deep_link_goes_to_one_project_window`)
- 전체: `pnpm typecheck` 0 · `pnpm test` Tests 948 passed · `pnpm lint` 0 · `pnpm build` 0 · `cargo fmt --check && cargo clippy -D warnings && cargo test --locked --no-fail-fast` → rust passed 1154 failed 0
- 실제 창 둘에서 닫기를 눈으로 확인하는 것은 아직 남았다. 다음 릴리스 설치본에서 확인한다.