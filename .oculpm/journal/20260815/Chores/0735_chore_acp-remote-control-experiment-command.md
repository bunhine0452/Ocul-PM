---
schema_version: 1
type: chore
slug: "acp-remote-control-experiment-command"
status: done
difficulty: low
created_at: "2026-08-15T07:35:05+09:00"
session_id: "mcp-20260815-073505"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/acpSlash.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "experiment"
  - "mcp-tool"
---
[x] /remote-control-acp — 한 번 시험해 보려고 둔 명령

## 호출부 없는 커맨드를 남겨 두지 않는다

`/rc` 를 터미널로 돌리면서 `acp_start_remote_control` 이 **아무도 안 부르는 커맨드**가 됐다. 그대로 두면 다음에 보는 사람에게 "이건 되나 보다"라는 거짓 신호다. 지우거나, 부르게 하거나 둘 중 하나여야 한다.

한 번은 시험해 볼 값이 있어 부르는 쪽을 골랐다 — 지난 실패는 **플래그가 잘못돼 있었기 때문**이지 길이 없어서가 아니었다. SDK 는 값이 `null` 일 때만 값 없는 플래그를 만드는데 `""` 을 보내서 `--remote-control` 뒤에 빈 인자가 붙었다. 그건 고쳤고, 그 상태로는 한 번도 안 눌러 봤다.

`/remote-control-acp` 로 뒀다. 이름을 길게 둔 이유는 **실수로 눌리지 않게** — `/rc` 는 확실히 되는 길(터미널)에 그대로 둔다.

## 결과를 볼 수 있게

앞 라운드에서 어댑터 stderr 를 앱 로그로 옮겼다. 짝짓기 안내가 화면에 안 뜨더라도 stderr 로 나갔다면 `[adapter]` 줄로 보인다 — 안내 문구가 그 경로(설정 → 진단 → 로그 폴더)를 알려 준다.

## 다음 갈래

- **뜬다** → `/rc` 를 이쪽으로 되돌릴지 판단(그래도 로그를 열어 링크를 옮겨야 한다면 터미널이 낫다).
- **안 뜬다** → 이 명령과 `acp_start_remote_control` 을 같이 지운다. 그때는 "불가능"이 아니라 **"해 보고 아니었다"** 로 적을 수 있다.

## 검증

typecheck 0 · 프런트 853 · lint 0 · build 0.