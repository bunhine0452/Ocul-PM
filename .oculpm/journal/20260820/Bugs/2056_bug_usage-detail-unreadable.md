---
schema_version: 1
type: bug
slug: "usage-detail-unreadable"
status: done
difficulty: medium
created_at: "2026-08-20T20:56:00+09:00"
session_id: "manual-20260820-205600"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/usageDetail.ts"
    op: create
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_usage_detail.test.ts"
    op: create
  - path: "src/__tests__/acp_usage_meter.test.tsx"
    op: create
related:
  - ".oculpm/journal/20260820/Bugs/2055_bug_title-follows-last-prompt.md"
tags: ["acp", "claude-code", "usage", "dogfooding"]
---

[x] 사용량 카드의 "무엇이 기여했나"가 잘려서 안 읽히던 것

## 발생 원인

제보와 스크린샷: 대목 전체가 292px 카드 안 11px 고정폭 `<pre>` 에 들어가 한
문장이 네댓 줄로 접히고, 216px 스크롤 칸 아래로 잘려 나갔다. 정보가 있는데
읽히지 않는 상태.

원문을 그대로 건 데는 이유가 있었다 — 항목이 CLI 판올림마다 늘고 문구도 바뀌어
파싱해 두면 다음 판에 조용히 빈칸이 된다. 맞는 걱정이지만, 그 대가로 지금
당장 아무도 못 읽고 있었다.

실측 원문(claude 2026-08-20):

```
Approximate, based on local sessions on this machine — does not include …

Last 7d · 4704 requests · 44 sessions
  92% of your usage was at >150k context
  Top skills: /frontend-design:frontend-design 2%, /claude-api 1%
  Top MCP servers: plugin:oculpm:oculpm 4%, oculpm 1%
```

## 해결 방법

`usageDetail.ts` (순수 함수) 로 뜯되 **파서가 이기지 않게** 한다 — 규칙은
하나: **모르는 줄은 원문 그대로 흘려보낸다**(정렬 공백까지). 확실히 아는 네
모양만 뜯는다.

- `note` — 맨 앞 단서 문장. 고정폭을 풀어 비례폭으로 접는다.
- `stat` — "Last 7d · … requests · … sessions". 아래 비율들의 기준이라 제목처럼.
- `share` — "92% of your usage was at >150k context" → 숫자 + 얇은 막대 + 설명.
  줄마다 되풀이되는 `of your usage` 는 뗀다(넷 중 셋이 같은 말로 시작해 폭만 먹음).
- `top` — "Top skills: a 2%, b 1%" → 이름표 + 칩. 긴 이름은 자르고 `title` 로 돌려준다.
- `text` — 못 알아본 줄. **예전과 똑같이** 고정폭 원문.

카드 폭도 292 → 344px(`max-width: calc(100vw - 24px)`), 스크롤 칸 216 → 300px.
기여도 막대의 트랙 색은 따로 준다 — 이 칸 배경이 곧 `--bg-inset` 이라 위쪽 한도
막대와 같은 색을 쓰면 안 채워진 부분이 통째로 사라져 막대가 떠 보인다.

## 검증

`acp_usage_detail.test.ts` 6건(실측 원문 분해 · 군더더기 제거 · Top 항목 파싱 ·
표 정렬 보존 · 문구가 통째로 바뀌어도 줄 손실 없음 · 빈 입력) + 
`acp_usage_meter.test.tsx` 4건(카드를 실제로 열어 DOM 확인 — 막대 너비·칩·단서
문장·모르는 줄 생존). 전체 vitest 1031건, typecheck/lint/build 통과.

## 메모

파서의 안전장치는 "모르면 원문"이므로, CLI 가 문구를 바꾸면 **예전 모습으로
되돌아갈 뿐** 빈칸이 되지 않는다. 회귀 테스트에 그 경우를 명시로 박아 뒀다.
