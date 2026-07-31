---
schema_version: 1
type: feature
slug: plugin-skills-v2-hardening
status: done
created_at: 2026-08-01T00:11:27+09:00
session_id: "manual-20260801-001127"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: plugin/oculpm/skills/self-audit/SKILL.md, op: update }
  - { path: plugin/oculpm/skills/run-evals/SKILL.md, op: update }
  - { path: plugin/oculpm/skills/tdd-workflow/SKILL.md, op: update }
  - { path: plugin/oculpm/skills/project-inception/SKILL.md, op: update }
  - { path: src/features/skills/skillsGallery.ts, op: update }
related: []
tags: [plugin, skills, ecc, ponytail]
---

# 플러그인 스킬 3종 v2 강화 (ECC·ponytail 이식)

## 무엇을

ECC(affaan-m/ecc) 281종 전수 조사 + ponytail 6종 정독에서 채택한 규율을 우리 플러그인 스킬 3종에 이식했다 (플랜 R1).

- **self-audit v2** — 자유 산문 리뷰 금지: 고정 태그(debris/gap/gate/unlogged/secret) 1발견 1줄 형식 강제, `net: <N> findings, <M> fixed.` / `clean. ship.` sentinel, 보고 전 신뢰도 게이트 4문항, 오탐(false-positive) 제외 목록. 적대 리뷰 지적으로 **위치 없는 발견(gate/unlogged)의 형식 예외**를 추가 — 일지 미작성·게이트 실패는 파일:라인이 구조적으로 없어서, 예외가 없으면 규칙대로 발견을 버리거나 라인 번호를 날조하게 되는 자기모순이 있었다.
- **run-evals v2** — capability/regression 이원화(새 기능만 돌리고 회귀를 건너뛰는 패턴 차단), 결정적 체크 1순위 grader 서열, 루브릭 4점 이상=통과 합격선 고정, "사람 확인 대기"는 분모 제외, "베이스라인 없는 수치 금지" 정직성 룰.
- **tdd-workflow v2** — 컴파일 실패도 유효한 RED 인정, 체크포인트 커밋 규격(test:→fix:/feat:→refactor:), 증거 표(보장|테스트|RED 확인|GREEN 명령). 증거 표는 `## 검증`(1~3줄 규격)과 충돌하지 않도록 **`## 메모` 배치**로 정정.
- **project-inception** — 사양 확정 직후 "스택 감지 기반 갤러리 추천(2~3개 권장)" 안내 1줄 (R2 C4 연결 고리).

갤러리 미러(skillsGallery.ts)는 4종 전부 바이트 동일 재생성 (plugin_skills_sync 가드 그린).

## 왜

세 스킬 모두 v1 은 "잘 하라"는 산문 지침이라 에이전트가 형식을 흘려버렸다. ECC 의 형식 강제(고정 태그·sentinel)와 ponytail 의 신뢰도 게이트가 정확히 이 드리프트를 막는 장치라 이식했다.

## 검증

cargo test 전체 + pnpm typecheck/lint/vitest(플러그인·갤러리 sync 포함)/build 전부 exit 0. 라운드 적대 리뷰 워크플로(2 에이전트)가 지적한 스킬 자기모순(HIGH)·규격 충돌(MED)·합격선 미정의(LOW) 전부 반영 후 재게이트.

## 메모

벤더 카탈로그(R2)와 같은 라운드 — 상세는 [[0012_feature_skill-catalog-and-stack-detect]] 참조. 플랜: skill-catalog-round #self-audit-v2 #run-evals-v2 #tdd-workflow-v2 #inception-hook.
