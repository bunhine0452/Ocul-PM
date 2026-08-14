---
schema_version: 1
type: feature
slug: "acp-effort-colors-and-status-dot-line"
status: done
difficulty: low
created_at: "2026-08-15T06:59:09+09:00"
session_id: "mcp-20260815-065909"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
related: []
tags:
  - "acp"
  - "design"
  - "css"
  - "mcp-tool"
---
[x] Effort 단계마다 색 · 진행 점을 상태 문구와 같은 줄로

## 단계마다 색

effort 는 숫자도 눈금도 없는 값이라 이름만으로는 "지금 어느 정도인지"가 안 읽힌다. 차가운 쪽에서 뜨거운 쪽으로 옮겨 가게 했다 — 칩만 흘깃 봐도 알게.

몇 가지를 지켰다.

- **색은 칩에 한 번만** 건다. 라벨도 아이콘(`currentColor`)도 상속하므로, 라벨만 물들이고 불꽃 아이콘이 남처럼 떠 있는 일이 없다.
- **단계는 데이터로 싣는다**(`data-effort`). 값 목록이 어댑터에서 오므로 색 표를 JS 에 두면 값이 하나 늘 때 두 곳을 고쳐야 한다. 모르는 값이 오면 아무 규칙도 안 걸려 기본색으로 남는다 — 빠뜨린 값에 엉뚱한 색을 입히는 것보다 정직하다.
- **xhigh 는 섞어 만든다** — high(호박)와 max(빨강) 사이에 토큰이 없어 하드코딩할 뻔했는데, `color-mix` 로 두 토큰을 섞으면 테마를 따라간다.
- 울트라코드만 흐름 밖의 보라다. 트랙이 하드코딩하고 있던 `#8b5cf6` 도 같은 토큰으로 바꿔 라벨과 점의 색을 하나로 맞췄다 — 같은 신호는 같은 색이어야 한다.

## 점이 줄을 갈랐다

진행 표시용 점(`msg-head`)을 따로 한 줄 두고 있었다. 그런데 레일이 이미 단계마다 점을 찍고 도는 것은 맥박이 뛴다 — 위에 점을 하나 더 얹으면 **점이 두 개**가 되고, "빚는 중…" 같은 상태 문구와 줄이 갈라진다.

그 줄을 없애고 상태 문구 자신에게 레일 점을 줬다. 점은 그 문구의 줄에 있어야 둘이 한 말로 읽힌다. 문구를 기다리는 자리(`msg-wait`)도 같다.

## 검증

typecheck 0 · 프런트 843 · lint 0 · build 0 · 백엔드 전 스위트.