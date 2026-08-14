---
schema_version: 1
type: bug
slug: "acp-usage-dedicated-hidden-session"
status: done
difficulty: medium
created_at: "2026-08-15T06:08:15+09:00"
session_id: "mcp-20260815-060815"
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
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "usage"
  - "session"
  - "mcp-tool"
---
[x] 사용량은 전용 대화 하나에서 묻고 목록에서 감춘다 — 위젯도 다시 뜬다

## 지우기로는 안 됐다

물어볼 때마다 대화를 파고 지웠는데, 지우기와 어댑터의 전사 기록이 **경합**해 가끔 살아남았다. 어댑터 코드에도 그 순서를 맞추려는 흔적이 있지만(teardown 먼저, 그다음 delete) 빈틈이 남는다. 지우기의 성공 여부에 기대는 설계 자체가 틀렸다.

**어댑터가 사는 동안 전용 대화 하나만 두고, 목록에서 감춘다.** 지우기가 실패해도 사용자 눈에는 없다. 실패해도 되는 설계가 실패하지 않으려 애쓰는 설계보다 낫다.

거르기는 두 겹이다.
- **id 로** — 이번 실행에서 우리가 판 것.
- **제목으로** — 앱이 죽으면 그 대화는 디스크에 남고 다음 실행에서는 그 id 를 모른다. 첫 메시지가 `/usage` 인 대화는 우리가 판 것뿐이다(사용자가 치는 `/usage` 는 프롬프트로 나가지 않고 화면에서 위젯을 연다).

## 위젯이 안 뜨던 것

앞 라운드에서 "대화가 생긴다"를 막으려고 **시작할 때 아예 안 묻게** 했더니, 첫 대화 전까지 계기가 영영 안 떴다. 원인을 없앴으니 다시 물어봐도 된다 — 값이 없으면 4초 간격으로 **다섯 번까지만** 물어보고 멈춘다. 무한히 두드리면 어댑터가 영영 안 뜨는 상황에서 조용히 계속 돈다.

## 검증

typecheck 0 · 프런트 831 · lint 0 · build 0 · 백엔드 581 유닛 + 전 스위트.

**미확인**: 앞선 실행들이 남긴 "/usage" 대화가 이미 디스크에 있다면 제목 거르기가 그것들도 가려 준다 — 실제로 사라지는지는 열어 봐야 안다. 파일 자체는 남는다(우리가 지우지 않는다).