---
schema_version: 1
type: feature
slug: "acp3-tool-calls-permission"
status: done
difficulty: high
created_at: "2026-08-14T21:03:43+09:00"
session_id: "mcp-20260814-210343"
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
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
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
  - "permission"
  - "tool-call"
  - "rust"
  - "react"
  - "mcp-tool"
---
[x] PR-ACP3 — 툴콜 카드 + 권한 승인: 에이전트가 뭘 하는지 보이고, 물어본다

## 추가 기능

지금까지 `Other` 로 흘려보내던 `tool_call` · `tool_call_update` 를 카드로 그리고, `session/request_permission` 을 인라인 승인 카드로 받는다. 커맨드 1개 추가(`acp_permission_respond`).

## 동작 흐름

**권한 요청 처리가 이 라운드의 핵심 난점이었다.** 크레이트 문서(`concepts::ordering`)가 못 박는다 — `on_receive_request` 콜백은 **dispatch 루프를 붙잡고**, 콜백이 끝날 때까지 어떤 메시지도 처리되지 않는다. 여기서 사용자를 기다리면 승인 카드를 띄운 순간 스트리밍이 통째로 멎는다.

그래서 콜백은 즉시 빠져나간다: `request_id`(우리가 만든 uuid — 프로토콜의 JSON-RPC id 는 크레이트 안에 숨어 있어 프런트가 못 본다)로 oneshot 을 park 하고, 이벤트를 쏘고, `cx.spawn` 한 태스크가 사용자의 결정을 기다렸다 `responder.respond` 한다.

**응답하지 않으면 에이전트는 영영 멈춘다.** 그래서 빠져나갈 구멍을 모두 막았다 — 취소(`acp_cancel`)·연결 종료·앱 종료 어느 쪽이든 미결 요청을 취소로 닫는다. 프로토콜도 이걸 요구한다(취소한 클라이언트는 미결 `session/request_permission` 에 전부 취소로 응답해야 한다).

카드는 모달이 아니라 대화 흐름 안에 둔다(D4) — 모달로 덮으면 *무엇을* 승인하는지 보여 주는 도구 카드가 같이 가려진다.

## 통합 테스트가 잡아낸 것

임시 폴더에서 실제로 쓰기를 시켜 승인 요청을 강제했더니, 승인했다고 믿었는데 파일이 안 생겼다. 원인은 **선택지 순서를 믿은 것**이다 — 어댑터는 이렇게 보낸다:

```
선택지: Deny (RejectOnce)        ← 첫 항목이 거절이다
선택지: Allow Once (AllowOnce)
선택지: Always Allow (AllowAlways)
```

`options.first()` 를 고르면 거절이 된다. 테스트를 `kind` 기준 선택으로 고쳤고, **UI 도 같은 함정을 확인해 손봤다**: 강조는 순서가 아니라 `option_kind` 로 고르고, 우리 폴백 거절 버튼은 어댑터가 거절 선택지를 안 줄 때만 낸다(안 그러면 거절 버튼이 둘이 된다).

## 검증

백엔드 유닛 5건 신규 — 도구 매핑(kind·status·locations 평탄화), **부분 갱신이 안 온 필드를 덮지 않는지**, 권한 park/resolve, 중복 resolve 거부, 그리고 취소가 **해당 프로젝트 것만** 닫는지(옆 프로젝트 카드를 함께 날리면 누르지도 않은 거절이 일어난다).

프런트 유닛 4건 신규 — 도착 순 누적, 부분 갱신, 모르는 id 무시, 턴 종료 후 지각 도구 거절.

통합(`#[ignore]`, 수동): `tool_calls_and_permission_requests_reach_the_client` — 임시 폴더 cwd 로 복사를 시켜 도구 3건·권한 1건을 실제로 받고, 승인 뒤 **`copy.txt` 가 실제로 생겼는지**까지 확인한다(응답이 에이전트에 전달됐다는 유일한 증거다). 24초 통과.

게이트: typecheck 0 · 프런트 749건 · lint 0 · build 0 · 백엔드 569 유닛 + 통합 전 스위트. `plugin_json` 실패는 v2.9.0 릴리스가 남긴 기존 드리프트.

**남은 것**: 화면을 실제로 띄워 카드를 눌러 본 적은 없다(ACP2 와 같은 종류의 미검증). 승인 경로는 통합 테스트가 크레이트 레벨에서 증명하지만, `acp_permission_respond` 커맨드를 거치는 프런트 왕복은 실기기 확인이 필요하다.