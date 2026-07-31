---
schema_version: 1
type: feature
slug: "inception-v3-research-first"
status: done
difficulty: low
created_at: "2026-07-31T16:42:11+09:00"
session_id: "mcp-20260731-164211"
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
  - "user-flow"
  - "mcp-tool"
---
[x] project-inception v3 — 리서치 선행→근거 실린 대화로 사양 확정 + 기능 추가 반복 루프

## 추가 기능

사용자가 정의한 표준 흐름(웹 조사로 환경 탐색 → 대화로 최적 사양 구성 → 3-depth 상세 계획 → 구현, 기능 추가는 계획→구현 반복)에 맞춰 스킬 재구성:

- STAGE 0 축소: 리서치 방향을 정할 최소 질문만(문제·완성 정의·플랫폼·강한 제약)
- STAGE 1 환경 탐색(웹 리서치)을 대화 **앞**으로 — 후보 스택 버전·스캐폴드·함정을 먼저 조사
- STAGE 2 신설: **리서치 근거가 실린 객관식**으로 사용자와 사양 확정 ("A(버전·근거) vs B, 이 상황엔 A 추천")
- STAGE 3 계획: "3-depth 로 매우 자세히" 명시 — 리프=반나절 이하 검증 가능한 동사구, 구현 순서 배열
- **반복 루프 섹션 신설**: 기능 추가는 STAGE 3 부터(계획→▶실행 디스패치→일지→plan_update 반복), STAGE 0~2 는 낯선 영역일 때만
- description(영문)도 research→converse 순서로 갱신, 갤러리 항목 바이트 패리티 재생성

## 동작 흐름

플러그인 설치 → 새 프로젝트에서 스킬 발동 → 최소 문제 파악 → 웹 리서치 → 근거 실린 대화로 사양 확정(discussion resolved) → plan_create 3-depth → EVALS.md → rules → 이후 기능마다 계획→구현 루프.

## 검증

plugin_skills_sync 4/4(바이트 패리티), plugin_manifest 6/6(description 예산), typecheck/test/build/lint exit 0.