---
schema_version: 1
type: feature
slug: "acp-thinking-word-tool-open-clip"
status: done
difficulty: medium
created_at: "2026-08-15T03:07:28+09:00"
session_id: "mcp-20260815-030728"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/agentWords.ts"
    op: create
  - path: "src/__tests__/agent_words.test.ts"
    op: create
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "motion"
  - "css"
  - "bug"
  - "mcp-tool"
---
[x] 생각 시간·상태 단어 · 도구 카드 기본 펼침 · 메뉴 잘림 수정

## 메뉴가 잘리던 이유

`.settings-menu` 가 `right: 0` 이었다. 설정 칩들은 컴포저 **왼쪽**에 모여 있으므로, 칩을 기준으로 250px 이 왼쪽으로 펼쳐지며 컴포저 밖으로 나갔다 — 사이드바를 열면 남는 폭이 줄어 더 심하게 잘렸다. 왼쪽 앵커로 바꾸고 `max-width: calc(100vw - 32px)` 를 걸어 어떤 앵커든 화면을 넘지 않게 했다. 오른쪽 끝에 있는 사용량 카드만 예외로 뒤집는다.

## 생각 줄

도는 동안은 "생각하는 중 · N 토큰", 끝나면 "18초 생각함".

시간은 **실제로 잰다**. 리듀서가 첫 생각 조각에 시작 시각을, 첫 답변 조각에 끝 시각을 찍는다(답변 중간에 다시 생각해도 처음 구간이 "생각한 시간"이다). 시계는 인자로 받는다 — 리듀서를 순수하게 두어 테스트가 시간을 고정할 수 있게. **안 넘기면 아예 안 찍는다**: 기본값 0 을 찍으면 "0초 생각함"처럼 보여, 시계를 안 넘긴 호출부의 실수가 화면에서는 정상으로 보인다.

토큰 수는 **추정치**다. 프로토콜이 생각 토큰을 따로 주지 않아 정확한 값을 만들 수 없다 — 진행 감각이 목적이고, 끝난 뒤에는 추정 대신 실제로 잰 시간을 보여 준다.

## 상태 단어

"응답 대기 중…" 한 줄은 정확하지만 죽어 있다. 스피너는 기다림을 시간이 아니라 **초조함**으로 준다. 말이 한 글자씩 찍히면 같은 시간이 진행으로 읽힌다.

무작위로 고르지 않는다 — 같은 화면을 두 번 보는 사람에게 매번 다른 말이 뜨면 "무슨 뜻이 있나" 하고 읽게 된다. 순서대로 돌면 배경이 된다. 다 찍은 뒤 잠시 머무는 구간을 둔 것도 같은 이유다(바로 넘어가면 완성된 단어를 읽을 새가 없다).

## 도구 카드

기본값을 **진행 중이면 펼침**으로 바꿨다. 돌고 있는 동안에는 "무엇을 시켰는지"가 곧 진행 상황이고, 끝나면 결과 한 줄로 접히는 편이 대화를 덜 밀어낸다. 사용자가 한 번 누르면 그 선택이 이긴다. IN 과 OUT 사이에는 선을 넣었다 — 한 덩어리로 뭉치면 어디까지가 내 명령인지 안 보인다.

## 검증

프런트 유닛 9건 신규(생각 시각 3건, 단어 순환·타이핑 6건). 게이트: typecheck 0 · **800건** · lint 0 · build 0 · 백엔드 575 유닛.