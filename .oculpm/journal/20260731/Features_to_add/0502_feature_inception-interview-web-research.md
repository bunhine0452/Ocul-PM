---
schema_version: 1
type: feature
slug: "inception-interview-web-research"
status: done
difficulty: medium
created_at: "2026-07-31T05:02:39+09:00"
session_id: "mcp-20260731-050239"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/project-inception/SKILL.md"
    op: update
  - path: "src/features/skills/skillsGallery.ts"
    op: update
related: []
tags:
  - "plugin"
  - "skills"
  - "project-inception"
  - "interview"
  - "web-research"
  - "mcp-tool"
---
[x] project-inception 스킬 v2 — 사용자 인터뷰(1차)→웹 리서치(2차) 2단 구체화

## 추가 기능

정보가 부족한 채 계획을 지어내던 project-inception 스킬을 2단 구체화 구조로 재작성:

- **STAGE 0 인터뷰**: 문제/완성의 정의/비목표/사용자·규모/플랫폼/제약/선호 중 모르는 것 전부를 사용자에게 한 번에(객관식 보기 곁들여) 질문. 모호한 답은 재질문, 추측 금지.
- **STAGE 1 환경 리서치**: 사용자에게 묻지 않고 WebSearch/WebFetch 로 후보 스택 2~3개의 안정 버전·스캐폴드·베스트 프랙티스·개발 환경을 직접 조사, discussion 후보안에 버전·출처와 함께 반영. "기억 속 버전을 단정하지 말 것".
- STAGE 2 plan_create: Phase 1 첫 항목을 "리서치에서 확정한 버전으로 환경 구성·스캐폴드"로 고정.
- 금지 조항 확장: 인터뷰 생략·기억으로 버전 단정 금지.

## 동작 흐름

Claude Code 에서 스킬 발동 → 인터뷰 질문 일괄 제시 → 답변으로 discussion `## 문제 정의` 작성 → 웹 리서치로 `### 방안 {#opt-id}` 비교 → 결론 → plan_create 3-depth 계획 → EVALS.md → .claude/rules 시드. skillsGallery.ts 항목도 파일에서 재생성해 바이트 동일성 유지.

## 검증

`pnpm vitest run src/__tests__/plugin_skills_sync.test.ts` 4건 통과(갤러리-파일 바이트 패리티), `cargo test --test plugin_manifest` 6건 통과(설명 예산 ≤1,400자 포함). 전체 게이트 typecheck/lint/test/build/cargo 모두 exit 0.