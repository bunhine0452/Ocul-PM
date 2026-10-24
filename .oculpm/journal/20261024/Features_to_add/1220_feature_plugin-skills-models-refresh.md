---
schema_version: 1
type: feature
slug: "plugin-skills-models-refresh"
status: done
difficulty: medium
created_at: "2026-10-24T12:20:23+09:00"
session_id: "20261024-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/board/SKILL.md"
    op: rename
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: rename
  - path: "plugin/oculpm/skills/inception/SKILL.md"
    op: rename
  - path: "plugin/oculpm/skills/next/SKILL.md"
    op: rename
  - path: "plugin/oculpm/skills/project_init/SKILL.md"
    op: rename
  - path: "plugin/oculpm/skills/standup/SKILL.md"
    op: rename
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm/.claude-plugin/icon.png"
    op: create
  - path: "src-tauri/src/llm/openai.rs"
    op: update
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/__tests__/plugin_docs_sync.test.ts"
    op: update
related: []
tags:
  - "plugin"
  - "llm"
  - "release"
  - "mcp-tool"
---
[x] 플러그인 최신 규격 맞춤 + 기본 모델 세대 교체 — 커맨드→스킬, StopFailure, GPT-6 추론 판정

## 추가 기능

사용자 요청 "최신 트렌드·모델에 맞춰 플러그인 업데이트할 것 찾아서 전부 진행". 근거는 공식 문서(Claude Code plugins-reference·changelog 2.1.283~2.1.310, Codex 패키징·훅), `claude plugin validate --strict`(2.1.307), OpenRouter `/api/v1/models` 실측.

- **기본 모델**: anthropic `claude-sonnet-5` → `claude-sonnet-5-5`(같은 값), openai `gpt-4o-mini` → `gpt-6-luna`($0.10/$0.50, 더 쌈), gemini `gemini-2.5-flash` → `gemini-3.8-flash`(Google 권장), openrouter → `openai/gpt-6-luna`. 폴백 예시·위키 예시 동기.
- **GPT-6 추론 판정**: OpenRouter `supported_parameters` 실측에서 gpt-6-luna·gpt-5 는 temperature 없음. `is_reasoning_model` 이 `gpt-5` 접두만 알아 GPT-6 에 온도를 실어 400 이 날 뻔했다 → `gpt-<N>` N≥5 전부 추론 계열.
- **커맨드→스킬**: 문서상 `commands/` 는 구형. 6개를 `skills/<이름>/SKILL.md` 로 git mv, 이름 유지(haiku 세션으로 `oculpm:project_init` 등 11개 목록 확인). `project_init` 에 `disable-model-invocation: true`(사용자만). 게이트(plugin_manifest·plugin_docs_sync)를 지식 5 + 커맨드 6 상수로, 모델 호출을 끈 스킬은 상시 설명 예산에서 제외.
- **StopFailure 훅**: 턴이 API 오류로 끝나면 Stop 대신 이것만 온다 — 인박스 싱크 추가, 앱 `apply_event` 는 Stop 과 같은 활동 신호.
- **아이콘·displayName**: validate 의 ICON_MISSING 경고 해소(앱 512px 아이콘).

## 동작 흐름 / 하지 않은 것

- 종료된 모델 표시: 이미 `useLlmBackgroundToast`(2026-09-14)가 한 시간에 한 번 토스트 — 할 일 없음. 처음 보고에서 "로그만" 이라 한 것은 확인 부족이었다.
- **Codex 플러그인 MCP 탑재는 보류**: 임시 CODEX_HOME 실측(codex 0.162.1)에서 `.mcp.json` 을 읽고 절대 경로면 도구 7개가 붙지만, `./bin/…` · `${PLUGIN_ROOT}` · `${CLAUDE_PLUGIN_ROOT}` 는 셋 다 서버가 안 뜬다. 설치 위치(`plugins/cache/<mp>/<plugin>/<ver>`)가 유동이라 실을 수 없고, 앱 설정으로 등록한 사용자에겐 같은 이름 서버가 둘이 된다. 환경 변수 확인 시험은 권한 분류기가 막아 멈췄다. 루트 `plugin.json` 이전도 `.codex-plugin` 이 호환으로 지원돼 보류.

## 검증

- `claude plugin validate --strict` 경고 0 · typecheck · vitest 3355 · lint · cargo test.