---
schema_version: 1
type: bug
slug: "acp-interleaved-blocks-usage-sessions-tombstones-caret"
status: done
difficulty: high
created_at: "2026-08-15T05:59:44+09:00"
session_id: "mcp-20260815-055944"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/acpHistory.ts"
    op: update
  - path: "src/features/chat/streamPacer.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/__tests__/acp_history.test.ts"
    op: update
  - path: "src/__tests__/stream_pacer.test.ts"
    op: update
related: []
tags:
  - "acp"
  - "bug"
  - "streaming"
  - "design"
  - "session"
  - "mcp-tool"
---
[x] 글과 도구가 순서를 잃던 것 · /usage 대화 두 개 · 지운 대화가 되살아나던 것 · 온점이 깜빡이던 것

## "같은 생각이 왜 보이지" — 순서를 잃고 있었다

기록이 글은 `text` 한 덩어리로, 도구는 `tools` 배열로 **따로** 모으고 있었다. 그러면 화면이 "도구 전부 → 글 전부"로 그려진다. 도구 사이사이에 한 줄씩 하던 설명이 맨 아래에 줄줄이 붙어, 서로 다른 대목의 문장이 한 문단인 것처럼 이어져 보였다 — 사용자 눈에는 "같은 말이 왜 또 보이지"다.

턴을 **조각의 나열**(`blocks`)로 바꿨다. 글이 오면 마지막 글 조각에 잇고, 도구가 오면 새 조각으로 끼운다. 갱신은 **그 자리에서** 바뀐다(뒤로 밀리면 카드가 문장을 건너뛴다). 화면은 그 순서대로 그리기만 한다 — 레퍼런스와 같은 배치다.

`text` 는 전체를 이어 붙인 값으로 남겼다: 복사·길이 계산처럼 순서가 필요 없는 곳이 쓴다. 옛 기록(블록 이전)은 글 한 덩어리로 폴백한다.

## 처음 들어가면 `/usage` 대화가 두 개

일회용 대화로 옮긴 뒤 남은 구멍이다. 값이 없으면 **3초마다 다시 시도**하고 있었고, StrictMode 이중 마운트까지 겹쳐 조회가 나란히 돌았다 — 조회 하나가 대화 하나다.

두 겹으로 막았다.
- **시작하자마자 묻지 않는다.** 한도는 대화가 한 번 돌면 알림으로 저절로 채워진다. 그전에 알고 싶으면 계기를 누르거나 `/usage` 를 치면 된다. 주기 조회는 이제 **상태 읽기**뿐이라 왕복도 대화 생성도 없다.
- **한 번에 하나만.** 겹쳐 부르면 그만큼 대화가 생긴다.

## 지운 대화가 되살아나던 것

`session/delete` 가 성공해도 어댑터 목록에는 잠깐 더 남는다. 그래서 지운 줄이 사라졌다가 다음 조회에 되살아났고, 한 번 더 지워야 진짜로 없어졌다. 지웠다는 사실은 우리가 아는 것이므로 우리가 든다(목록에서 걸러 낸다).

## 온점이 깜빡이던 것

커서가 `.msg-md` **마다** 붙고 있었다. 글·도구가 섞인 답에서는 도구 위쪽 문단 끝마다 커서가 하나씩 켜졌고, 문장이 온점으로 끝나면 그 온점 옆에서 깜빡이니 "온점이 깜빡인다"로 보였다. **마지막 글 조각**에만 붙인다.

`steps(2)` 하드 온/오프도 부드러운 맥박으로 바꿨다 — 딱딱 끊기는 깜빡임은 살아 있다는 신호가 아니라 고장 난 것처럼 읽힌다. 굵기도 7px 블록에서 2px 선으로.

## 스트리밍이 덜컹거리던 이유 하나 더

글자 수로만 잘라서 낱말 한가운데가 끊겼다. "produc" 이 한 프레임 떴다가 "tion" 이 붙는다 — 사람 눈은 낱말 단위로 읽어서 반쪽 낱말이 스치면 매번 읽기를 다시 시작한다. 조금 물러나 공백에서 끊되, 너무 멀면(긴 코드·URL) 포기하고 그냥 자른다.

## 검증

typecheck 0 · 프런트 831(조각 순서 2 · 묘비 2 · 낱말 경계 3 추가) · lint 0 · build 0 · 백엔드 전 스위트.