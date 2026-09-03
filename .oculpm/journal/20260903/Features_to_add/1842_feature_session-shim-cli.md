---
schema_version: 1
type: feature
slug: "session-shim-cli"
status: done
difficulty: superhigh
created_at: "2026-09-03T18:42:13+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shim.rs"
    op: create
  - path: "src-tauri/src/oculpm/agent_cli.rs"
    op: create
  - path: "src-tauri/src/acp/identity.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/a2a_tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/registry.rs"
    op: update
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.zsh"
    op: update
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.bash"
    op: update
  - path: "src/features/today/A2aCard.tsx"
    op: update
  - path: "src/__tests__/a2a_card.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1809_feature_evidence-based-rules.md"
    kind: "followup"
tags:
  - "shim"
  - "cli"
  - "identity"
  - "cas"
  - "buzz-borrows"
  - "mcp-tool"
---
[x] 세션이 자기를 증명한다 — 심 디렉터리와 oculpm CLI

## 추가 기능

`block/buzz` 의 `crates/buzz-dev-mcp/src/shim.rs`(세션 전용 0700 PATH 디렉터리 + 멀티콜 심링크)와 `buzz-cli` 의 JSON in/out·의미 있는 종료코드·`--base-hash` CAS 를 가져왔다 (논의 `.oculpm/discussion/buzz-borrows/discussion.md` F4·F10).

두 가지를 푼다.

1. **MCP 를 안 쓰는 에이전트도 기록한다.** 지금은 MCP 가 없으면 AGENTS.md 규격대로 파일을 직접 쓰라고 부탁하는 수밖에 없었다. PATH 에 `oculpm` 이 있으면 한 줄이다.
2. **신원.** `agent.id` 는 여태 에이전트가 프롬프트에서 **자칭**하는 값이었다. 심 디렉터리의 토큰은 우리가 적어 준 값이다.

새로 생긴 것: `oculpm/shim.rs`(설치·정리·토큰 해석), `oculpm/agent_cli.rs`(`oculpm <도구> [json]`), `acp/identity.rs`(ACP 세션의 신원·존재).

## 동작 흐름

**표면을 새로 만들지 않았다.** CLI 는 `mcp::tools::call_tool` 에 stdin/stdout 을 잇는 어댑터일 뿐이다 — 도구 목록도 구현도 그대로다. 두 벌을 만들면 하나만 고쳐지는 날이 반드시 오고, 그날 기록 규격이 표면마다 달라진다.

**PATH 를 우리가 덮어쓰지 않는다.** Finder 로 띄운 `.app` 의 PATH 는 `/usr/bin:/bin:…` 뿐이다(`acp::env` 가 로그인 셸을 띄우는 이유). 그걸로 사용자 터미널을 열면 brew·nvm 이 사라진다. 그래서 **터미널에는 `OCULPM_SHIM_DIR` 만 넘기고**, 셸 통합 스크립트가 사용자 rc 가 끝난 뒤 PATH 앞에 붙인다. 우리가 직접 띄우는 ACP 어댑터에만 우리가 만든 PATH 를 쓴다 — 그건 이미 로그인 셸에서 받아 온 것이다.

**토큰은 모르는 것을 적지 않는다.** `agent_id` 가 `Option` 인 이유다 — 셸을 띄우는 시점에는 사용자가 그 안에서 `claude` 를 칠지 `codex` 를 칠지 알 수 없다(판정은 나중에 `agentDetect` 가 도는 프로세스를 보고 한다). 그래서 **터미널 토큰에는 프로젝트와 세션만** 적고, provider 를 아는 ACP 세션에만 이름을 적는다. 이름을 아는 토큰이 있을 때만 CLI 가 자칭을 덮어쓴다.

**신원을 찾는 순서가 곧 신뢰 순서다:** ① `OCULPM_SESSION_TOKEN` 이 가리키는 파일 ② 실행된 심링크 **옆**의 토큰. ②가 있는 이유는 환경변수가 벗겨져도(`env -i`) 심을 거쳐 들어왔다는 사실 자체가 신원이기 때문이다.

**CAS.** `plan_update` 가 선택 인자 `base_hash` 를 받는다 — 그 사이 파일이 바뀌었으면 **쓰지 않고** `write-conflict:` 표지를 단 오류로 돌아오고, CLI 가 그것을 exit 5 로 옮긴다. 응답에는 방금 쓴 내용의 해시가 실려 다음 CAS 의 재료가 된다(안 주면 호출자가 파일을 다시 읽어야 하고 그 사이가 또 창이 된다).

**심은 반드시 걷힌다.** 세션 종료(PTY Kill·ACP stop)에서 지우고, 앱이 뜰 때 남은 것을 전부 쓸어낸다 — 막 뜬 앱에는 도는 세션이 없으므로 디스크에 남은 토큰은 전부 지난 실행이 정리 경로를 못 지나가고 죽은 흔적이다. 남겨 두면 다음 세션이 남의 신원을 줍는다.

**화면.** 참여자 목록에 「자칭」 표기 — 막지 않고 **보이게**만 한다(침범 경고와 같은 철학). 조용한 표기인 이유는 이것이 앱 밖 터미널 세션의 정상 상태이기 때문이다.

## 검증

- Rust: 심 5(멱등·경로 탈출 방어·정리가 도는 세션은 안 건드림·환경변수 없이 심 옆 토큰·PATH 는 앞에 붙이지 덮어쓰지 않음) · CLI 7(인자 파싱·비추적 전용 코드·도구 목록 일치·**정확히 일치할 때만 CLI 진입**) · CAS 1(옛 해시는 거부되고 **파일을 건드리지 않는다**, 새 해시는 통과).
- 프런트 1 — 앱이 띄우지 않은 세션에 「자칭」이 붙고 목록에서 빠지지 않는다.
- 게이트 전부 직접 확인 — `cargo fmt --check` · `clippy --all-targets -D warnings` · `cargo test`(1330, 0 실패) · `pnpm typecheck` · `pnpm test`(162파일 2109) · `pnpm lint`(filesize 포함) · `pnpm build`.

## 메모

**래칫이 또 잡았다.** ACP 심 배선으로 `acp/process.rs` 가 1269→1314 로 늘었다. 참여자 카드 등록·해제와 심 설치를 `acp/identity.rs` 로 갈라 1255줄. 셋은 한 관심사다 — 이 어댑터가 **누구이고 지금 있다**는 것을 앱 밖에 알린다.

**AGENTS.md 템플릿에 CLI 안내를 넣으려다 물렀다.** 마스터 템플릿에는 6,100자 상한 게이트가 있고(매 세션 전 추적 프로젝트에 실리는 비용), 가장 짧게 줄인 한 줄로도 6,127자였다. 27자가 모자라 못 넣었다 — 게이트를 올리는 대신 넣지 않기로 했다. §2 의 파일 규격 산문을 CLI 가 정말 기본 경로가 된 뒤에 맞바꾸는 것이 순서다.

`--no-base-hash` 는 만들지 않았다. `base_hash` 가 선택 인자라 **안 주는 것이 곧 옵트아웃**이고, 같은 뜻의 플래그를 하나 더 두면 계약이 둘이 된다.