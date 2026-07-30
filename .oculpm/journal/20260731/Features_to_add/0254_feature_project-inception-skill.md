---
schema_version: 1
type: feature
slug: "project-inception-skill"
status: done
difficulty: medium
created_at: "2026-07-31T02:54:11+09:00"
session_id: "mcp-20260731-025411"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/project-inception/SKILL.md"
    op: create
  - path: "src/features/skills/skillsGallery.ts"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/__tests__/skills_gallery_v2.test.tsx"
    op: update
related: []
tags:
  - "skills"
  - "inception"
  - "methodology"
  - "plugin-round"
  - "mcp-tool"
---
[x] project-inception 스킬 — 아이디어를 설계 산출물 4종으로 시드 (IN0)

## 추가 기능

plugin-round Phase C {#in0-inception-skill}. 야망("시작부터 완벽한 설계")의 앞쪽 절반을 앱 기능이 아니라 **스킬**로 여는 방법론 캐리어:

- **STAGE 0~3 워크플로**: 문제 정의(3질문 인터뷰→discussion 문서, discussion-spec 규격) → 결론→**plan_create 로 3-depth 계획**("검증 가능한 동사구" 항목 규율) → **EVALS.md 완료 정의**(`## 기록` 표 규약 고정 — 회고 파서와 한 쌍) → **초기 .claude/rules 1~3개**(paths 스코프, 근거 있는 것만·범용 조언 금지).
- **성공 기준을 스킬 본문에 내장**: "문서를 만드는 것"이 아니라 기존 소비자 3개(discussion→플래너 승격, evals.rs 표 파서, rules paths 로더)가 **무수정으로 먹는 것**. 마무리 금지 조항으로 spec-kit-lite 화 방지(진척은 플래너로, 구현은 ▶실행 디스패치로).
- **배포 이원화**: 플러그인 `skills/` 동봉(5종째) + 앱 갤러리 등재 — vitest 동기 테스트가 바이트 동일성 강제(SSOT=플러그인 파일, 갤러리 문자열은 파일에서 생성). 매니페스트 예산 테스트 5종·상시 ~523 tok 실측(상한 내).

## 동작 흐름

새 프로젝트/기능 킥오프 → 스킬 발화 → discussion(문제·옵션·결론) → plan_create(3-depth) → EVALS.md → rules → 이후 항목별 ▶실행 디스패치로 구현 루프.

## 검증

- vitest 갤러리 동기 4케이스 + 갤러리 계약 테스트 4종화 갱신(첫 설치 대상 교체 포함) — 336 그린.
- cargo 매니페스트 5종·예산 테스트 그린, `plugin details` Skills 6(커맨드 포함)·Always-on ~523 tok 실측.
- typecheck/lint/build 그린. 실사용(스킬 발화→4종 산출물 실생성) 확인은 A0d 동승.