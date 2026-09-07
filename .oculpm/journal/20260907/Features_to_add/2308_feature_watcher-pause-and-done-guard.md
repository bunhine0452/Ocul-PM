---
schema_version: 1
type: feature
slug: "watcher-pause-and-done-guard"
status: done
difficulty: high
created_at: "2026-09-07T23:08:00+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/supervisor.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/lifecycle.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/tests/plan_cas_two_process.rs"
    op: create
  - path: "src/features/settings/tabs/DoctorSection.tsx"
    op: update
tags:
  - "watcher"
  - "planner"
  - "cas"
  - "v3-release"
---
[x] 워처를 진짜로 멈출 수 있고, 미완 플랜은 완료로 닫히지 않는다

## 추가 기능

### 진짜 워처 「중지」 {#watcher-user-pause}

지난 라운드가 발견한 사실: `supervisor.rs` 가 워처 없는 프로젝트를 먹통으로 판정해 60초 안에
되살린다. 그래서 그때의 "끄기" 는 **60초짜리 거짓말**이었고 「다시 시작」만 붙였다.

이제 `ProjectEntry.user_paused` 를 감독관이 **존중한다** — `is_deaf` 보다 먼저 본다.
판정은 순수 함수 `verdict(&WatcherHealth, probed_before)` 로 떼어냈다. 닥터의 워처 행은
4갈래로 말한다: 「사용자가 멈춤 · 앱을 다시 켜면 풀려요」 / 「감시 중」 / 「멈춤」 / 「오류」.
지난 라운드의 「다시 시작」은 그대로 살아 있다 — 재시작과 일시정지는 다른 일이다.

**상태는 프로세스 메모리에 산다.** 디스크였다면 자리는 `.oculpm/config.toml` 인데 그 파일은
gitignore 블록에 없어 **저장소에 커밋된다** — 내가 내 기계에서 10분 멈춘 것이 동료의 실시간
갱신까지 끈다. 그리고 껐다는 사실이 재시작을 살아남으면 그게 곧 감독관이 막으려던
「소리 없이 죽은 워처」다(사람이 본능적으로 잡는 처방이 앱 재시작인데 그게 안 듣게 된다).
일시정지는 원래 순간의 행위이고, 문구가 그 수명을 직접 말한다 — 숨은 규칙이 아니다.

### 미완 플랜의 `done` 전이 거부 {#done-transition-guard}

**이 라운드에서 실제로 난 사고를 막는 가드다.** `hardening-and-optimization` 이 미완 2건을
남긴 채 `done` 으로 닫혀 있는 것을 발견해 되돌렸다. `{#glyph-hygiene}` 는 과거를 청소했을
뿐 재발을 막지 못한다.

플랜 레벨 `status:` 를 쓰는 유일한 함수를 `planner/lifecycle.rs` 로 옮기고, 원시 수술 함수를
**비공개**로 내렸다. 공개 진입점은 `Result<_, PlanCloseRefusal>` 을 반환한다 — **새 호출자도
거부를 처리하지 않으면 컴파일되지 않는다.** 막은 자리는 셋이고, 셋째가 요점이다:
`plan_set_status` · `plan_set_status_bulk`(배치를 전부 판정한 뒤 쓰도록 바꿔 반쪽 쓰기 제거) ·
**`mobile_bridge/dispatch.rs`** — 프런트만 막았으면 정확히 여기로 샜다.

판단 둘. **`archived` 는 막지 않았다** — 이 저장소에서 `done` 은 완료 선언이고 `archived` 는
선반이다(실측으로 archived 플랜 16개가 미완을 갖고 있고 그 미완은 대부분 이월돼 살아 있다).
막으면 「못 끝냈다」를 정직하게 적을 자리가 사라진다. **강제 옵션도 두지 않았다** — CAS
`base_hash` 필수화와 같은 논리로, 우회 플래그가 있으면 계약이 둘이 되고 마찰을 만나는 쪽은
늘 둘째를 고른다. 정상 경로가 글리프 한 자(`-`/`>`)라 더 싸고, **그 한 자가 곧 "이건 안 한다"
는 기록**이다.

### 진짜 2-프로세스 CAS 테스트 {#cas-two-process-test}

지금까지는 스레드 동시성으로 대신 물었다. 이제 **테스트 실행 파일 자기 재진입**으로 진짜 OS
프로세스를 띄워 실제 `McpServer::handle_line` 경로를 돈다(새 크레이트 없음). 두 프로세스가
같은 해시로 쓰면 정확히 하나만 이기고 진 쪽은 파일을 한 바이트도 안 건드린다. 6 프로세스가
정직하게 재시도하면 6 전이와 plan-log 6행이 전부 산다.

계측판을 3회 돌려 6 세션 중 5개가 **실제 크로스프로세스 충돌**을 겪음을 확인했다 — 공허한
테스트가 아니다.

## 검증

`cargo test` 31 스위트 · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` ·
`pnpm typecheck` · `pnpm lint`(6게이트, 경고 47) · `pnpm test`(190파일) · `pnpm build`
전부 exit 0. 새 CAS 테스트는 연속 3회 0.15초 내 통과.

워처 일시정지는 **반증으로 확인**했다 — `verdict` 의 가드를 지우면 테스트가 빨개지는 것을
실제로 확인하고 복구했다.

**육안 미확인** — 닥터의 4갈래 워처 행은 띄워 봐야 한다.
