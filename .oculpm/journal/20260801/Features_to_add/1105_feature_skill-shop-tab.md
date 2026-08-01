---
schema_version: 1
type: feature
slug: skill-shop-tab
status: done
created_at: 2026-08-01T11:05:00+09:00
session_id: "manual-20260801-001127"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src/features/skills/SkillShopTab.tsx, op: create }
  - { path: src/features/skills/SkillsScreenV2.tsx, op: update }
  - { path: src/features/skills/skills.css, op: update }
  - { path: src/__tests__/skill_shop.test.tsx, op: create }
  - { path: src/__tests__/skills_catalog.test.ts, op: update }
  - { path: landing/plugin.html, op: update }
  - { path: plugin/oculpm/skills/project-inception/SKILL.md, op: update }
  - { path: src/features/skills/skillsGallery.ts, op: update }
related: ["20260801/Features_to_add/0057_feature_catalog-round-2-and-delivery-gate.md"]
tags: [skills, shop, catalog, ui]
---

# 스킬 샵 탭 — 카탈로그를 모달에서 정식 탭으로 승격

## 추가 기능

사용자 요청 "스킬 샵을 나도 볼 수 있게": 갤러리 모달 안에 숨어 있던 25종 카탈로그를
스킬·규칙 허브의 **샵 탭**(스킬 다음 자리)으로 승격. 스택 감지 추천 + 검색 +
태그 필터(aria-pressed) + 본문 미리보기 모달(Markdown, 핀 커밋 원본 링크) +
원클릭 설치. 갤러리 모달의 카탈로그 섹션은 샵 탭 포인터 버튼으로 대체(이중 유지
방지). oculpm.com/plugin 에 카탈로그 25종 표 섹션 추가 + 전 스킬 문서화를
skills_catalog 테스트 게이트로 강제.

**게이트 설계 결정**: 사용자가 "플러그인 설치 이용자만 보게?"라 물었으나 반대로
결론 — 설치되는 스킬은 `.claude/skills/` 의 Claude Code **네이티브** 기능이라
플러그인 없이도 동작한다. 게이트 없이 전원 노출 + 하단 안내 문구로 사실 고지.
skill_shop 테스트가 "플러그인 여부와 무관하게 렌더"를 회귀 조건으로 잠금.

## 동작 흐름

탭 진입 → skillsList(설치 판정)·detectStack(추천) 병렬 조회(alive 가드 + projectId
전환 리셋) → 추천 섹션(태그 교집합) + 전체 카탈로그(검색·태그 필터) → 행 클릭
미리보기 → 설치(skills_save create=true) → 목록 재조회.

## 검증

skill_shop.test.tsx 5종(렌더·추천·검색·설치 인자·미리보기 링크) + skills_catalog
문서 동기 게이트 + 전체 게이트(cargo test/typecheck/lint/vitest/build) exit 0.
적대 리뷰(react-reviewer) 2건 반영: sk-gallery-sec 미정의 CSS, 태그 필터
aria-pressed 누락.

## 메모

react-markdown 은 rehype-raw 미사용이라 제3자 SKILL.md 의 raw HTML 은 렌더되지
않음(리뷰 확인). 미리보기는 벤더 콘텐츠 표시의 안전 경로.
