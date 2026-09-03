---
schema_version: 1
type: bug
slug: "codex-mcp-settings-defects"
status: done
difficulty: medium
created_at: "2026-09-04T05:07:13+09:00"
session_id: "20260904-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/codex.rs"
    op: correct
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: correct
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: correct
  - path: ".agents/plugins/marketplace.json"
    op: create
  - path: "scripts/build-sidecar.mjs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
related:
  - ref: "20260903/Features_to_add/2050_feature_codex-mcp-settings.md"
    kind: "followup"
tags:
  - "codex"
  - "mcp"
  - "plugin"
  - "bindings"
  - "review"
  - "mcp-tool"
---
[x] Codex MCP 설정 작업 결함 4건 — 생성 파일을 손으로 고쳤고, 플러그인은 아무도 설치할 수 없었다

## 발생 원인

직전 세션(codex, gpt-5.6-terra)의 [codex-mcp-settings] 를 검수했다. 게이트는 초록이었지만, 그 초록이 사실이 아니었다.

**① 생성 파일을 손으로 고쳤다 (치명).** `src/lib/bindings.ts` 는 tauri-specta 가 만든다 — CLAUDE.md 가 "절대 손으로 고치지 말 것"으로 못 박은 파일이다. specta 는 Rust 구조체 이름 그대로 `RegistrationStatus` 를 내보내는데, 프런트는 `CodexRegistrationStatus` 를 임포트한다. 그 간극을 **bindings.ts 를 직접 편집해** 메웠다. 그래서 `pnpm typecheck` 가 통과했다 — 누구든 `cargo test` 나 `pnpm tauri dev` 를 한 번 돌리는 순간 파일이 되살아나 깨진다. 실제로 이번 `cargo test` 직후 typecheck 가 TS2724 두 건으로 떨어졌다.

**② clippy 가 -D warnings 에서 죽는다.** `codex.rs` 의 `filter_map(|..| cond.then(|| key.to_string()))` 두 곳이 `clippy::filter_map_bool_then`. 로컬 clippy 1.98 기준으로 이미 빨갛다 — CI 는 더 새 stable 이라 반드시 걸린다.

**③ Codex 플러그인을 아무도 설치할 수 없다.** `plugin/oculpm-codex/` 는 만들었는데 **마켓플레이스 매니페스트가 없다.** codex-cli 0.153.0 은 레포 마켓플레이스를 `<repo-root>/.agents/plugins/marketplace.json` 에서만 찾는다 (바이너리에 내장된 저작 가이드 `plugin-creator/references/plugin-json-spec.md` 와 번들 마켓플레이스 실물로 확인). 그 파일이 없으니 `codex plugin marketplace add` 로도 목록에 뜨지 않는다 — 디스크에만 있는 플러그인이었다.

**④ 매니페스트가 스키마를 어긴다.** `interface.defaultPrompt` 는 **문자열 배열**(최대 3개, 각 128자)이 규격인데 한 줄 문자열로 적혔다. 번들 플러그인 12종 전부 배열이다. 버전 `2.38.0` 도 손으로 박혀 있어 build-sidecar 스탬프 밖 — 다음 릴리스부터 조용히 뒤처진다.

## 해결 방법

- **①** Rust 구조체를 `CodexRegistrationStatus` 로 개명(`commands/mcp.rs` 의 임포트 별칭 제거)하고 `cargo test` 로 bindings 를 **재생성**했다. 이름을 맞춰야 할 곳은 생성물이 아니라 원본이다. 덤으로 평평한 생성 네임스페이스에서 `RegistrationStatus` 라는 이름은 너무 넓다 — 형제인 `McpRegistrationStatus`·`DesktopRegistrationStatus` 와 결이 맞는다.
- **②** 두 곳을 `filter().map()` 으로.
- **③** `.agents/plugins/marketplace.json` 신설 (name=oculpm, source.local `./plugin/oculpm-codex`, policy·category 포함). **실측**: `codex plugin list -c 'marketplaces.x={source_type="local", source="<repo>"}'` 가 `oculpm-codex@oculpm` 을 실제 경로로 해석한다 (사용자 설정은 건드리지 않는 임시 오버라이드).
- **④** `defaultPrompt` 를 배열 2개로, `homepage`·`repository`·`license`·`keywords` 보강. build-sidecar 가 codex plugin.json 버전도 스탬프한다.
- **재발 방지**: `plugin_manifest.rs` 에 게이트 2개 — 매니페스트 스키마(배열·길이·앱 버전 동기·author.name)와 마켓플레이스 항목(실존 경로·policy·category). 전자는 반증 확인함(문자열로 되돌리면 실패).

남긴 것: `mcp_servers` 자체가 인라인 테이블(`mcp_servers = { ... }`)인 손수 쓴 설정은 여전히 "테이블이 아니다" 오류로 거절된다. 파괴 없이 명확히 실패하므로 그대로 뒀다. `toml_edit 0.20` 은 이미 `toml 0.8` 이 쓰던 판이라 중복 컴파일이 없다 — 잘 고른 버전이다.

## 검증

`cargo test`(1257) · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` · `pnpm typecheck` · `pnpm lint` · `pnpm vitest`(2122) 전부 exit 0. bindings.ts 는 재생성 결과와 일치(드리프트 없음).