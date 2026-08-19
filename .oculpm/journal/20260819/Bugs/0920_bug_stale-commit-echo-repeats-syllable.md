---
schema_version: 1
type: bug
slug: "stale-commit-echo-repeats-syllable"
status: done
difficulty: superhigh
created_at: "2026-08-19T09:20:00+09:00"
session_id: "manual-20260819-092000"
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
  - ".oculpm/journal/20260819/Bugs/0755_bug_space-during-composition-repeats-char.md"
  - ".oculpm/journal/20260818/Bugs/2011_bug_hangul-doubles-on-composing-backspace.md"
tags: ["terminal", "ime", "hangul", "production-only", "claude-code"]
---

[x] 스페이스 뒤 앞 음절이 다시 찍히던 것 — 확정 직후 올라온 잔여 조합 (프로덕션 전용)

## 발생 원인

제보: "안녕" 뒤 스페이스를 치면 "안녕 녕". 같은 날 올린 v2.13.2 수정(조합 중
소유권)으로도 남아 있었고, **dev 빌드에서는 재현되지 않고 릴리스 빌드에서만**
났다.

dev/prod 차이를 전수로 좁히니 터미널 입력 경로엔 두 곳뿐이었다 — 이벤트마다
IPC 로그를 하는 `TRACE`(prod 에선 빈 함수로 컴파일됨)와 dev 전용
`React.StrictMode`. 둘 다 dev 를 **느리게** 만든다. 즉 오버헤드가 없는 빠른
빌드에서만 창이 열리는 타이밍 경합이었다. (빌드가 리터럴을 망가뜨렸을 가능성도
번들 바이트로 확인해 배제 — DEL 0x7f · NBSP 0xa0 · 한글 범위 모두 온전.)

경로:

```
echoed="안녕"  →  스페이스 확정  →  " " 전송 → endSession() 이 textarea 를 비움
입력기가 아직 확정분을 붙들고 있다  →  비워진 버퍼에 잔여분 "녕" 을 다시 올림
onInput: echoed="" 기준 → 되돌릴 것이 없으니 DEL 없이 "녕" 을 그대로 전송
화면: "안녕 녕"
```

v2.13.2 에서 고친 것과 **방향이 반대**다. 그건 스페이스가 너무 일찍 나가 뒤늦은
DEL 이 그 스페이스를 지운 문제였고, 이건 잔여분이 너무 늦게 올라와 새 입력으로
오인된 문제다. 그래서 앞 수정으로는 잡히지 않았다.

## 해결 방법

세션이 없는 상태(`echoed === ""`)에서 올라온 조합 잔여분은 **되돌릴 대상이
없으므로 정의상 stale** — 흘리지 않고 버리고 버퍼만 다시 비운다
(`isStaleCommitEcho`). 두 축으로 가린다:

1. `insertReplacementText` — 교체할 대상이 없는 교체.
2. 방금 확정한 문자열의 **한글 꼬리**와 같은 값 (예: "안녕 " 직후의 "녕").

오탐 방지: 새 조합은 언제나 **낱자**로 시작하므로(`ㄴ`) 완성형 음절이 첫 input
으로 오는 일이 정상 타이핑엔 없다. 한글이 아닌 값(영문·기호)은 아예 대상이
아니고, 판정 창은 확정 후 400ms 로 제한한다.

## 검증

회귀 4건 추가 — 잔여분(교체)·잔여분(insertText)·확정 뒤 새 낱자 통과·영문은
대상 아님. 수정 전 `"안녕 녕"` → 수정 후 `"안녕 "`. ime_bridge 25건,
전체 vitest 1003건, typecheck/lint/build + cargo test 통과.

## 메모

**릴리스 빌드에 진단 스위치가 없어 두 번 헛짚었다.** TRACE 가 DEV 전용이라
제보 상황의 트레이스를 못 얻고 과거 개발 세션의 타이밍 분포로 우회해야 했다.
게다가 이 버그는 그 TRACE 를 켜면 느려져 재현이 사라지는 종류라, 진단 스위치는
**IPC 가 아니라 메모리 버퍼에 모았다가 한 번에 비우는** 방식이어야 한다.
다음 라운드 최우선 후속.
