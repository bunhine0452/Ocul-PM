---
schema_version: 1
type: chore
slug: "deps-tauri-sqlite-acp-adapters"
status: done
difficulty: medium
created_at: "2026-10-24T19:00:16+09:00"
session_id: "20261024-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src-tauri/acp-lock"
    op: update
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "deny.toml"
    op: update
related: []
tags:
  - "deps"
  - "security"
  - "acp"
  - "parallel-round"
  - "mcp-tool"
---
[x] 의존성 검증 갱신 — tauri 2.12.5·updater 2.14·SQLite 3.53.2 + ACP 어댑터 보안 판

## 변경 요약

사용자 지시 "업그레이드 가능한 부분을 웹 서치로 찾되 검증까지". 1차 출처(crate CHANGELOG·소스 diff·npm packument·sqlite.org)로 교차 확인한 것만 적용.

- tauri 2.11.2 → 2.12.5(GHSA-w28w-mhc8-qvjv, tray-icon 0.25.1 = macOS 27 왼쪽 클릭 상류 수정, macOS restart 가 `open -n`), updater 2.10 → 2.14(원자적 교체·설치 전 재검증), 플러그인 최신 2.x, quick-xml 0.42(deny ignore 2줄 제거).
- rusqlite 0.40.2 / SQLite 3.53.2(WAL 리셋 손상 수정, `fallible_uint` 로 기존 동작), chrono-tz 0.10.4(tzdata 2025b), pulldown-cmark 0.13.5(이차 시간 파싱), fastembed 5.17.3, TypeScript 5.9.3, npm 범위 내(audit 109 → moderate 1).
- ACP 어댑터 claude 0.81 → 0.93.0(zod·body-parser high), codex 1.13.0 → 1.13.1(zod). 0.82 AIR 계약 이후 압축 메타가 `_meta.jetbrains.air.contextCompaction` 으로 옮겨 `compaction_meta` 가 두 자리를 다 본다. Codex 도 고정 판이 바뀌면 이미 깐 것을 새 판으로 맞춘다(`install_for` 로 통합). sandbox-exec 로 네트워크를 막고 핸드셰이크 실측, 픽스처 테스트 추가.
- 보류: xterm 6(viewportResync 전제 붕괴), keyring 4, notify 8(성능 레인 FileIdCache 충돌), portable-pty 0.9, specta rc.27, tree-sitter 0.27, Rust 1.99.

## 검증

- cargo-deny · pnpm audit high 0 · 전체 게이트(PR #90). 레인이 crates.io 요청 1건 UA 에 사용자 이메일을 넣었다 — 이후 제거, 사용자에게 보고함.