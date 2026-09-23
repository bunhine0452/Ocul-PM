---
schema_version: 1
type: feature
slug: "port-os-branches-los"
status: done
difficulty: superhigh
created_at: "2026-09-24T02:40:42+09:00"
session_id: "20260924-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/deeplink.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/open_native.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/tray.rs"
    op: update
  - path: "src-tauri/src/tray/placement.rs"
    op: create
  - path: "src-tauri/src/secrets.rs"
    op: update
  - path: "src-tauri/src/dap/registry.rs"
    op: update
  - path: "src-tauri/src/lsp/registry.rs"
    op: update
  - path: "src-tauri/src/lsp/client.rs"
    op: update
  - path: "src-tauri/src/commands/code/clipboard_windows.rs"
    op: create
  - path: "src-tauri/src/commands/code/mutate.rs"
    op: update
  - path: "src-tauri/src/acp/recording.rs"
    op: update
  - path: "src-tauri/src/test_links.rs"
    op: create
  - path: "src-tauri/tests/hook_sh/mod.rs"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260924/Bugs/0230_bug_port-fs-semantics-lfs.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "security"
  - "mcp-tool"
---
[x] 나머지 OS 분기 — 메뉴·딥링크·트레이·비밀 저장소·외부 도구, cmd 명령 주입 두 곳 (L-OS, PR #34)

## 추가 기능

크로스플랫폼 W2 · L-OS(병렬 worktree 세션) 합류. 42파일.

- **비-mac 앱 메뉴 미부착**(`#os-no-menu`, L-UI 발견): GTK 액셀러레이터가 터미널의 Ctrl+W(페인 닫힘)·Ctrl+C(SIGINT 대신 복사)를 가로챈다. MockRuntime 테스트가 windows·ubuntu 에서.
- **딥링크**: 비-mac 은 두 번째 인스턴스 argv 와 첫 기동 `args_os` 에서 링크를 건진다(`deeplink::links_in_argv`), AppImage 만 `register_all`.
- **보안 결함 둘 (Windows)**: `open_url`·`open_native`·Notion OAuth 가 `cmd /c start "" <url>` 였다 — cmd 는 따옴표 밖 `&`·`|`·`^` 를 명령 구분자로 읽어 **URL·경로의 `&` 뒤가 명령으로 실행**될 자리였고, Notion 은 `&state=` 가 잘려 OAuth 가 깨졌다 → ShellExecute(opener). 외부 편집기는 `cmd /S /C` + `raw_arg`.
- 트레이 비-mac(메뉴 상시 — appindicator 는 클릭 이벤트가 없다 · 불투명 팝오버 · 작업 영역 기준 위치, `tray/placement.rs` 로 분리해 래칫 936→716), Linux Secret Service 부재 시 평문 저장 없는 `SecretError::Unavailable`, DAP 비-mac(PATH `lldb-dap`·Windows `py`), LSP `kill_on_drop` 전 OS·Windows URI `file:///C:/`, Windows 클립보드 CF_HDROP, 휴지통은 새 스레드(MTA 스레드에서 trash 패닉), 사이드카 후보 OS 별.
- `#fs-symlink-tests`(L-FS 에서 이관): 경로 탈출 가드 테스트 12곳을 `test_links`(심링크→정션) 로 Windows 에서 실제 링크를 만들어 통과. `#![cfg(unix)]` 로 Windows 0건이던 통합 테스트 17건을 Git Bash 로.

## 오케스트레이터 검토 (macOS 불변)

Notion·열기 macOS `open` 그대로, 메뉴 부착 `cfg(macos)` 안, 딥링크 argv `cfg(not(macos))`, DAP macOS `xcrun lldb-dap`·`python3`, LSP URI 는 `cfg!(windows)` 분기만, 휴지통 같은 호출. 외부 편집기 `sh -c` 는 비-Windows 분기에 그대로.

## 발견 (결정 필요)

macOS 기존 결함: `acp/adapter.rs` `npm_platform` 이 "macos" 로 찾아 `claude-agent-sdk-darwin-arm64` 의 딸린 claude 를 못 보고 PATH claude 로 물러선다 — D3 로 손대지 않고 `#mac-bundled-claude` 사용자 결정.

## 검증

- 오케스트레이터가 L-FS 합류 뒤 rebase(충돌 0) → 로컬 macOS fmt · clippy · cargo test 1,874 통과 0 실패 · file-size clean · bindings diff 없음.
- PR #34: ci.yml 3잡 SUCCESS + portability windows check·clippy 초록 · **실패 2건 전부 다른 레인 몫**(L-SHELL search_path · L-INTEG codex_register) — L-FS+L-OS 결합으로 새 실패 0. rebase 머지 f01fdab0.
- 간헐 실패 관찰: `watcher::removing_the_project_root_does_not_resurrect_it` 가 L-SHELL run 에서 Access is denied(os 5)로 한 번 붉고 이 run 에선 초록 → `#fs-watcher-flake`.
- CI 로 못 본 것: 두 번째 인스턴스 인계·스킴 등록·트레이 표시·GNOME AppIndicator → W3 E2E·#w5-eyes.