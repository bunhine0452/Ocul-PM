---
schema_version: 1
type: feature
slug: "acp-panel-transition-usage-button"
status: done
difficulty: low
created_at: "2026-08-14T23:23:06+09:00"
session_id: "mcp-20260814-232306"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpSlash.ts"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_slash.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "css"
  - "motion"
  - "mcp-tool"
---
[x] 패널 전이 · Effort 최상위 티어 색 분리 · usage 버튼 · 새로운 세션

## 패널 열고 닫기

조건부 렌더로 붙였다 뗐다 하고 있었다 — 그러면 **전이 자체가 불가능**하고, 스크롤 위치와 검색어도 매번 날아간다. 항상 마운트해 두고 폭을 전이시키는 방식으로 바꿨다(`width` + `opacity` + 테두리색, 320ms). 안쪽 래퍼가 고정 폭을 갖고 있어야 접히는 동안 글자가 찌그러지지 않는다. 닫힌 동안에는 `inert` 로 포커스가 들어가지 않게 했고, `prefers-reduced-motion` 에서는 전이를 끈다.

## Effort

- 팝오버가 트랙 하나만 담는데 `min-width: 210px` 이라 여백이 넘쳤다 — 내용 폭에 맞췄다.
- 점 선택을 **크기까지 전이**시켰다. 색만 바뀌면 툭툭 끊기는데, 크기가 함께 움직이면 점이 "옮겨 가는" 것으로 읽힌다.
- **최상위 티어(max)만 다른 색.** 같은 척도의 연장이 아니라 "여기부터는 다른 물건"이라는 신호다(레퍼런스도 마지막 점만 색을 달리한다).

## usage

사용량 표시를 **그대로 버튼으로** 만들었다 — 숫자를 보다가 "자세히"를 누르고 싶어지는 자리가 바로 거기다. 누르면 `/usage` 가 실행된다. 데이터가 아직 없으면 "사용량" 이라고만 뜬다.

슬래시 목록도 손봤다. 어댑터가 주는 순서는 알파벳순이라 자주 쓰는 것이 백 개 아래 묻힌다 — `/` 만 쳤을 때는 `usage`·`compact`·`clear`·`plugin` 을 위로 올린다(치기 시작하면 일반 정렬로 돌아간다).

## 그 외

"새 대화" → "새로운 세션". 컴포저의 ✎ 버튼은 제거 — 패널에 같은 동작이 있어 둘이 경쟁했다.

## 검증

프런트 유닛 3건 신규(고정 정렬). 게이트: typecheck 0 · **783건** · lint 0 · build 0 · 백엔드 569 유닛.

**답변**: Effort 에 "울트라코드" 단계는 없다. 어댑터가 주는 값은 `low·medium·high·xhigh·max` 뿐이고(`default` 는 우리가 뺐다), ultracode 는 effort 축이 아니라 별개의 오케스트레이션 개념이라 `configOptions` 로 노출되지 않는다. 대신 최상위인 `max` 를 색으로 구분해 "여기가 끝"임을 드러냈다.