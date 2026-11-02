---
schema_version: 1
type: feature
slug: "today-stale-verdict"
status: done
difficulty: medium
created_at: "2026-11-02T17:49:38+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/stale.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/commands/today.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_stale.test.ts"
    op: create
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "오늘"
  - "today"
  - "planner"
  - "mcp-tool"
---
[x] 오늘: 통과 뒤 바뀐 파일을 짚는다

## 추가 기능
계획의 마지막 판정이 ✓ 라도, 그 뒤에 이 계획이 다룬 파일이 다시 저장되었으면 오늘 화면 「먼저 볼 것」에 「통과 뒤 바뀜」 한 줄이 선다. 줄의 기본 동작 「다시 확인」은 앱 안 터미널에서 claude 를 연다. 프롬프트는 확인 명령을 다시 돌리고 결과 끝 줄을 그 계획의 plan-log 에 남기라고 시킨다. 앱이 ✓ 를 대신 적지는 않는다.

## 동작 흐름
- `planner/stale.rs` 의 `changed_after(root, files, verdict_ts)` 는 판정 시각보다 수정 시각(mtime)이 늦은 파일을 돌려준다.
  - mtime 을 쓰는 이유: 커밋은 mtime 을 바꾸지 않는다. 그래서 「확인 → 판정 → 커밋」 순서는 잡히지 않고, 판정 뒤에 고친 것과 pull/rebase 로 내용이 바뀐 것만 잡힌다.
  - `.oculpm/` · 루트 밖 경로 · 없어진 파일은 보지 않는다. 시각을 못 읽으면 빈 목록이다.
- 「계획이 다룬 파일」 = 그 계획 plan-log 에 걸린 일지들의 `files_touched`(`files_for_entry_paths`).
- `today_digest` 가 ✓ 인 계획마다 `DigestPlan.stale_files` 를 채운다. `build` 는 순수하게 둔다.
- 오늘 화면 모델 `kind: "stale"`. 순서는 실패 다음, 딱지는 경고색이다.
- 용어집 규칙(UI 에 「판정」 금지)을 따라 이름은 「통과 뒤 바뀜」으로 했다.

## 검증
- `cargo test --lib planner::stale`: 2 passed.
- `pnpm test`: 993 passed. `today_stale.test.ts` 에서 실패 → 낡음 순서, 바뀐 파일 없음/판정 없음/실패면 서지 않음을 확인했다.
- `cargo test --locked`: 1067 passed, 0 failed. `pnpm typecheck` · `pnpm lint` · `pnpm build` 모두 exit 0.