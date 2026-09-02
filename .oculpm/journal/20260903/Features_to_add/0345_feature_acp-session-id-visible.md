---
schema_version: 1
type: feature
slug: "acp-session-id-visible"
status: done
difficulty: low
created_at: "2026-09-03T03:45:25+09:00"
session_id: "20260903-002"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/SessionIdChip.tsx"
    op: create
  - path: "src/features/chat/conversation/SessionPanel.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_session_id.test.tsx"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "claude-code"
  - "ui"
  - "mcp-tool"
---
[x] Claude Code 대화의 세션 id 를 화면에 — 터미널에서 그대로 이어 열도록

## 추가 기능

앱 안의 Claude Code 대화는 우리가 저장하지 않는다 — Claude Code 자신의 세션 스토어에 있고 ACP `session/list` 가 그걸 그대로 연다. 그래서 같은 대화를 터미널에서 `claude --resume <id>` 로 이어 열 수 있는데, 정작 그 id 가 화면 어디에도 없었다. 앱과 터미널을 오가는 사람에게 두 세계를 잇는 유일한 손잡이가 빠져 있던 셈이다.

- **툴바** — 지금 보고 있는 대화의 세션 id 칩. 패널을 열어야만 보이면 "터미널에서 이어서" 가 두 동작이 된다.
- **지난 대화 패널** — 줄마다 id 가 보이고, 줄마다 복사 버튼이 하나씩. 열지 않고 id 만 가져갈 수 있다.

## 동작 흐름

`SessionIdChip` (신규) 하나를 두 자리가 함께 쓴다. 화면에는 앞 8 자만 적고 **복사는 언제나 전체 id** 다 — 8 자로는 resume 이 안 된다. 툴팁은 칠 명령(`claude --resume <전체 id>`)을 그대로 보여 준다. 복사되는 것이 명령줄이 아니라 id 인 이유: 붙여 넣는 자리가 터미널일 수도, 스크립트일 수도, 남에게 보내는 메시지일 수도 있다.

패널 줄은 한 줄에서 두 줄이 됐다. id 를 제목 옆에 끼우면 좁은 패널에서 제목이 먼저 잘리는데, 이 목록에서 제목은 대화를 고르는 유일한 단서다. 나누고 나니 제목이 줄 전체를 쓴다 — 잘림이 오히려 줄었다. 상대 시각·상태는 둘째 줄로 함께 내려갔고 그 자리 규칙(도는 중이면 상태가 시각을 대신)은 그대로다. 백엔드는 손대지 않았다 (`AcpSession.session_id` 가 이미 프런트에 온다).

## 검증

`acp_session_id.test.tsx` 신규 8건: 앞 8 자만 적는가 · 복사되는 것이 **전체** id 인가 · 툴팁이 명령을 그대로 보여 주는가 · 줄마다 id 와 복사 버튼이 있는가 · 상대 시각이 id 에 자리를 뺏기지 않았는가. 프런트 게이트 전부 exit 0 (typecheck · vitest 2045 · lint · build) — 기존 `provenance_rows` 의 `.acp-session-time` 단언도 그대로 통과한다.