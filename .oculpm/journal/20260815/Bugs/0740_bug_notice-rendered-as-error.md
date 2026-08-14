---
schema_version: 1
type: bug
slug: "notice-rendered-as-error"
status: done
difficulty: low
created_at: "2026-08-15T07:40:38+09:00"
session_id: "mcp-20260815-074038"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "ux"
  - "mcp-tool"
---
[x] 안내 문구가 빨간 오류로 뜨던 것 — 구분선이 문장을 스스로 짓고 있었다

## 성공을 실패처럼 보여 줬다

`/remote-control-acp` 가 **성공**했는데 사용자 눈에는 "오류"로 보였다. `setError()` 로 안내 문구를 띄웠기 때문이다 — 그 자리는 빨간 오류 줄이다.

띄울 자리는 이미 있었다. 며칠 전 만든 `notice` 턴(모델 교체 구분선)이 정확히 "대화에 일어난 일"을 위한 것이다.

## 그런데 그 구분선이 문장을 스스로 짓고 있었다

렌더러가 받은 텍스트를 모델 이름으로 보고 `"{model} 로 전환"` 을 조립하고 있었다. 그러면 **모델 교체 말고는 아무 것도 이 자리에 못 넣는다** — 대화에 일어나는 일은 그것만이 아닌데.

문장은 만든 쪽이 만들고, 구분선은 **받은 문장을 그대로** 건다. 모델 교체 효과가 `"…로 전환"` 을 짓고, 원격 조종 안내는 자기 문장을 짓는다. 다음에 무엇이 오든 자리가 열려 있다.

## 검증

typecheck 0 · 프런트 853 · lint 0 · build 0.