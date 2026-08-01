---
schema_version: 1
type: bug
slug: "fix-terminal-double-input-echo"
status: done
difficulty: high
created_at: "2026-08-01T15:17:20+09:00"
session_id: "mcp-20260801-151720"
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
  - "input"
  - "mcp-tool"
---
[x] 터미널 영문·스페이스 이중 입력 재수정 — 실 트레이스 기반, 타이밍 추측 제거

직전 일지(1438)의 수정 이후에도 스페이스가 계속 두 번 입력돼, 추측을 멈추고 dev 빌드가 남긴 실제 IME 트레이스(`oculpm.log` 1237건)를 분석했다.

## 발생 원인

트레이스가 두 가지를 확정했다.

**1) 입력기가 켜져 있으면 ASCII·스페이스도 `input` 을 한 번 더 만든다 — 순서는 조합 키와 반대다.**

```
한글        input(insertText 'ㅏ')  → keydown key='ㅏ' code=229
ASCII·공백  keydown key=' ' code=32 → input(insertText ' ')
```

즉 스페이스는 xterm 이 keydown 에서 보내고, 브리지가 뒤이은 input 에서 또 보냈다(공백 44건 중 29건). 게다가 IME 가 textarea 에 넣는 공백은 U+00A0(NBSP)라 **셸에 NBSP 가 나가고 있었다.**

**2) 직전 수정의 100ms `handledByInput` 창은 위험했다.** 실측 연속 keydown 간격이 최소 0~7ms(5퍼센타일 27ms)라, 빠르게 치면 앞 키의 input 을 이 키의 것으로 오인해 preventDefault 까지 걸어 **멀쩡한 글자를 삼킨다.** 직전 일지가 지목한 keypress 누수는 구 빌드의 영문 이중 입력 경로로는 맞았지만(당시 `inputSinceKeydown` 불리언이 계속 참이라 억제 경로를 탔다), 스페이스에는 애초에 해당하지 않았고 시간 창 방식 자체가 잘못된 축이었다.

**3) `input→keydown` 287건은 전부 keyCode 229 였다.** 조합 여부는 타이밍 없이 결정적으로 판정할 수 있다.

## 해결 방법

판정 축을 둘로 나눴다.

- **keydown 억제는 `imeKey`(keyCode 229 / isComposing / "Process")일 때만.** 시간 창 기반 `handledByInput` 과 keypress 억제 로직을 전부 제거 — 글자를 삼킬 여지가 사라진다.
- **나머지는 에코 대조로 거른다.** xterm 에게 넘긴 키의 글자를 `xtermEchoes` 큐에 기록하고, 뒤늦게 같은 글자가 input 으로 올라오면 전송을 건너뛰고 부기(`echoed`)만 맞춘다. 큐로 둔 건 타이핑이 빠르면 keydown 두 개가 input 보다 먼저 몰릴 수 있어서다. 250ms 안에 짝이 없으면 버린다.
- **NBSP 정규화.** input 값을 부기 기준으로 삼기 전에 U+00A0 → 공백. 셸에 NBSP 가 나가지 않고, xterm 이 보낸 `' '` 와 에코 대조도 성립한다.
- **Backspace·Delete 도 세션을 끊는다.** xterm 은 셸에 지우라고 보내는데 textarea 는 그대로라 부기가 어긋난 채 계속 자랐다 — 트레이스에 30자 넘게 누적된 `echoed` 가 남아 있었고, 그 상태의 diff 는 DEL 개수를 틀리게 낸다.

## 검증

- `src/__tests__/ime_bridge.test.ts` 10건으로 확장 — 트레이스의 두 순서를 그대로 재현한다. 영문/스페이스 에코 차단, NBSP 정규화, 조합 키는 xterm 미위임, 에코와 다른 글자는 통과, 빠른 타이핑에서 삼키지 않음, Backspace 부기 리셋, ⌘ 조합은 에코 기록 제외.
- 게이트 전부 exit 0: typecheck / test(50 files, 610) / lint / build.
- 남은 확인: 실 WKWebView 에서 한/영 섞어 타이핑. 트레이스에 `insertFromPaste` 가 xterm 자체 paste 경로와 겹칠 소지가 보였으나 이번 범위 밖 — 붙여넣기 중복 여부는 별도 확인 필요.