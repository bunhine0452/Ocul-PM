---
schema_version: 1
type: bug
slug: "acp-lazy-new-session-and-usage-scratch-session"
status: done
difficulty: high
created_at: "2026-08-15T05:29:38+09:00"
session_id: "mcp-20260815-052938"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "session"
  - "usage"
  - "mcp-tool"
---
[x] 새 대화는 첫 마디에 만들고, /usage 는 일회용 대화에서 묻는다

## 새 대화는 첫 마디에

"새로운 세션" 이 곧장 `session/new` 를 불렀다. 그런데 아무 말도 안 한 세션은 어댑터 목록에 실리지 않아서, **사이드바에는 없는 창**이 하나 떠 있는 상태가 됐다 — 닫으면 사라지고 어디에도 안 남는, 있는 것도 없는 것도 아닌 대화다.

이제 화면만 비운다. `session_id` 를 비우는 것이 곧 "아직 안 만들어진 새 대화"라는 표시다 — 별도 플래그를 두지 않았다. 세션 설정(모델·Effort·권한)은 그대로 들고 있어야 컴포저가 살아 있으므로 나머지 필드는 남긴다. 진짜 생성은 첫 마디를 보낼 때.

**주의 한 곳**: 백엔드의 `acp_prompt` 는 세션이 없으면 알아서 하나 판다. 하지만 이때는 **직전 대화가 아직 등록돼 있어서** 그냥 보내면 그 대화에 이어 붙는다 — 그래서 프런트가 먼저 명시적으로 만든다.

## `/usage` 가 대화를 오염시키던 것 (두 번째 재발)

앞서 "세션을 새로 만들지 않는다"로 고쳤는데 다시 나왔다. 원인을 절반만 봤던 것이다: `/usage` 는 결국 **프롬프트**라, 보고 있는 대화에 보내면 그 대화의 기록에 `/usage` 가 남는다. 그 대화가 아직 한 마디도 안 한 상태였다면 그것이 **제목**까지 되어 목록 맨 위에 "/usage" 라는 대화가 생긴다.

즉 "세션을 만들지 않는다"로는 부족하다 — 어느 대화에 보내든 그 대화가 더러워진다.

**일회용 대화를 파서 묻고 지운다.** `session/new` → `/usage` → `session/delete`. 결과와 상관없이 지운다(남기면 목록에 쌓인다).

그러려면 그 대화의 알림이 화면으로 새면 안 된다. 알림 핸들러는 **프로젝트 단위**로만 라우팅하고 있었다 — 세션을 안 봤다. 갈무리 버퍼에 세션 id 를 달고, 그 세션의 알림은 갈무리만 하고 거기서 끊는다. 기존 경로는 한 줄도 안 바뀐다(모르는 세션이면 예전 그대로).

덤: 이제 첫 마디 전에도 사용량을 물어볼 수 있어 `ready` 게이트를 걷어냈다.

## 검증

typecheck 0 · 프런트 817 · lint 0 · build 0 · 백엔드 581 유닛 + 전 스위트.

**미확인**: 일회용 대화 생성→삭제가 매 새로고침마다 도는 비용, 그리고 대화 중에 새로고침했을 때 진짜 대화의 스트리밍이 끊기지 않는지는 실제로 눌러 봐야 안다.