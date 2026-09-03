---
schema_version: 1
type: feature
slug: "codex-settings-surfaces"
status: done
difficulty: medium
created_at: "2026-09-04T05:57:39+09:00"
session_id: "20260904-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/codex.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/features/settings/CodexPluginBlock.tsx"
    op: create
  - path: "src/features/settings/ClaudePluginBlock.tsx"
    op: create
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
related:
  - ref: "20260904/Bugs/0507_bug_codex-mcp-settings-defects.md"
    kind: "followup"
tags:
  - "codex"
  - "settings"
  - "plugin"
  - "ui"
  - "mcp-tool"
---
[x] 설정에 Codex 자리를 냈다 — 네이티브 표기와 플러그인 블록, 그리고 고아 항목을 말하는 화면

## 추가 기능

**① Agents — Codex 를 목록에 세우되 거짓 스위치는 만들지 않았다.** Codex 는 루트 `AGENTS.md` 를 그대로 읽는다 (`codex` 0.153.0 바이너리에서 확인: 인식하는 지침 파일은 `AGENTS.md`·`AGENTS.override.md` 뿐, `.codex/AGENTS.md` 같은 건 없다). 그래서 토글 칩이 아니라 **점선 「네이티브」 칩 + 한 줄 설명**으로 넣었다 — 켜도 아무 파일이 안 생기는 스위치는 UI 가 하는 거짓말이다.

**② 연동 → Codex 플러그인 블록** (머신 스코프, Claude 판 옆자리). 상태 배지 + 두 명령 복사:

```
codex plugin marketplace add bunhine0452/Ocul-PM
codex plugin add oculpm-codex@oculpm
```

설치를 우리가 대신 하지 않는 이유: `codex plugin` 이 마켓플레이스를 받아 **캐시까지 펼쳐야** 로드된다. 설정 파일만 흉내 내면 캐시 없는 반쪽이 된다 (Claude 플러그인 블록과 같은 규약 — 읽기만 하고 명령을 안내한다).

**③ 화면이 「고아」를 말한다.** `[plugins."oculpm-codex@<마켓>"]` 은 있는데 그 `[marketplaces.<마켓>]` 이 없으면 Codex 는 **조용히** 로드하지 않는다. 오늘 실제로 그 상태를 봤으므로(아래) 배지·경고로 구분해 말하게 했다. 백엔드 `codex_plugin_status` 는 config.toml 을 읽어 `enabled`·`marketplace`·`marketplace_configured`·`cached_version` 을 돌려준다.

## 동작 흐름

1. 블록이 `~/.codex/config.toml`(`CODEX_HOME` 존중)에서 `oculpm-codex@*` 항목을 찾는다.
2. 그 항목의 마켓플레이스가 `[marketplaces.*]` 에 있는지, 캐시 `plugins/cache/<마켓>/oculpm-codex/<버전>/` 이 펼쳐졌는지 본다.
3. 셋이 다 맞으면 「설치됨 + 캐시 버전」, 마켓플레이스가 없으면 「마켓플레이스 없음」 경고, `~/.codex` 자체가 없으면 「Codex 미설치」.

## 곁가지 — 왜 Codex 를 깔자마자 oculpm 이 떴나

사용자 질문에 대한 답을 증거로 남긴다. Codex 는 첫 실행에 **외부 에이전트 임포트**를 돌린다 (`.codex-global-state.json` 의 `external-agent-import-discovery:claude-code,claude-cowork,cursor`). 발견 항목에 `Migrate enabled plugins from ~/.claude/settings.json`, `Migrate hooks from ~/.claude`, 프로젝트별 `Migrate skills from <repo>/.claude/skills → .agents/skills` 가 그대로 들어 있다. 게다가 Codex 의 플러그인 로더는 매니페스트를 `.codex-plugin/plugin.json` → **`.claude-plugin/plugin.json`** → `.cursor-plugin/plugin.json` 순으로 찾는다. 즉 우리가 Codex 를 위해 한 일이 없어도, Claude 쪽 설정이 그대로 건너간다. 그 임포트가 플러그인 **항목만** 옮기고 마켓플레이스는 안 가져와서 `oculpm@oculpm` 이 고아가 됐고, 그게 어제의 MCP 시작 실패였다.

## 검증

`cargo test`(1261) · `clippy -D warnings` · `fmt --check` · `typecheck` · `lint`(래칫 포함) · `vitest`(2125) 전부 exit 0.

- 새 Rust 테스트 3건: 설정 없음 / 정상(마켓플레이스+캐시) / **고아**.
- 새 프런트 테스트 3건: 설치됨(캐시 버전 노출) · 고아 경고 · 미설치+명령 복사.
- 파일 크기 래칫이 `OculpmSettings.tsx` 증가(1531→1548)를 막아서, `ClaudePluginBlock` 을 자기 파일로 떼어냈다 (1490줄). 두 플러그인 블록이 형제 파일이 됐다.
- 실기기 육안 확인은 미완 — 설치본이 도는 중이라 dev 빌드를 띄우지 않았다.