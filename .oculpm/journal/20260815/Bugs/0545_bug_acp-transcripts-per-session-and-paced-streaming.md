---
schema_version: 1
type: bug
slug: "acp-transcripts-per-session-and-paced-streaming"
status: done
difficulty: high
created_at: "2026-08-15T05:45:45+09:00"
session_id: "mcp-20260815-054545"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/streamPacer.ts"
    op: create
  - path: "src/__tests__/stream_pacer.test.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "streaming"
  - "session"
  - "architecture"
  - "mcp-tool"
---
[x] 답변이 남의 대화에 쓰이던 것 · 돌아오면 사라지던 것 · 스트리밍 속도 고르기

## 턴은 화면이 아니라 **대화**의 것이다

세 증상이 한 뿌리였다. 화면이 `turns` 하나를 들고 있었다.

- 답변 도중 다른 대화로 넘어가면 흐르던 글자가 **그 대화 화면에 쓰였다**.
- 돌아오면 `session/load` 가 디스크에서 다시 읽는데, 아직 안 끝난 답은 디스크에 없어 통째로 사라졌다.

기록을 대화 id 로 갈랐다(`transcripts`). 스트리밍은 보낼 때 정해진 `into` 에 계속 쌓이고, 돌아오면 그 자리에 그대로 있다. 아직 안 만든 새 대화는 빈 자리(`""`)에 쌓았다가 첫 마디에 진짜 id 로 옮긴다.

## 자리를 빼앗던 싱크

프런트만 고쳐서는 안 됐다. 백엔드의 이벤트 자리(`sinks`)가 **프로젝트당 하나**여서, 대화를 하나 열 때마다 그 자리를 빼앗았다 — 답변이 흐르는 중에 다른 대화로 넘어가면 진행 중이던 스트림이 그 자리에서 끊겼고, 돌아와도 그 답은 영영 오지 않았다.

자리를 **(프로젝트, 대화)** 단위로 바꿨다. 권한 요청도 자기 대화의 화면으로 간다.

그리고 돌아올 때 `session/load` 를 부르지 않는다. 새 커맨드 `acp_select_session` 은 **어댑터에 아무 것도 묻지 않고** 장부만 바꾼다 — `session/prompt` 가 대화 id 를 인자로 받으므로 "활성 대화"는 우리 쪽 기록일 뿐이다. 재생 비용도, 흐르는 스트림을 건드릴 일도 없다.

## 스트리밍: 배치가 아니라 **속도**

rAF 로 묶었는데도 끊겨 보였던 이유가 있었다. 배치는 *언제* 그릴지를 고르는 것이지 *얼마나* 그릴지를 고르지 않는다 — 프레임마다 "그 사이 도착한 것"을 통째로 얹으니 화면의 리듬이 곧 **네트워크의 리듬**이었다. 한 덩어리가 오면 한 덩어리가 툭 튀어나오고, 조용하면 화면도 멈춘다.

**도착과 표시를 끊었다.** 도착분은 대기줄에 쌓고, 매 프레임 대기줄에서 자기 속도로 꺼낸다. 밀린 만큼 빨라지므로(대기줄을 6프레임에 비우는 비율) 긴 답이 쏟아져도 뒤처지지 않고, 조각이 띄엄띄엄 와도 최소 속도로 흐른다. 도착이 멎어도 대기줄이 빌 때까지 계속 돈다.

두 가지를 지켰다:
- **글자 경계를 안 깬다** — 서로게이트 쌍 한가운데서 자르면 반쪽짜리 글자가 한 프레임 스쳤다 사라진다.
- **끝날 때는 안 기다린다** — 턴이 끝나거나 순서가 중요한 사건(툴콜·승인)이 오면 대기줄을 즉시 비운다.

## 검증

typecheck 0 · 프런트 824(속도 고르기 7건 추가) · lint 0 · build 0 · 백엔드 581 유닛 + 전 스위트.

**미확인**: 체감은 눌러 봐야 안다 — divisor 6(≈100ms 따라잡기)이 빠른지 느린지는 숫자로 정할 수 없다. 그리고 답변 중 대화를 오가는 흐름은 타이밍이라 자동 테스트로 못 잡았다.