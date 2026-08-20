---
schema_version: 1
type: bug
slug: "stale-commit-echo-recurrence"
status: done
difficulty: high
created_at: "2026-08-20T21:24:00+09:00"
session_id: "manual-20260820-212400"
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
  - ".oculpm/journal/20260819/Bugs/0920_bug_stale-commit-echo-repeats-syllable.md"
  - ".oculpm/journal/20260819/Bugs/0755_bug_space-during-composition-repeats-char.md"
  - ".oculpm/journal/20260820/Chores/2125_chore_ime-trace-ring-buffer.md"
tags: ["terminal", "ime", "hangul", "recurrence", "claude-code"]
---

[x] 스페이스 뒤 앞 음절이 다시 찍히던 것 — v2.13.3 뒤에도 남아 있던 두 경로

## 발생 원인

제보: "아직도 터미널에 스페이스바 치면 이전 한글이 다시 나와." 설치된 앱이
v2.13.3(= 이 증상을 고친 버전)임을 확인했으므로 **같은 증상의 재발**이다.

v2.13.3 은 "확정 직후 입력기가 비워진 버퍼에 올린 잔여 조합"을 판별해 버리도록
했다(`isStaleCommitEcho`). 그 판별에 구멍이 둘 있었고, 둘 다 **확정과 잔여분
사이**에서 벌어진다.

**(1) 빈 input 한 건이 판별 근거를 지웠다.**

확정 처리는 방금 내보낸 문자열을 `lastCommitted` 에 적어 두고, 잔여분이 오면 그
꼬리와 대조한다. 그런데 적는 자리가 `if (!value || 조합 아님)` 블록 안이라
**`value` 가 빈 문자열일 때도 덮어썼다.** 확정 직후 입력기가 버퍼를 한 번
비우고 나서 잔여분을 올리면:

```
input "안녕 " → 확정, lastCommitted="안녕 "
input ""      → lastCommitted="" 로 덮임          ← 근거 소실
input "녕"    → "".endsWith("녕") = false → 전송 → "안녕 녕"
```

**(2) 잔여분이 확정한 공백까지 끌고 오면** 값이 `"녕 "` 이 되는데, 판별 첫
관문이 `isComposable(value.slice(-1))` 이라 꼬리가 공백이면 **대조를 시작조차
못 하고** 통과했다.

## 해결 방법

- 빈 값으로는 확정 기록을 덮지 않는다. 단 **지울 것이 있었던**(`had !== ""`) 빈
  값은 진짜 삭제이므로 그대로 기록한다 — 그 구분이 없으면 이번엔 반대로 멀쩡한
  입력을 잔여분으로 오인해 삼킨다.
- 판별 전에 꼬리 공백을 떼고 본다(`TRAILING_SPACE`, NBSP 포함).

두 수정 모두 판별을 **넓히는** 쪽이라, 오히려 정상 입력을 삼킬 위험이 는다.
그래서 "확정 뒤 새 조합(낱자)은 통과" · "영문/기호는 대상 아님" · "빈 값이 진짜
삭제일 때는 기록 갱신" 세 개의 반대 방향 테스트로 양쪽을 함께 묶었다.

## 검증

회귀 2건이 **수정 전 실제로 붉게 나는 것**을 확인했다 (수정을 되돌려 재실행 →
두 건 fail, 산출 문자열 `"안녕 녕"`). 반대 방향 1건 추가. ime_bridge 28건,
전체 vitest 1038건, typecheck/lint/build 통과.

## 메모

**세 번째로 트레이스 없이 고쳤다.** 릴리스 빌드에 진단이 없어 이번에도 코드
독해로만 경로를 좁혀야 했고, 위 두 경로가 제보자의 실제 경로인지는 **증명하지
못했다** — 증상과 맞는 구멍을 막았을 뿐이다. 같은 일을 네 번째로 반복하지
않으려고 이번 라운드에 진단 장치를 함께 넣었다
([2125_chore_ime-trace-ring-buffer](../Chores/2125_chore_ime-trace-ring-buffer.md)).
다음에 또 새면 그때는 트레이스로 시작한다.
