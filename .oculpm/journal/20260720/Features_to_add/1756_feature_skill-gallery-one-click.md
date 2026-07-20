---
schema_version: 1
type: feature
slug: "skill-gallery-one-click"
status: done
difficulty: low
created_at: "2026-07-20T17:56:31+09:00"
session_id: "mcp-20260720-175631"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/skills/skillsGallery.ts"
    op: create
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/__tests__/skills_gallery_v2.test.tsx"
    op: create
related: []
tags:
  - "claude-integration"
  - "skills"
  - "edd"
  - "mcp-tool"
---
[x] PR-CI5 추천 스킬 갤러리 — self-audit·run-evals·tdd-workflow 원클릭 설치

## 추가 기능

마스터플랜 트랙4(검증·감사 루프)의 앞단. 스킬 탭 툴바에 "추천 스킬" 버튼(빈 상태에도 노출) → 갤러리 모달에서 검증 습관 스킬 3종을 프로젝트 스코프로 원클릭 설치.

- **템플릿 3종** (`skillsGallery.ts`, 순수 데이터 — 백엔드 무변경): `self-audit`(완료 선언 전 요구사항 대조·게이트 실행·diff 재검토·거짓 완료 방지), `run-evals`(EVALS.md 를 완료 정의로 실행·채점), `tdd-workflow`(실패 테스트 먼저→최소 구현→그린→리팩토링).
- **run-evals 가 EVALS.md `## 기록` 표 규약을 정의**: `| 날짜 | 스위트 | 통과수/전체수 | 메모 |`. PR-CI6 회고 eval 추이가 이 표를 파싱한다 — 스킬이 쓰는 형식과 회고가 읽는 형식이 한 곳에서 만난다. 템플릿에 형식 변경 금지 문구 포함.
- **설치 = 기존 `skills_save(create=true)` 재사용** — 갤러리 전용 백엔드 없음. 중복 가드는 UI "설치됨" 칩(프로젝트 스코프 dir_name 대조, 비활성 포함) + 백엔드 동명 거부의 이중.

## 동작 흐름

1. 스킬 탭 → "추천 스킬" → 갤러리 모달 (3종 라벨·요약·설치/설치됨).
2. 설치 → `skills_save(project, <id>, 템플릿, create=true)` → 목록 갱신 + 새 스킬 자동 선택.

## 검증

- `pnpm test` 163 passed — 신규 `skills_gallery_v2.test.tsx` 3건: 템플릿 규약(3종 id·frontmatter·기록 표 형식), 설치 클릭→skillsSave 인자 계약+axe, 기설치 "설치됨" 가드. 기존 skills_v2 회귀 0.
- typecheck/lint/build exit 0 (백엔드 무변경 — cargo 373 유지).