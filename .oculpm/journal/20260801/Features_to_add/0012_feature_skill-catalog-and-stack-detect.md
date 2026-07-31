---
schema_version: 1
type: feature
slug: skill-catalog-and-stack-detect
status: done
created_at: 2026-08-01T00:12:40+09:00
session_id: "manual-20260801-001127"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src/features/skills/skillsCatalog.ts, op: create }
  - { path: src/features/skills/catalog/python-patterns.md, op: create }
  - { path: src/features/skills/catalog/python-testing.md, op: create }
  - { path: src/features/skills/catalog/golang-patterns.md, op: create }
  - { path: src/features/skills/catalog/golang-testing.md, op: create }
  - { path: src/features/skills/catalog/rust-patterns.md, op: create }
  - { path: src/features/skills/catalog/rust-testing.md, op: create }
  - { path: src/features/skills/catalog/react-patterns.md, op: create }
  - { path: src/features/skills/catalog/react-testing.md, op: create }
  - { path: src/features/skills/catalog/security-review.md, op: create }
  - { path: src/features/skills/catalog/codebase-onboarding.md, op: create }
  - { path: src/features/skills/catalog/ponytail.md, op: create }
  - { path: src/features/skills/catalog/ponytail-review.md, op: create }
  - { path: src/features/skills/catalog/ponytail-audit.md, op: create }
  - { path: src/features/skills/catalog/LICENSE-ecc, op: create }
  - { path: src/features/skills/catalog/LICENSE-ponytail, op: create }
  - { path: src/__tests__/skills_catalog.test.ts, op: create }
  - { path: src-tauri/src/oculpm/stack_detect.rs, op: create }
  - { path: src-tauri/src/oculpm/mod.rs, op: update }
  - { path: src-tauri/src/commands/project.rs, op: update }
  - { path: src-tauri/src/lib.rs, op: update }
  - { path: src/lib/bindings.ts, op: update }
  - { path: src/features/skills/SkillsScreenV2.tsx, op: update }
related: []
tags: [skills, catalog, stack-detect, mit]
---

# 스킬 카탈로그 + 스택 감지 추천 ("스킬 쇼핑")

## 무엇을

사용자 아이디어(신규 프로젝트=인셉션 계획 단계에서, 기존 프로젝트=코드 스캔으로 — 필요한 스킬을 쇼핑하듯 추천) 구현 (플랜 R2).

- **C1 카탈로그 벤더링** — ECC·ponytail 에서 선별한 13종을 커밋 핀 사본으로 동봉(`src/features/skills/catalog/`, Vite `?raw` 임포트, 런타임 네트워크 0). 각 파일 frontmatter 직후 `vendored-from` 헤더(핀 SHA·MIT·수집일), 원문은 그 외 무수정. `skillsCatalog.ts` 에 태그(15종 어휘)·본문 토큰 추정치·요약 메타데이터. 검증 테스트 70개(헤더·40-hex 핀·태그 어휘·id↔파일 1:1·바이트 동일성·**MIT 허가 고지 전문 동봉**).
- **C2 스택 감지** — `detect_stack` 커맨드: 매니페스트 기반 결정적 감지(LLM·네트워크 0). 루트 + **하위 1단계** 매니페스트(Tauri 의 src-tauri/Cargo.toml 커버 — 이 저장소 자체가 미감지되던 도그푸딩 실패를 리뷰가 잡음), 워크스페이스 선언 시(pnpm-workspace.yaml·workspaces 필드·Cargo [workspace]) 2단계까지. 언어 태그는 존재 기반(깨진 매니페스트여도 유지), 프레임워크만 파싱 기반, peerDependencies 포함. 매니페스트 전무 시 얕은 확장자 폴백. 단위 테스트 14개.
- **C3 갤러리 추천 UI** — 스킬 탭 갤러리 모달에 "이 프로젝트 스택 추천" 섹션: 감지 태그 칩 + 태그 교집합 매칭 목록(출처·본문 토큰 표기) + 원클릭 설치(skills_save 재사용) + 전체 카탈로그 접기/펼치기 + MIT·토큰 안내 푸터.

## 적대 리뷰 반영 (12건 전부)

- react-patterns/react-testing 태그를 `["react",…]` 로 좁힘 — typescript·frontend 광역 태그가 Vue/TS백엔드 프로젝트에 React 스킬을 오추천하던 문제.
- stackTags 캐시: 프로젝트 전환 시 리셋 + fetch alive 가드(늦은 응답이 다른 프로젝트 추천 오염).
- MIT 라이선스 전문 2종(LICENSE-ecc·LICENSE-ponytail, 핀 커밋 원문) 동봉 — 헤더 1줄만으로는 재배포 조건 미준수.
- "설치됨" 판정이 폴더명 기준임을 title 문구로 정직화, "본문 ≈N tok"(발동 시 로드) 라벨로 상시 비용 오독 방지.

## 검증

cargo test 전체(stack_detect 14 포함) + pnpm typecheck/lint/vitest 전체/build 전부 exit 0. 적대 리뷰 워크플로 2 에이전트(스킬·벤더링 / 감지·UI) 지적 12건 반영 후 재게이트 그린.

## 메모

벤더 사본 무결성 원칙: 헤더 1줄 외 업스트림 원문 바이트 동일(리뷰 에이전트가 13종 전부 raw 대조 확인). 같은 라운드 R1 은 [[0011_feature_plugin-skills-v2-hardening]].
