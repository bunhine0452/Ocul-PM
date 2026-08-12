---
schema_version: 1
type: feature
slug: "i18n-agents-template-lang-wiring"
status: done
difficulty: medium
created_at: "2026-08-12T17:04:25+09:00"
session_id: "mcp-20260812-170425"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/commands/greenfield.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "agents"
  - "mcp"
  - "mcp-tool"
---
[x] AGENTS.md 영어 템플릿을 도달 가능하게 배선 + MCP 스키마의 언어 강제 제거

## 발견 — 영어 템플릿이 있는데 도달할 수 없었다

`master_en.md.tpl`(49줄)과 `discussion_spec_en.md.tpl` 은 **예전부터 존재**했고 `agents::embedded_master(lang)` 이 `"en"` 이면 그걸 고르게 돼 있었다. 그런데:

- 언어를 정하는 값은 `config.agents.template_language` (프로젝트 `.oculpm/config.toml`)
- 기본값이 `"ko"` 하드코딩
- **UI 어디에도 노출되지 않는다** (프런트 전체 grep 0건 — `bindings.ts` 타입에만 존재)

즉 영어 사용자는 손으로 `config.toml` 을 고치지 않는 한 **한국어 기록 규칙이 자기 저장소에 심긴다.** 기능이 없는 게 아니라 배선이 빠져 있었다.

## 변경 요약

`init_project` 가 `template_lang` 을 받고, 호출하는 두 커맨드(`oculpm_init`·greenfield)가 AI 작성 언어에서 넘긴다.

**최초 시드에만 반영된다.** 이미 config 가 있으면 무시한다 — 필드 주석이 말하듯 "이미 시드된 `_template.md` 는 사용자 소유라 자동 교체하지 않는다". 그래서 **첫 init 이 유일한 기회**이고, 나중에 sync 에서 바꾸는 건 의미가 없다(마스터가 안 갈린다). 테스트가 두 방향을 다 못박는다: `"en"` 이면 `MASTER_EN` 이 선택되고, 기존 config 는 덮이지 않는다.

## MCP 스키마 — 언어 강제만 걷어냈다

`journal_write` 의 `title` 설명이 **`"한 줄 제목 (한국어 권장)"`** 이었다. 사용자가 AI 작성 언어를 English 로 둬도 **스키마가 에이전트에게 한국어를 지시**한다 — 회고 디스패치의 `"한국어 회고로"` 와 같은 부류다. 헤더 안내도 이번에 헤더가 이중언어가 되면서 한국어 이름을 박아 두면 틀린 안내가 된다.

둘 다 **AGENTS.md 를 가리키도록** 바꿨다 — 그게 프로젝트별이고 이미 ko/en 양쪽이 있는 정본이다.

## 왜 MCP 표면 전체를 번역하지 않았나

`oculpm-mcp` 는 **DB 없는 독립 바이너리**다 (`앱이 꺼져 있어도 동작` — 설계 의도). 앱 설정을 못 읽는다. 프로젝트 `.oculpm/config.toml` 의 `template_language` 는 읽을 수 있으니 이중언어화 자체는 **가능**하지만:

- description 33개 + `MCP_INSTRUCTIONS` 를 두 벌로 유지 → §4.5 가 프롬프트에서 거부한 바로 그 드리프트
- `tests/rule_canary.rs` 가 **서빙되는 실제 문자열**에서 한국어 필수 규칙(`시크릿/.env 내용은 어떤 인자에도 넣지 말 것`)을 검증한다 — 이중언어화하면 카나리도 양쪽을 덮어야 한다

기계 대상 계약이고 실제 해악은 "언어 강제" 뿐이라 그것만 제거했다. 전체 이중언어화는 별도 단위로 남긴다 (가능하고, 크기는 위와 같다).

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 674통과 / **cargo test 529통과**(+1) / lint(남은 0) / build.