---
schema_version: 1
type: chore
slug: "ime-trace-ring-buffer"
status: done
difficulty: medium
created_at: "2026-08-20T21:25:00+09:00"
session_id: "manual-20260820-212500"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeTrace.ts"
    op: create
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_trace.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ".oculpm/journal/20260820/Bugs/2124_bug_stale-commit-echo-recurrence.md"
  - ".oculpm/journal/20260819/Bugs/0920_bug_stale-commit-echo-repeats-syllable.md"
tags: ["terminal", "ime", "diagnostics", "claude-code"]
---

[x] 릴리스 빌드에서도 도는 IME 입력 추적 — 링 버퍼 + 요청 시 덤프

터미널 한글 입력 버그가 네 번 재발했는데(v2.13.1·2·3, 그리고 오늘) 매번 제보
상황의 트레이스 없이 코드 독해로만 고쳤다. 2026-08-19 일지가 이 공백을
"다음 라운드 최우선 후속"으로 남겼고, 그 후속이다.

## 무엇을 만들었나

기존 `TRACE` 는 `import.meta.env.DEV` 라 릴리스에서 한 줄도 안 남는다. 그렇다고
그 로그를 켤 수도 없다 — `oculpmLog` 는 호출마다 IPC 를 타는데 이 버그는 **입력
경로가 빨라야만 열리는 경합**이라(v2.13.3 일지: dev 에서는 재현 안 됨) 로그를
켜는 순간 재현이 사라진다. **진단이 관측 대상을 바꾸는** 종류다.

그래서 관측 비용을 재현 시점에서 덤프 시점으로 옮겼다.

- `imeTrace.ts` — 400칸 링 버퍼. 쌓을 때는 배열 한 칸 쓰기뿐이고 **문자열
  포매팅도 직렬화도 IPC 도 없다.** 포매팅은 덤프할 때 한 번에.
- 덤프는 한 덩어리로 **한 번** 나간다 (건별 IPC 면 덤프 자체가 수백 왕복).
- `⌃⌥⇧I` — 사용자가 이상 동작 직후 눌러 그때까지의 흐름을 저장한다.
- **자동 덤프** — 잔여분 판별을 빠져나갔는데 값의 모양이 잔여분이면
  (완성형 음절만으로 이루어진 값) 그 자리에서 링을 통째로 남긴다. 판별을
  좁게 잡는 것이 핵심이다: "확정 직후"라는 조건만으로는 **낱말 사이마다**
  걸린다(스페이스 뒤 새 조합의 첫 낱자). 새 조합은 언제나 낱자로 시작하므로
  완성형만 든 값은 정상 타이핑의 첫 input 으로 오지 않는다.

## 검증

`ime_trace.test.ts` 4건 — 쌓는 동안 로그 0건(경합을 안 바꾼다는 계약) · 덤프는
1회 호출로 전부 · 덤프 뒤 비워짐 · 링을 넘겨도 최근 400건만 남고 안 터짐.
전체 vitest 1038건, typecheck/lint/build 통과.

## 메모

로그 문자열은 영어로 뒀다 — `oculpm.log` 의 기존 줄(`[FLOW]` 등)과 같은 결이고,
i18n 사전을 거칠 표시 문자열이 아니다.
