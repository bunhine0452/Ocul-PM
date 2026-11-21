---
schema_version: 1
type: feature
slug: "diff-all-clear-line"
status: done
difficulty: low
created_at: "2026-11-22T03:31:00+09:00"
session_id: "manual-20261122-031405"
agent:
  id: "claude-code"
  version: "Fable 5.2"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/ChangeFileList.tsx"
    op: update
  - path: "src/features/diff/changes.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/diff_all_clear.test.tsx"
    op: create
related: []
tags:
  - "변경-화면"
  - "diff"
  - "volume"
---
[x] 변경 화면: 볼 것이 없으면 한 줄로 말한다

## 추가 기능
변경 화면은 예외(일지 없는 변경 · 검증 없는 묶음)를 앞에 세우지만, 예외가 **없다**는 것은 말하지 않았다. 파일 200개가 일지 40건에 묶여 선 날, 「검증 없음」 이 하나도 없는지는 묶음 메타 40줄을 다 훑어야 알 수 있었다.

- 일지 없는 변경이 없고 모든 묶음에 검증이 섰으면 목록 머리에 회색 ✓ 한 줄 「볼 것이 없어요. 모든 변경이 일지에 있고 검증이 섰어요.」 가 선다.
- 일지 없는 변경이 하나라도 있거나, 검증 없는 묶음이 있거나, 묶음의 일지 요약을 못 읽었으면 서지 않는다. 못 읽은 것은 「없다」 가 아니라 「모른다」 다.
- 통과는 색으로 외치지 않는다(회색 ✓).

## 동작 흐름
1. `DiffScreenV2` 가 `allClear` 를 계산한다: 묶음을 알고(`buckets.known`) · 요약을 받았고(`entriesReady`) · 일지 없는 파일 0 · 검증 없는 묶음 0 · 모든 묶음의 요약이 지도에 있다.
2. `ChangeFileList` 가 목록 머리(커밋 · 「본 것 n/m」 줄 아래)에 그 한 줄을 그린다.

## 검증
- 파일 200 · 일지 40 픽스처 넷: 전부 검증이 서면 한 줄이 서고, 검증 없는 묶음 하나 · 일지 없는 파일 하나 · 요약을 못 읽음 각각에서는 서지 않는다.
- `npx vitest run src/__tests__/diff_` → `Tests  142 passed (142)`
- `npx tsc --noEmit` exit 0 · `node scripts/check-design-discipline.mjs` → `✓ design discipline: clean`
- 설치본에서 눈으로 보지는 않았다.
