---
schema_version: 1
type: bug
slug: "acp-concurrent-load-race-and-cmdw-wrong-instance"
status: done
difficulty: high
created_at: "2026-08-15T04:30:04+09:00"
session_id: "mcp-20260815-043004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "race"
  - "session"
  - "shortcut"
  - "mcp-tool"
---
[x] 세션이 섞여 보이던 것(동시 load 경합) · ⌘W 를 배경 탭이 가로채던 것

## key 중복 로그는 원인이 아니라 **증상**이었다

`Encountered two children with the same key, toolu_…` 는 도구 카드 이야기다. ⌘W 와는 무관하고, "다른 세션이 보인다"와는 **같은 뿌리**다.

## 뿌리: 동시 load 경합

탭을 빠르게 두 번 누르면 `session/load` 가 두 개 뜬다. 백엔드의 이벤트 싱크는 **프로젝트당 하나**라 나중 것이 앞 것을 밀어내는데, 앞 로드의 재생분은 이미 흐르고 있다. 두 채널이 같은 `setTurns` 로 들어가 대화가 섞였다 — 그래서 "클릭하지 않은 세션이 보이고", 같은 도구 카드가 두 번 그려져 React 가 key 중복을 외쳤다.

화면에 **세대 카운터**를 뒀다. 로드가 시작될 때 올리고, 이벤트와 응답 양쪽에서 세대가 어긋나면 버린다. 새 대화와 전송도 세대를 올린다 — 아직 흐르고 있는 재생분이 내 질문 위에 지난 대화를 덧그리면 안 된다.

덧붙여 리듀서를 **id 로 멱등하게** 만들었다: 같은 도구 호출 id 가 또 오면 새 카드가 아니라 같은 카드다. 경합을 막았어도 이건 참이라 남겨 둔다(방어 두 겹).

## ⌘W 를 배경 탭이 가로채고 있었다

프로젝트 탭은 배경에서도 **마운트된 채** 남는다(Chrome 처럼 watcher·PTY 가 계속 돌아야 해서). 창에 Claude Code 화면이 둘 이상 살아 있으면 각자 닫기 사슬에 등록하고, 사슬은 나중에 등록한 것부터 묻는다 — 그게 배경 탭이면 보이는 화면은 그대로인 채 **남의 세션 탭이 닫힌다**. 사용자 눈에는 "⌘W 를 눌렀는데 아무 일도 안 일어남"이다.

`display: none` 안의 요소는 레이아웃 상자가 없다 — `getClientRects().length` 로 가른다. 안 보이는 화면은 사슬에서 물러나고 다음 차례로 넘긴다.

## 검증

typecheck 0 · 프런트 812(도구 카드 멱등 2건 추가) · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: 경합은 타이밍에 달려 있어 자동 테스트로 못 잡았다 — 탭을 빠르게 번갈아 눌러 봐야 확인된다. 세대 카운터는 순수 로직이 아니라 컴포넌트 ref 라 단위 테스트로 떼어내지 못했다.