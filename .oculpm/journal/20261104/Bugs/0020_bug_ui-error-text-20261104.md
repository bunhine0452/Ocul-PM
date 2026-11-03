---
schema_version: 1
type: bug
slug: "ui-error-text-20261104"
status: done
difficulty: low
created_at: "2026-11-04T00:20:20+09:00"
session_id: "mcp-20261104-002020"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/features/oculpm/useJournalSearch.ts"
    op: update
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/diff/useDiffChanges.ts"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/error_text.test.tsx"
    op: create
related:
  - ref: "20261102/Bugs/2023_bug_open-in-vscode-without-code-cli.md"
    kind: "followup"
tags:
  - "화면"
  - "ui-audit"
  - "i18n"
  - "mcp-tool"
---
[x] 화면: 오류 카드 문장과 계획 오류 제목을 고친다

11-03 화면 검사에서 못 본 곳(터미널 · 설정 아래쪽 · 오류 상태)을 앱 통째 하네스(mockIPC + 실제 일지 픽스처)로 이어서 봤다. 명령 실패는 `?fail=<명령 접두>` 로 흉내 냈다.

## 발생 원인
- 일지 목록 · 검색 · 변경 · 일지 상세: 실패 문장을 `String(e)` 로 만들어 `Error: database is locked` 처럼 접두가 붙었다.
- 계획 화면: 실패 카드 제목이 「문제가 발생했어요」 — 다른 화면은 「일지를 불러오지 못했어요」 처럼 무엇이 실패했는지 말한다.
- 일지 목록: 오류 카드 아래에 「일지는 에이전트가 쓰고…」 빈 안내와 「이전 기록 더 보기」 가 같이 떠, 없는 건지 못 읽은 건지 알 수 없었다.

## 해결 방법
- 네 파일의 `e instanceof OculpmApiError ? e.message : String(e)` 를 `tError(toAppError(e))` 로. 계획의 `String(e)` 둘도 같게. WorkspaceContext 는 파일 크기 래칫(937줄) 때문에 그대로 — 그 자리는 늘 OculpmApiError 라 접두가 없다.
- `plan.error` → 「계획을 불러오지 못했어요」 / Couldn't load the plan.
- JournalScreenV2: `error` 면 empty · footer 를 그리지 않는다.

이상 없던 것: 터미널 밝게 · 어둡게(프로젝트 색 바탕), 터미널 열기 실패 토스트, 설정 전체 스크롤, 오늘 · 변경 오류 카드.

## 검증
```
pnpm vitest run src/__tests__/error_text.test.tsx → 3 passed (고치기 전 코드면 "Error: database is locked" 로 실패)
pnpm test → Tests 1049 passed (1049)
pnpm typecheck / pnpm lint / pnpm build → exit 0
```
PR #162.