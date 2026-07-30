---
schema_version: 1
type: feature
slug: "plan-3depth-rollup"
status: done
difficulty: high
created_at: "2026-07-31T02:19:59+09:00"
session_id: "mcp-20260731-021959"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/oculpm/reconcile.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "docs/planner-upgrade/01-data-model-and-markdown-spec.md"
    op: update
related: []
tags:
  - "planner"
  - "3depth"
  - "rollup"
  - "plugin-round"
  - "mcp-tool"
---
[x] 3-depth 플랜 계층 — 부모 롤업·리프 집계·중첩 생성/와이어 (plan-3depth)

## 추가 기능

plugin-round Phase C {#plan-3depth} (Decision 2 확정 형태). 파서·DTO·UI 들여쓰기·캐시에 이미 있던 중첩 인식 위에 **의미론**을 완성:

1. **부모 = 하위 롤업** (`parse.rs::rollup_status`): dropped 모수 제외 → 전부 dropped 면 Dropped · blocked 최우선 · done/todo/deferred 균일값 · 혼합 InProgress. 파서가 하위 가진 항목의 상태를 글리프와 무관하게 파생시키고, 쓰기 경로(`set_item_status_rolled` — 앱 UI·MCP·reconcile 3경로 전부 교체)가 하위 변경 시 부모 글리프를 함께 정규화. **부모 직접 설정은 거부** (phase 와 동일 — 설정할 수 있는 상태가 아님).
2. **집계는 리프 기준** (`parent_ids()` 헬퍼): progress()·요약 done/total·phase 진척·MCP plan_status 전부 — 부모 포함 시 하위 이중 가중으로 "1/3·100%" 류 모순이 생기던 것(리뷰 F3) 일괄 해소.
3. **와이어·생성**: plan_status TSV 에 `parent` 6열 + legend 파생값 주석, `plan_create` 에 `items[].children`(1단계 캡 — 손자는 명시 거부).
4. **UI**: 부모 행 글리프 버튼 비활성(툴팁 안내)·"완료?" 칩 억제 — 항상 실패하는 컨트롤 제거(리뷰 F2).
5. **템플릿 v7**: 중첩 문법·부모 갱신 금지 1줄 + "글리프가 정답" 독트린에 파생 예외 명시. AI reconcile 프롬프트 목록에서 부모 제외(조용한 no-op 재제안 루프 방지). 포맷 SSOT(docs/planner-upgrade/01) 에 §중첩과 롤업 추가.

## 동작 흐름

에이전트/plan_create 가 `  - [ ]` 중첩 작성 → 파서가 parent_item+롤업 파생 → 하위 갱신 시 부모 글리프 자동 정규화 → 레일/TSV/phase 진척은 리프 기준으로 일관.

## 검증

- 2관점 적대 검증 워크플로(기계·의미론) → HIGH 3·MED 5·LOW 3 전부 수정 또는 반영: dedup 방관자 덮어쓰기(M1 — 중복 id 시 정규화 스킵), 부모 삭제 시 하위 입양(M2 — 최상위 승격), 집계 불일치(F3), 탭 들여쓰기·### 입양(F7/L2), 템플릿 미전파(F1 — v7 bump), UI 데드엔드(F2), legend 거짓말(F4), AI 재제안 루프(F5), 스펙 문서(F6).
- 신규 테스트 9(롤업 어휘·파생 우선·정규화·부모 거부·방관자 불가침·승격·탭/### ·중첩 와이어 왕복) + 기존 계약 4건 갱신. cargo 392+통합 FAILED 0 · vitest 335 · typecheck/lint/build 그린.

## 메모

부모 글리프 정규화는 plan-log 행을 남기지 않는다(하위의 행이 원인 기록 — 스펙 문서에 명문화). 손자(4칸+)는 최상위로 평탄화(경고 없음, 문서화). 접기(collapse) UI 는 후속.