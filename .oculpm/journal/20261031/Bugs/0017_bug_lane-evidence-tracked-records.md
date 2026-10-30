---
schema_version: 1
type: bug
slug: "lane-evidence-tracked-records"
status: done
difficulty: medium
created_at: "2026-10-31T00:17:56+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/race.rs"
    op: update
  - path: "src-tauri/src/git/race_tests.rs"
    op: update
related: []
tags:
  - "race"
  - "redteam"
  - "mcp-tool"
---
[x] 여럿에서: 옛 일지를 레인 증거로 세지 않는다

## 발생 원인
레드팀(10-31)이 찾은 반례다. 레인의 일지를 「레인 `.git` 파일보다 늦게 쓰인 것」으로 가렸다. 그런데 기록을 git 에 올리는 저장소(이 저장소처럼)는 `git worktree add` 가 옛 일지를 `.git` 보다 약 6ms 늦게 쓴다. 그래서 옛 일지가 전부 새 것으로 세어졌다(옛 일지 3건 모두). 모든 레인이 옛 일지 덕에 「명령 있음」이 되고, 「추천」이 틀린 근거로 붙었다.

## 해결 방법
`read_evidence(root, lane)` 가 시각 대신 git 으로 가린다.
- 기록을 올리는 저장소: 레인에서 `.oculpm/journal` 을 stage 한 뒤 `diff --cached --name-only --diff-filter=AM <기준>` 으로 레인이 더하거나 고친 일지만 센다.
- 안 올리는 저장소: 레인의 기록 폴더는 심은 것이라(config.toml 만), 거기 있는 일지가 전부 레인의 것이다.

## 검증
- `cargo test --lib git::race` → 5 passed (새 테스트 `a_tracked_record_lane_counts_only_what_the_lane_wrote`: 옛 일지 셋은 0, 레인이 쓴 하나만 1)
- 전체 게이트 → Tests 973 passed · rust passed 1167 failed 0 · clippy · fmt 통과