---
schema_version: 1
type: feature
slug: "acp-model-switch-divider"
status: done
difficulty: low
created_at: "2026-08-15T06:46:49+09:00"
session_id: "mcp-20260815-064649"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "design"
  - "mcp-tool"
---
[x] 모델을 바꾸면 대화에 구분선 한 줄

## 대화가 아니라 **대화에 일어난 일**

모델 교체는 사람도 에이전트도 한 말이 아니다. 그래서 말풍선·카드가 아니라 구분선으로 그린다 — 턴에 `notice` 역할을 하나 더 뒀다.

안 남기면 나중에 스크롤을 올렸을 때 **어디까지가 어느 모델의 답인지** 알 수 없다. 답의 결이 갑자기 달라졌을 때 "왜 이러지"의 답이 정확히 여기 있다.

`~~~~~ Switched to X ~~~~~` 의 뜻은 그대로 두고 물결표 대신 실선을 썼다 — 폭이 어떻든 좌우가 정확히 맞고, 글자가 아니라 선이라 읽을 것으로 착각하지 않는다.

## 두 군데를 조심했다

**끼우는 자리.** 열려 있는 에이전트 턴 **앞에** 넣는다. 리듀서는 "마지막 턴이 곧 받는 중인 턴"이라는 규칙으로 도는데, 맨 뒤에 붙이면 그 규칙이 깨져 그 뒤 도착하는 청크가 갈 곳을 잃고 조용히 버려진다. 테스트로 박았다.

**언제가 "바꾼" 것인가.** 대화별로 마지막 값을 기억한다 — 다른 대화를 열면 그쪽 모델로 갈아끼워지는데, 세션 구분 없이 보면 그것까지 "바꿨다"로 잘못 읽는다. 처음 본 값도 조용히 기록만 한다: 시작 모델은 바뀐 것이 아니다.

## 함께 확인한 것 — 기억은 유지된다

어댑터는 모델을 바꿀 때 **살아 있는 query 에 `setModel`** 을 부른다(`acp-agent.js`). 세션을 다시 만들지 않으므로 대화 기록은 그대로 남고, 새 모델이 앞의 대화를 전부 본다.

## 검증

typecheck 0 · 프런트 838(구분선 3건 추가) · lint 0 · build 0 · 백엔드 전 스위트.