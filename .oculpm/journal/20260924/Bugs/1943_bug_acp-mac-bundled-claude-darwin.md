---
schema_version: 1
type: bug
slug: "acp-mac-bundled-claude-darwin"
status: done
difficulty: low
created_at: "2026-09-24T19:43:30+09:00"
session_id: "20260924-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
related: []
tags:
  - "acp"
  - "cross-platform"
  - "mcp-tool"
---
[x] macOS ACP 진단이 딸려 온 claude 를 못 찾던 결함 — npm 플랫폼 이름 darwin (PR #39)

## 발생 원인

`acp::adapter::npm_platform` 이 Rust OS 이름 `macos` 를 그대로 써서 `claude-agent-sdk-macos-<arch>` 를 찾았다. 실제 npm 패키지 폴더는 `claude-agent-sdk-darwin-arm64`(개발 기기 app-data 에서 확인). 그래서 **시스템에 claude 를 따로 깔지 않은 macOS 사용자는 ACP 가 멀쩡히 돌아도 진단이 "Claude Code 를 설치하세요" · 준비 안 됨**이었다. L-OS 레인이 Windows(`win32`)를 고치다 발견하고, D3(macOS 불변)로 손대지 않고 보고 → 사용자 결정으로 수정.

기존 테스트는 기대 경로를 `npm_platform` 으로 **다시 계산**해 함수가 틀려도 통과했다 — 결함이 그렇게 숨었다.

## 해결 방법

`"macos" => "darwin"`. 테스트는 OS 별 실제 폴더 이름(`win32`·`darwin`·`linux`)을 문자열로 못박았다.

영향 범위를 정정해 둔다: 사용자에게 결정을 물을 때 "ACP 가 쓰는 claude 바이너리가 바뀐다" 고 부풀려 말했으나, `bundled_claude` 는 `acp::diagnose` 만 먹인다 — 실제로 실행되는 claude 는 어댑터(`CLAUDE_CODE_EXECUTABLE` 없으면 SDK 옆 네이티브)가 고르므로 **바뀌지 않는다.** 사용자에게 바로잡아 알렸다.

## 검증

- 로컬 macOS cargo test 1,944 통과 0 실패. PR #39 ci.yml 3잡 SUCCESS, portability ubuntu·사이드카 초록, windows 는 첫 시도에서 무관한 ptyhost ^C 테스트가 간헐 실패(#pty-ctrlc-flake — L-PTY2 조사) → 재시도 초록. rebase 머지.
- 실기기 확인(사용자가 할 수 있다): 다음 릴리스 뒤 설정의 ACP 진단에서 claude 경로가 `…/acp/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`·딸려 옴으로 뜨는지.