---
schema_version: 1
type: feature
slug: "worktree-race"
status: done
difficulty: high
created_at: "2026-10-30T18:11:21+09:00"
session_id: "20261030-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/race.rs"
    op: create
  - path: "src-tauri/src/git/race_tests.rs"
    op: create
  - path: "src-tauri/src/commands/race.rs"
    op: create
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src/features/terminal/race.ts"
    op: create
  - path: "src/features/terminal/RacePanel.tsx"
    op: create
  - path: "src/features/terminal/TerminalScreen.tsx"
    op: update
  - path: "src/__tests__/terminal_race.test.tsx"
    op: create
related: []
tags:
  - "터미널"
  - "orca-bench"
  - "git-worktree"
  - "mcp-tool"
---
[x] 터미널: 같은 일을 worktree 여럿에서 돌린다

## 추가 기능

사용자 결정(10-30): Orca 의 「Parallel Worktrees」를 가져온다(계획 `orca-bench-20261030` #worktree-race). 같은 프롬프트를 격리된 worktree 여럿에서 돌리고, 변경을 비교해 하나를 고른다.

Ocul 식으로 바꾼 점: 고른 레인은 **원래 폴더에 커밋 전 변경으로** 가져온다. 그러면 변경 화면의 검토 → 줄 메모 → 커밋 흐름을 그대로 탄다.

## 동작 흐름

- **백엔드 `git/race.rs`** — 테스트는 `race_tests.rs` 에 둔다.
  - 레인은 `ocul-race/<도장>-<n>` 가지의 worktree 이고, 앱 데이터 폴더 `races/p<id>/` 에 만든다.
    - 프로젝트 옆에 두면 사용자 폴더를 어지럽힌다.
    - 프로젝트 안에 두면 워처와 `git status` 가 그것을 본다.
  - 상태는 따로 적지 않고 `git worktree list` 에서 그 가지를 찾는다. 그래서 앱을 다시 켜도 레인이 보인다.
  - `start`: 2~4 개로 묶는다. 실패하면 반쯤 만든 것을 거둔다.
  - `lanes`: 기준은 merge-base 다. 레인 인덱스에 `add -A` 한 뒤 `diff --cached --numstat` 로 커밋 · 미커밋 · 새 파일을 모두 센다.
  - `take`: `--binary` diff 를 임시 파일에 쓰고, 원래 폴더에서 `git apply`. 겹치면 git 이 거절한 말을 그대로 돌려주고, 아무것도 바뀌지 않는다.
  - `clear`: worktree remove · branch -D · prune.
  - `find`: 레인이 아닌 경로를 거절한다.
  - git 은 모두 `safe::cmd` 로만 부른다(훅 · 필터 · fsmonitor 꺼짐).
- **`term_open` 의 `cwd`:** 이 프로젝트의 레인일 때만 받고, 아니면 `race_not_a_lane` 으로 거절한다.
- **화면:**
  1. 툴바 「여럿에서」 → 시작 대화상자에서 프롬프트와 개수(2/3/4)를 정하고 ⌘↩.
  2. 레인마다 그 worktree 에서 `claude "<프롬프트>"` 세션을 연다. 탭 이름은 「레인 n」.
  3. 터미널 위 띠(레인이 있을 때만): 레인 n · Claude 상태 · 파일 · +/− · 보기 · 이것으로 · 모두 정리.
  4. 보기는 파일별 `PatchView` 다. git 확장 머리줄과 끝 빈 줄을 빼는데, 하네스에서 「new file mode」가 코드 줄로 그려져 고쳤다.
- **원장:** 레인 테스트의 git 픽스처를 실행 원장(`egress_spawn_ledger/sites.rs`)에 등록했다. 처음에는 잠금 테스트 둘(`no_other_module_spawns_git` · `every_process_launch_site_is_classified`)이 잡았다.

남은 한계: 레인 안에서 Claude 가 쓴 일지는 그 worktree 의 `.oculpm/` 로 간다. 저장소가 `.oculpm` 을 추적하면 가져올 때 함께 온다. 레인의 훅 상태는 앱이 보지 않고, 상태는 앱 안 터미널의 OSC 7501 로만 안다.

## 검증

- `cargo test --lib git::race`: 3 passed
  - 레인 넷(9를 4로 묶음), 크기 (2, 3, 1), 보기에 `+TWO`
  - 가져오기 뒤 원래 폴더의 두 파일, 빈 레인은 `empty_lane`
  - 원래 폴더 · 아무 폴더는 `not_a_lane`, 정리 뒤 레인 0 · 폴더 없음
  - 커밋 없는 저장소는 `no_commit`
- `terminal_race.test.tsx`: 3 passed. 시작 → 레인마다 cwd 로 열기 · 탭 「레인 2」, 띠의 크기 · 빈 레인 비활성 · 가져오기 · 정리(세션부터), 파일 나누기 · 머리줄 빼기.
- 하네스: 어두운 띠, 밝은 시작 대화상자, 레인 diff 를 스크린숏으로 확인했다. 개수 선택이 안 보이던 것은 seg 관례(role tab · aria-selected)로 고쳤다.
- 전체:
  - `pnpm typecheck` 0 · `pnpm test` 969 passed · `pnpm lint` 0 · `pnpm build` 0
  - `cargo fmt --check && clippy -D warnings && cargo test --locked --no-fail-fast` → rust passed 1165 failed 0