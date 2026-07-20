---
schema_version: 1
type: bug
slug: tauri-dev-default-run
status: done
difficulty: verylow
created_at: "2026-07-20T14:58:06+09:00"
session_id: "manual-20260720-145806"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/Cargo.toml
    op: update
related:
  - 20260720/Features_to_add/1449_feature_oculpm-mcp-server.md
tags: ["claude-integration", "PR-CI2", "tauri-dev", "cargo"]
---

[x] pnpm tauri dev 실패 — 두 번째 바이너리 추가로 cargo run 모호

## 발생 원인

PR-CI2 가 `[[bin]] oculpm-mcp` 를 추가하면서 패키지에 바이너리가 2개가 됐는데, tauri dev
의 DevCommand 는 `cargo run` 이라 대상이 모호해져 exit 101 로 실패했다
("could not determine which binary to run"). PR-CI2 게이트는 `cargo test/build` 만 돌려
tauri dev 경로를 못 잡았다 — 사용자 실기기 확인에서 즉시 발견.

## 해결 방법

`[package] default-run = "ocul-pm"` 로 앱 바이너리를 기본 실행 대상으로 고정.
`oculpm-mcp` 는 명시적 `--bin` 으로만 실행되므로 dev/빌드 플로우 불변.

## 검증

`cargo metadata` 의 `default_run = ocul-pm` 확인 + `cargo check` 그린. tauri dev 재실행은
사용자 환경에서 확인 (DevCommand = `cargo run` 이므로 default-run 지정으로 결정적 해소).
