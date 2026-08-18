---
schema_version: 1
type: bug
slug: "space-during-composition-repeats-char"
status: done
difficulty: superhigh
created_at: "2026-08-19T07:55:00+09:00"
session_id: "manual-20260819-075500"
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
related:
  - ".oculpm/journal/20260818/Bugs/2011_bug_hangul-doubles-on-composing-backspace.md"
  - ".oculpm/journal/20260819/Bugs/0724_bug_ime-cursor-keys-stale-baseline.md"
tags: ["terminal", "ime", "hangul", "race", "claude-code"]
---

[x] 조합 중 스페이스가 이전 글자를 반복시키던 것 — xterm 이 브리지 밖에서 끼어들었다

## 발생 원인

사용자 제보: 앱 터미널에서 Claude Code 를 쓰며 한글을 치다 **스페이스를 누르면
이전 글자가 반복**된다. v2.13.1 의 조합 중 Backspace 수정과 증상이 닮았지만
다른 경로였다.

실측 트레이스(oculpm.log 2026-08-18, ime 이벤트 237건)를 재구성해 확인한 사실:

1. 그 세션의 바이트 스트림 자체는 정상이었다 — 재생하면
   `안녕하세요 지금은 오류가 안뜨는것 같아여` 가 그대로 나온다. 즉 느리게 치면
   재현되지 않는 **타이밍 의존** 결함이다.
2. IME 의 **내용을 바꾸는 교체 input** 은 keydown 보다 60~250ms 늦게 온다
   (실측 최대 242.7ms: `침여`→`침ㅇ`, 228.5ms: `안뜨`→`안뜬`).
3. 반면 스페이스는 `keydown → input` 순서이고, xterm 의 `_keyDown` 은 그
   keydown 에서 **동기적으로** PTY 에 쏜다 (minified 번들에서 경로 확인:
   커스텀 핸들러 → compositionHelper → `triggerDataEvent`).

그래서 (2)의 지연 창 안에 스페이스를 치면 순서가 뒤집힌다:

```
echoed="드"                    PTY 줄: "드"
keydown ' ' → xterm 이 즉시 전송  PTY 줄: "드 "    ← 브리지 밖에서 끼어든다
input "든 " (뒤늦은 교체분)      → echoed="드" 기준 DEL+"든 "
PTY 줄: "드 " -DEL→ "드" +"든 " = "드든 "          ← 이전 글자가 남는다
```

조합 글자를 되돌리려던 DEL 이 방금 나간 **스페이스**를 지운다. 부기 버그가
아니라 **소유권** 문제였다 — 조합이 열린 동안 PTY 로 나가는 바이트가 두 경로
(xterm keydown / 브리지 syncEcho)로 갈라져 순서 보장이 깨졌다.

## 해결 방법

조합이 열려 있는 동안(`echoed !== ""`)의 인쇄 가능 키는 xterm 에게 넘기지 않고
**브리지가 소유**한다 (`bridgeOwnsKey`). keydown 에서 false 를 돌려주면 xterm 은
보내지도 preventDefault 하지도 않고, 뒤이어 올 IME 의 input 이 `syncEcho` 를
타고 교체분 **뒤에** 나가 순서가 보장된다. 모든 바이트가 한 경로를 지난다.

- keydown 에서 preventDefault 를 안 하므로 keypress 가 뒤따를 수 있다 → 같은
  글자를 xterm 이 또 보내지 않도록 `ownedKeydown` 으로 막는다. `echoed` 로 다시
  판정하지 않는 건 그 사이 input 이 먼저 와 세션이 끝났을 수 있어서다.
- Enter·Tab·화살표 등은 `key.length > 1` 이라 걸리지 않고 종전대로 xterm 이
  보낸다(셸에 CR 이 반드시 가야 한다). 조합이 없을 때(`echoed === ""`)도 종전
  경로 그대로 — v2.13.0 의 "두 번 찍힘" 수정이 유지된다.

## 검증

- 회귀 4건 추가: 지연 교체분이 스페이스를 먹는 경합(단일/분할 도착), keypress
  이중 전송 차단, 조합 없을 때 스페이스 1회. 수정 전 `'드든 '` → 수정 후 `'든 '`.
- 기존 테스트가 "xterm 이 스페이스를 보낸다"를 **가정만** 하고 있어(term.input
  목) 이 경로가 통과했다 — 하네스에 xterm 전송까지 합친 `stream` 을 추가해
  PTY 가 받는 순서 그대로 검증하도록 바꿨다.
- 실제 8/18 트레이스를 새 로직으로 재생 → 결과 동일(회귀 없음).
- typecheck/test(21)/lint/build + cargo test 5대 게이트 exit 0.

## 메모

릴리스 빌드는 TRACE 가 꺼져 있어(`import.meta.env.DEV`) 사용자 재현 로그를 얻을
수 없었다. 이번엔 8/18 개발 세션 트레이스의 **타이밍 분포**로 경합 가능성을
입증했지만, 다음에 IME 문제가 또 오면 릴리스에서도 켤 수 있는 진단 스위치가
있어야 한다 (후속 후보).
