---
schema_version: 1
type: bug
slug: "titlebar-dblclick-and-blank-oculpm-settings"
status: done
difficulty: low
created_at: "2026-08-16T00:15:01+09:00"
session_id: "mcp-20260816-001501"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/TabStrip.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/__tests__/tab_strip.test.tsx"
    op: update
  - path: "src/__tests__/oculpm_settings_subtabs.test.tsx"
    op: update
related: []
tags:
  - "ui"
  - "tabs"
  - "settings"
  - "window"
  - "regression-test"
  - "mcp-tool"
---
[x] 타이틀바 더블클릭이 탭을 늘리던 것 · 시작 탭 설정의 ocul-pm 화면이 통째로 빈 화면이던 것

실기기 사용 중 보고된 두 건. 서로 무관하지만 둘 다 "창 하나가 통째로 이상해지는" 종류라 한 사이클로 묶었다.

## 발생 원인

**1. 타이틀바 더블클릭 → 탭이 하나씩 늘어남**

탭 스트립의 남는 공간(`.tabstrip-drag`)은 무장식 타이틀바의 잡는 자리라 `data-tauri-drag-region` 을 달고 있다. 여기에 브라우저 관습을 따라 `onDoubleClick={() => onNewTab()}` 을 겹쳐 걸어 두었는데, Tauri 의 드래그 리전 스크립트(`tauri/src/window/scripts/drag.js`)가 **같은 더블클릭을 이미 `internal_toggle_maximize` 로 소비**한다. macOS 에서는 `mouseup` 경로다. 결과적으로 타이틀바를 더블클릭할 때마다 창 확대/복원과 새 시작 탭 생성이 **동시에** 일어났다 — 사용자 눈에는 "창이 하나 더 생기는" 버그.

**2. 시작 탭 설정 → ocul-pm 탭이 빈 화면**

`OculpmSettings` 가 `useWorkspace()` 를 호출하는데, 이 훅은 프로바이더가 없으면 throw 한다. 그런데 시작 탭(`StartTab`)은 **의도적으로** `WorkspaceProvider` 를 마운트하지 않는다(워크스페이스 상태는 프로젝트 탭의 개념 — 탭 사이 localStorage 충돌 방지). 설정 오버레이는 시작 탭·프로젝트 탭 양쪽에서 같은 `SettingsPanel` 을 띄우므로, 시작 탭에서 ocul-pm 탭을 누르는 순간 예외가 올라가고 경계가 없어 React 가 창 트리를 통째로 언마운트했다. 2026-07-31 터미널 크래시(`TerminalErrorBoundary`)와 같은 실패 모드다.

## 해결 방법

1. `.tabstrip-drag` 의 `onDoubleClick` 제거 — 더블클릭은 Tauri 의 창 확대/복원에 온전히 넘긴다. 새 탭은 `+` 버튼과 ⌘T 가 담당한다.
2. `OculpmSettings` 를 `useOptionalWorkspace()` 로 바꿔 프로젝트가 없으면 기존 빈 상태(`op.pickProject`)만 보여주게 했다 — `SettingsPanel` 의 색인 탭이 이미 쓰던 접근자와 같다.

두 건 모두 회귀 테스트를 갈아끼웠다. 탭 스트립 테스트는 "더블클릭하면 새 탭"에서 "더블클릭은 탭을 만들지 않는다"로 계약을 뒤집었고, ocul-pm 설정 테스트에는 프로바이더 없이 렌더해도 크래시 대신 안내가 뜨는 케이스를 추가했다.

## 검증

- `pnpm test` — 73 파일 879 테스트 통과 (뒤집은 탭 스트립 계약 + 새 워크스페이스 부재 케이스 포함).
- `pnpm typecheck`, `pnpm lint` 각각 exit 0.
- 앱 실행 확인은 미실시 — 사용자 쪽 실기기 확인이 남아 있다.