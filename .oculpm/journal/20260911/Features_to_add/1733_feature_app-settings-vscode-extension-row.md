---
schema_version: 1
type: feature
slug: "app-settings-vscode-extension-row"
status: done
difficulty: low
created_at: "2026-09-11T17:33:10+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/settings/VscodeExtensionBlock.tsx"
    op: create
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/vscode_extension_block.test.tsx"
    op: create
related: []
tags:
  - "settings"
  - "vscode"
  - "extension"
  - "mcp-tool"
---
[x] 설정 > 통합 'VS Code 확장' 행 — 설치 감지 배지 + 마켓 링크 2개

## 추가 기능

플랜 `vscode-extension-round` `{#app-settings}` — 백엔드 커맨드 `vscode_extension_status` → `{installed, editor: "vscode"|"vscode-insiders"|null, marketplace_url, open_vsx_url}`(판정은 `vscode_ext::detect`, 확장 폴더만 읽음 — 항목 문구의 `code --list-extensions` 는 .app 이 PATH 를 안 물려받아 못 쓴다). `lib.rs` 두 목록에 등록, `cargo test` 로 bindings 재생성. 프런트 `VscodeExtensionBlock`(머신 전역 섹션, `CodexPluginBlock` 아래): 배지(미설치/설치됨/설치됨 Insiders/확인 중), 설명, 마켓 링크 2개(앵커 → `externalLinks` 가드 → `open_url`, 사용자 클릭에만), 설치 시 "편집기로 열기가 사이드바까지" 안내. i18n ko/en 6키.

## 동작 흐름

테스트는 `status` prop 으로 두 상태를 주입해 커맨드 호출 없이 스냅샷 2장 + Insiders/null 분기. 처음엔 한글 리터럴로 단언했다가 `lint:i18n` 래칫(새 파일은 PENDING 밖)에 걸려 `t("op.…")` 키로 고쳤다.

## 검증

`pnpm vitest run vscode_extension_block`(3)·`mcp_settings`+`oculpm_settings_subtabs`(32) 통과, `typecheck`·`lint:i18n`·`lint:js`·`lint:storage`·`lint:bindings` OK, `cargo clippy -D warnings` OK. `lint:design` 은 **다른 세션 WIP**(`AcpUsageMeter.tsx` icon-size)로 붉음 — 이 작업과 무관.