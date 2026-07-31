---
description: 새 프로젝트/기능 영역의 설계 시작 — 리서치→사양 확정→3-depth 계획→EVALS→rules 시드
---

# /oculpm:inception

`$ARGUMENTS` 가 있으면 그것을 아이디어로 삼는다 (없으면 무엇을 만들지 먼저 묻는다).

1. `.oculpm/` 이 없으면: "추적부터 시작할까요?" 를 물어보고, 동의 시
   `project_init` 도구(`confirm=true`)로 초기화한 뒤 계속한다.
2. **project-inception 스킬**을 따라 끝까지 진행한다: 최소 문제 파악 →
   웹 리서치로 환경 탐색 → 근거 실린 선택지로 사용자와 사양 확정(discussion
   resolved) → `plan_create` 로 3-depth 상세 계획 → `EVALS.md` → 초기
   `.claude/rules`.
3. 끝나면 계획의 Phase 1 첫 리프를 보여주고 제안한다:
   "구현을 시작하려면 `/oculpm:next` — 항목 하나씩 구현→일지→플랜 갱신으로 돕니다."
