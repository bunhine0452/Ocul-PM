---
schema_version: 1
type: feature
slug: "acp-session-failures-and-068"
status: done
difficulty: high
created_at: "2026-08-15T08:29:04+09:00"
session_id: "mcp-20260815-082904"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "feature"
  - "reliability"
  - "mcp-tool"
---
[x] 세션 실패 확장 — 침묵하던 한도·인증·모델 폴백을 대화에 남긴다 (어댑터 0.68)

## 침묵하던 것들

한도 초과, 인증 실패, 제공자 과부하, 그리고 **모델 폴백**. 지금까지 이런 것들은 평범한 오류 문자열이거나 아예 침묵이었다. 특히 폴백은 알려 주지 않으면 알 길이 없다 — 사용자는 Opus 를 골라 뒀는데 다른 모델이 답하고 있어도 화면은 똑같다.

어댑터에 `sessionFailure` 확장이 있고, **켜야 온다.** `initialize` 의 `clientCapabilities._meta` 에 선언한다. 네임스페이스가 `jetbrains.air` 인 것은 그쪽이 이 확장을 먼저 정의했기 때문이지 우리가 고를 수 있는 것이 아니다.

받으면 종류(`connection`·`access`·`limit`·`request`·`service`·`unknown`)와 심각도(`warning`/`error`)가 붙은 기록이 온다.

## 조각으로 둔다

**일어난 자리가 정보다.** 한도가 어느 도구 호출 뒤에 걸렸는지, 폴백이 어느 대목에서 났는지가 순서로 읽힌다. 맨 위나 맨 아래로 모으면 그게 사라진다. 그래서 글·도구와 같은 조각 흐름에 끼운다.

**같은 `id` 는 제자리에서 갱신한다.** 스펙이 못 박는다 — 같은 id 의 더 높은 revision 은 "그 줄을 고치는 것"이지 새 줄이 아니다. 밀어 넣으면 재시도가 진행될 때마다 같은 사고가 여러 줄 쌓인다. 반대로 **다른 id 는 제목이 같아도 안 합친다**(그것도 스펙).

종류를 못 읽어도 **버리지 않는다** — 제목만 있어도 사용자에게는 쓸모가 있고, 조용히 삼키는 것이 가장 나쁘다.

경고와 오류는 색으로만 가른다. 아이콘 옆에 "경고:" 를 붙이면 제목이 이미 하는 말을 두 번 한다.

## 어댑터 0.67 → 0.68

0.68 의 유일한 변경이 이 확장의 정렬(`align typed session failures with AIR protocol`)이라 함께 올렸다. 자동 설치가 붙어 있어 사용자는 다음 실행에 한 번 받는다.

0.67 에서 온 것 중 우리에게 닿는 것들도 확인했다: `preserve task plans across prompts`(방금 넣은 할 일 목록이 프롬프트를 넘어 유지된다), `surface Skill tool calls with name and kind in _meta`(이미 `_meta.claudeCode.toolName` 을 읽고 있다).

## 아직 안 가져온 것

- **turn-terminal failure** — `PromptResponse` 의 `_meta` 에도 같은 기록이 실린다. 지금은 `session_info_update` 쪽만 읽는다.
- **nested subagent transcripts** — `clientCapabilities._meta["subagent-transcript"]` 로 켜면 서브에이전트의 글·도구가 부모 호출에 묶여 온다. 화면 구조를 한 겹 더 만들어야 해서 미뤘다.
- **goal extension** — 세션에 걸친 장기 목표. 우리 플래너와 겹치는 축이라 설계부터 봐야 한다.

## 검증

typecheck 0 · 프런트 859(실패 기록 3건 추가) · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: 실제 기록이 오는지는 한도에 걸리거나 폴백이 나야 안다 — 만들어 낼 수 없는 조건이라 실측을 못 했다. 파싱은 문서의 필드 이름을 그대로 따랐다.