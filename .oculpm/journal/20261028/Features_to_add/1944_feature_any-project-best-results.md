---
schema_version: 1
type: feature
slug: "any-project-best-results"
status: done
created_at: "2026-10-28T19:44:49+09:00"
session_id: "20261028-009"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/check_infer.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_goal.rs"
    op: update
  - path: "src-tauri/tests/plugin_hook_no_plan.rs"
    op: create
  - path: "src-tauri/tests/resume_context.rs"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm/README.md"
    op: update
  - path: "docs/PROMISE.md"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "AGENTS.md"
    op: update
  - path: ".oculpm/agents/_template.md"
    op: update
related: []
tags:
  - "template"
  - "hook"
  - "plan-create"
  - "best-results"
  - "plugin"
  - "mcp-tool"
---
[x] 「어떤 프로젝트여도」 — 플랜 없는 작업에도 다섯 원칙: 템플릿 v18 작업 규율 · 빈 프로젝트 훅 안내 · 확인 명령 후보 감지 · plan_create 기본 확인 명령

## 추가 기능
사용자 말: "oculpm을 사용하면 에이전트를 사용했을때 최고의 결과를 내주게 해줘야해. 어떤 프로젝트여도." 최고의 결과 라운드는 다섯 원칙(완료 조건·확인 명령·증거·실제 실행·바깥 심판)을 **플랜**에 박았는데, 플랜이 없는 작업·막 추적을 시작한 프로젝트·훅 없는 에이전트(Cursor·Gemini)에는 기록 규칙만 닿았다. 세 구멍을 새 화면·새 도구 없이 메웠다.

- **템플릿 v18 — §1 「작업 규율 — 결과를 좋게 하는 네 줄 (플랜이 없어도)」** (ko/en): 코드 전 완료 조건·확인 명령 한 줄(모호하면 질문 셋 이내, 두 단계 넘으면 plan_create) · 범위 안에서, 같은 접근 두 번 실패면 교체 · 끝엔 확인 명령 결과 끝 줄, 초록이어도 실제로 띄워 보기 · 남은 일은 대화가 아니라 플랜 항목으로. 옛 §1~5 는 §2~6 으로, MCP 메모의 §참조도 함께. 예산 ko 4,800→5,300 (실측 5,147) · en 6,500→7,400 (7,275), 근거는 `agents/tests.rs` 이력에.
- **시작 훅 `plan-context.sh`(claude·codex 동일)**: 미완 항목 0·일지 0 이면 「플랜·일지 없음 → plan_create(done_when·check)로 완료 조건·확인 명령부터, 끝나면 journal_write」 한 줄. 확인 명령 없는 활성 플랜이 있거나 플랜이 없으면 매니페스트에서 감지한 **확인 명령 후보** 한 줄(package.json `"test":` → 락파일로 pnpm/yarn/bun/npm · Cargo.toml · pyproject.toml/pytest.ini · go.mod · Makefile `test:`), 못 찾으면 「후보 없음」. 안내만 실은 세션은 전달 원장(resume-delivered.jsonl)에 적지 않는다 — 재개가 아니다.
- **`oculpm/check_infer.rs`** — 같은 규칙의 Rust 판. `plan_create` 가 `check` 를 못 받으면 `default_check(root)` 를 **확인 명령:** 줄로 적고 `warnings` 로 「감지한 명령을 적었다 — 틀리면 고쳐라」, 못 찾으면 「확인 명령이 없다」 경고. 훅 sh 와는 공유 계약 — `parity_with_the_start_hook_script` 가 sh 본문의 규칙 글자를 문다.
- 문서: PROMISE.md 다섯 원칙 표 ①②의 자리 열에 「플랜이 없어도」, 측정 목표 「확인 명령 있는 플랜」 행에 기본값 명시 · plugin README 재개 컨텍스트 행 · landing/plugin.html ko/en plan_create 행.

## 동작 흐름
1. 새 폴더에 `.oculpm` 만 있고 Claude Code 를 열면 SessionStart 훅이 「무엇부터」 한 줄 + 후보(예: `pnpm test · cargo test`)를 additionalContext 로 싣는다. 이 저장소에서도 확인 명령 없는 활성 플랜이 있어 후보 줄(`pnpm test`)이 실제로 실렸다.
2. 에이전트가 AGENTS.md §1 대로 완료 조건·확인 명령을 먼저 말하고, 두 단계 넘으면 plan_create — check 를 빼먹어도 감지값이 들어가고 경고가 돌아온다.
3. 끝낼 때 결과 끝 줄을 검증 칸에, 남은 건 플랜 항목으로 — 다음 세션의 훅이 그것을 다시 싣는다.

## 검증
- `cargo test --lib check_infer` → 5 passed · `cargo test --test plugin_hook_no_plan` → 4 passed (빈 프로젝트 안내+후보 · 매니페스트 없음 → 후보 없음 · 확인 명령 없는 플랜 → 후보만 · 확인 명령 있는 플랜 → 후보 없음) · `cargo test --lib agents::` 24 passed · `cargo test --lib mcp::tools::tests` 72 passed · `--test plugin_xplat` 7 · `--test plugin_manifest` 11 · `--test resume_context` 5 passed(빈 프로젝트 테스트를 「안내만, 원장 없음」 계약으로 고침).
- `cargo clippy --all-targets --locked -- -D warnings` 출력 없음 · `cargo fmt --check` 깨끗.
- 프런트 `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 261 파일 통과 · lint 4 warnings(허용) · built, exit 0.
- 훅 수동 smoke: 임시 폴더(package.json+pnpm-lock+Cargo.toml) → 두 줄 실림, `.oculpm/hooks` 원장 없음.

## 메모
- 하위 디렉터리 매니페스트(src-tauri/Cargo.toml 류)는 보지 않는다 — 후보가 늘면 「어느 것」이 다시 질문이 된다. 모노레포는 사람이 check 를 적는 쪽.
- `plugin_xplat.rs` 는 래칫 935줄이라 새 테스트는 `plugin_hook_no_plan.rs` 로 분리.
- 랜딩 첫 화면·README 의 「플랜이 없어도」 내세우기는 이 일지에 넣지 않았다 — 릴리스 때 함께.