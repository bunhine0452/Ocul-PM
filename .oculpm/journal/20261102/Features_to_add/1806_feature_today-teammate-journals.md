---
schema_version: 1
type: feature
slug: "today-teammate-journals"
status: done
difficulty: low
created_at: "2026-11-02T18:06:18+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/authors.rs"
    op: create
  - path: "src-tauri/src/git/authors_tests.rs"
    op: create
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/commands/today.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/plan.ts"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related: []
tags:
  - "오늘"
  - "today"
  - "git"
  - "mcp-tool"
---
[x] 오늘: 동료가 올린 일지에 이름을 단다

## 추가 기능
`.oculpm/` 을 저장소에 올리는 팀에서는 `git pull` 로 받은 동료의 일지도 오늘 화면에 이미 섰다. 그런데 누구의 일인지가 없었다. 일지의 `agent` 는 에이전트지 사람이 아니다. 이제 「검증 없이 끝난 일지」 줄에 「민지 님이 올린 일지」가 붙는다.

## 동작 흐름
- `git/authors.rs` `teammates(root, workday)`
  - `git log --diff-filter=A --name-only --format=@@%an\t%ae -- .oculpm/journal/<그날>` 로 일지를 더한 커밋의 작성자를 찾는다.
  - 이 기계의 `user.email` 과 다르면(대소문자 무시) 동료다. 커밋 전 일지는 늘 내 것이다. 날짜 꼴이 아니면 git 을 부르지 않는다.
  - `log` 를 맨 앞에 두어 `safe::cmd` 가 외부 diff 를 끄게 했다. quotepath 끄기도 거기서 붙는다.
- `today_teammates` 명령에서 `useTodayExceptions` 의 `teammates`(경로 → 이름) 를 거쳐 `UnreadRow` 메타로 간다. 실패하면 빈 표라 이름만 빠진다.

## 검증
- `cargo test --lib git::authors`: 2 passed. 진짜 저장소에서 내 것 · 동료 것 · 어제 것 · 커밋 전 것을 가렸고, 최신 추가가 이기는 것을 확인했다.
- `today_v4.test.tsx`: 18 passed(동료 이름 테스트 추가). `pnpm test` 996 passed ×2.
- `cargo test --locked`: 1074 passed. fmt · clippy · typecheck · lint · build 모두 0.