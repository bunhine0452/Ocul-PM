---
schema_version: 1
type: bug
slug: "config-missing-keys-load-defaults"
status: done
created_at: "2026-09-18T20:18:32+09:00"
session_id: "20260918-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
related:
  - ref: "20260918/Bugs/2000_bug_bug-hunt-round3-settings-writeback.md"
    kind: "followup"
tags:
  - "bug-hunt"
  - "config"
  - "toml"
  - "resilience"
  - "mcp-tool"
---
[x] 손으로 고친 config.toml 에 키가 빠지면 프로젝트가 통째로 무효가 되던 것 — 빠진 값은 기본값으로

## 발생 원인

`OculpmConfig::from_toml_str` 이 `toml::from_str` 한 번이었고, 섹션 구조체의 대부분 필드에 serde 기본값이 없었다. `config.toml` 은 사용자가 손으로 고치라고 있는 파일인데(주석 보존 병합까지 해 둔 이유) `auto_redact_patterns` 한 줄이나 `[watcher]` 섹션을 지우면 **전체 로드가 실패** → `config_valid=false` → 워처 재시작 거부·`patterns_for_project` 빈 목록(마스킹 없음)·자동화 정지. 3라운드에서 "표면화되는 설계" 로 미뤘던 것을 다시 봤다 — 표면화는 되지만 복구 방법이 "파일을 정확한 스키마로 다시 쓰기" 뿐이라 사용자를 막는다.

첫 시도는 구조체에 `#[serde(default)]` 였는데 specta 가 그 속성을 **옵셔널 TS 타입**(`git?: GitConfig`)으로 내보내 `bindings.ts` 가 바뀌고 설정 화면의 모든 접근이 흔들렸다 — 되돌렸다.

## 해결 방법

파싱 단계에서 **기본값 위에 사용자 값을 덧씌운다**: `toml::Value::try_from(default_for_new_project())` 에 사용자 TOML 을 `overlay_toml` 로 재귀 병합(테이블은 합치고, 배열·스칼라는 사용자 값이 통째로 이김 — `forbid_journal_for_paths = []` 는 "다 지웠다" 는 뜻이어야 한다) 한 뒤 역직렬화. 구조체·바인딩은 무변경. 각 섹션에 `impl Default` 를 두고 `default_for_new_project` 가 그것을 쓰게 해 기본값 출처를 하나로 모았다. 테스트 `field_defaults_agree`: 키·섹션이 빠진 config 와 빈 문자열이 새 프로젝트 기본값과 같은 값으로 읽히고 `validate()` 를 통과한다.

## 검증

- `cargo fmt` · `clippy -D warnings` · `cargo test` 전부 통과 (`bindings.ts` diff 없음)
- `pnpm typecheck` · `pnpm lint` exit 0 · `vitest` 2740