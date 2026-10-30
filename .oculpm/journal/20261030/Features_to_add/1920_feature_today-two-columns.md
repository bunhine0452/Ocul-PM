---
schema_version: 1
type: feature
slug: "today-two-columns"
status: done
difficulty: medium
created_at: "2026-10-30T19:20:05+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/today.css"
    op: update
  - path: "src/features/terminal/race.css"
    op: update
related: []
tags:
  - "오늘"
  - "layout"
  - "density"
  - "mcp-tool"
---
[x] 오늘: 넓은 창에서 두 칸으로 빈 곳을 줄인다

## 추가 기능

사용자 요청(10-30): 「화면에 빈 공간이 있는 부분들을 찾고 줄여 줘」. 하네스로 여섯 화면을 1440×900 에서 찍어 훑었다.

- **오늘:** 820px 한 기둥이라 양옆이 300px 씩 비었다. **두 칸으로 바꿨다.**
- **터미널 레인 띠:** 단추가 줄 끝으로 밀려 가운데가 비었다. **단추를 크기 바로 뒤로 옮겼다.**
- **일지 · 변경:** 폭을 다 쓴다. 그대로 둔다.
- **계획 · 설정:** 읽기 폭 제한이다. 그대로 둔다.

오늘의 두 칸:
- 왼쪽은 해야 할 것: 먼저 볼 것 · 다음 · 내 차례 · 지금 일하는 중.
- 오른쪽은 기록: 검증 없이 끝난 일지 · 오늘 한 일.
- 옛 오른쪽 칼럼(계획 카드, 계획 탭을 되풀이해 걷음)은 돌아오지 않는다. 있던 카드를 옮겼을 뿐이다.

## 동작 흐름

- **접힘:** `flex-wrap` 으로 한다(왼쪽 basis 520 · 오른쪽 380). 셸의 「접힘 선은 640/460 한 벌, 세 번째 숫자 금지」 규칙 때문에 컨테이너 질의 숫자를 새로 고르지 않았다.
  - 처음 basis 480/340 은 960 창에서 두 칸이 되어 시간 칸이 두 줄로 꺾였다. 그래서 올렸다.
- **오른쪽이 빌 때:** 기록이 없으면(`hasSide` 거짓) 예전처럼 820px 한 기둥으로 선다(`.tdy-body.is-two` 일 때만 1180).
- **키보드 순번:** `TodayExceptions` 에 `part`(first · unread)를 더해 두 칸에 나눠 그린다. 순번은 같은 `split` 으로 계산해 j/k 가 두 칸에서도 이어진다.

## 검증

- 하네스 측정:
  - 1440: 두 칸, 양옆 여백 300 → 130.
  - 1100: 596 · 430.
  - 960: 한 칸 902, 오른쪽 묶음이 아래로 온다.
- `today_v4.test.tsx` · `today_num.test.tsx` → 19 passed(구조를 바꿨지만 행동 테스트는 그대로 통과).
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 969 passed · `pnpm lint` 0 · `pnpm build` 0
  - rust passed 1165 failed 0