---
schema_version: 1
type: bug
slug: "acp-sticky-stacking-collapsible-command-history-order"
status: done
difficulty: high
created_at: "2026-08-15T05:01:33+09:00"
session_id: "mcp-20260815-050133"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpHistory.ts"
    op: create
  - path: "src/__tests__/acp_history.test.ts"
    op: create
  - path: "src/features/chat/acpTurns.ts"
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
  - "bug"
  - "css"
  - "ux"
  - "session"
  - "mcp-tool"
---
[x] 지시문이 top 에 겹겹이 쌓이던 것 · 긴 지시문 접기 · 열기만 해도 목록 맨 위로 오던 것

## sticky 는 컨테이닝 블록이 전부다

어제 붙인 지시문 sticky 가 두 번 틀렸다. 같은 속성인데 **어디에 거느냐**로 결과가 정반대다.

1. **카드에 걸었더니** — 컨테이닝 블록이 카드 자신이라 붙어 있을 구간이 카드 높이뿐. 아무 일도 안 일어난다.
2. **스레드 전체에 걸었더니** — 반대로 영영 안 놓인다. 스크롤을 내릴수록 지난 지시가 하나도 안 비켜나고 top 에 겹겹이 쌓였다.

정답은 **묶음**이다. 주고받은 한 덩어리(지시 + 그 답)를 실제 요소로 그리고 그 안에서 sticky 를 건다 — 자기 답변이 끝나는 순간 자연히 자리를 비우고 다음 지시가 넘겨받는다. `groupTurns` 로 나눈다(사용자 발화에서 새 묶음이 열리고, 재생 복원은 에이전트 턴이 먼저 올 수 있어 첫 묶음은 사용자 없이 시작할 수 있다).

`top: 0` 도 고쳤다 — 스레드 맨 위 테두리에 딱 붙어 카드가 창을 뚫고 나온 것처럼 보였다. 6px 띄우고 카드 위쪽 여백도 줄였다.

## 긴 지시문은 접는다

지시문이 길수록 답도 길어서, 안 접으면 화면 위쪽을 지시문이 다 먹고 정작 보려던 출력이 밀려난다. 6줄에서 자르고 잘린 곳을 페이드로 알린다(칼로 끊으면 문장이 원래 거기서 끝나는지 알 수 없다).

- **펼치기는 본문 아무 데나** — 작은 버튼을 겨냥할 필요가 없다.
- **접기는 버튼으로만** — 본문 클릭으로 접으면 긴 글을 읽다 스크롤 대신 잘못 눌렀을 때 읽던 자리가 통째로 사라진다.
- 펼친 지시문은 **붙이지 않는다** — 길어서 펼친 것을 화면 위에 고정하면 보려던 출력을 통째로 덮는다.

넘침 판정은 **접힌 상태에서만** 잰다. 펼친 뒤에는 넘칠 것이 없어 `false` 가 되고, 그러면 "접기" 버튼이 스스로 사라져 되돌릴 방법이 없어진다.

## 열어 보기만 해도 맨 위로 오던 것

어댑터의 `updated_at` 은 세션 **파일의 수정 시각**이다(`new Date(session.lastModified)`). 그런데 대화를 열면 `session/load` 가 그 파일을 만져서 시각이 올라간다 — 한 마디도 안 했는데 목록 맨 위로 온다. 그러면 "최근에 이야기한 순서"라는 이 목록의 의미가 무너져 그냥 **눌러 본 순서**가 된다.

어댑터를 고칠 수 없으므로 **정렬 기준을 우리가 아는 사실로 바꿨다**: 처음 본 시각을 원장에 적어 두고, 우리가 그 대화에 실제로 말을 걸었을 때만 올린다. 시각을 모르는 대화는 맨 뒤로 — 모르는 것을 "가장 최근" 자리에 놓으면 첫 줄이 거짓말이 된다.

원장은 영속하지 않는다(창을 다시 열면 그때 본 값으로 다시 잡힌다). 첫 관찰이 클릭보다 먼저이므로 그것으로 충분하다.

## 검증

typecheck 0 · 프런트 817(목록 순서 5건 추가) · lint 0 · build 0 · 백엔드 전 스위트.