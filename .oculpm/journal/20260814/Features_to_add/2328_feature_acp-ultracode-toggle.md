---
schema_version: 1
type: feature
slug: "acp-ultracode-toggle"
status: done
difficulty: medium
created_at: "2026-08-14T23:28:53+09:00"
session_id: "mcp-20260814-232853"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/ultracode.ts"
    op: create
  - path: "src/__tests__/ultracode.test.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
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
  - "ultracode"
  - "research"
  - "ux"
  - "mcp-tool"
---
[x] 울트라코드 토글 — 설정 항목이 아니라 프롬프트 키워드였다

## 질문

"울트라코드를 구현하고 싶은데 안 되나?" — 앞 라운드에서 나는 "effort 축이 아니라 별개 개념이라 `configOptions` 로 노출되지 않는다"고 답했다. 맞는 말이었지만 **결론이 틀렸다**: 노출되지 않을 뿐, 다른 경로로 이미 열려 있었다.

## 근거

어댑터(`claude-agent-acp` 0.67.0) 소스에 답이 있었다. 프롬프트를 만들 때 `origin: {kind: "human"}` 을 찍는 이유를 스스로 이렇게 설명한다.

> ACP prompts are the user's own input relayed by the client. Stamp the provenance explicitly: per the SDK, a host wrapping keyboard input must send `{kind: "human"}` — an absent `origin` is treated as unattributed and fails closed at the CLI's strict `isHuman()` trust gates (**e.g. the ultracode keyword opt-in honors only human-originated turns**).

즉 ① 울트라코드는 **프롬프트 키워드 옵트인**이고, ② 사람이 친 턴에만 유효하며, ③ 어댑터가 우리 프롬프트를 이미 사람 발화로 스탬프하고 있다. 우리 패널에서 지금도 **키워드만 치면 동작한다** — 백엔드에 새 프로토콜 작업이 필요 없었다.

(CLI `--help` 에도 `--effort` 는 있어도 ultracode 플래그는 없다. 설정 파일에도 없다. 키워드가 유일한 문이다.)

## 구현

컴포저에 토글 칩. 켜면 두 가지를 한다.

1. 보내는 프롬프트 앞에 키워드를 붙인다 — **화면에는 사용자가 친 그대로** 남긴다.
2. effort 를 `xhigh` 로 올린다. 스크린샷의 라벨이 "Ultracode - xhigh + workflows" 이므로, 키워드만 켜고 effort 를 낮게 두면 이름과 실제가 어긋난다. 이미 `xhigh`·`max` 면 건드리지 않는다.

키워드 부착은 순수 함수로 뺐다. 사용자가 이미 "ultracode" 를 쳤으면 **덧붙이지 않는다** — 같은 단어가 두 번 든 프롬프트는 사용자가 쓴 적 없는 문장이 되고 전송분과 화면이 어긋난다. 단어 경계도 본다(`ultracodex` 는 다른 단어라 여기서 참이면 키워드가 조용히 안 붙는다).

상태는 영속한다. 에이전트를 여럿 띄우는 비싼 모드라 **켠 사실이 계속 보여야** 하고, 모르는 새 꺼져 있거나 켜져 있으면 둘 다 사고다. 색은 앱의 초록 accent 가 아니라 보라 — Effort 최상위 점과 같은 색으로, 둘 다 "여기부터는 다른 물건"이라는 신호다.

## 검증

프런트 유닛 6건 신규(단어 경계·중복 방지·빈 입력). 게이트: typecheck 0 · **789건** · lint 0 · build 0 · 백엔드 569 유닛.

**미확인**: 실제로 켜고 보냈을 때 CLI 가 울트라코드로 받아들이는지는 실측하지 않았다. 근거는 어댑터 소스의 직접 진술이고, 확인은 켜서 한 번 보내 보면 즉시 드러난다(에이전트가 워크플로를 띄우면 툴콜 카드에 나타난다).