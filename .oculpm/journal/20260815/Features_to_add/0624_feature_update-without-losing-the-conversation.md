---
schema_version: 1
type: feature
slug: "update-without-losing-the-conversation"
status: done
difficulty: medium
created_at: "2026-08-15T06:24:01+09:00"
session_id: "mcp-20260815-062401"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/busyGuard.ts"
    op: create
  - path: "src/__tests__/busy_guard.test.ts"
    op: create
  - path: "src/lib/updater.ts"
    op: update
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "updater"
  - "session"
  - "ux"
  - "mcp-tool"
---
[x] 업데이트가 대화를 끊지 않게 — 재시작만 미루고, 다시 뜨면 하던 대화로

## 프로세스는 못 살린다. 대화는 살린다.

질문은 "업데이트 중에도 세션이 안 끊기게 할 수 있나"였다. 정직한 답을 먼저 적어 둔다.

ACP 어댑터는 **우리가 띄운 자식 프로세스**이고 stdio 파이프로 이어져 있다. 앱이 다시 뜨면 그 프로세스는 죽는다 — 파이프의 반대편이 사라지므로 살려 둘 방법이 없다(소켓으로 바꿔도 새 프로세스가 남의 stdio 에 다시 붙을 수는 없다). 그러니 **프로세스 연속성은 불가능**하다.

살릴 수 있는 것은 **대화**다. 세션은 어댑터가 디스크에 적어 두고 `session/load` 로 되살아난다. 그래서 문제를 둘로 갈랐다.

## 1. 재시작만 미룬다

업데이트는 두 걸음이다: 번들을 디스크에 깔고, 앱을 다시 띄운다. **앞걸음은 언제 해도 안전하다** — 도는 프로세스는 메모리의 옛 코드를 계속 쓴다. 위험한 것은 뒷걸음뿐이고, 그때 흐르던 답변은 아직 디스크에 없어 그대로 사라진다.

그래서 깔기는 그대로 하고 **재시작 직전에 물어본다**. 답변이 도는 중이면 깔아만 두고 기다렸다가, 끝나는 순간 띄운다. 배너는 그동안 이유를 말하고("Claude Code 가 작업 중 — 끝나면 자동으로 재시작합니다") 기다리기 싫으면 지금 띄울 수 있다.

폴링이 아니라 **구독**이다 — 폴링이면 일이 끝난 뒤에도 최대 한 주기만큼 멍하니 기다린다.

`busyGuard` 는 "등록하면 바쁨"이 아니라 **그 순간 바쁜지 물어보는** 구조다. 등록만으로 바쁘게 치면 해지를 한 번 놓칠 때 업데이트가 영영 안 뜬다.

## 2. 다시 뜨면 하던 대화로

보고 있던 대화 id 를 기억해 두고, 다시 떴을 때 목록에 아직 있으면 도로 연다. 없거나 지웠으면 조용히 빈 화면 — 없는 대화를 열려다 오류를 띄우는 것보다 낫다.

**한 번만** 시도한다: 사용자가 그 뒤로 다른 대화를 골랐는데 이게 다시 끼어들면 화면이 제 마음대로 움직이는 것처럼 보인다.

## 남는 한계 (숨기지 않는다)

- 재시작 시점에 **돌고 있던 답변 하나**는 잃는다. 미루기가 이 창을 아주 좁힐 뿐 없애지는 못한다 — 사용자가 "지금 재시작"을 누르면 그대로 잃는다.
- 어댑터가 새로 뜨는 데 드는 몇 초는 그대로다.

## 검증

typecheck 0 · 프런트 835(바쁨 등록소 4건 추가) · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: 실제 업데이트를 태워 봐야 안다 — 재시작 대기와 복원이 함께 도는 흐름은 릴리스 한 번을 지나야 확인된다.