---
schema_version: 1
type: feature
slug: "two-machines-round"
status: done
difficulty: high
created_at: "2026-11-13T00:58:34+09:00"
session_id: "20261113-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "a37496a9-17b0-4d08-99b1-06955418c094"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/journal_spec_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/planner/judge.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_goal.rs"
    op: update
  - path: "src-tauri/src/commands/today.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/git/local_only.rs"
    op: create
  - path: "src-tauri/src/git/local_only_tests.rs"
    op: create
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/project_color.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/session/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src-tauri/tests/plugin_hook_no_plan.rs"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/plan.ts"
    op: update
  - path: "src/api/projects.ts"
    op: update
  - path: "src/components/VerdictLine.tsx"
    op: update
  - path: "src/components/verdictLine.css"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/useTodayExceptions.ts"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/today_stale.test.ts"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
  - path: "src/__tests__/today_local_only.test.tsx"
    op: create
related: []
tags:
  - "두-기기"
  - "오늘"
  - "판정"
  - "설정"
  - "mcp-tool"
---
[x] 두 기기: 오갈 때 걸리던 넷을 고쳤다

## 추가 기능

맥과 윈도우에 Ocul 을 깔고 같은 저장소를 번갈아 쓸 때 걸리던 넷 (플랜 `two-machines-20261113`).

1. **앱 관리 규격 파일을 더 옛 앱이 되돌려 쓰지 않는다.** `journal-spec.md` 는 내장 내용과 한 바이트라도 다르면 덮어썼고 판 비교가 없었다. 두 기기의 앱 버전이 다르면 서로 되돌려 써서 작업 트리가 늘 더럽고 pull 이 막혔다. 이제 디스크의 `template_version` 이 더 크면 손대지 않고, 이미 있던 「기록 규칙이 이 앱보다 새로워요」 알림이 규격 쪽도 말한다. 규격은 v2 → v3, 내용을 고치고 번호를 안 올리면 깨지는 핀 테스트를 뒀다(제목 규칙이 v2 그대로 들어갔던 것이 이번 흔들림의 원인).
2. **판정이 어디서 돌았는지 안다.** `plan_update` 가 판정 메모 끝에 ` · mac` · ` · windows` · ` · linux` 를 붙인다(접두는 그대로라 시작 훅 · 확장의 읽기는 안 바뀐다). 가장 최근 ✓ 가 다른 OS 것이면 오늘 화면은 「통과 뒤 바뀜」 대신 「여기선 아직」 한 행을 세우고, 「다시 확인」 은 이 기기에서 돌리라는 프롬프트를 터미널로 넘긴다. 시작 훅도 그 줄 끝에 「(mac 에서 돌린 것 — 이 기기에서는 아직 안 돌렸다)」 를 붙인다.
3. **이 기기에만 있는 것을 한 줄로.** 커밋 안 한 변경(그중 기록) · 어느 리모트에도 없는 커밋. 받아 오지 않고 마지막으로 받아 온 리모트 가지와 견준다(네트워크 0). 일하는 중엔 늘 있는 것이라 「먼저 볼 것」 의 행도 배지의 수도 아니고 「내 차례」 같은 한 줄이다.
4. **프로젝트 색이 저장소를 따라온다.** 색을 고르면 `config.toml` 맨 위의 `project_color` 에도 적고(「색 없음」 은 `"none"`), 프로젝트를 열 때와 그 파일이 바뀔 때(pull) 이 기기의 색을 맞춘다.

## 동작 흐름

- 「여기선 아직」 의 규칙은 `DigestPlan::stale_baseline` · `settle` 에 있다. 다른 OS 가 ✓ 를 새로 찍었어도 **이 OS 에서 통과한 뒤 바뀐 파일이 없으면 조용하다** — 안 그러면 손대지 않은 계획이 두 기기 사이에서 번갈아 「여기선 아직」 을 띄운다. 표시 없는 옛 판정은 이 기기 것으로 센다(옛 동작 그대로).
- 색을 쓰는 길은 `OculpmManager::set_project_color` 하나다. `set_config`(설정 화면의 저장)는 색을 메모리 사본이 아니라 **디스크의 값**으로 지킨다 — pull 로 들어온 색을 낡은 사본이 되돌리지 않게. 워처는 `config.toml` 변경을 `OculpmDataArea::Config` 로 알리고 창이 `sync_project_color` 를 부른다.
- 새 명령 둘: `today_local_only` · `sync_project_color`. git 은 기존 창구(`run_git`)로만 띄우고, 테스트의 리모트 가지는 push 가 아니라 `update-ref` 로 세운다(원장이 네트워크 하위 명령을 테스트에서도 막는다).

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → exit 0 · `Tests  1105 passed (1105)` · `Test Files  109 passed (109)` (v4.9.3 위로 리베이스한 뒤)
- `cargo test --locked` → exit 0 · 합계 1150 passed, 0 failed · `cargo clippy --all-targets --locked -- -D warnings` → exit 0
- 못 한 것: 설치본과 윈도우 실기기에서 눌러 보지 않았다. 훅의 OS 판별(`uname -s` 의 MINGW/MSYS)은 맥에서만 돌았다.

## 메모

- 내려쓰기 방지는 **이 판이 깔린 앱부터** 듣는다. 한쪽이 4.9.0 이면 그쪽은 여전히 v2 로 덮어쓴다 — 두 기기 다 올려야 멎는다. 이 저장소의 `.oculpm/agents/journal-spec.md` 가 수정된 채인 것도 같은 이유라 손대지 않았다.
- 같은 OS 의 기기 둘(맥 둘)은 표시가 같아 서로를 못 가린다 — pull 뒤의 거짓 「통과 뒤 바뀜」 은 그 경우 그대로다.
- 색은 `config.toml` 이 커밋되므로 팀 저장소에서는 동료의 창 색도 같이 바뀐다.
- 이월: 도착 줄(다른 기기에서 한 일 N건) `#arrival`, 눈 확인 `#eyes`.