---
schema_version: 1
type: feature
slug: "acp-characterization-tests"
status: done
difficulty: medium
created_at: "2026-08-25T21:00:00+09:00"
session_id: "manual-20260825-210000"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/acp_conversation_seams.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: ["20260825/Refactors/2052_refactor_acp-conversation-children.md"]
tags: ["test", "frontend", "acp", "characterization"]
---

[x] AcpConversation 특성화 테스트 5건 — 훅 추출 전 안전망

## 추가 기능

`AcpConversation` 을 실제로 렌더하는 테스트가 **2건뿐**이었다(둘 다 "보내기가 어디로
나가는가"). 본체 훅 100개를 커스텀 훅으로 쪼개려면 그 전에 지금 화면이 무엇을 하는지를
못 박아야 한다. 겨냥한 절취선마다 한 건씩 깔았다:

| 테스트 | 겨냥한 절취선 |
|---|---|
| 받은 답변은 그 대화에만 쌓인다 (옮기면 사라지고 돌아오면 그대로) | `useTranscripts` |
| 실패는 그 대화에만 붙는다 | `useSessionMaps` |
| 새 대화 버튼이 탭을 늘리고 보낸 곳이 바뀐다 | `useAcpTabs` |
| 보내지 않은 초안은 대화별로 보관된다 | `useComposer` (draftsRef) |
| 추론(thought) 조각도 그 대화의 기록으로 들어간다 | `useTranscripts` |

기존 `acp_parallel_sessions` 가 **보내는 방향**을 본다면, 이쪽은 **받아서 어디에 쌓이는가**를
본다.

## 동작 흐름

화면은 `acpPrompt` 에 `Channel` 을 6번째 인자로 넘기고 거기에 `onmessage` 를 단다.
테스트 mock 이 그 채널을 붙잡아 두었다가 `emit({kind:"chunk"|"failed"|"thought"})` 로
에이전트 사건을 직접 밀어 넣는다.

## 내 가정이 두 번 틀렸다 (그래서 이 테스트가 필요했다)

1. **"탭을 돌아오면 로컬 기록이 그대로"** — 반만 맞았다. `openSession` 은 기본적으로
   기록을 **비우고** `acpLoadSession` 으로 재생한다. 다만 `transcriptsRef` 에 기록이
   있으면 "이미 본 대화" 지름길을 타 `acpSelectSession` 으로 장부만 바꾼다. 처음엔
   mock 이 이 커맨드에 `null` 을 줘서 빈 화면이 됐다 — 동작 차이가 아니라 mock 공백이라,
   실제 반환에 맞춰 보강했다.
2. **"초안은 화면 하나가 든다"** — 틀렸다. `draftsRef` 로 **대화별**이다(563줄
   `setDraft(draftsRef.current[activeId] ?? "")`). 테스트를 실제 동작에 맞춰 다시 썼고,
   오히려 이쪽이 훅 추출에서 깨지기 쉬운 지점이라 더 좋은 특성화가 됐다.

특성화 테스트는 **바라는 동작이 아니라 있는 동작**을 적는 것이라, 두 번 다 코드가 아니라
기대를 고쳤다.

## 검증

`pnpm vitest run src/__tests__/acp_conversation_seams.test.tsx` 5건 통과. 전체
**1,303 → 1,308 케이스**, 113 → 114 파일. typecheck·lint·build 전부 exit 0.

i18n 린트가 테스트의 한국어를 잡아 `scripts/check-no-hardcoded-korean.mjs` 의 `TESTS`
allowlist 에 등록했다 — 한국어 렌더를 검사하는 유효한 테스트라 기존 acp 테스트들과 같은
취급이다.

## 메모

이제 [#acp-extract-hooks] 를 칠 수 있다. 본체 2,059줄에 훅 100개(useCallback 34 ·
useEffect 23 · useState 20 · useRef 19 · useMemo 3 · useLayoutEffect 1). 하위 컴포넌트
추출과 달리 **기계적 이동이 안 된다** — 34개 useCallback 이 서로의 클로저를 잡고 있어
의존 순서를 지켜 옮겨야 하고, 훅 호출 순서가 바뀌면 런타임에서만 드러난다. 이 5건이
그걸 잡는 그물이다.
