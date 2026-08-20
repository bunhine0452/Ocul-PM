---
schema_version: 1
type: bug
slug: "new-session-has-no-tab"
status: done
difficulty: low
created_at: "2026-08-20T20:54:00+09:00"
session_id: "manual-20260820-205400"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_session_tabs.test.tsx"
    op: create
related: []
tags: ["acp", "claude-code", "tabs", "dogfooding"]
---

[x] 새 세션을 눌러도 상단 탭 줄에 아무 것도 안 뜨던 것

## 발생 원인

제보: "우측 상단에서 새로운 세션을 만들면 좌측 상단 상태창에 새로운 세션이라고
떠야 하는데, 눌러도 새 창이 안 뜬다."

세션은 **첫 마디를 보낼 때** 비로소 만들어진다 — `newConversation()` 은
`session_id` 를 `null` 로 비울 뿐이다(아무 말도 안 한 세션은 어댑터 목록에
실리지 않아 "있는 것도 없는 것도 아닌 대화"가 되므로 의도된 설계).

그런데 탭 줄은 `state.acpTabs` 만 그렸고, 그 목록에는 **진짜 세션 id 가 생긴
뒤에야** 항목이 들어간다(`addTab`). 그래서 새 세션을 누른 직후의 상태는 탭
줄에 자리가 없었고, 활성 탭 표시(`activeId={session?.session_id ?? null}`)도
아무 것도 가리키지 못해 상단바는 **방금 떠나온 대화를 그대로** 보여 줬다.
누른 사람 눈에는 아무 일도 안 일어난 것이다.

## 해결 방법

아직 안 만든 대화를 위한 **임시 탭**을 하나 그린다 (`AcpTab.pending`).

- `acpTabs` 에는 넣지 않는다 — 그 목록은 디스크에 남고, 아직 아무것도 아닌
  대화가 거기 남으면 다음 실행에 열 수 없는 탭이 하나 뜬다. `tabItems`
  에서만 맨 끝에 붙인다.
- 라벨은 `acp.newConversation`("새로운 세션"), 점선 테두리로 실선 탭과 구별.
  첫 마디를 보내면 진짜 탭이 **같은 자리(맨 끝)** 에 들어서므로 바뀌는 순간에도
  줄이 흔들리지 않는다.
- 활성 표시를 `activeId`(`session_id ?? SLATE`)로 바꿔 임시 탭이 잡히게 했다.
- 닫기 경로도 채웠다: `closeTab(SLATE)` 는 목록에서 뺄 것이 없으므로 **하던
  대화로 돌아가는 것**으로 정의하고(돌아갈 곳이 없으면 X 버튼 자체가 안 뜬다),
  ⌘W 도 같은 규칙을 탄다. 안 그러면 눌러도 반응 없는 X 가 하나 생긴다.

## 검증

`acp_session_tabs.test.tsx` 4건 신규 — 라벨이 "새로운 세션"인지 · 지난 대화
옆에서 활성으로 잡히는지 · 혼자일 때 닫기 버튼이 없는지 · 돌아갈 대화가 있으면
`onClose("")` 가 오는지. 전체 vitest 1031건, typecheck/lint/build 통과.

## 메모

임시 탭은 다른 대화로 옮기면 사라진다 — 빈 자리는 하나뿐이고 내용이 없으므로
남겨 둘 근거가 없다. 쓰다 만 글은 대화별로 재워 두므로 새 세션을 다시 누르면
그대로 돌아온다.
