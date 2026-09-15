---
schema_version: 1
type: refactor
slug: "ai-context-callsite-parallel"
status: done
difficulty: low
created_at: "2026-09-15T22:50:33+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/__tests__/ai_context_parts.test.ts"
    op: update
  - path: "docs/optimization/00-ledger.md"
    op: update
related: []
tags:
  - "perf"
  - "chat"
  - "ai-context"
  - "optimization-round-2"
  - "parallel-session"
  - "mcp-tool"
---
[x] AI 컨텍스트 빌더 두 개를 호출부에서도 병렬로 — 직렬 왕복 4 → 2, candidates 순서 보존

## 동기

최적화 원장 §1.1 이 두 빌더(`buildPlannerSystemContext`·`buildOculpmSystemContext`) 안쪽은 병렬로 만들었지만 **호출부**는 `if` 분기 둘에서 순차 `await` 라 전송 버튼→첫 토큰 사이에 왕복이 그대로 쌓였다. 남겨 둔 이유는 `candidates` 적재 순서(plan → journal) 를 뒤 랭킹이 타이브레이크로 쓰기 때문. 병렬 세션 AI 가 worktree 에서 구현, 커밋 `19bfb72e`.

## 변경 요약

- `assembleAiContext` 호출부: 조건은 그대로, 각 분기가 `builder(...).then(asCandidate(kind, boosted))` 를 `jobs` 배열에 넣고 `await Promise.all(jobs)` 뒤 null 을 거른다. `Promise.all` 이 입력 순서를 보존하므로 모든 조합에서 `candidates` 는 바이트 동일.
- 직렬 왕복: 전 4(planList→planGet×N, list→get×3) → 후 2(두 빌더가 겹쳐 긴 쪽만).
- 원장 §1.1 에 2026-09-15 문단, §4 잔고 표 「AI 컨텍스트 직렬 왕복」 행 4 → **2** (달성).

## 검증

- `ai_context_parts.test.ts` +176줄: recall{verbatim,episode,plan,fact}×includePlanner×includeOculpm **16조합**을 옛 순차 코드를 그대로 옮긴 `sequentialCandidates()` 와 `toEqual`; 동점 타이브레이크(`fact` → `[plan, journal]`); 동시성 — `planList` 를 deferred 로 막고 `oculpmListJournalEntries` 가 **그 전에** 호출됐는지 단언(타이머 없음).
- **빨감 확인**: HEAD 의 순차 `aiContext.ts` 로 바꾸면 동시성 테스트가 2ms 에 실패, 16조합은 양쪽 다 통과(바이트 동일 증명).
- `pnpm typecheck` 0 · `pnpm lint` 0 · 관련 vitest 65/65. 합류 뒤 전체 게이트는 #merge-gates.