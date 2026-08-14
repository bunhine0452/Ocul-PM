---
schema_version: 1
type: feature
slug: "acp4-auto-start-config-options"
status: done
difficulty: medium
created_at: "2026-08-14T21:24:34+09:00"
session_id: "mcp-20260814-212434"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "config"
  - "ux"
  - "rust"
  - "react"
  - "mcp-tool"
---
[x] PR-ACP4 — 자동 시작 + 세션 설정 노브(모델·Effort·Fast·모드·서브에이전트)

## 동기

사용자가 앱에서 패널을 띄워 보고 두 가지를 지적했다: ① "에이전트 시작" 버튼을 왜 눌러야 하나, ② Claude Code 확장에 있는 모델/Effort/Fast mode 같은 노브가 하나도 없다.

②를 답하려면 먼저 **무엇이 ACP 로 뚫려 있는지** 실측해야 했다. `session/new` 응답을 통째로 덤프하니 `configOptions` 가 5개 있었다 — `mode`(6) · `model`(5) · `effort`(6) · `fast`(on/off) · `agent`(설치된 서브에이전트 전부). 즉 확장 메뉴의 노브 대부분이 프로토콜로 이미 노출돼 있었고, 우리가 안 그리고 있었을 뿐이다.

## 추가 기능

**자동 시작** — 화면에 들어오면 붙는다. `acp_start` 가 멱등이라(이미 떠 있으면 그대로) 재진입 비용이 거의 없다. 히어로 화면은 이제 실패했을 때의 재시도 자리로만 남는다.

**설정 노브** — 컴포저 하단에 셀렉터 줄. 핵심은 **선택지를 우리가 들고 있지 않는다**는 것이다. 어댑터가 준 목록을 그대로 그리므로 Claude Code 가 모델을 추가하면 우리 코드를 고치지 않아도 나타난다. boolean 항목도 `"true"/"false"` select 로 통일해 렌더 분기를 하나로 유지했다.

## 설계 변경

**세션 생성을 `acp_start` 로 당겼다.** 설정 항목은 `session/new` 응답에만 실려 오는데, PR-ACP2 처럼 첫 프롬프트까지 미루면 그때까지 셀렉터를 그릴 수 없다. cwd(프로젝트 루트)는 시작 시점에 이미 확정돼 있으므로 미룰 이유가 없었다. `acp_prompt` 의 지연 생성은 폴백으로 남겼다 — 어댑터가 죽었다 살아난 뒤의 첫 프롬프트를 위해서다. `acp_start` 의 반환 타입도 `AcpAgentInfo` → `AcpSession{agent, options}` 로 넓혔다.

## 검증

통합(`#[ignore]`, 수동): `session_config_options_can_be_changed` — 임시 세션에서 실제로 `model` 을 `sonnet` 으로 바꿔 성공을 확인했다. `SetSessionConfigOptionRequest` 의 값 표현(`SessionConfigOptionValue::value_id`)은 스키마에서 **추론한** 것이라 와이어 확인이 꼭 필요했다. 관측된 항목: `["mode", "model", "effort", "fast", "agent"]`.

게이트: typecheck 0 · 프런트 749건 · lint 0 · build 0 · 백엔드 569 유닛 + 통합 전 스위트(ignored 6). `plugin_json` 실패는 v2.9.0 릴리스가 남긴 기존 드리프트.

**아직 없는 것**(확장 메뉴 대비): 파일 첨부·@멘션(`promptCapabilities.image`·`embeddedContext` 로 가능하나 미구현), 대화 비우기/Rewind(`sessionCapabilities` 의 `close`/`delete`/`fork` 로 가능하나 미구현), Thinking 토글·"플래그 시 모델 전환"(어댑터가 `configOptions` 로 노출하지 않음 — 프로토콜 밖).