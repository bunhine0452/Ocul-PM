---
schema_version: 1
type: bug
slug: "narrow-topbar-actions-menu"
status: done
difficulty: medium
created_at: "2026-10-31T00:17:56+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src/__tests__/shell_v4.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20261029/Errors/2245_error_e2e-start-steps-selector-gone.md"
    kind: "followup"
tags:
  - "shell"
  - "redteam"
  - "mcp-tool"
---
[x] 창: 좁은 윗줄의 화면 동작을 ⋯ 메뉴로

## 발생 원인
레드팀(10-31)이 찾은 반례다. 계획의 「좁으면 화면 동작을 아이콘으로, 넘치지 않게」가 지켜지지 않았다.
- 504 폭에서 화면 동작 칸이 29px(내용 271px)로 짓눌렸고, 480 에서는 5px 였다. 그래서 「새 세션 · 나란히 · 여럿에서 · 새 일지」를 누를 수 없었다.
- 384 폭(480 창 × 글자 125%)에서는 찾기 · 설정이 창 밖으로 나갔다.
- E2E 의 넘침 검사(scrollWidth)는 셸이 잘라 0 을 보았다.

## 해결 방법
- ≤640: 화면 동작 칸을 숨기고, 윗줄 끝의 「⋯」(이 화면의 동작)가 칸을 아래로 펼친다. 열면 첫 동작으로 포커스가 가고, Esc 로 접으면 「⋯」로 돌아온다. 바깥 클릭 · 동작 누름 · 화면 이동에도 접힌다. 넓은 창에서는 「⋯」가 보이지 않는다.
- ≤460: 프로젝트 이름을 시각적으로 감추고 탭 여백을 줄인다. 찾기 단추도 숨긴다(⌘K 는 그대로).
- E2E: 윗줄 칸 가운데 창 밖으로 나간 것이 있으면 실패한다.

## 검증
- 하네스 640 · 504 · 480 · 384 다섯 화면 → 윗줄 칸이 창 밖으로 나간 수 0 (고치기 전 480: 1~9, 384: 9~20), 504 에서 ⋯ 메뉴에 「새 세션 · 나란히 · 여럿에서」
- `pnpm vitest run src/__tests__/shell_v4.test.tsx` → 새 테스트 포함 통과(펼침 · 포커스 · Esc · 누르면 접힘)
- 전체 게이트 → Tests 973 passed · rust passed 1167 failed 0 · lint(design discipline clean)