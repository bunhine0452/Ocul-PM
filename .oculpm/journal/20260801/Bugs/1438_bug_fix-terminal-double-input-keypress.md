---
schema_version: 1
type: bug
slug: "fix-terminal-double-input-keypress"
status: done
difficulty: high
created_at: "2026-08-01T14:38:12+09:00"
session_id: "mcp-20260801-143812"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_bridge.test.ts"
    op: create
related: []
tags:
  - "terminal"
  - "ime"
  - "xterm"
  - "input"
  - "mcp-tool"
---
[x] 터미널에서 영문·스페이스가 두 번 입력되던 문제 — 억제한 keydown 뒤로 keypress 가 샜다

내장 터미널에서 영문과 스페이스가 한 번 누를 때마다 두 번씩 입력됐다. 한글은 정상이었다.

## 발생 원인

IME 브리지는 WKWebView 의 입력 모델(조합 이벤트 없이 `input` 만으로 조합 진행, `input` 이 `keydown` 보다 먼저 도착)에 맞춰, `input` 에서 글자를 PTY 로 보내고 뒤따르는 keydown 에서는 커스텀 키 핸들러가 `false` 를 돌려줘 xterm 이 같은 글자를 또 보내지 못하게 막고 있었다.

그런데 xterm `_keyDown`(node_modules/@xterm/xterm/src/browser/Terminal.ts:1005)은 커스텀 핸들러가 `false` 면 **그 자리에서 return** 한다 — 정상 경로 끝의 `cancel(event)`(= `preventDefault`)에 도달하지 못한다. 기본 동작이 살아 있으니 브라우저가 `keypress` 를 마저 쏘고, `_keyPress`(같은 파일 1120)가 커스텀 핸들러를 다시 통과시킨 뒤 **같은 글자를 한 번 더** `triggerDataEvent` 로 보낸다.

즉 억제가 keydown 에만 걸리고 keypress 로 그대로 샜다. 한글이 멀쩡했던 건 조합 키가 keyCode 229 라 애초에 keypress 를 만들지 않기 때문이고, 영문·스페이스가 걸린 건 **한글 입력기가 영문 모드일 때도 ASCII 가 IME 를 거쳐** `input` 이 먼저 오기 때문이다. 조합을 확정시키는 스페이스도 같은 경로다.

## 해결 방법

- 억제할 때 브리지가 직접 `event.preventDefault()` 한다 — keypress 발생과 textarea 재삽입을 원천 차단.
- 조합 중인 키(`keyCode 229` / `isComposing` / `key === "Process"`)는 예외. preventDefault 하면 IME 가 조합을 이어가지 못한다. 어차피 keypress 를 만들지 않는다.
- 엔진 차이로 keypress 가 그래도 오는 경우를 대비해 `suppressKeypress` 로 한 번 더 끊는다.
- `inputSinceKeydown` 불리언을 `lastInputAt` 타임스탬프(100ms 창)로 교체. keydown 없이 끝난 input(마우스 클릭 조합 확정·받아쓰기)의 플래그가 남으면, preventDefault 가 붙은 지금은 **다음 키를 통째로 삼킨다**. 기존에는 keypress 가 우연히 되살려 주고 있어 드러나지 않던 함정이다.
- 헤더 주석의 "일반 영문 타이핑은 input 이 발생하지 않는다" 전제를 실제 동작(입력기 영문 모드에서는 발생)으로 정정.

## 검증

- `src/__tests__/ime_bridge.test.ts` 신규 6건 — 스텁 Terminal 에 실제 핸들러를 붙여 WKWebView 이벤트 순서를 재현한다. 영문/스페이스 억제(+preventDefault), 조합 키 preventDefault 금지, input 없는 일반 타이핑은 xterm 위임, 오래된 input 플래그가 다음 키를 삼키지 않음, Enter 위임.
- 수정을 되돌리면 영문·스페이스 2건이 실패함을 확인 — 회귀 테스트가 실제로 이 버그를 잡는다.
- 게이트 전부 exit 0: typecheck / test(50 files, 606) / lint / build.
- 남은 한계: 실제 WKWebView + IME 조합 렌더링은 jsdom 으로 검증할 수 없다. 앱에서 한/영 전환 타이핑으로 최종 확인 필요.