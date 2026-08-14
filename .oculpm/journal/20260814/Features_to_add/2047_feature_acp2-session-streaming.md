---
schema_version: 1
type: feature
slug: "acp2-session-streaming"
status: done
difficulty: high
created_at: "2026-08-14T20:47:19+09:00"
session_id: "mcp-20260814-204719"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: create
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: create
  - path: "src/features/chat/acpTurns.ts"
    op: create
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "streaming"
  - "rust"
  - "react"
  - "i18n"
  - "mcp-tool"
---
[x] PR-ACP2 — 세션 생성 + 프롬프트 스트리밍: 에이전트 화면에서 Claude Code 가 답한다

## 추가 기능

에이전트 화면에서 프롬프트를 보내면 Claude Code 가 앱 안에서 답한다. 커맨드 2개(`acp_prompt` / `acp_cancel`)와 화면 모드 전환(LLM 채팅 ↔ Claude Code).

## 동작 흐름

**이벤트 라우팅이 이 라운드의 설계 핵심이다.** `session/update` 알림 핸들러는 `connect_with` 빌더에 **연결 생성 시점 한 번만** 등록된다 — 프롬프트마다 새로 붙일 수 없다. 그래서 핸들러는 프로젝트별 "현재 싱크"를 찾아 흘려보내고, `acp_prompt` 는 자기 `Channel` 을 그 자리에 꽂았다 뺀다. 싱크가 없으면(프롬프트 밖) 조용히 버린다.

세션은 **첫 프롬프트에서 지연 생성**한다. `session/new` 가 cwd 를 요구하는데 그게 프로젝트 루트가 확정된 유일한 지점이기 때문이다(ACP1 에서 프로세스 cwd 를 뺀 이유와 같은 사실의 뒷면).

`session.rs` 의 `map_update` 는 `SessionUpdate` 를 프런트 이벤트로 옮기되 **모르는 종류를 에러로 다루지 않고 `Other{update}` 로 흘린다**(리스크 R2 — 어댑터가 2주에 6회 배포된다). 툴콜·플랜은 지금 `Other` 로 지나가고 PR-ACP3/4 가 그 자리를 채운다.

프런트는 `AcpConversation` 으로 **분리**했다. 프로바이더 채팅은 히스토리를 우리가 들고 매번 통째로 재전송하지만, ACP 는 세션이 에이전트 쪽에 살아 있어 우리는 그릴 것만 들면 된다 — 두 모델을 한 상태기계에 욱여넣으면 양쪽 다 망가진다.

누적 로직은 순수 리듀서 `acpTurns.ts` 로 뺐다. "청크가 어느 턴에 붙는가"는 조용히 틀리기 쉬운 자리다 — 취소·오류로 턴이 끝난 뒤 늦게 도착한 청크가 다음 질문의 답에 달라붙으면 대화가 오염되는데 화면만 보고는 원인을 못 찾는다. 그래서 턴에 `closed` 를 두고 지각 청크를 **버린다**(엉뚱한 곳에 섞는 것보다 낫다).

## 걸린 것

specta 가 `u64` 내보내기를 막는다(정밀도 손실). `usage_update` 의 토큰 수를 `u32` 포화 변환으로 낮췄다 — 컨텍스트 창은 백만 단위라 충분하고, 넘치면 최대값이 잘못된 작은 수보다 덜 거짓말이다. 그리고 `#[serde(tag = "kind")]` 는 `kind` 라는 **필드명**과 충돌해 derive 가 통째로 깨진다(증상은 엉뚱하게도 `IpcResponse` 미구현) — `Other{update}` 로 이름을 바꿔 풀었다.

## 검증

프런트 유닛 7건 신규(`acp_turns.test.ts`) — 지각 청크 방어와 불변성 포함. 백엔드 유닛 4건 신규(`map_update` 매핑·USD 아닌 통화 비용 폐기·`stop_reason` 와이어 표기).

통합(`#[ignore]`, 수동): `prompt_streams_chunks_and_ends_the_turn` — **합성 값이 아니라 진짜 어댑터가 보내는 `session/update`** 를 `map_update` 에 통과시켜 답변이 `Chunk` 로, 사용량이 `Usage` 로 매핑되고 `stop_reason == end_turn` 임을 확인. 7.07초 통과. 스키마가 바뀌어 매핑이 조용히 `Other` 로 미끄러지면 여기서 잡힌다.

게이트: typecheck 0 · 프런트 745건(60파일) · lint 0 · build 0 · 백엔드 564 유닛 + 통합 전 스위트. `plugin_json_is_minimal_and_version_synced` 실패는 v2.9.0 릴리스가 남긴 **기존 드리프트**로 본 작업과 무관.

**남은 것**: 계획의 `acp2-sid`(ACP UUID ↔ ocul-pm `session_id` 매핑)는 미착수다. ACP 세션 id 는 상태에 보관하지만, workday 접두 제약을 만족하는 ocul-pm 세션 id 로의 변환은 일지 귀속(PR-ACP5)이 실제로 필요로 할 때 붙이는 게 맞다고 판단했다.