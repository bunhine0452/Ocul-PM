---
schema_version: 1
type: bug
slug: "fix-terminal-paste-double-send"
status: done
difficulty: medium
created_at: "2026-08-01T15:37:27+09:00"
session_id: "mcp-20260801-153727"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_bridge.test.ts"
    op: update
related: []
tags:
  - "terminal"
  - "ime"
  - "xterm"
  - "paste"
  - "mcp-tool"
---
[x] 터미널 붙여넣기가 두 번 들어가고 개행이 날것으로 셸에 나가던 문제

직전 라운드에서 "확인 필요"로 남겨둔 붙여넣기 중복을 실제 트레이스와 xterm 소스로 확정하고 고쳤다.

## 발생 원인

xterm 5.5 의 `handlePasteEvent`(browser/Clipboard.ts)는 `stopPropagation()` 만 하고 **`preventDefault()` 를 하지 않는다.**

1. `paste` 이벤트에서 xterm 이 텍스트를 `prepareTextForTerminal`(개행 → CR) + `bracketTextForPaste`(bracketed paste 로 감쌈) 처리해 PTY 로 보낸다 — 1차 전송.
2. 기본 동작이 취소되지 않으니 브라우저가 같은 텍스트를 textarea 에도 꽂는다.
3. 그 결과 `input inputType="insertFromPaste"` 가 IME 브리지로 올라오고, 브리지가 `syncEcho` 로 **또 보낸다** — 2차 전송.

2차가 단순 중복보다 나쁘다. 트레이스(`oculpm.log`)에서 `data` 는 개행 0개인데 `textarea` 값에는 **개행이 327개**(05:31:07 건, 3948자) 있었다. 브리지 경로는 bracketed paste 로 감싸지 않고 개행 변환도 하지 않으므로, 그 개행이 그대로 셸에 들어가면 **각 줄이 명령으로 실행된다.**

xterm 자신의 `_inputEvent` 는 `inputType === 'insertText'` 만 처리해 붙여넣기를 무시한다 — 이중 전송의 두 번째 발신자는 오직 브리지였다.

## 해결 방법

`onInput` 에서 `insertFromPaste` 를 전송 대상에서 제외하고 세션만 정리한다(`endSession()` — 붙여넣기 잔재가 다음 조합의 diff 기준에 섞이지 않게). 붙여넣기는 bracketed paste·개행 변환까지 갖춘 xterm 경로가 온전히 맡는다.

## 검증

- 회귀 테스트 추가 — 여러 줄 `insertFromPaste` 에 대해 브리지 전송 0건, textarea 비움.
- 게이트 exit 0: typecheck / test(50 files, 611) / lint. 프로덕션 빌드는 태그 푸시가 `release.yml` 에서 수행한다.