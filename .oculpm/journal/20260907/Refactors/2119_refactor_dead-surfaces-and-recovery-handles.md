---
schema_version: 1
type: refactor
slug: "dead-surfaces-and-recovery-handles"
status: done
difficulty: high
created_at: "2026-09-07T21:19:44+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/overview.rs"
    op: delete
  - path: "src-tauri/src/commands/greenfield.rs"
    op: update
  - path: "src-tauri/src/commands/conversation.rs"
    op: update
  - path: "src-tauri/src/commands/dap.rs"
    op: update
  - path: "src-tauri/src/commands/discussion.rs"
    op: update
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/features/settings/tabs/DoctorSection.tsx"
    op: update
related: []
tags:
  - "commands"
  - "cleanup"
  - "v3-release"
  - "mcp-tool"
---
[x] 죽은 진입점 16개를 걷고, 없던 복구 손잡이를 붙인다

## 동기

v3-release 「죽은 표면 정리」 3항목. 등록 커맨드 354개 중 프런트 참조가 0인 것이
**17개**였다(부모가 사전 조사로 특정).

## 변경 요약

**판정 기준을 먼저 세웠다** — 프런트만 보고 지우면 안 된다. `mobile_bridge/dispatch.rs` 의
문자열 디스패치 표 전수 · `oculpm/mcp/**` · `deeplink.rs` · `tests/**` 를 각각 확인했다.
결과: 17개 중 백엔드 호출부가 있는 것은 **0개**. 16개를 지웠다(354 → 340).

지우지 않은 하나는 **`acp_stop`** 이다 — `acp::process::stop` 의 유일한 호출부라, 지우면
떠 있는 어댑터를 내릴 길이 완전히 사라지고 원장 세그먼트를 닫는 부수효과(`note_closed`)까지
잃는다. UI 를 붙이는 쪽이 맞아 이월했다.

**플랜의 전제를 하나 뒤집었다.** `openEntryInEditor` 는 "opener-scope 3회 회귀 끝에 만든
우회로인데 호출부 0" 이라 적혀 있었지만, 추적해 보니 **새고 있지 않았다** — 일지 .md 를
OS 로 여는 코드가 어디에도 없다(`EntryDetailView` 에 그 손잡이 자체가 없고, `openInEditor`
호출부 6곳은 전부 diff·그래프·검색·터미널의 일반 파일이다). 누출이 아니라 **미구현
어포던스**다. 지우면 opener-scope 회귀 4번째를 부르므로 유지하고, 이유를 래퍼 doc 에
못박아 다음 청소가 지우지 못하게 했다.

반대로 `watcherStart` 는 진짜 우회였다 — `ProjectTab.tsx` 가 `commands.oculpmWatcherStart`
를 직접 불렀다. 래퍼 경유로 되돌리며 실패 경로(토스트·「감독관이 복구 중」 문구·
`takeOver` 액션·`cancelled` 가드 순서)를 그대로 보존했고, 덤으로 로그 줄의
`${wsRes.error}` → `[object Object]` 버그가 없어졌다.

**「중지」가 아니라 「다시 시작」인 이유** — `supervisor.rs` 가 워처 없는 프로젝트를
먹통으로 판정해 60초 안에 되살린다(`is_deaf(None, _) => true`). 그래서 지금 코드에서
"끄기" 는 **60초짜리 거짓말**이다. 진짜 off 는 감독관이 존중할 사용자 일시정지 상태가
선행돼야 해서 이월했다. 대신 「다시 시작」(`watcher_stop` → `watcher_start`)은 없던 손잡이를
실제로 채운다 — `watcher_start` 는 이미 돌고 있으면 no-op 이라, 「감시 중」으로 보이지만
먹통인 워처 앞에서 사용자가 누를 것이 하나도 없었다.

**원장을 같은 커밋에서 갱신했다** — `generate_seed_goals` 제거로 `commands/greenfield.rs` 가
LLM 프롬프트 자리가 아니게 되어, 유출 원장과 `EXEMPT_LLM_PROMPT_SITES`(4→3)를 함께 고쳤다.
상수 doc 이 "자리를 더하거나 빼는 같은 커밋에서 갱신하라" 고 적어 둔 대로다.

## 검증

`cargo test`(30 스위트) · `cargo clippy --all-targets -- -D warnings` · `pnpm typecheck` ·
`pnpm lint` · `pnpm test`(190파일 / 2,463건) · `pnpm build` 전부 exit 0.
eslint 경고가 50 → 49 로 내려갔다(죽은 커맨드가 데리고 있던 것).

## 이월

`acp_stop` UI · `EntryDetailView` 의 "파일로 열기" · 진짜 워처 중지(감독관 opt-out 상태) ·
고아가 된 백엔드 함수 5개(`manager::overview_stats` · `Db::conversation_rename/set_context` ·
`DapStateStore::breakpoint_lines/clear_breakpoints` · `Db::get_blueprint`) — 전부 `pub` 이라
경고는 안 나지만 죽은 코드다.