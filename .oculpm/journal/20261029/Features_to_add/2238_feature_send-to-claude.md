---
schema_version: 1
type: feature
slug: "send-to-claude"
status: done
difficulty: medium
created_at: "2026-10-29T22:38:41+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/sendToClaude.ts"
    op: create
  - path: "src/features/terminal/SendToClaudeHost.tsx"
    op: create
  - path: "src/features/terminal/send.css"
    op: create
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlanItems.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/send_to_claude.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "terminal"
  - "ocul-next"
  - "mcp-tool"
---
[x] 「Claude 에게 보내기」 — 일지 · 계획 항목 · 변경 파일을 맥락으로 붙여 앱 안 claude 세션에

## 추가 기능

사용자가 고른 소통 방식 넷 중 「내가 보내고 Claude 가 받기」를 만들었다.

- **여는 자리**
  - 일지 상세의 「Claude 에게 보내기」
  - 변경 화면 파일 머리의 「Claude 에게 보내기」
  - 계획 항목 줄의 「보내기」 — 가리킬 때만 보이고, 끝난 항목과 부모 항목에는 없다
  - 모두 `requestSendToClaude(맥락)` 만 부른다. 대화상자는 프로젝트 창마다 하나(`SendToClaudeHost`)다.
- **맥락**
  - 일지: `.oculpm/journal/…md`, 「검증 없음」이면 그 말
  - 계획 항목: `.oculpm/planner/<id>.md #<item>`, 막혔으면 그 말
  - 파일: 경로, 일지 없는 변경이면 그 말
  - Claude 에게 가는 글은 「맥락 한 줄 → 빈 줄 → 사람이 쓴 말」이다.
- **받는 곳**
  - 이 창의 세션 가운데 셸 위에서 claude 가 도는 것이다(`busy` 이면서, 상태 신호가 있거나 「다음」으로 띄운 것). 쉬는 세션(입력 대기 · 끝냄)이 먼저 골라진다.
  - 그런 세션이 없으면 그 글로 새 claude 세션을 연다(`runPromptInTerminal`).
- **넣는 법**
  - 붙여넣기 시퀀스(`ESC[200~ … ESC[201~`)로 감싸 여러 줄이 한 번에 입력칸에 들어가게 하고, 60ms 뒤 Enter 를 넣는다.
  - 일하는 중이면 Claude Code 가 다음 턴으로 줄을 세운다.
  - 보낸 뒤 「터미널 N 에 보냈어요」 토스트가 뜨고 「터미널에서 보기」로 그 세션에 간다.
- 빈 글이면 이유를 말하는 비활성(`blocked`)이다. ⌘↩ 로 보낸다.

## 남은 것

- 실제 claude TUI 에 붙여넣기 + Enter 가 한 번에 제출되는지는 설치본에서 봐야 한다(#eyes-installed).

## 검증

- 하네스(앱 통째 · 일지 상세)로 대화상자를 찍었다. 맥락 줄, 받는 곳 「터미널 1 · claude (입력을 기다려요)」, ⌘↩ 표시가 보인다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 78개 · 테스트 922개 통과, lint · build exit 0. `send_to_claude.test.tsx` 4개는 글 모양, 받는 곳 거르기, 도는 세션에 붙여넣기 + Enter(⌘↩), 새 세션 · 빈 글 비활성을 본다.