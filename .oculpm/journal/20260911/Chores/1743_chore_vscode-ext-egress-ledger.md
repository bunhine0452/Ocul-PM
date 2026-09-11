---
schema_version: 1
type: chore
slug: "vscode-ext-egress-ledger"
status: done
difficulty: low
created_at: "2026-09-11T17:43:52+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "extension/src/egress.spec.ts"
    op: create
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "egress"
  - "privacy"
  - "vscode"
  - "extension"
  - "mcp-tool"
---
[x] 유출 경계 원장 — 마켓 호스트 2개 등록, 확장에도 아웃바운드 0 게이트, README 프라이버시 한 줄

## 작업 내용

플랜 `vscode-extension-round` `{#app-egress}`.
- `cargo test --test egress_inventory` 가 **설계대로 붉어졌다** — 호스트 인구조사(B)가 `vscode_extension_status` 의 `marketplace.visualstudio.com`·`open-vsx.org` 를 잡았다. 둘 다 "브라우저에 넘기는 링크(앱이 보내지 않는다)" 절에 사유와 함께 등록. 자리 스캔(A)은 `vscode_ext.rs`(`open` 셸아웃뿐)를 자리로 세지 않았다 — 확장 감지가 새 아웃바운드를 만들지 않음이 그대로 확인된다.
- 확장에도 같은 약속을 게이트로: `extension/src/egress.spec.ts` 가 `src/**/*.ts`(spec 제외)에서 네트워크 프리미티브(`fetch(`·`node:http(s)`·`net`·`dgram`·`WebSocket`·`axios`·`undici`)를 찾아 0건을 단언하고, 소스에 적힌 절대 URL 호스트가 `oculpm.com` 하나뿐임을 대조한다(마켓 링크는 앱 쪽 커맨드가 준다).
- README ko/en 프라이버시 문단에 "확장도 같은 약속 — 네트워크 없음, 쓰기는 앱의 oculpm-mcp 경유" 한 문장.

## 검증

`cargo test --test egress_inventory` 11 통과, 확장 vitest 27 통과(신규 2), 루트 `lint:extension` OK. README 문단을 단언하는 테스트는 없다(grep 확인).