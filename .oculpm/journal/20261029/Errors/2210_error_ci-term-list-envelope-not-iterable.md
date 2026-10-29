---
schema_version: 1
type: error
slug: "ci-term-list-envelope-not-iterable"
status: done
difficulty: low
created_at: "2026-10-29T22:10:40+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/__tests__/terminal_close_guard.test.tsx"
    op: update
related:
  - ref: "20261029/Features_to_add/2152_feature_today-claude-waiting-alert.md"
    kind: "followup"
tags:
  - "terminal"
  - "today"
  - "ci"
  - "mcp-tool"
---
[x] CI 에서만 오늘 화면이 「object is not iterable」 로 죽음 — 터미널 목록이 봉투로 옴

## 발생 원인

PR #124 의 CI 「프런트」 두 잡(Linux · Windows)이 테스트 900개를 다 통과하고도 처리 안 된 오류 하나로 실패했다. 오류는 `TypeError: object is not iterable` 이고 자리는 `todayModel.buildExceptions` 의 `for (const session of input.terms ?? [])` 였다.

`term_list` 는 봉투(`{status, data}`) 없이 배열을 바로 주는 명령이다. 그런데 `i18n_english_screens.test.tsx` 의 바인딩 흉내는 모르는 명령에 모두 `{status:"ok", data:null}` 을 돌려준다. 그래서 `useWindowTerms` 가 그 봉투를 목록으로 받아 썼다. 로컬에서는 테스트가 그 답이 오기 전에 끝나 오류가 보이지 않았고, 느린 CI 러너에서만 렌더가 따라잡아 터졌다.

## 해결 방법

`features/terminal/status.ts` 에 `asList` 를 두었다. 배열이 아니면 빈 목록으로 접는다. `useWindowTerms` 와 `useTermOverview` 둘 다 이것을 거친다. 테스트 흉내를 파일마다 고치지 않은 까닭은, 그런 흉내가 여러 파일에 따로 있어서 다음 명령에서 같은 일이 되풀이되기 때문이다. 「터미널 목록을 못 읽었다고 오늘 화면이 죽으면 안 된다」는 `api/invoke.subscribe` 와 같은 원칙이다.

## 검증

- CI 로그(`gh api --allow-escape-sequences …/jobs/123458557504/logs`)에서 스택을 확인했다. 원인 파일은 `i18n_english_screens.test.tsx`, 마지막 테스트는 「Today」였다.
- `terminal_close_guard.test.tsx` 에 「배열이 아닌 답은 빈 목록」 테스트를 더했다. `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 901개 통과, 처리 안 된 오류 없음.