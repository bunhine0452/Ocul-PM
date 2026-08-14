---
schema_version: 1
type: refactor
slug: "acp-effort-panel-tightening"
status: done
difficulty: low
created_at: "2026-08-15T06:52:49+09:00"
session_id: "mcp-20260815-065249"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/ultracode.ts"
    op: update
  - path: "src/__tests__/ultracode.test.ts"
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
  - "design"
  - "keyboard"
  - "mcp-tool"
---
[x] Effort 패널 — 3줄 여백을 한 줄로, 트랙은 순환, 울트라코드에 준말 풀이

## 한 줄이면 되는 자리에 세 줄을 잡아 뒀다

높이를 고정한 것 자체는 맞았다 — 값을 옮길 때마다 패널이 늘었다 줄면 겨냥하던 점이 달아난다. 틀린 것은 **몇 줄로 고정했느냐**다. 3줄을 잡았더니 여섯 칸 중 다섯 칸은 한 줄짜리 문구("좌우 방향키로 조절")를 위해 두 줄만큼의 빈 칸을 이고 있었다. 울트라코드 설명 하나 때문에 나머지가 전부 헐렁했다.

한 줄로 고정하고 넘치면 말줄임한다 — 흔들림도 없고 여백도 없다. 울트라코드 문구는 한 줄에 맞게 줄이고 **전문은 `title` 로** 남겼다(짧게 줄이면서 정보를 버리지는 않는다).

## 끝에서 막히지 않는다

Tab·좌우 방향키가 양 끝에서 멈추고 있었다. 막히면 "안 눌리는 건가" 하고 한 번 더 누르게 되고, 반대편으로 가려면 지나온 칸을 도로 되짚어야 한다. 여섯 칸짜리 척도에서는 도는 편이 늘 가깝다.

**잠긴 칸은 건너뛴다.** 모델이 안 되는데 울트라코드에서 멎으면 끝에서 막히는 것과 똑같은 막다른 길이다. 전부 잠겨 있으면 제자리에 둔다 — 무한히 도는 것보다 아무 일도 안 하는 편이 낫다.

순환 계산은 순수 함수(`nextIndex`)로 빼서 테스트했다. 감싸기·건너뛰기·전부 잠김·빈 트랙 네 경우가 다 조용히 틀리기 쉬운 자리다.

## 준말 풀이

울트라코드 이름 옆에 `(xhigh + workflows)` 를 붙였다. 여섯 칸 중 유일하게 척도의 연장이 아니라 별개의 물건이라, 설명이 없으면 "max 다음의 더 센 칸"으로 오해된다. 이름보다 물러난 톤으로 — 이름이 먼저 읽혀야 한다.

## 검증

typecheck 0 · 프런트 843(순환 5건 추가) · lint 0 · build 0 · 백엔드 전 스위트.