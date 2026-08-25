---
schema_version: 1
type: refactor
slug: "acp-use-session-maps"
status: done
difficulty: medium
created_at: "2026-08-25T21:03:00+09:00"
session_id: "manual-20260825-210300"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/conversation/useSessionMaps.ts"
    op: create
related: ["20260825/Features_to_add/2100_feature_acp-characterization-tests.md"]
tags: ["refactor", "frontend", "react", "hooks", "acp"]
---

[x] useSessionMaps 훅 추출 — 훅 분해 5개 중 1개, 패턴 검증

## 동기

본체 훅 100개를 쪼개는 첫 걸음. 가장 **독립적인** 묶음부터 골랐다 — 대화별 상태
(작업중·실패·사용량·승인 요청)는 서로만 참조하고 바깥 클로저를 잡지 않는다.

## 변경 요약

`conversation/useSessionMaps.ts` (111줄) 신설:

- `UsageState` 타입, `NO_SESSIONS`·`NOTHING_BY_SESSION` 빈 초기값,
  `assignBySession` 헬퍼 — 전부 이 묶음에서만 쓰여 통째로 옮겼다
- `useSessionMaps(activeId)` — 4개 상태(`busySessions`/`errors`/`usages`/`permissions`),
  보고 있는 대화의 몫(`busy`/`error`/`usage`/`permission`), 갱신 4종
  (`markBusy`/`putError`/`putUsage`/`putPermission`)

호출부는 구조분해로 **예전과 같은 이름들**을 받는다 — 화면 곳곳의 사용처는 한 줄도
고치지 않았다. 원시 setter 4개(`setBusySessions` 등)는 블록 밖에서 쓰인 적이 없어
반환하지 않았고, `busySessions`(밖에서 8회)와 `permissions`(2회)만 함께 내보낸다.

본체 2,059 → 1,993줄.

## 검증

**특성화 테스트가 제 몫을 했다.** 어제 깐 5건 중 "실패는 그 대화에만 붙는다" 가
정확히 이 묶음을 겨냥한 것이고, 추출 후에도 통과한다.

- vitest 114파일 **1,308 케이스 전부 통과**
- typecheck **에러 0** (첫 시도)
- lint · build exit 0

## 여기서 끊은 이유

다음 후보였던 탭 묶음(`names`/`nameOf`/`tabs`/`addTab`/`renameTab`, 117~161줄)은
**`closeTab` 이 965줄에 따로 떨어져 있다.** 앞쪽만 훅으로 빼면 탭이라는 하나의 개념이
두 군데로 갈려 지금보다 나빠진다. `closeTab` 은 `openSession`·`session` 에 물려 있어
함께 옮기려면 그 의존까지 정리해야 하므로, 한 번에 하기보다 다음 라운드에서 제대로
잡는 게 맞다.

## 메모

남은 절취선 4개 — `useAcpTabs`(closeTab 동반 필요) · `useTranscripts` · `useComposer`
(draftsRef 포함) · `useStickToBottom`. 패턴은 이번에 확인됐다: 묶음을 고르고 → 바깥
사용처를 세어 반환 목록을 정하고 → 구조분해로 이름을 보존하면 호출부가 무변경이다.
위험 신호는 typecheck 가 아니라 **테스트**에서 온다(훅 순서·클로저는 타입으로 안 잡힌다).
