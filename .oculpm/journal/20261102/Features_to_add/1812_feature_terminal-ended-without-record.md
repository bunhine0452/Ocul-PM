---
schema_version: 1
type: feature
slug: "terminal-ended-without-record"
status: done
difficulty: low
created_at: "2026-11-02T18:12:36+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/terminal/status.ts"
    op: update
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/features/terminal/terminal.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_screen.test.tsx"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "mcp-tool"
---
[x] 터미널: 일지 없이 끝난 세션을 짚는다

## 추가 기능
이 세션에서 Claude 가 일했고(OSC 7501 working 을 한 번이라도 알림) 지금은 끝났거나 손을 놓았는데(끝 · done · idle), 세션 시작 뒤 일지가 0건이면 경고 글자색 「· 일지 없음」 을 단다. 붙는 자리는 탭과 칸 머리다. 약속 1(일지 없이 끝난 세션 0)을 터미널에서 바로 본다.
- 코드를 바꾸지 않은 문답에도 선다. 그래서 실패 딱지가 아니라 「확인해 볼 것」으로 두었고, 툴팁에서 그렇다고 말한다.

## 동작 흐름
- `termStore` 가 상태 사건에서 `working` 을 본 세션을 `worked` 집합에 기억한다(`hasWorked`). 세션을 닫으면 지운다.
- `status.ts` 의 `endedWithoutRecord(info, worked, records)` 는 xterm 없이 쓸 수 있는 순수 판정이다. 일지 수는 기존 「시작 뒤 일지 수」(`useRecordsSince`)를 그대로 쓴다.

## 검증
- `terminal_screen.test.tsx`: 14 passed. 일했고 일지 있음(없음 표시 안 남) · 일했고 시작 뒤 일지 0(표시) · 일한 적 없는 셸(표시 안 남)을 확인했다.
- `pnpm test`: 1000 passed ×2. `pnpm typecheck` · `pnpm lint` · `pnpm build` 0. Rust 변경은 없다.