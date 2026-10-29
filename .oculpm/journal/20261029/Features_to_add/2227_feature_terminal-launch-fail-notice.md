---
schema_version: 1
type: feature
slug: "terminal-launch-fail-notice"
status: done
difficulty: low
created_at: "2026-10-29T22:27:09+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/launchCheck.ts"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_launch_check.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "terminal"
  - "ocul-next"
  - "mcp-tool"
---
[x] 「다음」 실행 뒤 claude 명령이 없으면 알려 준다 · 제목 글리프 대체는 보류

## 추가 기능

- **claude 를 못 찾음 (#launch-fail)** — `features/terminal/launchCheck.ts`. 「다음」(`claude "$OCULPM_PROMPT"`)으로 연 세션은 첫머리 4096자를 보고, 셸이 claude 를 못 찾았다고 하면 경고 토스트를 한 번 띄운다. 알아보는 셸은 zsh · bash · dash · fish · PowerShell 이다. 문구는 「Claude Code 가 깔려 있고 로그인 셸의 PATH 에 있는지 확인해 주세요」다. 첫머리만 보는 까닭은, 그 뒤의 같은 글자는 claude 가 띄운 내용일 수 있어서다. 셸만 남은 세션은 이미 「실행 중」으로 세지 않는다(포그라운드가 셸이라 `busy` 가 거짓).

## 보류한 것 — 제목 글리프 대체 (#orca-title-glyph)

Orca 의 `agent-title-status.ts` 를 읽었다. Claude 의 규칙은 두 가지다. 창 제목이 `✳ ` 로 시작하면 쉬는 중, 점자(U+2800–28FF)나 사분원(U+25D0–25D3) 스피너가 있으면 일하는 중이다. 이 대체 경로를 들이지 않고 보류한 까닭은 둘이다.
- Claude Code 는 2.1.295 부터 OSC 7501 을 보내므로 옛 판에만 쓸모가 있다.
- 셸이 창 제목을 바꾸지 않으면, claude 가 끝난 뒤에도 「작업 중」이 낡은 채로 남는다. Orca 는 「셸 제목이 오면 끝난 것」으로 지우는데, 그 셸 제목이 없는 경우가 흔하다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 77개 · 테스트 918개 통과, lint · build exit 0. `terminal_launch_check.test.ts` 6개는 셸 다섯의 말과 오탐 셋(claude 화면 · claudex · 다른 명령)을 본다.