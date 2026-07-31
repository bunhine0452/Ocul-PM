---
schema_version: 1
type: feature
slug: "skill-promotion-loop"
status: done
difficulty: medium
created_at: "2026-07-31T17:07:04+09:00"
session_id: "mcp-20260731-170704"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/skill_promotion.rs"
    op: create
  - path: "src-tauri/src/commands/skill_promotion.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/commands/summary.rs"
    op: update
  - path: "src-tauri/src/oculpm/rule_promotion.rs"
    op: update
  - path: "src/features/retro/SkillCandidates.tsx"
    op: create
  - path: "src/features/retro/RetroScreenV2.tsx"
    op: update
  - path: "src/__tests__/skill_promotion_v2.test.tsx"
    op: create
  - path: "src/__tests__/notion_export_v2.test.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "skill-promotion"
  - "retro"
  - "mcp-tool"
---
[x] 반복 절차→스킬 승격 루프 — 규칙 승격(ci4)의 미러

## 추가 기능

실패→규칙 승격 루프(PR-CI4)의 정확한 미러로, 반복 절차→스킬 승격 루프를 구현.
회고 화면이 기간 일지의 **tag 클러스터**(같은 tag 3회 이상, entry_type 무관)를 결정적으로 뽑아
"스킬 후보"로 제안하고, 사용자가 요청할 때만 LLM 이 SKILL.md 초안을 만들며,
저장은 기존 `skills_save`(scope=project, create=true) 승인 경로로만 이뤄진다 — 자동 적용 경로 부재.

- `oculpm/skill_promotion.rs`: 후보 추출(MIN_CLUSTER=3, CAP=6, 스톱리스트 9종+v버전태그 제외,
  기존 스킬 폴더/`<!-- promoted-from: tag:… -->` 마커 억제), slug 정규화, 증거 수집(디스크 SSOT
  redact 통과·500자), 한국어 프롬프트, SKILL.md 응답 파서(frontmatter 검증·마커 자동 부착). 단위 테스트 11.
- `commands/skill_promotion.rs`: `skill_candidates` / `skill_draft_generate` thin 커맨드 (rule_promotion 미러).
- `cache.rs`: `RangeEntry` 에 `tags` 필드 추가 + `range_entries` 가 files 와 같은 단일 조인으로 하이드레이션.
- `features/retro/SkillCandidates.tsx`: 후보 카드 + 초안 모달(슬러그 입력·description·본문 미리보기·거절/저장),
  세션 내 숨김, RuleCandidates 미러. RetroScreenV2 에 RuleCandidatesPanel 바로 아래 마운트. vitest 6(axe 포함).

## 동작 흐름

1. 회고 화면 진입 → `skill_candidates` (LLM 없음) → 후보 있으면 "스킬 후보" 카드.
2. [초안 생성] → `skill_draft_generate` (과금) → 증거 발췌로 SKILL.md 초안.
3. 모달에서 슬러그 확인/수정(frontmatter name 도 동기 치환) → [스킬로 저장] → `skills_save` → `.claude/skills/<slug>/SKILL.md`.
4. 저장본의 promoted-from 마커가 같은 tag 의 재제안을 억제.

## 검증

- `cargo test --lib` 478/478 그린 (skill_promotion 11 포함, bindings.ts 재생성).
- `pnpm test` 345/345 (신규 skill_promotion_v2 6 포함), typecheck·lint·build 전부 exit 0.