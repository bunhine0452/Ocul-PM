---
schema_version: 1
type: bug
slug: "title-follows-last-prompt"
status: done
difficulty: high
created_at: "2026-08-20T20:55:00+09:00"
session_id: "manual-20260820-205500"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpTitle.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_title.test.ts"
    op: create
related:
  - ".oculpm/journal/20260820/Bugs/2054_bug_new-session-has-no-tab.md"
tags: ["acp", "claude-code", "tabs", "adapter", "dogfooding"]
---

[x] 대화 제목이 방금 보낸 마지막 지시문으로 계속 바뀌던 것

## 발생 원인

제보: "내가 보낸 마지막 텍스트가 제목으로 변함."

어댑터(`@agentclientprotocol/claude-agent-acp` 0.70.0)는 턴이 끝날 때마다
`maybeUpdateSessionTitle` 로 SDK 의 세션 요약을 읽어 `session_info_update` 로
내려보낸다. 그 요약을 만드는 우선순위가 문제였다 —
`@anthropic-ai/claude-agent-sdk` 의 `getSessionInfo` 는:

```
summary = customTitle || aiTitle || lastPrompt || summaryHint || firstPrompt
```

즉 **AI 가 제목을 붙이기 전까지는 `lastPrompt` 가 곧 제목**이다. 첫 턴에서는
lastPrompt == firstPrompt 라 멀쩡해 보이지만, 대화를 이어 갈수록 제목이 방금
친 말로 계속 갈아치워졌다. 제목이 대화를 가리키지 않고 커서를 따라다닌 것.

같은 값이 두 경로로 들어온다 — `acp_session_title` 폴링(탭)과
`acp_list_sessions`(지난 대화 패널). 그래서 양쪽 다 흔들렸다.

## 해결 방법

어댑터 쪽에 고칠 자리는 없다 — ACP 에 제목을 고치는 요청이 없다(있는 것은
지우기뿐). 대신 우리는 **이 대화에 무엇을 보냈는지 알고 있다**: 받은 제목이
지시문의 메아리인지 가려낼 수 있다는 뜻이다.

`acpTitle.ts` (순수 함수) — `resolveTitle(incoming, prompts)`:

- 첫 지시문의 메아리는 **받아들인다** (CLI 도 그렇게 보여 준다).
- 그 뒤 지시문의 메아리는 **버리고 첫 지시문을 지킨다** (= lastPrompt 폴백).
- 메아리가 아니면 진짜 제목(aiTitle·`/rename`)이므로 그대로 이긴다.
- 보낸 것을 모르면(창을 다시 켠 뒤 안 열어 본 탭) 받은 것을 그대로 쓴다 —
  삼키지 않는다.

비교는 어댑터의 `sanitizeTitle` 과 같게 접어서 한다(공백 접기 + 256자 절단).
잘린 쪽(`…`)은 접두사까지만 보고, 안 잘렸으면 정확히 같아야 한다 — 접두사만으로
같다고 하면 "고쳐줘" 가 "고쳐줘 그리고 …" 를 삼킨다. 울트라코드가 켜져 있으면
실제로 나가는 문장 앞에 키워드 한 줄이 더 붙으므로 비교 전에 뗀다.

지시문 목록은 별도 장부 없이 **기록에서 바로 읽는다**(`promptsOf`) — 장부를
두면 지난 대화를 다시 열었을 때(재생분으로만 채워지는 경우) 비어 있다.
`transcriptsRef` 는 커밋 뒤에 최신이 되므로 **효과 안에서만** 부른다. 탭 제목·
목록 제목 양쪽에 같은 잣대를 걸어, 같은 대화가 탭에서는 제 이름으로 옆
패널에서는 방금 친 말로 보이는 일이 없게 했다.

덤으로 첫 마디를 보내는 순간 그 문장을 임시 이름표로 건다 — 어댑터 제목이 올
때까지 "제목 없는 대화"로 있을 이유가 없다.

## 검증

`acp_title.test.ts` 9건 — 첫 지시문 메아리 수용 · 나중 지시문 메아리 거부 ·
aiTitle 우선 · 지시문을 모를 때 원본 유지 · 제목 없을 때 첫 마디 승격 · 절단된
제목 매칭 · 안 잘린 접두사는 매칭 금지 · 줄바꿈 접기 · 울트라코드 키워드.
전체 vitest 1031건, typecheck/lint/build 통과.

## 메모

SDK 사본을 직접 읽어(`sdk.mjs` 의 `BO()`) 우선순위를 확정했다 — 어댑터 주석은
"`summary` is the auto-generated title (or first prompt)" 라고만 적혀 있어
`lastPrompt` 가 그 사이에 낀 것을 알 수 없다. 어댑터를 올릴 때 이 함수가 바뀌면
걸러내기가 헛돌 수 있으니 스파이크 체크리스트에 넣을 것.
