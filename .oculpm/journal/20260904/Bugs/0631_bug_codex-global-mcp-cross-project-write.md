---
schema_version: 1
type: bug
slug: "codex-global-mcp-cross-project-write"
status: done
difficulty: high
created_at: "2026-09-04T06:31:18+09:00"
session_id: "20260904-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/codex.rs"
    op: correct
  - path: "src-tauri/src/oculpm/shim.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src/features/settings/CodexMcpServerBlock.tsx"
    op: correct
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
  - path: "plugin/oculpm-codex/skills/oculpm-codex/SKILL.md"
    op: update
related:
  - ref: "20260904/Features_to_add/0557_feature_codex-settings-surfaces.md"
    kind: "followup"
  - ref: "20260903/Features_to_add/2050_feature_codex-mcp-settings.md"
    kind: "followup"
tags:
  - "codex"
  - "mcp"
  - "data-integrity"
  - "regression"
  - "mcp-tool"
---
[x] 유튜브 프로젝트의 Codex 가 이 저장소에 일지를 썼다 — 전역 설정에 루트를 박은 값

## 발생 원인

사용자가 다른 프로젝트(`~/Desktop/1dev/youtube_music_workflow`)에서 Codex 로 일하고 있었는데, 그 세션의 `journal_write`·`plan_create` 가 **이 저장소**에 파일을 남겼다.

`~/.codex/config.toml` 은 **머신 전역**이다. 거기 적힌 MCP 서버는 모든 Codex 세션에 실린다. 그런데 v2.39.0 의 등록은 Claude 판(`프로젝트/.mcp.json`)을 그대로 베껴 **프로젝트별 키 + `--root <프로젝트>`** 를 썼다. 프로젝트 스코프 파일에서는 맞는 모양이 전역 파일에서는 정확히 반대로 작동한다 — 한 항목이 모든 세션을 자기 루트로 끌어간다.

실측이 그대로 말해 준다:

```
pid 71440  oculpm-mcp --root /Users/…/Desktop/git/ai-pm
           cwd = /Users/…/Desktop/1dev/youtube_music_workflow
```

같은 세션에서 에이전트가 **직접 쓴** 파일(`discussion.md`)은 유튜브 프로젝트에 제대로 들어갔다. cwd 는 맞았고, 틀린 것은 우리가 박아 준 `--root` 뿐이었다.

## 해결 방법

- **등록을 항목 하나로.** `[mcp_servers.oculpm]` 에 `command` 만 쓴다 — `--root` 를 싣지 않는다. `oculpm-mcp` 는 `--root` → `OCULPM_ROOT` → **cwd** 순으로 루트를 정하고, Codex 는 MCP 서버를 그 세션의 작업 폴더에서 띄운다(위 실측). Claude 의 `${CLAUDE_PROJECT_DIR}` 가 하는 일을 전역 설정에서는 cwd 가 한다.
- **옛 항목을 짚고 수렴시킨다.** 상태에 `pinned_root` 가 생겼다. 박힌 항목이 있으면 배지가 「프로젝트 고정됨」으로 바뀌고 그 경로를 이름으로 말하며, 「다시 등록」이 옛 키를 전부 걷어내고 하나로 모은다.
- **서버가 남의 프로젝트에 쓰기를 거부한다.** `shim::conflicting_tracked_root` — 명시된 root 와 지금 도는 자리가 서로 **다른 추적 프로젝트**면 `oculpm-mcp` 가 아예 뜨지 않는다(exit 2). cwd 가 추적 프로젝트가 아니면 판단하지 않는다 — 패키징된 앱은 `/` 에서 뜨고, Claude Desktop 도 그렇다. 조용히 cwd 로 갈아타는 대신 서지 않기로 했다: 설정이 틀렸다는 사실이 보여야 고쳐진다.
- **카드를 「이 프로젝트에만 적용」에서 「이 머신 전체」로 옮겼다.** 설정 파일이 그렇게 생겼으니 화면도 그렇게 말해야 한다. 커맨드 3개에서 `project_id` 가 빠졌다.

사용자 기계의 살아 있는 설정은 손으로 고쳐 즉시 멈췄고(`args` 한 줄 제거, 도구 승인 표는 보존), 잘못 쓰인 일지·계획 2건은 유튜브 프로젝트로 옮겼다.

## 검증

- 새 Rust 테스트 3: 인자 없는 항목 하나로 등록(주석·남의 서버 보존) · **레거시 고정 항목 수렴** · `conflicting_tracked_root`(다른 추적 프로젝트만 충돌, 하위 폴더·비추적 자리는 아님).
- 새 프런트 테스트 1: 고정된 항목이 경로를 짚고 「해제」 대신 「다시 등록」을 준다.
- `cargo test --locked` · `clippy -D warnings` · `fmt` · typecheck · lint · test(2126) · build 전부 exit 0.
- 실기기: `codex mcp list` 가 `oculpm` 을 인자 없이 싣는 것을 확인했다.