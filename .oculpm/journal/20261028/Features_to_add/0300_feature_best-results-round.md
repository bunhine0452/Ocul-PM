---
schema_version: 1
type: feature
slug: "best-results-round"
status: done
difficulty: high
created_at: "2026-10-28T03:00:28+09:00"
session_id: "20261028-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/done_when.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_goal.rs"
    op: update
  - path: "src-tauri/src/oculpm/evidence.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/src/db/scorecard.rs"
    op: create
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/commands/scorecard.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/rollup.rs"
    op: update
  - path: "src-tauri/src/oculpm/rollup/generate.rs"
    op: update
  - path: "src-tauri/src/oculpm/rollup/tests.rs"
    op: update
  - path: "src-tauri/src/commands/release_notes.rs"
    op: update
  - path: "src-tauri/tests/plugin_xplat.rs"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm/skills/next/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/inception/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/project-inception/SKILL.md"
    op: update
  - path: "src/features/today/PromiseScorecardCard.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/WeeklyRollupCard.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/__tests__/today_scorecard_card.test.tsx"
    op: create
  - path: "docs/PROMISE.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
related: []
tags:
  - "best-results-round"
  - "planner"
  - "mcp"
  - "today"
  - "rollup"
  - "landing"
  - "promise"
  - "mcp-tool"
---
[x] 최고의 결과 라운드 — 확인 명령·닫기 안내·결과 끝 줄 경고·약속 성적표·영수증 롤업·다섯 원칙 내세우기

## 추가 기능

2026-10-28 웹 조사(Anthropic Claude Code best-practices · Willison Agentic Engineering Patterns · Sonar State of Code 2026 · METR 2026 uplift update)에서 코딩 에이전트 운용법은 다섯 줄로 모였다: 코드 전 완료 조건 · 통과/실패를 내는 확인 명령 · 주장이 아니라 명령+출력 · 초록이어도 실제로 돌려 보기 · 바깥 심판. 이 다섯이 `/clear` 와 세션 경계를 넘어 사라지지 않는 자리를 oculpm 에 박았다.

- **플랜 「확인 명령」 줄** — `planner::done_when` 에 `check_command`/`render_check_line`(`**확인 명령:**`/`**Check:**`), `plan_create` 의 `check` 인자(스키마 포함), `plan_status` 응답 `check`. claude·codex `plan-context.sh` 가 완료 조건 다음 줄로 싣는다.
- **plan_update 닫기 안내** — 마지막 미완 항목(deferred 제외)을 `done` 으로 닫으면 응답 `warnings` 에 「항목 완료는 목표 달성이 아니다 — 확인 명령 `…` 을 돌려 완료 조건 「…」을 판정하고 로그에, 합류 전 /oculpm:redteam」. 막지 않는다.
- **훅 all-done 줄** — 항목이 전부 `[x]` 인데 아직 active 인 플랜은 `[plan: id] 항목 전부 닫힘 — 완료 조건이 참인지 판정 후 닫기: …` 한 줄(최대 3개).
- **journal_write 「명령만 있고 결과 없음」 경고** — `evidence::command_without_result`: 검증 칸에 cargo/pnpm/pytest 류 명령 이름은 있는데 결과 토큰(N passed · exit 0 · 통과 · 실측 수치)이 없으면 경고. 등급(`evidence_level`)은 성적표 스크립트와 계약이라 그대로.
- **템플릿 v17** — §2 검증 칸 「명령과 그 결과 끝 줄… 명령 이름만도 증거가 아니다」, §4 새 plan 은 완료 조건+확인 명령. ko 4,755 / en 6,490 chars.
- **스킬** — `next` 는 완료 조건·확인 명령을 읽고 최소 구현 대신 완료 조건을 참으로 만드는 구현을 고르며, 끝에 확인 명령을 돌려 결과 끝 줄을 검증 칸에 적고, 가능하면 실제로 띄워 본다. `inception`·`project-inception` 은 `plan_create` 에 `done_when`·`check` 필수.
- **「약속 성적표」** — `db::scorecard`(순수 `compute`: 증거 비율 = bug/feature/refactor 중 evidence==2, 7일 재수정 = bug/error 중 앞 7일 feature/refactor 가 같은 비허브 파일을 만진 비율, 허브 = 전 기간 일지 3% 이상·최소 3건, `.oculpm/` 제외 — `agent-report-card.py` 와 같은 정의) + `commands::scorecard::oculpm_promise_scorecard`(활성 플랜 중 완료 조건·확인 명령 있는 수는 플래너 디스크에서) + Today `PromiseScorecardCard`(지표·지금·목표 3행, PROMISE.md 의 97% / ≤30% / 전부, 분모 0 은 「—」).
- **영수증 롤업** — `RollupSourceEntry.evidence`, 주간 요약에 `## 검증 안 된 것` 절(증거 없는 bug/feature/refactor)과 요약 문단의 「N건 중 M건은 검증 칸에 명령 증거」 문장, 롤업 대화상자에 마크다운 복사 버튼.
- **내세우기** — PROMISE.md 「에이전트 운용 다섯 원칙 → 자리」 표(출처·기계가 지키는 것)와 측정 목표에 「확인 명령 있는 플랜 1/14」 행, README ko/en 「왜 결과가 좋아지나」 절, 랜딩 ko/en `#why` 절(여섯 셀, 마지막은 「못 주는 것: 야망 자체」)과 featureList, plugin.html plan_create 행에 done_when·check.

## 동작 흐름

세션 시작 → 훅이 플랜마다 `**완료 조건:**` → `**확인 명령:**` → 미완 항목을 싣고, 전부 닫힌 active 플랜은 한 줄로 → 에이전트가 항목을 구현하고 확인 명령을 돌려 결과 끝 줄을 검증 칸에 → `journal_write` 가 명령만/증거 없음을 경고 → 마지막 항목을 닫는 `plan_update` 가 완료 조건 판정·redteam 을 안내 → 사람은 Today 성적표에서 증거 비율·재수정률을 목표와 보고, 주간 요약을 복사해 코드를 안 보는 사람에게 건넨다.

**발견한 결함(별도 수정 아님, 기록):** 이 기기의 설치 플러그인(3.3.0, 프로젝트 범위) MCP 는 `done_when` 을 모르고 조용히 버려서, 10-27~28 에 MCP 로 만든 플랜 셋(ambition·record-quality·best-results)에 완료 조건 줄이 없었다. 손으로 넣었다(활성 14/14). `/plugin update oculpm@oculpm` 전까지 새 인자는 전부 같은 운명이다.

## 검증

- `cargo test --lib` 1846 passed · 0 failed (done_when 3 · evidence 3 · db::scorecard 1 · commands::scorecard 1 · rollup::generate 8 · agents::tests 템플릿 예산/버전 패리티 · plan_goal 2 · export_bindings)
- `cargo test --test plugin_xplat` 7 passed (확인 명령 줄 · all-done 줄 단언 포함) · `cargo fmt` · `cargo clippy --all-targets --locked -D warnings` 경고 0
- `pnpm typecheck` exit 0 · `pnpm test` 259 files / 3290 passed (새 `today_scorecard_card.test.tsx` 4건) · `pnpm lint` 6게이트 clean(경고 4는 기존) · `pnpm build` ✓ built
- 설치본에서의 육안(Today 카드 · 훅 출력)은 사용자 확인 대기 — `{#eyes-scorecard}` `{#eyes-hook-check}`

## 메모

- 래칫: `mcp/tools/mod.rs` 789→795줄(한계 800). 다음 경고 하나면 갈라야 한다.
- 성적표 정의를 바꾸면 `docs/launch/agent-report-card.py` 도 같이 — 두 숫자가 갈라지면 둘 중 하나가 거짓이다.
- 삭제 후보는 결정 자료만 플랜에 적었다(10월 fix 분포: 보안 18 · 터미널 10 · 색인 5 · 워처 4 · 편집기 2 · 핵심 화면 2). 결정은 사용자 몫.