---
schema_version: 1
type: chore
slug: "plans-18-to-4-hook-top3"
status: done
difficulty: medium
created_at: "2026-10-28T23:25:15+09:00"
session_id: "20261028-010"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/tech-backlog-20261028.md"
    op: create
  - path: ".oculpm/planner/polish-round-20261027.md"
    op: update
  - path: ".oculpm/planner/bug-opt-round-20261018.md"
    op: update
  - path: ".oculpm/planner/improvement-round-2026-09-14.md"
    op: update
  - path: ".oculpm/planner/native-agent-drivers.md"
    op: update
  - path: ".oculpm/planner/external-review-2026-10-08.md"
    op: update
  - path: ".oculpm/planner/first-record-loop.md"
    op: update
  - path: ".oculpm/planner/optimize-round-20261024.md"
    op: update
  - path: ".oculpm/planner/orca-editor-terminal-round.md"
    op: update
  - path: ".oculpm/planner/record-quality-round-20261027.md"
    op: update
  - path: ".oculpm/planner/ui-density-round-20261028.md"
    op: update
  - path: ".oculpm/planner/ui-density-round-3-20261028.md"
    op: update
  - path: ".oculpm/planner/any-project-best-results-20261028.md"
    op: update
  - path: ".oculpm/planner/ambition-round-20261027.md"
    op: update
  - path: ".oculpm/planner/artifact-board-drop-notion.md"
    op: update
  - path: ".oculpm/planner/best-results-round-20261028.md"
    op: update
  - path: ".oculpm/planner/compact-chrome.md"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "src-tauri/tests/plugin_hook_no_plan.rs"
    op: update
related: []
tags:
  - "planner"
  - "hooks"
  - "simplify"
  - "mcp-tool"
---
[x] 활성 플랜 18→4 + 시작 훅 최근 갱신 3개

## 동기
활성 플랜 18개에 미완 항목 100여 건 — 시작 훅은 24줄 상한 때문에 앞 플랜 둘셋만 싣고 나머지는 어떤 세션에도 실리지 않았다. 사용자 승인 5번: 끝난 라운드 플랜을 닫되 미완은 살아 있는 플랜으로 옮겨 유실 0.

## 변경 요약
- 살아 남은 넷: `simplify-round-20261028`(진행 중) · `polish-round-20261027`(완료 조건을 고쳐 **확인 날·사용자 결정 받은함**으로 — 모든 `[사용자]` eyes·결정·액션이 여기) · `tech-backlog-20261028`(plan_create, 근거 있는 기술 부채 9건) · `cross-platform-port`(W5 졸업, 2027-01 기한).
- 닫은 14개 플랜의 미완 86항목: 옮김 `[>]` 46(각 항목 끝에 `→ 대상플랜 #id`), 폐기 `[-]` 38(터미널·편집기·ACP·보드·네이티브 드라이버 — 기능이 사라져 질문도 사라진 것, 사유를 항목 끝에), 완료 `[x]` 2(사용자 결정 「걷음」·README 재편). 옮긴 항목은 걷은 화면 몫을 뺀 문구로 다시 적었다(예: 보안 실기기에서 xterm·CodeMirror·Notion 제거). `native-agent-drivers` 는 한 항목도 못 하고 닫혀 `archived`, 나머지는 `done`. 각 플랜 로그에 항목별 행 + `active→done` 행.
- 유실 0 확인: 닫은 15개 파일에 `[ ]`·`[~]`·`[!]` 0 (스크립트 assert) · plan_status 의 `locked_open` 20플랜/63항목이 **그대로**(이번 닫기가 받은함에 한 건도 더하지 않음).
- 훅 `plan-context.sh`(두 플러그인 동일): 활성 플랜을 frontmatter `updated:` 내림차순(같은 날은 파일명)으로 정렬해 **상위 3개**만 싣고, 더 있으면 「활성 플랜 N개 중 최근 갱신 3개만 실었다 — 나머지는 plan_status 로」 한 줄. `$total개` 가 bash 3.2 에서 변수 이름으로 먹혀 깨진 글자가 나와 `${total}개` 로.
- 테스트 `plugin_hook_no_plan.rs`: 플랜 넷(updated 09-01·10-10·10-27·10-28) → 셋만, 순서는 최근 먼저, 가장 오래된 것은 빠짐, 안내 줄 존재.

## 검증
- `python3 plans_fold.py` → 15 플랜 처리, assert 통과(미완 0) · `grep -h '^status:' .oculpm/planner/*.md | sort | uniq -c` → active 4 · archived 27 · done 51
- MCP `plan_status` → plans 4 · items 52 · locked_open {plans 20, items 63} (변동 없음)
- `cargo test --test plugin_hook_no_plan` → 5 passed · `--test plugin_xplat` 6 · `--test resume_context` 5 · `sh -n plan-context.sh` OK

## 메모
plan frontmatter `status:`·`updated:` 를 손으로 고쳤다 — 템플릿 §4 는 「미완을 옮긴 뒤 닫으라」 는 조건부 허용이고, 앱의 `set_plan_status` 와 같은 검사(열린 잎 0)를 스크립트가 먼저 했다. 사용자 몫 항목은 polish-round 에 31건 — 확인 날이 길다.