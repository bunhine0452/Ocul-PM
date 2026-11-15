---
schema_version: 1
type: feature
slug: "plan-check-in-shell"
status: done
difficulty: high
created_at: "2026-11-15T08:25:24+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal.rs"
    op: update
  - path: "src-tauri/src/terminal_env.rs"
    op: update
  - path: "src-tauri/src/terminal_tests.rs"
    op: update
  - path: "src-tauri/src/terminal_types.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src/__tests__/plan_check_in_shell.test.tsx"
    op: create
  - path: "src/api/terminal.ts"
    op: update
  - path: "src/features/planner/CheckRunDialog.tsx"
    op: create
  - path: "src/features/planner/PlanDoc.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/planner.css"
    op: update
  - path: "src/features/terminal/runCheck.ts"
    op: create
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "계획"
  - "planner"
  - "terminal"
  - "quality-round"
  - "mcp-tool"
---
[x] 계획: 확인 명령을 누를 때만 셸에서 돌린다

## 추가 기능

사용자 결정(11-15 「누를 때만 돌리기」, 계획 quality-round-20261115 #check-in-shell). 판정 줄이 계획의 심장인데 돌리는 길이 복사 → 붙여넣기 → Claude 에게 맡기기로 가장 멀었다(Orca Quick Commands · Codex actions 를 본뜸).

계획 화면의 **확인 명령:** 옆에 보통 단추 「셸에서 돌리기」(채운 단추 아님 — 영수증 ③). 누르면 확인 창(`CheckRunDialog`)에 명령 전문(기계 글씨)과 도는 폴더를 보이고, 확인할 때만 새 셸 세션(탭 이름 「확인 명령」)에서 돌린 뒤 터미널 화면의 그 세션으로 간다. 판정 기록(판정 ✓|✗ 줄)은 여전히 Claude 몫이다 — 앱은 결과를 읽어 판정하지 않는다.

## 동작 흐름

1. 명령은 한 줄만(줄바꿈이 있으면 단추가 막히고 이유가 보인다), 제어 문자는 `pasteSafe` 정화기로 걷는다.
2. `runCheck.ts` → `openTerm(…, check)` → Rust `OpenSpec.check` → `Launch::Check(line)` 이 셸의 명령 인자(`-l -i -c`, PowerShell `-NoExit -Command`)로 넘긴다. tty 에 치지 않으니 셸 설정 파일이 질문을 해도 첫 글자가 먹히지 않는다(「다음」 과 같은 길). 명령 뒤 셸은 남는다.
3. 새 자식 프로세스 자리는 없다(기존 셸 기동 자리에 인자만) — `egress_spawn_ledger/sites.rs` 사유를 고쳤다.

## 검증

- `cargo test --locked --no-fail-fast` 1206 passed 0 failed(레인 시점, egress 원장 포함) · clippy · fmt · `pnpm test` 1666 passed · typecheck · lint · build exit 0. 합류 뒤 `cargo test` 1211 passed 0 failed.
- `plan_check_in_shell.test.tsx` 14건: 누르기 전 확인 창의 전문, 확인 뒤 터미널 열기 한 번 · 그 명령 한 줄, 취소면 0회, 줄바꿈 든 명령은 막힘, 확인 명령 없는 계획엔 단추 없음. 실제 PTY 시험으로 셸이 그 줄을 쓴 그대로 돌리고 셸로 남는 것을 확인.
- 독립 리뷰를 거치지 않았다(워크트리 기준 어긋남) — 최종 검수가 따로 본다. 설치본에서 눌러 보지는 않았다.

## 메모

- 명령은 셸 기록(history)에 남지 않는다 — 사람이 보는 자리는 확인 창의 전문과 탭 이름이다(tty 에 치면 rc 질문 결함이 되살아난다).
- Windows PowerShell 5.1(pwsh 가 없을 때)은 `&&` 를 모른다 — 이 저장소처럼 `&&` 로 이은 확인 명령은 구문 오류를 보이고 셸로 남는다.
- CLAUDE.md 의 「앱이 터미널에 넣는 것」 목록에 이 줄을 넣었다.