---
schema_version: 1
type: refactor
slug: "acp-conversation-children"
status: done
difficulty: medium
created_at: "2026-08-25T20:52:00+09:00"
session_id: "manual-20260825-205200"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/conversation/shared.ts"
    op: create
  - path: "src/features/chat/conversation/Markdown.tsx"
    op: create
  - path: "src/features/chat/conversation/Attachments.tsx"
    op: create
  - path: "src/features/chat/conversation/TraceRow.tsx"
    op: create
  - path: "src/features/chat/conversation/TurnRow.tsx"
    op: create
  - path: "src/features/chat/conversation/PermissionCard.tsx"
    op: create
  - path: "src/features/chat/conversation/SessionPanel.tsx"
    op: create
  - path: "src/features/chat/conversation/ConfigControls.tsx"
    op: create
related: ["20260825/Refactors/2102_refactor_cache-module-split.md"]
tags: ["refactor", "frontend", "react", "acp"]
---

[x] AcpConversation 하위 컴포넌트 29개를 conversation/ 8파일로 추출 — 3,542 → 2,059줄

## 동기

Phase 3 의 첫 단계. 이 파일의 진짜 문제는 길이가 아니라 **본체 컴포넌트 하나가
1,922줄**이라는 점인데, 그 아래 하위 컴포넌트 ~29개가 시야를 가려 본체가 드러나지
않았다. 하위부터 걷어내야 본체 훅 추출(다음 단계)의 대상이 보인다.

## 변경 요약

먼저 의존 그래프를 떠서 순환이 없음을 확인하고 층으로 갈랐다:

| 파일 | 줄 | 담긴 선언 |
|---|---|---|
| `ConfigControls.tsx` | 459 | ConfigControl·MoreSettings·EffortControl + 모드/아이콘 상수 (12) |
| `TurnRow.tsx` | 387 | TurnRow·UserTurn·PlanList·FailureRow·TurnCopy·ThinkingLabel·AgentWord (8) |
| `TraceRow.tsx` | 236 | TraceRow·TraceElapsed·TraceIo (3) |
| `SessionPanel.tsx` | 215 | SessionPanel (1) |
| `PermissionCard.tsx` | 97 | PermissionCard (1) |
| `Attachments.tsx` | 91 | ImageAttachment·Lightbox (2) |
| `shared.ts` | 28 | TOOL_ICON·TOOL_STATUS_KEY·PermissionState (3) |
| `Markdown.tsx` | 24 | MarkdownBlock·StreamingMarkdown (2) |

`TOOL_ICON` 은 TraceRow 와 PermissionCard 양쪽이, `PermissionState` 는 PermissionCard 와
본체가 함께 써서 `shared.ts` 로 뺐다. 나머지 참조는 층 구조라 순환이 없다
(TurnRow → {Markdown, Attachments, TraceRow}).

## 헛디딘 것

임포트 카탈로그를 손으로 적다가 원본 임포트 블록을 69줄까지만 읽고 만들었다. 실제로는
**34개 모듈 104개 심볼**이라 `AcpDiffView`·`estimateTokens`·`wordKeyAt` 등이 빠져
TS2304 가 났다. 카탈로그를 하드코딩하는 대신 **원본 임포트 블록을 파싱해 자동 생성**하도록
고치고 처음부터 다시 했다. 상대경로도 한 단계 깊어지므로 `./x` → `../x` 로 변환한다.

## 검증

`noUnusedLocals: true` 덕에 TypeScript 가 Rust 컴파일러 역할을 그대로 했다 — 임포트가
하나라도 남거나 모자라면 에러다. 최종 **typecheck exit 0**.

- **선언 집합 동일** — 분할 전 원본과 분할 후 9개 파일에서 최상위 선언을 뽑아 정렬
  비교 → diff 없음, **42개 그대로**.
- **테스트 동일** — vitest 113파일 **1,303 케이스 전부 통과**(기준선과 같은 수).
- lint(storage·i18n) · build 모두 exit 0.

## 메모

본체는 아직 ~1,900줄이다. 다음은 훅 100개(useCallback 34·useEffect 23·useState 20·
useRef 19·useMemo 3·useLayoutEffect 1) 추출인데, **AcpConversation 을 렌더하는 테스트가
2건뿐**이라 그대로 손대면 위험하다. 계획대로 [#frontend-regression] 특성화 테스트를
먼저 채우고 [#acp-extract-hooks] 로 간다. 절취선 후보는 useAcpTabs · useSessionMaps ·
useTranscripts · useComposer · useStickToBottom.
