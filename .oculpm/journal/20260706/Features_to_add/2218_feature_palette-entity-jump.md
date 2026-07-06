---
schema_version: 1
type: feature
slug: palette-entity-jump
status: done
difficulty: high
created_at: "2026-07-06T22:18:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/tests/entity_search.rs
    op: create
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/lib/navRegistry.ts
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - 20260706/Features_to_add/2131_feature_nav-registry-shortcuts.md
tags: ["v2-release", "U7", "command-palette", "go-to-anything", "search"]
---

[x] U7 팔레트 엔티티 점프 — ⌘K 에서 일지·플랜·토의·문서를 제목으로 바로 열기

## 추가 기능

- **백엔드 `oculpm_search_entities(project_id, query, limit)`**: 일지(title/slug)·플랜(title/plan_id)·플랜 항목(title, 플랜 제목 subtitle)·토의(title/id) 4개 캐시 테이블을 kind 별 쿼리로 검색, prefix 매치(0) > substring(1) 스코어 후 최신순 병합. LIKE 와일드카드 이스케이프, limit clamp 1..50. `EntityHit { kind, id, title, subtitle }` — id 는 라우팅 키(journal=relative_path, plan_item="plan#item").
- **팔레트 통합**: 2자 이상 입력 시 120ms debounce 로 "바로가기" 그룹 표시(엔티티 8 + docs 4). docs 파일은 캐시 테이블이 없어 `docs_tree` 를 팔레트 오픈 동안 1회 캐시해 클라이언트 필터. 백엔드가 이미 매칭한 항목은 `keywords=[search]` 로 cmdk 필터를 항상 통과.
- **라우팅**: `NAV_BUS.openEntity` CustomEvent → ShellV2 리스너. journal→`openEntryPath`(워크데이 밖 과거 엔트리도 해소), plan/plan_item→`plannerPlanId`, discussion→`discussionActiveId`, doc→`docsActivePath`. 플래너/토의/문서는 영속 필드를 mount 시에만 읽으므로 **jumpNonce 로 remount 강제** — 같은 화면에 있어도 점프가 반영된다.

## 동작 흐름

⌘K → "v2" 타이핑 → 바로가기: 플랜 "v2.0.0 대규모 업데이트…" / 일지 "U1 내비…" → Enter → 해당 화면+항목 즉시 오픈.

## 검증

- Rust 통합 테스트 3개 신설 (`tests/entity_search.rs`): 4-kind 병합+prefix 랭킹+plan_item 라우팅 키, `%` 와일드카드 이스케이프(전행 반환 방지), limit/프로젝트 격리/공백 쿼리.
- cargo test **335 passed / 0 failed** (bindings.ts 재생성: oculpmSearchEntities + EntityHit).
- 프런트 게이트: typecheck=0 / test=0 / lint=0 / build=0.
