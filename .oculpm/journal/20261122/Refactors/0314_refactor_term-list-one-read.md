---
schema_version: 1
type: refactor
slug: "term-list-one-read"
status: done
difficulty: medium
created_at: "2026-11-22T03:14:05+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/__tests__/terminal_terms_shared.test.tsx"
    op: create
related: []
tags:
  - "터미널"
  - "perf"
  - "today"
---
[x] 터미널: 세션 목록을 창에서 한 번만 읽는다

## 동기
`TermSessionsChanged` 는 어느 창의 어느 세션이든 상태 · 제목 · 끝이 바뀔 때마다 모든 창에 온다. 프로젝트 창 하나에는 이 창의 목록을 읽는 훅이 셋이다(셸의 터미널 점 · 셸의 오늘 배지 · 오늘 화면). 사건 한 묶음마다 셋이 저마다 `term_list` 를 불렀고, 답이 앞과 같아도 새 배열이라 `ShellV2` 와 그 아래 지금 화면이 통째로 다시 그려졌다. 세션 40개가 도는 날에는 다른 창의 세션이 낸 사건만으로 읽던 화면이 150ms 마다 다시 섰다. `term_list` 는 읽을 때마다 백엔드가 「도는 중」 을 잰다(Windows 는 프로세스 스냅숏).

## 변경 요약
- `status.ts` 에 창 하나짜리 읽는 곳(`windowTermsHub`)을 두었다. 사건은 여기서 한 번 듣고 한 번 읽어 듣는 훅 모두에게 준다.
- 사건이 부른 읽기는 늘 새로 읽는다. 훅이 켜지며 부른 읽기는 읽는 중인 것에 얹는다. 답에는 번호가 있어 먼저 떠난 느린 읽기가 새 목록을 덮지 않는다.
- 답이 앞과 값으로 같으면 상태를 바꾸지 않는다(같은 배열 그대로). `useTermOverview` 도 수가 그대로면 앞 표를 둔다.
- 「Claude 에게 보내기」 가 기대는 계약은 그대로다: 꺼지면 읽지 않은 상태로 돌아가고, 켜면 새로 읽은 답이 오기 전까지 읽는 중이다.

## 검증
- 고치기 전 같은 시험(훅 셋 · 세션 40 · 사건 묶음 10): `term_list` 33번(처음 3 + 30) · 훅 렌더 30번. 고친 뒤 11번(처음 1 + 10) · 렌더 0번.
- `npx vitest run src/__tests__/terminal_terms_shared.test.tsx src/__tests__/terminal_status_refetch.test.tsx src/__tests__/terminal_close_guard.test.tsx` → `Tests  16 passed (16)`
- `npx vitest run` → `Tests  1982 passed (1982)`

## 메모
- 같은 값으로의 첫 갱신에 React 는 그 컴포넌트 함수를 한 번 더 불러 보고 접는다(자식은 그리지 않는다). 시험은 그 한 번을 재지 않는다.
- 이 PC 의 pnpm 12 는 `package.json` 의 `pnpm.overrides` 를 읽지 않아 스크립트를 거부한다. 설치는 `npx pnpm@10.34.9 install --frozen-lockfile` 로 했고 잠금 파일은 바뀌지 않았다.
- 설치본에서 눈으로 보지는 않았다.
