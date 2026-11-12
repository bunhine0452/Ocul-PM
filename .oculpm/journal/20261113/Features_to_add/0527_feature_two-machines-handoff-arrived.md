---
schema_version: 1
type: feature
slug: "two-machines-handoff-arrived"
status: done
difficulty: medium
created_at: "2026-11-13T05:27:14+09:00"
session_id: "20261113-003"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "a37496a9-17b0-4d08-99b1-06955418c094"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/arrived.rs"
    op: create
  - path: "src-tauri/src/git/arrived_tests.rs"
    op: create
  - path: "src-tauri/src/git/head.rs"
    op: update
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
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_local_only.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related:
  - ref: "20261113/Features_to_add/0058_feature_two-machines-round.md"
    kind: "followup"
tags:
  - "두-기기"
  - "today"
  - "git"
  - "mcp-tool"
---
[x] 두 기기: 올리기 맡기기와 받아 온 일지 줄을 넣었다

v4.10.0 뒤, 맥과 윈도우를 오갈 때의 연동 편의 셋을 더했다 (플랜 `two-machines-20261113` `#handoff` · `#synced` · `#arrival`).

## 추가 기능

- **올리기 맡기기** — 오늘 화면 「이 기기에만」 줄에 단추 하나. 앱 안 터미널의 Claude 에게 "기록은 커밋하고, 기록 아닌 변경은 먼저 묻고, 지금 가지를 올려라(강제 금지 · 리모트가 앞서 있으면 멈춤)" 를 넘긴다. 앱은 올리지 않는다 — 기존 「터미널에서 실행」 과 같은 길(`runPromptInTerminal`)이다.
- **오늘 받아 온 일지 N건** — 받아 온 커밋 가운데 다른 기기나 동료가 쓴 일지를 세고, 「일지 보기」 가 가장 최근 것을 연다. 행도 배지의 수도 아닌 조용한 한 줄.
- **리모트와 주고받은 지 N일** — 받아 온 일지가 없고, 마지막으로 받아 오거나 올린 지 24시간이 넘었을 때만. 다른 곳의 기록을 받은 적이 없는 저장소에는 말하지 않는다.

## 동작 흐름

- 새 모듈 `git/arrived.rs` 와 명령 `today_arrived(project_id, since)`. **받아 오지 않는다.** 리모트 가지의 reflog(`logs/refs/remotes/<리모트>/<지금 가지>`)를 파일로 읽는다. 메시지가 `update by push` 가 아니고 가지가 처음 생긴 줄(옛 oid 0)이 아니면 받아 온 것이다.
- 오늘 받아 온 첫 구간의 옛 oid 부터 마지막 새 oid 까지를 `git log --diff-filter=A --name-only` 한 번으로 묻는다. 구간이 그대로면 지난 답을 쓴다(창에 돌아올 때마다 불려도 git 0번).
- **이 기기에서 만든 커밋은 뺀다.** 모든 워크트리의 HEAD reflog 에서 `commit…` 줄의 oid 와 시각을 모으고, 받아 온 커밋의 oid 나 작성 시각(±2초)이 거기 있으면 여기서 한 일로 본다. 리베이스 머지는 oid 를 바꾸지만 작성 시각은 남긴다.
- 작업 트리에 없는 일지(받아 왔지만 합치지 않음)는 세지 않는다.
- 「주고받은 때」 는 그 reflog 의 마지막 줄 시각과 `FETCH_HEAD` 수정 시각 중 늦은 것. 최근 받아 온 12번 안에 다른 곳의 일지가 있을 때만 값을 준다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → exit 0 · `Tests  1109 passed (1109)` · `Test Files  109 passed (109)`
- `cargo test --locked` → exit 0 · 합계 1157 passed, 0 failed · `cargo clippy --all-targets --locked -- -D warnings` → exit 0 · `cargo fmt --check` 깨끗
- 이 저장소의 실제 기록으로 임시 확인(시험은 지움): 오늘 받아 온 구간에서 윈도우 기기가 쓴 일지 23건만 나오고, 이 맥에서 써서 PR(리베이스 머지)로 돌아온 `0058` 일지는 빠졌다.

## 메모

- 처음 구현은 PR 로 합친 내 일지까지 받아 온 것으로 셌다. 이 저장소의 reflog 를 보고 알았고, HEAD reflog 대조로 고쳤다.
- 스쿼시 머지는 작성 시각까지 새로 써서 가리지 못한다 — 받아 온 것으로 센다.
- 지금 가지와 이름이 같은 리모트 가지만 본다. 리모트에 없는 작업 가지 위에서는 두 줄 다 서지 않는다. 떨어진 HEAD · reftable 저장소도 모른다고 답한다.
- 「오늘」 은 그날 자정 뒤에 받아 온 것이다. 어젯밤 받아 온 일지는 오늘 아침 줄에 없다.
- 못 한 것: 설치본과 윈도우 실기기에서 눌러 보지 않았다.