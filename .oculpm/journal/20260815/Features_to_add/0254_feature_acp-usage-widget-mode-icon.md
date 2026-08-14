---
schema_version: 1
type: feature
slug: "acp-usage-widget-mode-icon"
status: done
difficulty: medium
created_at: "2026-08-15T02:54:48+09:00"
session_id: "mcp-20260815-025448"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/usageBus.ts"
    op: create
  - path: "src/features/chat/AcpUsageMeter.tsx"
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
  - "usage"
  - "ux"
  - "bug"
  - "css"
  - "mcp-tool"
---
[x] 사용량을 위젯으로 (채팅 밖) · 모드 아이콘 버그 · 울트라코드 모델 게이트

## 모드 아이콘이 늘 자물쇠였다

Auto 를 골라도 트리거에 Manual 의 자물쇠가 남아 있었다. 아이콘을 **고른 값**이 아니라 **항목 id**(`mode`)로 정하고 있었기 때문이다 — 메뉴 행은 값으로 골랐으니 열어 보면 맞고 닫으면 틀린, 눈치채기 어려운 형태였다.

## 사용량은 대화가 아니라 계기판

`/usage` 를 프롬프트로 보내 답을 채팅에 남기고 있었다. 긴 표가 대화를 밀어내고, 다시 보려면 스크롤을 거슬러야 한다. 이제 `/usage` 를 입력하거나 배지를 누르면 **채팅을 건드리지 않고 위젯이 열린다**(그리고 열면서 값을 새로 읽는다 — 공짜다).

컴포저와 툴바 위젯은 형제라 서로를 직접 못 부른다. 상태를 컨텍스트로 올리는 대신 **한 번 스치는 사건**으로 모델링했다(`usageBus`) — 상태로 만들면 "열림"이 영속돼 다음 진입 때 뜬금없이 떠 있다.

툴바 계기에는 짧은 이름을 붙였다(`오늘 3% · 주간 83% · Fable 66%`). 숫자만 셋이면 무엇의 %인지 알 수 없다. `/usage` 가 주는 이름은 문장형(`week (all models)`)이라 짧은 키로 접는다.

## 카드 재설계

레퍼런스는 목록에 가깝다. 여기서는 **읽는 순서**를 만들었다: 큰 숫자(19px, tabular-nums)가 먼저 눈에 들어오고, 4px 트랙이 그 아래에서 비율을 확인시키고, 초기화 시각이 맨 밑에서 "언제 풀리나"에 답한다. 임계에서 색이 바뀌고(경고 주황·위험 빨강), 새로고침은 도는 동안 아이콘이 회전한다.

## 울트라코드 모델 게이트

사용자 관찰대로 상위 모델에서만 켜지게 했다. 값 목록을 우리가 들고 있지 않으므로 **모델 id 로 판정**한다(`opus`·`fable` 포함 시 통과) — 새 상위 모델이 나와도 이름이 그 규칙을 따르면 자동으로 통과한다. 못 켜는 모델에서는 마지막 칸이 잠기고 이유를 말한다. **켠 척하지 않는 게 요점이다** — 켜졌다고 믿으면 사용자는 워크플로가 돌 거라 기다린다.

## 검증

게이트: typecheck 0 · 프런트 791건 · lint 0 · build 0 · 백엔드 575 유닛.

작업 중 잘못된 CSS 한 줄(`#e0a martial`)을 넣었다가 지웠다 — 다음 줄이 덮어써서 화면에는 안 드러났을 것이다. 생성한 CSS 는 눈으로 한 번 훑어야 한다는 교훈.

**미확인**: 울트라코드가 Opus 이상에서만 된다는 것은 사용자 관찰이고 내가 실측한 것은 아니다. 아니라면 게이트를 풀면 된다.