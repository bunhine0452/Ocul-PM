---
schema_version: 1
type: bug
slug: "acp-session-load-replay"
status: done
difficulty: medium
created_at: "2026-08-14T22:59:53+09:00"
session_id: "mcp-20260814-225953"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
related: []
tags:
  - "acp"
  - "session"
  - "bug"
  - "protocol"
  - "mcp-tool"
---
[x] 지난 대화를 열어도 화면이 비던 문제 — resume 이 아니라 load 였다

## 발생

목록에서 지난 대화를 열면 세션은 이어지는데 **화면이 비어 있었다.** 앞 라운드 일지에 "resume 이 재생하는지 미실측"으로 남겨 둔 항목이 그대로 터진 것.

## 원인

`session/resume` 을 골랐는데, 스펙이 둘을 정확히 반대로 정의한다.

- `session/load` — "The Agent **MUST** replay the entire conversation to the Client in the form of `session/update` notifications."
- `session/resume` — "Unlike `session/load`, the Agent **MUST NOT** replay the conversation history."

즉 재생을 안 하는 쪽을 골라 놓고 재생을 기대했다. 이름만 보고 "이어서 연다 = resume" 으로 판단한 것이 화근 — 두 메서드가 나란히 있으면 문서를 읽어야 했다.

## 해결

- `acp_load_session` 으로 교체. **요청 전에 싱크를 꽂는다** — 알림 핸들러는 싱크가 없으면 조용히 버리므로, 순서가 뒤집히면 재생분이 통째로 사라진다.
- `UserMessageChunk` 를 `Other` 로 버리던 것을 `AcpEvent::UserChunk` 로 승격. 재생에서 지난 **질문**을 복원하려면 이게 필요하다(라이브에서는 우리가 이미 그렸으므로 무시한다).
- 리듀서에 `replay` 모드 추가. 라이브 경로는 `openTurn` 이 턴 쌍을 미리 열어 두지만, 재생은 **빈 목록에서** 이벤트만으로 대화를 세워야 한다 — 그래서 replay 일 때만 필요한 턴을 직접 연다. 재생이 끝나면 마지막 턴을 닫는다(안 닫으면 다음 질문의 답이 지난 답변 꼬리에 붙는다).

## 곁들여 고친 것

- **대화 목록 밀도**: 제목과 시각이 두 줄이라 목록이 두 배로 길었다. 한 줄로 합치고 절대 시각(`2026-08-14 13:50`)을 상대 시각(`17m`·`2h`·`3d`)으로. 목록에서 알고 싶은 건 "얼마나 오래됐나"이지 "몇 시였나"가 아니다. `relativeTime` 은 순수 함수로 분리했고, 미래 타임스탬프가 `-3m` 으로 보이지 않게 눕힌다(버그로 읽힌다).
- **"새 대화" 버튼**: 테두리 두른 상자라 이 패널에서 가장 무거운 물체였다 — 목록의 일부처럼 가볍게 낮췄다.
- **시작 화면**: 제안 칩 3개를 뺐다. 칩을 늘어놓으면 "무엇을 시킬까"를 고르는 화면이 되고 정작 하려던 말을 밀어낸다. 마크 하나와 두 줄(Claude Code 시작 화면 벤치마크).

## 검증

프런트 유닛 신규 10건 — 재생으로 대화를 세우는 4건(교대 복원·연속 청크 병합·라이브에서 사용자 반향 무시·도구가 자기 턴에 붙는지)과 상대 시각 6건.

게이트: typecheck 0 · 프런트 **772건(64파일)** · lint 0 · build 0 · 백엔드 569 유닛.

**미확인**: 실제 재생은 사람이 열어 봐야 한다 — 스펙과 리듀서는 맞췄지만 어댑터가 실제로 흘려보내는 이벤트 순서는 실측하지 않았다.