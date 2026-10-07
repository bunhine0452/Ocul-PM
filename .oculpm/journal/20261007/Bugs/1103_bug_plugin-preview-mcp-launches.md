---
schema_version: 1
type: bug
slug: "plugin-preview-mcp-launches"
status: done
difficulty: low
created_at: "2026-10-07T11:03:53+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/plugins/install.rs"
    op: update
  - path: "src-tauri/src/commands/plugins.rs"
    op: update
  - path: "src/features/settings/plugins/PluginBundlesBlock.tsx"
    op: update
  - path: "src/__tests__/plugin_bundles.test.tsx"
    op: update
related:
  - ref: "20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md"
    kind: "followup"
tags:
  - "security"
  - "plugins"
  - "external-review"
  - "mcp-tool"
---
[x] 플러그인 설치 미리보기가 MCP 서버가 실행할 명령을 보여 주지 않았다

## 발생 원인

외부 보안 피드백 2: "딥링크로 GitHub 의 아무 저장소에서나 플러그인 설치를 제안받을 수 있고, 플러그인 훅은 곧 실행 코드". 확인 결과 앞 절반은 맞고(확인 시트에 출처가 보이고 미리보기 단계가 있다) 훅 쪽은 틀렸다 — 앱 설치는 번들의 `hooks/`·`bin/` 을 놓지 않는다(`plugins::manifest::NOT_HONORED`, 미리보기에 "감지했지만 실행하지 않아요" 로 표시). 실제로 실행 코드가 되는 것은 `.mcp.json` 의 MCP 서버 정의인데, 미리보기는 그 서버의 명령은커녕 이름도 보여 주지 않았다(충돌일 때만 키를 보였다).

## 해결 방법

- `McpMerge.launches` — 병합될 서버마다 `key` 와 실행 한 줄(stdio 는 `command args…`, 원격은 URL, 모르는 꼴은 원문 JSON). `env` 값은 싣지 않는다(키가 들어 있을 수 있다). dry 미리보기와 실제 설치가 같은 함수를 지난다.
- `PluginBundlesBlock` 이 그 목록을 "이 번들은 아래 명령을 MCP 서버로 등록해요 — 이 프로젝트에서 Claude Code 가 실행해요" 경고와 함께 고정폭으로 그린다(ko/en).

## 검증

- Rust `the_preview_names_what_each_mcp_server_will_run`(stdio·원격·모르는 꼴, env 미노출, dry 무쓰기). 프런트 `plugin_bundles.test.tsx` 에 명령줄 표시 1건. vitest 3270 통과, lint·typecheck·clippy 통과.