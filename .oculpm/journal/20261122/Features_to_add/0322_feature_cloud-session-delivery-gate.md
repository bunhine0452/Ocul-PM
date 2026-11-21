---
schema_version: 1
type: feature
slug: "cloud-session-delivery-gate"
status: done
difficulty: medium
created_at: "2026-11-22T03:22:19+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/delivery-gate.sh"
    op: update
  - path: "src-tauri/tests/delivery_gate.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
related: []
tags:
  - "게이트"
  - "클라우드"
  - "플러그인"
  - "mcp-tool"
---
[x] 게이트: 앱 없는 클라우드 세션도 묻는다

## 추가 기능

앱이 없는 기기에서는 셔틀이 바이너리를 못 찾아 배달 게이트가 침묵했다(MCP 도구도 없으니 `journal_write` 를 시킬 수 없다는 이유). 클라우드 세션은 바로 그 자리다 — 일회용 리눅스 기기에 앱이 없고, 거기서 한 일은 git 으로만 돌아오므로 일지 없이 끝나면 아무도 모른다. 이제 클라우드 세션(`CLAUDE_CODE_REMOTE=true`, Claude Code 문서의 표식)에서만 셸이 대신 묻는다.

## 동작 흐름

셔틀이 exit 1(바이너리 없음)을 냈고 클라우드 표식이 있을 때만: 이 대화의 트랜스크립트에 `.oculpm/` 밖을 고친 편집 도구 호출이 있고, 세션 마커보다 새 일지가 없으면 한 번 막는다. 지시는 도구 없이 할 수 있는 것만 한다 — `.oculpm/agents/journal-spec.md` 를 읽고 파일로 쓰라고. 로컬에서는 예전처럼 침묵한다. 2026-09-05 의 오탐(같은 워킹트리의 옆 대화가 고친 파일)은 대화가 하나뿐인 클라우드 기기에서는 생길 자리가 없다.

## 검증

- `cargo test --locked --test delivery_gate`: `test result: ok. 17 passed; 0 failed` — `a_cloud_session_without_the_app_is_still_asked_for_a_journal` · `the_cloud_fallback_stays_silent_when_recorded_or_nothing_was_edited` (훅과 셔틀을 임시 폴더에 두고 설치 위치 변수를 비워 「앱 없음」 을 만든다)

## 메모

실제 클라우드 세션에서는 돌려 보지 못했다. 문서는 클라우드 세션이 저장소 설정의 플러그인을 깔지 않는다고 하고(계정에서 켠 플러그인은 남는다), 플러그인 훅이 거기서 도는지는 적혀 있지 않다 — 돌지 않으면 이 폴백은 닿지 않고 `AGENTS.md` 의 문장만 남는다. 확인은 사용자 몫(클라우드 세션 한 번)이다.