---
schema_version: 1
type: feature
slug: "v4-round-part1-design-plugin-journal"
status: done
difficulty: high
created_at: "2026-10-29T00:48:10+09:00"
session_id: "20261029-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/judge.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/digest.rs"
    op: create
  - path: "src-tauri/src/commands/today.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "plugin/oculpm/skills/inception/SKILL.md"
    op: update
  - path: "plugin/oculpm/skills/next/SKILL.md"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "src/features/oculpm/JournalDetail.tsx"
    op: create
  - path: "src/features/diff/ChangeFileList.tsx"
    op: create
related: []
tags:
  - "v4"
  - "simplify"
  - "planner"
  - "plugin"
  - "ui"
  - "mcp-tool"
---
[x] 4.0 라운드 1부 — 실효성 감사·시안 7장·판정 집계(today_digest)·템플릿 v20·inception/next·일지/변경 화면 (통합 브랜치, 합류 전 중단)

## 추가 기능

- **실효성 감사 → 4.0 범위 결정.** 앱 DB 실측: 837MB 중 임베딩 232MB·청크 126MB(코드 의미검색), `automation_runs` 0행, 이 저장소 주간 롤업 0건, `auto_reconcile`·`auto_journal_draft` false, 논의 18건/12프로젝트(마지막 09-21). 결론: 새로 짜지 않고 고친다(파일 규격·MCP·워처·서명/CI 가 fix 비용을 흡수한 자산), 화면 9→5(오늘·작업 일지·계획·변경·설정), 앱 안 LLM·자동화·색인·스킬/논의/브랜치 화면·트레이·테마 프리셋·마법사·밀도 토글·탭 떼어내기 제거. 계획 `v4-major-20261028`.
- **시안 7장**(비공개 아티팩트 YQPe5Po6FnZT3UL4aTaJET) — 「예외만 보여 준다」: 하루 58건/3건이 같은 Today. 진행 페이지 4kMaQaqhEui92Da9dzQTeV.
- **판정 집계 백엔드**: `planner/judge.rs`(plan-log 메모 `^(판정|verdict) (✓|✗)` — 시작 훅과 글자 그대로 같은 규칙) · `PlanSummary.last_verdict` · `planner/digest.rs` + 명령 `today_digest`(활성 플랜의 완료 조건·확인 명령·마지막 판정·다음 리프·사람 몫·막힘·일지→계획 연결, 재투영 1회). `project.rs` 래칫 836줄 유지.
- **플러그인 레인(Opus)**: 템플릿 v20 ko 4,028→2,783자 · en 6,038→4,606자, §1 Rieseberg(결과 다음·바깥 심판·원재료·어려운 숫자 목표·실패도 기록), §6 논의·discussion-spec 동기 제거, 플랜 수동 형식은 journal-spec.md v2 로. inception 재작성(고도→깊이 네 질문→범위→숫자 목표→빨간 판정 먼저), next 의 `[~]` 선점 + until-done, 시작 훅 「마지막 판정」 줄.
- **일지·변경 화면 레인(Sonnet)**: 목록+상세(검증 상자·인라인 diff·검색 합침), 변경은 기록 없음 먼저 + 기록 요청 배너. 기존 결함 둘 수정(검증 줄 정규식 `\b` 가 한글 뒤에서 안 맞던 것, `.oculpm/journal/` 접두 처리).

## 동작 흐름

통합 브랜치 `port/v4-major` = be4650f3(다른 세션 PR #113 끝) + digest 2 + plugin 5 + journal/changes 2. 남은 레인 넷은 사용자 요청(카페 → 집)으로 중단, 각 브랜치에 WIP 커밋: `v4/engine` f70d01fb · `v4/surfaces` 69f35816 · `v4/ui-shell` afddf413 · `v4/ui-today` 583101f5(오늘·계획 두 화면 커밋 완료). worktree 는 이 세션 scratchpad `wt/` 아래.

## 검증

- `cargo test --lib -- planner::judge planner::digest` → `test result: ok. 5 passed; 0 failed` (판정 파서·집계)
- 플러그인 레인 보고: `cargo test --locked --no-fail-fast` 1,678 passed · `pnpm test` 1913 passed · lint/build/fmt/clippy exit 0 (레인 worktree 기준)
- 일지·변경 레인 보고: `pnpm test` → `Tests 1906 passed (1906)` · typecheck/lint/build exit 0
- 통합 브랜치 전체 게이트는 **아직 안 돌렸다** — 남은 레인 합류 뒤 한 번에.