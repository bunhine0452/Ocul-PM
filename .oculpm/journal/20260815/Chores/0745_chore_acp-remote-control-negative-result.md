---
schema_version: 1
type: chore
slug: "acp-remote-control-negative-result"
status: done
difficulty: medium
created_at: "2026-08-15T07:45:54+09:00"
session_id: "mcp-20260815-074554"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src/features/chat/acpSlash.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "experiment"
  - "negative-result"
  - "mcp-tool"
---
[x] 원격 조종은 ACP 로 안 된다 — 해 보고 내린 결론과 그 근거

## 무엇을 해 봤나

`_meta.claudeCode.options.extraArgs` 로 `--remote-control` 을 넘기는 길. 어댑터가 그것을 SDK 질의의 `extraArgs` 로 흘리고, SDK 가 CLI argv 로 편다. 값은 `null` 이어야 값 없는 플래그가 된다(`""` 을 보내면 뒤에 빈 인자가 붙는다 — 첫 시도가 조용히 실패한 이유).

## 결과

- 세션은 **오류 없이 열린다** — 플래그가 거부되지는 않았다.
- 짝짓기 안내가 **대화에 안 뜬다.**
- 어댑터 **stderr 에도 없다.** 앱 로그에 `[adapter]` 줄이 단 하나도 안 찍혔다.

## 왜 그런가

그 안내는 CLI 가 **자기 대화형 화면에 그리는 것**이다. 프로토콜로 옮겨질 데이터가 애초에 없다. 통로를 못 찾은 게 아니라 옮길 것이 없는 것이다.

같은 이유로 stderr 로깅도 이 문제를 못 푼다. 그건 여전히 값어치가 있다(시작 실패 사유·플래그 불평은 거기 나온다) — 다만 화면에 그리는 것은 거기로도 안 온다.

## 그래서 지웠다

`acp_start_remote_control` 과 `/remote-control-acp` 를 함께 제거했다. **되지 않는 길을 코드로 남겨 두면 다음 사람에게 "이건 되나 보다"라는 거짓 신호**가 된다. 대신 실측 결과를 `/rc` 핸들러 주석과 이 일지에 남겨, 다음에 같은 생각을 하는 사람이 처음부터 시작하지 않게 했다.

`/rc` 는 터미널로 간다. 거기서는 CLI 의 화면이 곧 우리 화면이라 그냥 된다.

## 남긴 것

- 어댑터 stderr → 앱 로그. 이번엔 답을 못 줬지만 "아무 일도 안 일어난 것처럼 보이는" 다음 사건에서 처음으로 볼 곳이 생겼다.
- `_meta` 로 CLI 플래그를 넘길 수 있다는 사실 자체. 원격 조종에는 안 통했어도 다른 플래그에는 통한다.

## 검증

typecheck 0 · 프런트 853 · lint 0 · build 0 · 백엔드 전 스위트.