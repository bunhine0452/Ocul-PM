---
schema_version: 1
type: error
slug: "e2e-start-steps-selector-gone"
status: done
difficulty: low
created_at: "2026-10-29T22:45:03+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/scenario.mjs"
    op: update
related:
  - ref: "20261029/Features_to_add/2223_feature_tour-first-run-guide.md"
    kind: "followup"
tags:
  - "e2e"
  - "tour"
  - "start"
  - "mcp-tool"
---
[x] E2E 가 걷은 시작 창 세 단계 칸을 60초 기다리다 실패 — 새 흐름으로 고침

## 발생 원인

PR #125 의 E2E 두 잡(Windows · Linux)이 첫 단계 「기동 — 세션 생성 · 첫 화면」에서 실패했다. 오류는 「시작 창(빈 데이터 폴더) — 60초 안에 안 됐다 (마지막 값: null)」였다. `e2e/scenario.mjs` 가 시작 창을 `.start .start-steps` 로 알아봤는데, 이번에 그 칸을 처음 쓰는 법 안내로 바꿔 걷었다(#tour-retire). 다음 단계도 세 단계의 버튼(`.start-steps > li:nth-child(n)`)을 눌렀다. 단위 테스트 · 린트 · 빌드는 이 시나리오 파일을 읽지 않아서 로컬에서는 잡히지 않았다.

## 해결 방법

- 시작 창은 `.start .start-card` 로 알아본다.
- 처음 쓰는 법이 4초 안에 뜨면 찍고 「건너뛰기」로 닫는다. 그다음 `settings_set tour_seen=1` 을 적는다. 창이 뒤에 있으면 처음 앞에 올 때 뜨는데, 그러면 뒤 단계의 클릭을 가로막기 때문이다.
- 「시작 창 폴더 열기 → 픽스처 프로젝트 → 이 창이 그 프로젝트가 된다」로 바꿨다. `.start-card-head .btn` 한 번을 누르고, 프로젝트 셸(윗줄)과 `.oculpm/` 생성(프로젝트 창의 oculpmInit)을 본다.

## 검증

- CI 로그(E2E Windows job 123474393327)에서 실패 자리를 확인했다.
- `node --check e2e/scenario.mjs` 통과, `pnpm test` → 912 passed. E2E 자체는 PR #125 의 새 run 이 본다.