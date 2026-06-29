---
schema_version: 1
type: feature
slug: discussion-pr4-promote-today
status: done
difficulty: medium
created_at: "2026-06-29T12:34:21+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/discussion.rs
    op: update
  - path: src-tauri/src/oculpm/discussion/doc_edit.rs
    op: update
  - path: src/features/today/DiscussionPending.tsx
    op: create
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/features/discussion/DiscussionScreenV2.tsx
    op: update
related:
  - ./1234_feature_discussion-pr3-screen.md
tags: ["discussion-feature", "PR-DISC-4", "planner", "today"]
---

[x] 문제 해결(Discussion) PR-DISC 4 — 플래너 승격 브리지 + Today 노출

## 추가 기능

결정 전 문서를 결론 후 계획으로 잇는 다리.

- 백엔드 `discussion_promote_to_plan` — `## 다음 단계`를 새 `.oculpm/planner/<id>.md` 항목으로(plan_create + add_item 재사용, LLM 불필요), discussion 은 `set_resolution`(status=resolved + resolution_ref{plan_id,decided_at}) 로 잠금. plan_write_lock(N4) 직렬화. 이미 승격됨/다음단계 없음 가드.
- doc_edit `set_resolution` — frontmatter resolution_ref 중첩 매핑 idempotent 기입(기존 블록 교체).
- 프론트 승격 다이얼로그(다음 단계 미리보기→확인) → plannerPlanId 세팅 + 플래너 이동. resolved 헤더에 "→ 계획 보기" 링크.
- Today `DiscussionPending` 위젯 — open discussion "결정 대기 N건"(없으면 미표시), 클릭→문제 해결.

## 동작 흐름

승격 → 잠금 획득 → plan 골격+항목 write → discussion resolution 기입 → plan_id 반환 → 프론트가 플래너로 이동. 퍼널 문제해결→플래너 최초 연결.

## 검증

doc_edit set_resolution 2건(연결/교체) 포함 lib 312 green. 프론트 typecheck 0/test 124 green(today_v2 mock 에 discussionList 추가). build 성공.
