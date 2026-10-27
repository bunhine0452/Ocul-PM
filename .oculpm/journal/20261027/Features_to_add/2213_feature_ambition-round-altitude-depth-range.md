---
schema_version: 1
type: feature
slug: "ambition-round-altitude-depth-range"
status: done
difficulty: medium
created_at: "2026-10-27T22:13:36+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/done_when.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/resume.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_goal.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "plugin/oculpm/skills/redteam/SKILL.md"
    op: create
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/features/skills/pluginDocs.ts"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "docs/PROMISE.md"
    op: update
related:
  - ref: "20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md"
    kind: "followup"
  - ref: "20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md"
    kind: "followup"
tags:
  - "planner"
  - "journal"
  - "plugin"
  - "docs"
  - "polish"
  - "mcp-tool"
---
[x] 야망 라운드 — 훅이 완료 조건을 싣고, 검증은 바깥 심판이 말하고, 레드팀은 쓰지 않고 한다 (Rieseberg 적용)

## 추가 기능

Felix Rieseberg, 「How to be more ambitious」(2026-10-13)의 네 축 중 Ocul-PM 에 닿는 셋을 코드로.

**고도 — 할 일이 아니라 결과를 싣는다.**
- SessionStart 훅(claude·codex `plan-context.sh`)이 `[plan: id]` 바로 아래에 플랜 본문의 `**완료 조건:**` 한 줄(240자 상한)을 항목보다 먼저 싣는다. 오후에 활성 플랜 11개에 넣어 둔 그 줄이 이제 에이전트에게 닿는다. `plugin_xplat` 테스트가 잰다.
- `planner::done_when`(새 모듈) 이 셸 정규식과 같은 계약(`**완료 조건:**` · `**Done when:**`). `resume.rs` 의 `ResumeItem.plan_done_when` — 이어하기 텍스트에 플랜마다 한 번, 항목 앞에. `plan_create` 에 `done_when` 인자(한 줄로 접어 소개 아래에 씀), `plan_status` 가 플랜마다 `done_when`(없으면 null — 그게 신호). 템플릿 v16: 새 플랜은 완료 조건 한 줄 필수.

**깊이 — 바깥 심판.**
- 템플릿 v16 검증 칸: "**네가 아닌 것**이 말하게 하라 — 돌린 명령과 결과, 실측 수치. 「확인했다」는 증거가 아니다. 못 돌렸으면 못 돌렸다고". `journal_write` 는 bug/feature/refactor 일지의 검증 칸 증거 등급이 2 미만이면 경고(막지 않음) — 어제 들어간 `evidence.rs` 를 쓰는 자리.
- `docs/PROMISE.md` 「측정 목표」 표 — "최선을 다한다"가 아니라 숫자(Locke & Latham): 증거 83→97%, 무기록 세션 0, 무기록 파일 28→10%, 완료 조건 전 플랜, 재수정 47→30%. 못 맞추면 실패가 아니라 데이터.

**범위 — 명사를 동사로.**
- PROMISE.md 첫 절과 README ko/en · 랜딩 ko/en 히어로 부제: 「일지 앱」이 아니라 **에이전트가 한 일을 사람이 3분 안에 믿고 다음을 결정하게 하는 것**. 10월 초부터 미뤄 둔 「기억 → 영수증」 전환의 문장.
- `/oculpm:redteam` 스킬: 숏셀러처럼 **쓰는** 게 아니라 숏셀러가 **하는 일** — 주장 목록 → 원재료 → 직접 실행 → 가정 뒤집기 → 바깥 심판만 인용. 결과 형식 강제(반례 · 검증 불가 · 유지된 주장), 고치지 않는다, 역할극 문체 금지. 매니페스트 게이트(커맨드 7종)·help 카드·랜딩 ko/en 커맨드 섹션·README ko/en·pluginDocs 동기.

**안 받은 것.** 「사람을 루프에서 빼는 지속 워크플로」와 crew 를 화면으로 — 범위 동결·약속 문서가 막는 자리. 레드팀은 앱 밖 스킬로만.

## 동작 흐름

- 래칫 셋: `tools/tests/plan.rs`(836) → `plan_goal.rs` 로 분리. `json!` 스키마가 커져 `recursion_limit` 128 → 512 (lib.rs). `plugin_docs_sync` 가 SKILL.md description 과 pluginDocs 의 완전 일치를 요구해 문구를 하나로.
- 이 플랜 자체를 `plan_create(done_when)` 으로 만들었는데 **도는 MCP 는 설치본(3.15 이전) 바이너리**라 인자를 몰라 줄이 빠졌다 — 손으로 넣었다. 새 빌드부터는 도구가 쓴다.

## 검증

- 새 테스트 5: done_when 파싱·렌더 2, 이어하기 목표 1, plan_create/plan_status done_when 1, journal_write 바깥 심판 경고 1. `plugin_xplat`(훅 실실행) · `plugin_manifest` 통과. `cargo fmt --check` · `cargo clippy --all-targets --locked -D warnings` · `pnpm lint` · `pnpm typecheck` · 플러그인 동기 테스트 79 통과. 전체 스위트는 CI.