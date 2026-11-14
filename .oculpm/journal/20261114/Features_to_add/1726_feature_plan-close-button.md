---
schema_version: 1
type: feature
slug: "plan-close-button"
status: done
difficulty: medium
created_at: "2026-11-14T17:26:37+09:00"
session_id: "20261114-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "b0484e51-1db3-430e-ae0e-a34545df4bb6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/plan.ts"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/planner_v4.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/__tests__/today_stale.test.ts"
    op: update
  - path: "src/__tests__/diff_receipt.test.ts"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261114/Features_to_add/1716_feature_journal-fold-gone.md"
    kind: "followup"
tags:
  - "계획"
  - "planner"
  - "today"
  - "mcp-tool"
---
[x] 계획: 남은 항목이 없으면 닫을 수 있다

## 추가 기능

사용자 결정(2026-11-14 「네 권장대로 갈게」): 계획 화면에 닫기 단추를 좁게 되살린다.

- 계획 화면의 「다음 할 일」 줄: 남은 항목(할 일 · 진행 중 · 막힘)이 0 이면 「계획 닫기」 가 선다. 닫으면 `status: done` 이 되어 끝난 계획으로 옮겨진다.
- 닫은 직후 알림에 「되돌리기」 가 달린다. 닫힌 계획은 잠겨서 에이전트도 못 고치므로, 잘못 눌렀을 때의 길이다.
- 오늘 화면: 「닫을 수 있는 계획 N개」 한 줄. 누르면 그 계획이 열린다. 여기서 닫지는 않는다.

되살리지 않은 것: `archived` 로 보내기, 묶어서 닫기, 닫힌 계획을 화면에서 다시 여는 단추(되돌리기는 알림에서만).

## 동작 흐름

1. `planner/lifecycle.rs` 에 문지기 `close_plan(md, date)` 와 `reopen_plan(md, date)`. 닫기는 미완 리프가 하나라도 있으면 `PlanCloseRefusal` 로 거부하고, 그것이 `AppError(plan_has_open_items)` 가 된다. 되돌리기는 `done` 인 계획만 `active` 로 돌린다. frontmatter 의 `status:` · `updated:` 두 줄만 바꾸고 줄바꿈(CRLF)은 지킨다.
2. 명령 `plan_close` · `plan_reopen` 은 계획 쓰기 잠금 아래에서 읽고 → 고치고 → 원자적으로 쓴 뒤 다시 투영한다.
3. 오늘 요약(`today_digest`)의 계획마다 `closable` 칸. 항목이 있고 남은 리프가 없을 때 참이다.

## 검증

- `pnpm test` 1117 passed · `pnpm typecheck` · `pnpm lint` · `pnpm build` exit 0
- `cargo test --locked` 1168 passed · 0 failed · clippy · fmt exit 0
- 새 테스트: 문지기 넷(거부와 항목 이름 · 본문 불변 · 되돌리기는 닫은 것만 · CRLF), 요약의 `closable` 하나, 계획 화면 둘(닫기 → 되돌리기 · 막힘이 남으면 단추 없음), 오늘 화면 둘. 설치본에서 눈으로 보지는 않았다.

## 메모

- 걷어낸 문지기는 git 에 있었다(`c2f61742` 가 지운 `set_plan_status`). `git log -S` 로 찾아 좁혀 되살렸다. 2026-09-07 사고(미완 둘을 남긴 채 done)의 회귀 테스트도 같이 돌아왔다.
- 이 저장소의 닫을 수 있는 계획 셋(beyond-orca · narrow-window · orca-bench)은 닫지 않았다. 닫기는 사용자 결정이다.
- 「항목이 다 닫혔어요. 확인 명령이 통과해야 끝나요.」 옆에 닫기 단추가 선다. 확인 명령이 통과했는지는 닫기의 조건으로 삼지 않았다. 확인 명령이 없는 계획도 닫을 수 있어야 해서다.