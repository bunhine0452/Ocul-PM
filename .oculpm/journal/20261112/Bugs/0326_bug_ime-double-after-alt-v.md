---
schema_version: 1
type: bug
slug: "ime-double-after-alt-v"
status: done
difficulty: medium
created_at: "2026-11-12T03:26:00+09:00"
session_id: "9d4f1e46-b6ae-4587-878b-58718e0f6a47"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/features/terminal/imeTrace.ts"
    op: update
  - path: "src/__tests__/ime_bridge.test.ts"
    op: update
  - path: "src/__tests__/ime_trace.test.ts"
    op: update
related:
  - ".oculpm/journal/20261111/Chores/2310_chore_ime-trace-pty-write.md"
tags:
  - "터미널"
  - "한글"
  - "windows"
---
[x] 터미널: Alt+V 뒤 한글이 두 번 찍히지 않는다

## 발생 원인
사용자가 조건을 짚었다(11-12): 모든 칸이 아니라 **Alt+V 를 누른 그 칸**에서만, claude 가 아니라 셸에서도 「방방금금」 처럼 음절마다 두 번 찍힌다.

설치본 `oculpm.log.2026-11-11` 의 자동 덤프가 앞뒤를 보여 준다. 22:46 덤프에서 「넣어주고,」 까지는 표준 조합 모델(compositionstart/update/end + `insertCompositionText`)이다. 그 뒤 `keydown Alt(18)` 가 두 번 찍히고, 'v' 의 keydown 은 DOM 에 오지 않는다. 22:58 덤프(같은 칸)에서는 조합 이벤트가 0건이다. `keydown Process(229)` 몇 번 뒤에 `input insertText "디"` 로 완성 음절이 통째로 온다. 입력기가 그 textarea 에서 인라인 조합을 놓은 것이다.

그 덤프에서 브리지는 「디」 를 한 번만 보냈다. PTY 로 가는 길 가운데 남은 것은 xterm 의 keypress 하나다. 229 keydown 은 브리지가 막고, input 은 브리지가 가로챈다. keypress 는 트레이스에 적지 않아 덤프에 보이지 않았다. xterm 의 `_inputEvent` 에는 `_keyPressHandled` 면 input 을 버리는 가드가 있다. keypress 와 input 이 같은 글자를 둘 다 싣는 경로를 위한 것인데, 브리지가 input 을 가로채면서 그 가드는 함께 오지 않았다. keypress 가 오는 것을 직접 본 것은 아니다. 다음 덤프에서 확인한다.

덤프가 쓸모없었던 이유도 하나 있었다. 백엔드 `oculpm_log` 가 메시지를 8KB 에서 자른다(2026-08-30). 400건 덤프(30~45KB)는 뒤쪽이 잘렸다. 덤프를 부른 재현 순간이 바로 그 뒤쪽이다. 11-11 의 자동 덤프 일곱 개가 모두 「… (+3만 bytes)」 로 끝났다.

## 해결 방법
- `imeBridge.ts`: 한글(자모·완성형) keypress 는 xterm 에 넘기지 않는다. 한글은 브리지(input)만 보낸다. 막을 때 preventDefault 를 하지 않으므로(커스텀 핸들러가 false 면 xterm 은 cancel 전에 돌아간다) 글자는 textarea 에 들어가 input 으로 온다. 잃지 않는다. keypress 도 입력 기록 링에 적는다.
- `imeTrace.ts`: 덤프를 7.6KB 아래 조각으로 나눠 보낸다. `[IME-DUMP` 머리는 첫 조각만 단다. 이어지는 조각은 `[ime-dump <사유>] (2/5)` 로 연다.

## 검증
- 새 시험 2건(keypress 먼저 · input 먼저)이 수정 전 `2 failed | 36 passed`, 수정 후 `vitest run ime_bridge ime_trace terminal_resize_webgl` → `Tests 50 passed (50)`
- `pnpm test` → `Tests 1098 passed (1098)` · `pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm build` exit 0
- 실기기 미확인: 설치본에서 Alt+V 뒤 한글을 쳐 봐야 한다. 그때 ⌃⌥⇧I 덤프에 keypress · pty-write 줄이 있어야 원인이 맞다.

## 메모
'v' keydown 이 DOM 에 오지 않으니 앱 터미널에서는 Alt+V(Claude Code 의 이미지 붙여넣기)도 claude 에 닿지 않을 것이다. 확인하지 않았다.
