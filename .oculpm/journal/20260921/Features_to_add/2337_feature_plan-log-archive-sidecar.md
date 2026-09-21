---
schema_version: 1
type: feature
slug: "plan-log-archive-sidecar"
status: done
difficulty: high
created_at: "2026-09-21T23:37:07+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 P)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/log_archive.rs"
    op: create
  - path: "src-tauri/tests/plan_log_archive.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_create.rs"
    op: update
  - path: "src-tauri/src/oculpm/reconcile.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
related: []
tags:
  - "journal-scale"
  - "planner"
  - "mcp"
  - "mcp-tool"
---
[x] 넘친 plan-log 이력을 <plan_id>.log.md 로 분리 — 62KB 플랜 파일이 컨텍스트를 먹지 않게

## 추가 기능

플랜 `journal-scale-round` {#plan-log-archive}. 2차 웨이브 세션 P(Opus 5) 구현, 감독자 합류. PR #27. 프런트·bindings·i18n 변경 0.

근거: 플랜 57파일 690KB, `v3-release.md` 62KB(로그 표 102행)이고 표는 `plan_update` 마다 무한 성장. 로그는 이력이고 본문 글리프가 현재 상태.

- `LOG_KEEP = 40`, 초과분을 **문서 순서 기준 오래된 행부터** `<plan_id>.log.md`(frontmatter `oculpm_plan_log: v1`, 같은 표 헤더)로. 시각 문자열로 재정렬하지 않는다 — append-only 라 문서 순서가 곧 시간순.
- **아카이브를 본문보다 먼저 쓴다.** 반대면 다음 실패에서 행이 증발한다. 잠깐 양쪽에 남는 최악은 다음 분리의 중복 판정(시각+항목+변화)이 걷고, 읽기 병합에도 같은 열쇠.
- 판정 자리 = 로그 행을 append 하는 4경로의 끝, 같은 락 안: `plan_apply_edit`·`plan_ai_refresh`·MCP `plan_update`·`reconcile::cas_write_plan`. `plan_set_status(_bulk)` 는 append 경로가 아니라 무접촉(가는 곳이 잠금이라 정책상도 맞음). 잠긴 플랜은 영원히 분리되지 않는다.
- 해시: 분리 뒤 내용으로 `plan_update` 응답 hash 계산, 이어지는 갱신이 그 hash 로 통과(테스트).
- 아카이브는 플랜이 아니다 — 경로(`*.log.md`)와 내용(`oculpm_plan_log:`) 이중 판정, 플랜을 걷는 네 자리 전부(`find_plan_path`·`load_all_plans`·`plan_status`·`similar_active_plans`). 읽기는 `load_all_plans` 가 `merge_archived_updates` 로 덧대 캐시 `oculpm_plan_item_updates` 가 전체를 담아 이력 뷰·Today·related 귀속이 그대로.
- 마커 `<!-- oculpm:plan-log archived: N rows → <id>.log.md -->` 표 위/아래, 분리마다 걷고 다시 놓아 안 겹침. `append_log_row` 는 하단 마커 위로.
- 워처는 손댈 것이 없었다(`.oculpm/planner/` 접두사로 이미 Planner 영역). AGENTS 템플릿 §4 "`<id>.log.md` 는 아카이브" 한 줄(template_version 13, R 과 합쳐 한 번). `redact::CALL_SITE_FILES` 는 합류 후 실측 27.
- `project.rs` 851줄 래칫 기준선과 동일하게 맞추려 `match` 둘을 let-else 로.

## 검증

단위 8(문턱 아래 무접촉·40/62·멱등·2차 넘침·보존·식별·IO 왕복·무시) + MCP 3(사이드카·hash·잠긴 플랜 무접촉) + 통합 1(61행 이력 전부 보임). 통합 브랜치 전 게이트 exit 0. 기존에 넘친 플랜은 머지 뒤 첫 `plan_update` 에서 자연 분리(새 `.log.md` 가 git 에 추가됨 — 예상된 동작). 잠긴 플랜 63건 일괄 정리 버튼은 별도 항목으로.