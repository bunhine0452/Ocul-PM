---
schema_version: 1
type: bug
slug: "port-app-dirs-projectdirs-mismatch"
status: done
difficulty: medium
created_at: "2026-09-25T03:07:43+09:00"
session_id: "mcp-20260925-030743"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/app_dirs.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/config/cli.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_search/cache.rs"
    op: update
  - path: "e2e/lib/env.mjs"
    op: update
related: []
tags:
  - "cross-platform"
  - "windows"
  - "linux"
  - "mcp-tool"
---
[x] Windows·Linux 에서 CLI·로그·MCP 검색 캐시가 GUI 와 다른 앱 데이터 폴더를 쓰던 결함 (PR #43)

## 발생 원인

GUI 는 Tauri `app_data_dir()` 을 쓴다. 이 값은 OS 데이터 폴더에 번들 식별자 `com.kimhyunbin.ocul-pm` 을 붙인 경로다. 그런데 `AppHandle` 이 없는 세 자리는 `directories::ProjectDirs::from("com","kimhyunbin","ocul-pm")` 로 경로를 구했다. 세 자리는 `lib.rs::setup_logging`, `config/cli.rs::open_db`, `oculpm/journal_search/cache.rs::app_db_path` 다. 두 방식은 **macOS 에서만** 같은 폴더가 나온다.

- Windows 는 `%APPDATA%\kimhyunbin\ocul-pm\data` 와 `%APPDATA%\com.kimhyunbin.ocul-pm` 으로 갈린다.
- Linux 는 `~/.local/share/ocul-pm` 과 `~/.local/share/com.kimhyunbin.ocul-pm` 으로 갈린다.

그래서 `ocul-pm config` CLI 가 GUI 와 **다른 DB** 를 열었다. `oculpm.log` 도 `ptyhost.log` 와 다른 폴더에 쌓였고, MCP 일지 검색은 앱 캐시를 못 찾아 디스크 스캔으로 내려갔다. L-PTY2 가 찾았다.

## 해결 방법

`src-tauri/src/app_dirs.rs` 를 새로 두어 AppHandle 없이 경로를 구하는 단일 창구로 삼았다. `BaseDirs::data_dir()` 에 `BUNDLE_IDENTIFIER` 를 붙이는 Tauri 규칙 그대로다. 세 호출 자리를 모두 이 모듈로 바꾸고, cache.rs 의 `APP_QUALIFIER` 상수는 지웠다. macOS 는 경로가 같아서 동작이 바뀌지 않는다(D3).

테스트 셋:
- 식별자가 `tauri.conf.json` 과 일치하는가.
- macOS 에서 예전 ProjectDirs 경로와 같은가.
- 비-mac 에서 Tauri 규칙을 따르고 예전 경로와 다른가.

## 검증

- PR #43: ci.yml 3잡, portability.yml(Rust·사이드카·프런트 양 OS), E2E(windows·ubuntu) 전부 pass. rebase 병합(e2e4ec5a).
- 기존 Windows·Linux 사용자는 없으므로(첫 출시 전) 옛 경로에서 옮겨 오는 코드는 두지 않았다.