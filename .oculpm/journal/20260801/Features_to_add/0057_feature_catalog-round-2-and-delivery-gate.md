---
schema_version: 1
type: feature
slug: catalog-round-2-and-delivery-gate
status: done
created_at: 2026-08-01T00:57:30+09:00
session_id: "manual-20260801-001127"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: src/features/skills/skillsCatalog.ts, op: update }
  - { path: src/features/skills/catalog/vue-patterns.md, op: create }
  - { path: src/features/skills/catalog/react-performance.md, op: create }
  - { path: src/features/skills/catalog/vite-patterns.md, op: create }
  - { path: src/features/skills/catalog/laravel-patterns.md, op: create }
  - { path: src/features/skills/catalog/springboot-patterns.md, op: create }
  - { path: src/features/skills/catalog/django-patterns.md, op: create }
  - { path: src/features/skills/catalog/fastapi-patterns.md, op: create }
  - { path: src/features/skills/catalog/accessibility.md, op: create }
  - { path: src/features/skills/catalog/api-design.md, op: create }
  - { path: src/features/skills/catalog/database-migrations.md, op: create }
  - { path: src/features/skills/catalog/e2e-testing.md, op: create }
  - { path: src/features/skills/catalog/inherit-legacy-style.md, op: create }
  - { path: src/__tests__/skills_catalog.test.ts, op: update }
  - { path: plugin/oculpm/hooks/delivery-gate.sh, op: create }
  - { path: plugin/oculpm/hooks/hooks.json, op: update }
  - { path: plugin/oculpm/hooks/session-marker.sh, op: update }
  - { path: plugin/oculpm/commands/help.md, op: create }
  - { path: plugin/oculpm/skills/oculpm-journal/SKILL.md, op: update }
  - { path: plugin/oculpm/skills/project-inception/SKILL.md, op: update }
  - { path: src/features/skills/skillsGallery.ts, op: update }
  - { path: src/features/skills/pluginDocs.ts, op: update }
  - { path: landing/plugin.html, op: update }
  - { path: src-tauri/tests/plugin_manifest.rs, op: update }
related: ["20260801/Features_to_add/0012_feature_skill-catalog-and-stack-detect.md"]
tags: [skills, catalog, plugin, hooks, delivery-gate]
---

# 카탈로그 2차(12종) + 배달 게이트 + /oculpm:help + 인셉션·일지 규율 이식

## 추가 기능

사용자 질문 "가져올 스킬·툴이 이게 다야?" → ECC 281종·ponytail 전체를 **전수 재감사**
(워크플로 6 에이전트: 4방향 스윕이 후보 91건 발굴 → 제품적합 판사 + 중복·유지비
회의론자 적대 심사). 양판사 합의 NOW 채택분을 실행:

- **카탈로그 2차 12종** (13→25종, 전부 ECC 핀 e4e4163): vue·laravel·springboot·
  django·fastapi(스택 감지가 방출하는데 벤더 0이던 공백 5종), react-performance·
  vite·accessibility·e2e-testing(프론트 축), api-design·database-migrations(범용),
  inherit-legacy-style(AI 스타일 드리프트 방지). 태그 협소화 원칙 유지,
  CATALOG_TAGS 9종 확장. 무결성: 헤더 1줄 외 업스트림 raw 와 바이트 동일 대조.
- **유니코드 위생 게이트**: 카탈로그 전 파일에 bidi(U+202A–202E·U+2066–2069)·
  제로폭(U+200B/C/D·FEFF·00AD) 문자 금지 테스트 — 제3자 콘텐츠 주입 파이프라인의
  스머글링 방어. 12종 전부 클린.
- **배달 게이트** (ponytail delivery-gate + ECC chief-of-staff 이식): Stop 훅이
  "이 세션에서 코드 변경이 있는데 일지가 없다"를 감지하면 세션당 1회 턴 종료를
  차단(exit 2)하고 일지 작성을 지시. 근거는 자체 벤치 실측(헤드리스 준수 0/12).
- **/oculpm:help**: 플러그인 표면 전체(커맨드 5·도구 5·스킬 5·훅) 레퍼런스 카드.
  문서 3표면(landing/plugin.html·인앱 pluginDocs·plugin 파일) 동기 갱신.
- **이식**: oculpm-journal 에 growth-log 학습 품질 규율(실패·막다른길 우선 기록),
  project-inception 에 product-lens 인터뷰 프레임 + plan-prd 증거 게이트 +
  리프 검증 방법 명시(plan Validate).

## 동작 흐름

배달 게이트: session-marker(기준점) → Stop 에서 stop_hook_active/1회 플래그/일지
존재 확인 → **세션 귀속 판정**(git porcelain 을 quotepath=off + show-prefix 보정
+ pathspec `-- .` 로 뽑고, 마커보다 mtime 이 새로운 .oculpm 밖 파일이 있을 때만)
→ exit 2 + 지시 문구. 적대 리뷰가 잡은 HIGH(기존 WIP 를 세션 변경으로 오판 —
병렬 세션 워킹트리가 정확한 반례)·MED 2건(한글 경로 quotepath 우회, 모노레포
prefix 무력화)·LOW 2건(rename 미탐, Linux date 폴백)을 전부 반영하고 스크래치
git 저장소 8개 시나리오로 기능 검증(기존 WIP 비발화·세션 변경 발화·한글 .oculpm
비발화·일지 후 통과·모노레포 양방향·재차단 금지·1회 플래그).

## 검증

cargo test 전체(plugin_manifest 새 잠금 11건 포함) + pnpm typecheck/lint/vitest
전체(카탈로그 169+)/build 전부 exit 0. 라운드 적대 리뷰 6건 전부 반영.

## 메모

미채택 합의분은 skill-catalog-round-2.md 백로그 8건에 기록 (훅 크로스플랫폼은
Windows 앱 트랙 동승 조건, 일지 스키마 확장은 실패원장+ADR+growth-log 병합 설계
필수 — 독립 이식 금지). 판사 양쪽 기각 11건은 재론 불요.
