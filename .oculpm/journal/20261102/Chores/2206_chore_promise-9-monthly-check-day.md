---
schema_version: 1
type: chore
slug: "promise-9-monthly-check-day"
status: done
difficulty: low
created_at: "2026-11-02T22:06:35+09:00"
session_id: "20261102-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/PROMISE.md"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "scripts/bump-version.mjs"
    op: update
  - path: "src/__tests__/bump_version.test.ts"
    op: update
related: []
tags:
  - "약속"
  - "promise"
  - "release"
  - "mcp-tool"
---
[x] 약속: 사람의 확인을 한 달에 한 번으로 고쳤다

## 무엇을 했나
PROMISE 약속 9 를 고쳤다. 옛 문구는 「위 1~8 을 릴리스마다 사람이 확인한다」였다. 그런데 마이너 셋(4.1.0 · 4.2.0 · 4.3.0)이 내리 확인 날을 건너뛰었고 눈 확인이 25건 쌓였다. 지키지 못할 약속을 적어 두는 대신 지킬 수 있는 주기로 바꿨다(사용자 결정 11-02, 계획 `direction-20261102` `#promise-9`).
- `docs/PROMISE.md`
  - 약속 9: 한 달에 한 번 확인 날에 사람이 설치본으로 확인한다. 릴리스마다 지키는 것은 기계(CI · 설치 스모크 · 실제 앱 E2E)다. 31일을 넘기면 `bump-version` 이 알린다.
  - 「약속을 지키는 장치」 표의 9번 줄을 고쳤다.
  - 「확인 날 기록」 절을 새로 만들었다. 줄 모양은 `- 확인 날 YYYY-MM-DD — 본 판 · 닫음 · 이월 · 걷음` 이고, 아직 기록은 없다. 첫 확인 날은 11월 첫 주 `#eyes-batch` 다.
- `docs/RELEASE.md` §0-2
  - 확인 날을 마이너와 떼어 한 달에 한 번으로 바꿨다. `[>]` 이월, `[-]` 걷음, 기록에 한 줄 더하기를 적었다.
  - 경고 설명도 바꿨다(판의 종류와 무관).
- `scripts/bump-version.mjs`
  - `isMinorBump` 을 걷었다(쓰는 곳 0).
  - `lastCheckDay`(줄 머리 `- 확인 날 YYYY-MM-DD` 만 센다 — 문단 안 백틱 예시는 세지 않는다)와 `daysBetween` 을 더했고, `CHECK_DAY_EVERY = 31` 을 두었다.
  - 이제 모든 bump 에서 확인 날이 31일을 넘거나 없으면 그 날짜와 eyes 건수를 경고한다. 막지는 않는다.

## 검증
- `bump_version.test.ts`: 11 passed. 줄 머리 기록만 읽음(들여쓴 줄 · 백틱 예시 제외), 31일 경계, 실제 PROMISE.md 의 절 · 문구를 확인했다.
- `node scripts/bump-version.mjs 4.3.2 --dry-run`: 「마지막 확인 날이 기록에 없습니다 … eyes 26건」 경고가 패치에서도 떴고, 파일 변경은 0 이었다(`git status`).
- `pnpm test` 1009 passed · typecheck · lint · build 0.