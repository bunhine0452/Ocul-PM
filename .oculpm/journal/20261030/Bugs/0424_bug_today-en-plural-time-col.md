---
schema_version: 1
type: bug
slug: "today-en-plural-time-col"
status: done
difficulty: low
created_at: "2026-10-30T04:24:44+09:00"
session_id: "20261030-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/todayFormat.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/__tests__/today_num.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - ref: "20261018/Bugs/0114_bug_terminal-tiny-fit-and-webgl-release.md"
    kind: "followup"
tags:
  - "i18n"
  - "today"
  - "en"
  - "mcp-tool"
---
[x] 영어 오늘 머리 「{n|entry|entries}」 · 시간 칸 꺾임

## 증상

랜딩 리디자인에 쓸 앱 화면을 영어로 찍다가 두 가지를 봤다.
- 오늘 화면 머리가 「34 {n|entry|entries}」로 그려졌다. 4.0 에서 넣은 단수/복수 문법이 풀리지 않은 채 나왔다.
- 「검증 없이 끝난 일지」 행의 시간 칸이 「yester / day」로 낱말 가운데서 꺾였다.

## 원인

- `Num`(`features/today/todayFormat.tsx`)이 숫자만 굵게 하려고 `t(k)` 를 **값 없이** 받아 `{n}` 에서 갈랐다. `interpolate` 는 값이 없으면 자리표시자와 단수/복수 갈래를 그대로 남긴다. 그래서 한국어 「기록 {n}건」은 멀쩡했고, 영어 「{n} {n|entry|entries}」만 깨졌다.
- `.tdy-time` 이 고정 40px 이었다. 「어제 21:08」은 두 줄로 들어가지만 「yesterday」는 그 폭에 들어가지 않고, 본문의 `overflow-wrap: anywhere` 를 물려받아 낱말 안에서 끊겼다.

## 수정

- `Num`: `t(k, { n })` 로 값을 넣어 받은 문장을, 그 수가 처음 나오는 자리에서 가른다. 수가 없으면 문장만 그린다.
- `.tdy-time`: 폭을 `5em` 으로 바꾸고 `overflow-wrap: normal; word-break: keep-all` 을 줬다.

## 검증

- 새 테스트 `src/__tests__/today_num.test.tsx`: 영어 34 → 「34 entries」, 1 → 「1 entry」(굵은 글자는 수만), 한국어 「기록 58건」.
- `pnpm vitest run src/__tests__/today_num.test.tsx src/__tests__/today_v4.test.tsx` → Tests 19 passed
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → typecheck 0 · Tests 946 passed · lint 0 · build 0. lint:i18n 허용 목록에 새 테스트를 넣었다(픽스처 한글).
- 하네스(영어 · 어두운 테마)로 다시 찍어 「34 entries」와 「yesterday / 21:08」을 눈으로 확인했다.