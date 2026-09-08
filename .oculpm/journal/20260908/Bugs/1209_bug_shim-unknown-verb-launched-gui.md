---
schema_version: 1
type: bug
slug: "shim-unknown-verb-launched-gui"
status: done
difficulty: medium
created_at: "2026-09-08T12:09:02+09:00"
session_id: "20260908-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/oculpm/shim.rs"
    op: update
  - path: "src-tauri/src/oculpm/agent_cli.rs"
    op: update
related: []
tags:
  - "shim"
  - "cli"
  - "terminal"
  - "argv"
  - "mcp-tool"
---
[x] 앱 터미널에서 유령 창이 떴다 꺼진다 — 심이 모르는 낱말을 GUI 로 흘려보냈다

## 발생 원인

앱 안 터미널에서 파일을 편집할 때마다 **새 ocul-pm 창이 떴다가 5초 뒤 스스로 꺼졌다.** 사슬은 네 마디였다.

1. 사용자의 전역 `~/.claude/settings.json` 에 PreToolUse 훅이 있었다 — matcher `Edit|Write|MultiEdit`, `command: "oculpm hook pretooluse"`, `timeout: 5`. `hook` 이라는 낱말은 **이 저장소에 구현된 적이 없다** (`docs/agent-discipline/00-master-plan.md:127` 이 그 아이디어를 "D1~D4 뒤에 검토" 로 미뤄 둔 그것이다).
2. 앱 터미널은 셸 통합이 `OCULPM_SHIM_DIR` 을 PATH 앞에 붙인다. 거기의 `oculpm` 은 **앱 GUI 바이너리(`ocul-pm`)로 건 심링크**다.
3. `main.rs` 는 argv 를 훑어 `--pty-host` · `config` · **정확한 도구 이름**만 CLI 로 보냈다. `hook` 은 셋 다 아니므로 루프를 그냥 빠져나가 `ocul_pm_lib::run()` — 즉 **두 번째 tauri 앱 인스턴스**가 창까지 띄웠다.
4. Claude Code 가 5초 훅 타임아웃에 그 프로세스를 죽인다. 그래서 "알아서 꺼진다".

"가끔" 인 이유도 여기 있다 — 매 도구 호출이 아니라 **편집/쓰기 도구일 때만**, 그리고 **앱 터미널 안에서만**(밖에서는 PATH 에 `oculpm` 이 없어 그냥 command not found) 걸린다.

낱말 판정이 엄격했던 것은 반대 방향의 사고를 막기 위해서였다(`is_cli_verb` 주석: macOS 가 붙이는 `-psn_…` 으로 앱이 헤드리스로 뜨는 것). 그 가드는 옳았지만, **심으로 들어온 호출**이라는 반대편 사실을 보지 않아 오타·낡은 훅 하나가 앱 인스턴스를 띄우는 구멍이 남았다.

## 해결 방법

**어떤 낱말인가가 아니라 어떤 이름으로 불렸는가로 가른다.** argv0 은 이미 신뢰 신호다 — `shim::resolve_token` 이 "심을 거쳐 들어왔다는 사실 자체가 신원" 이라며 argv0 옆의 토큰을 읽고 있었다. 같은 신호를 모드 판정에도 쓴다.

- `shim::invoked_as_shim(argv0)` — argv0 의 파일명이 심 이름 `oculpm` 인가. 앱 바이너리는 `ocul-pm`, MCP 서버는 `oculpm-mcp` 라 이름만으로 갈린다.
- `main.rs`: 기존 루프를 지나온 뒤, 심으로 들어왔으면 `run()` 대신 `agent_cli::run(argv[1..])` 로 끝낸다. 앱 이름으로 들어온 호출은 그대로 GUI 로 간다 — `-psn_…` 가드는 살아 있다.
- `agent_cli::dispatch`: 모르는 낱말은 **사용자 오류(exit 1) + usage** 로 끝낸다. 종전에는 계속 내려가 프로젝트 판정을 먼저 만나 "추적되지 않는 프로젝트"(3) 로 나갔다 — 부르는 쪽이 자기가 이름을 틀렸다는 것을 끝내 알 수 없었다.

전역 훅의 죽은 줄(`oculpm hook pretooluse`)도 지웠다. 코드 수정은 다음 릴리스부터 듣고, 설치본이 도는 지금 증상을 멈추는 것은 그쪽이다.

## 검증

- 새 단위 테스트 2개 — `shim::only_the_shim_name_means_the_cli`(`.../shim/sess-1/oculpm` 은 CLI, `.../MacOS/ocul-pm` 과 `oculpm-mcp` 는 아님), `agent_cli::an_unknown_tool_is_a_user_error`(코드 1 + "unknown tool"). `cargo test --lib oculpm::shim oculpm::agent_cli` 16개 통과.
- 실물 확인: 디버그 바이너리를 `oculpm` 이름으로 심링크해 `oculpm hook pretooluse` → **창 없이** exit 1 + usage. `oculpm whoami` 는 그대로 JSON, exit 0.
- `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` 통과.