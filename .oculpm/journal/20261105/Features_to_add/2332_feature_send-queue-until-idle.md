---
schema_version: 1
type: feature
slug: "send-queue-until-idle"
status: done
difficulty: medium
created_at: "2026-11-05T23:32:44+09:00"
session_id: "20261105-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "46e12a9f-7d29-4721-bc44-5366494409bc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/sendToClaude.ts"
    op: update
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: update
  - path: "src/features/terminal/send.css"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/send_to_claude.test.tsx"
    op: update
related: []
tags:
  - "터미널"
  - "terminal"
  - "orca"
  - "mcp-tool"
---
[x] 터미널: 보낼 말을 줄 세웠다가 넣는다

## 추가 기능
Orca 의 follow-up queue(11-02 기본값)를 가져왔다. 「Claude 에게 보내기」와 변경 화면 「Claude 에게 맡기기」가 쉬지 않는 세션에 보내면, 바로 넣지 않고 창의 줄에 세운다.

- 일하는 중(working)에 넣으면 Claude Code 가 도는 턴 한가운데 끼워 넣는다.
- 묻는 중(blocked)이 더 위험했다. 붙여넣기 뒤 Enter 가 권한 선택지를 눌러 버린다.

## 동작 흐름
- `sendOrQueue` 는 보내는 순간 `term_list` 를 다시 읽는다. idle · done · error 이거나 상태를 안 알리는 옛 claude 면 바로 넣는다. working · blocked 면 `enqueue` 한다.
- 「지금 끼워 넣기」(⇧⌘↩)는 working 일 때만 바로 넣는다. blocked 면 그래도 줄에 세운다.
- 줄은 `SendToClaudeHost` 의 `useSendQueueFlusher` 가 비운다. `TermSessionsChanged` 와 줄 변경 때마다 목록을 읽어, 손을 놓은 세션의 몫을 빈 줄로 이어 한 턴에 넣는다. 끝난 세션의 몫은 버리고 알린다.
- 줄에서 먼저 뺀 뒤 넣는다. 그래서 사건이 겹쳐 두 번 불려도 같은 말이 두 번 가지 않는다.
- 알림의 「취소」로 줄에서 뺀다. 변경 메모의 onSent 는 실제로 넣은 뒤에 부른다.

## 검증
- pnpm test 1074 passed (send_to_claude 새 5건 포함) · typecheck 0 · lint 0 · build 0
- 커밋 1cdc8f25 (브랜치 feat/send-queue)