---
schema_version: 1
type: feature
slug: multi-project-windows
status: done
created_at: 2026-08-12T20:00:34+09:00
session_id: "manual-20260812-200034"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/capabilities/default.json
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/commands/terminal.rs
    op: update
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/main.tsx
    op: update
  - path: src/App.tsx
    op: delete
  - path: src/windows/LauncherWindow.tsx
    op: create
  - path: src/windows/ProjectWindow.tsx
    op: create
  - path: src/windows/SettingsOverlay.tsx
    op: create
  - path: src/windows/Dialog.tsx
    op: create
  - path: src/lib/windowRoute.ts
    op: create
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/components/Sidebar.tsx
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/features/terminal/TerminalScreenV2.tsx
    op: update
  - path: src/features/onboarding/StartScreen.tsx
    op: update
  - path: src/features/onboarding/home/tiles.tsx
    op: update
  - path: src/features/onboarding/home/rows.tsx
    op: update
  - path: src/__tests__/multi_window.test.tsx
    op: create
  - path: scripts/check-no-localstorage.mjs
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related: []
tags: [multi-window, tauri, workspace, pty, tray]
---

[x] 멀티 프로젝트 창 — 메인 창을 런처 전용으로 바꾸고 프로젝트마다 독립 창

## 추가 기능

`docs/20260811_three-features/01-multi-window.md` Phase 1 구현. 메인 창(`main`)은 런처 전용이 되고, 프로젝트를 열면 언제나 별도 창 `project-<id>` 가 뜬다. 불변식 셋:

- **I1** 프로젝트당 창 하나 — 이미 열려 있으면 새로 만들지 않고 포커스한다.
- **I2** 런처는 `ShellV2` 도 `WorkspaceProvider` 도 마운트하지 않는다.
- **I3** 창의 프로젝트는 URL 이 정하고 런타임에 바뀌지 않는다 — "프로젝트 전환"은 곧 "다른 창을 포커스".

신규 커맨드 `open_project_window` / `list_open_project_windows` / `focus_launcher_window`, 신규 이벤트 `ProjectWindowsChanged`. 죽어 있던 `open_terminal_window` 는 제거했다 (라벨이 capability 에 없고 URL 도 처리되지 않아 호출하면 깨지는 코드였다 — 남겨두면 "멀티 창 지원이 이미 있네"로 오독된다).

## 동작 흐름

`main.tsx` 가 URL 로 세 갈래로 갈린다 (`parseWindowRoute` — 순수 함수라 단위 테스트 가능): `?tray=1` → `TrayApp`, `?project=<n>` → `WorkspaceProvider(projectId)` → `ProjectWindow`, 무파라미터 → `LauncherWindow`. 563줄짜리 `App.tsx` 는 런처 관심사(프로젝트 CRUD·인덱싱·그린필드)와 셸 관심사(`.oculpm` init·watcher·자동 색인)로 쪼개져 두 창 파일이 됐고 원본은 삭제됐다.

설계 문서가 지목한 함정 5개를 전부 처리했다.

- **T1 capability (R2)** — `windows` 에 글롭 `"project-*"` 추가. 없으면 창은 정상적으로 뜨는데 모든 IPC 가 permission denied 로 죽어 빈 화면만 남는, 추적이 매우 어려운 실패 모드다.
- **T2 종료 계약 (R1)** — `should_exit_on_launcher_close(open_windows, keep_running)` 순수 함수로 분리. 열린 프로젝트 창이 있으면 런처를 닫아도 숨기기만 한다. 대칭으로 `handle_last_project_window_closed` 를 추가해, 마지막 프로젝트 창이 닫혔는데 런처도 숨겨져 있고 상주 설정이 꺼져 있으면 종료한다(숨은 트레이 팝오버 창 때문에 Tauri 의 자동 종료가 발화하지 않는다). macOS Dock 숨김도 "보이는 창 0" 일 때만 적용한다.
- **T3 저장소 분리 (R3)** — 키를 `aipm:workspace:v2:p<id>` 로 쪼개고 `WORKSPACE_SCHEMA_VERSION` 3→4. `currentProjectId/Name/Root` 는 영속 대상에서 뺐다(창 URL 이 단일 진실). 기존 `aipm:workspace:v1` 레코드는 그 안의 `currentProjectId` 를 읽어 해당 프로젝트 키로 1회 이관하고 삭제한다(`null` 이면 런처 상태였으므로 폐기). `setProject` 는 `setProjectMeta(name, root)` 로 좁혀 I3 을 타입으로 강제했고, 호출처가 사라진 `resetWorkspace` 는 제거했다.
- **T4 PTY 생명주기 (R4)** — sid 에 창 접두사 `p<projectId>-` 를 새기고, 창의 `CloseRequested` 훅에서 그 접두사의 세션만 `PtyState::kill_with_prefix` 로 죽인다. 프런트 `beforeunload` 에 맡기지 않은 이유는 강제 종료 시 새기 때문. 프로젝트 창이 0개가 되면 접두사 없는 레거시 sid 까지 회수한다.
- **T5 트레이 딥링크** — `tray_open_main` 이 `TrayNavigate.project_id` 로 대상 창을 정한다. 이미 열린 창이면 `emit_to(label)`, 없으면 목적지를 URL(`&view=`/`&entry=`)에 실어 창을 만든다 — 갓 만든 창의 프런트는 리스너를 달기 전이라 emit 이 유실된다. 전역 emit 이 사라져 프로젝트 A 의 일지 클릭이 모든 창을 끌고 가지 않는다.

공용 컴포넌트 중 `CommandPalette` 와 `SettingsPanel` 이 `useWorkspace()` 를 부르고 있어 런처에서 throw 했다 — `useOptionalWorkspace()` 를 추가해 프로젝트에 매인 항목(화면 이동·세션·재색인)만 조용히 끄도록 했다. UX 는 런처 카드/사이드바 팝오버의 "열림" 배지, 사이드바 하단 "런처 열기", ⌘P·팔레트의 프로젝트 선택이 창 포커스로 바뀐 것.

## 검증

`pnpm typecheck` · `pnpm test`(57파일 692테스트) · `pnpm lint` · `pnpm build` · `cargo test`(536 + 통합) 전부 exit 0 을 직접 확인. 신규 `src/__tests__/multi_window.test.tsx` 14개가 라우팅 3갈래·판독 불가 id 폴백·키 분리·v1 이관 4케이스·두 창 상태 격리를 고정하고, Rust 쪽은 `should_exit_on_launcher_close` 진리표·라벨 왕복·PTY 접두사 비포섭(`p1-` 이 `p12-…` 를 안 잡는다)·딥링크 URL 인코딩을 고정한다. 기존 스위트 10개의 `WorkspaceProvider` 마운트에 `projectId` 를 주입했고, 저장소 키를 하드코딩하던 2개는 `storageKeyFor()` 를 쓰게 바꿨다.

## 메모

- 설계 문서 §7 의 **수동 검증 9종은 아직 안 돌렸다** — 창 3개 동시 열기, 창별 터미널 cwd 격리, 런처 닫아도 앱이 안 죽는지, 동일 프로젝트 재클릭이 포커스인지 등 실기기 확인이 남았다.
- `plugin.json` / `marketplace.json` 의 버전이 2.8.4 로 뒤처져 `plugin_manifest` 통합 테스트가 이 작업 **이전부터** 깨져 있었다(`git stash` 로 확인). 커밋 게이트를 열려면 필요해서 `build-sidecar.mjs` 와 같은 방식으로 2.8.5 로 맞췄다.
