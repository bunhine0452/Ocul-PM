---
name: project-inception
description: Use when kicking off a new project or a new feature area in an ocul-pm tracked project (.oculpm/ present) — turns an idea into a problem statement (discussion doc), a 3-depth plan (plan_create), EVALS.md done-criteria, and starter .claude/rules, all in ocul-pm's file formats.
---

# project-inception — 아이디어를 설계 산출물로

새 프로젝트(또는 새 기능 영역)를 시작할 때, 아이디어를 ocul-pm 파일 체계에 **그대로 물리는** 4종 산출물로 바꿉니다. 성공 기준은 문서를 "만드는 것"이 아니라 — **기존 도구가 무수정으로 소비하는 것**입니다 (discussion→플래너 승격, EVALS→회고 추이, rules→에이전트 자동 로드).

## STAGE 0 — 문제 정의 (discussion)

1. 사용자에게 3가지만 짧게 확인: **누구의 어떤 문제**인가 · **완성의 정의**(무엇이 되면 성공?) · **비목표**(안 만드는 것).
2. `.oculpm/agents/discussion-spec.md` 를 읽고 그 규격대로 `.oculpm/discussion/<slug>/discussion.md` 를 만든다 — `## 문제 정의` 를 먼저, 후보 접근안은 `### 방안 {#opt-id}` 로 2개 이상, 트레이드오프 명시.
3. 사용자가 방안을 고르면 `## 결론` 을 쓰고 status 를 resolved 로.

## STAGE 1 — 계획 (plan_create)

결론을 **3-depth 계획**으로: `plan_create` MCP 도구로 phases(마일스톤) → items(작업) → children(하위 작업, 1단계)을 만든다. 항목은 "검증 가능한 동사구" 한 줄 — "로그인" 이 아니라 "이메일 로그인 happy-path 가 동작한다". 도구가 없으면 AGENTS.md §4 의 폴백 규격으로 직접 작성.

## STAGE 2 — 완료 정의 (EVALS.md)

프로젝트 루트에 `EVALS.md` 를 만든다: 결론의 "완성의 정의"를 **실행/재현 가능한 평가 항목**(체크리스트/시나리오)으로 옮기고, 맨 아래에 기록 표를 둔다:

| 날짜 | 스위트 | 통과 | 메모 |
|---|---|---|---|

이 표의 형식(날짜 · 스위트 · N/M)은 바꾸지 말 것 — ocul-pm 회고 화면이 그대로 파싱해 추이를 그린다 (run-evals 스킬이 실행·기록을 담당).

## STAGE 3 — 초기 규칙 (.claude/rules)

스택·결정에서 **근거가 있는 것만** 1~3개를 `.claude/rules/<name>.md` 로 남긴다. 조건부 규칙은 frontmatter `paths: ["src/api/**"]` 로 스코프를 좁힌다 (없으면 상시 로드 — 토큰 비용을 의식할 것). 범용 조언("좋은 코드를 쓰자")은 금지 — 이 프로젝트에서만 참인 제약만.

## 금지

- discussion 에 진척/실행 로그를 쌓지 말 것 — 그건 플래너·일지의 일.
- 산출물 4종(discussion·plan·EVALS.md·rules) 외의 문서를 남발하지 말 것.
- 평가 기준을 통과 가능하게 미리 약화하지 말 것 — 애매하면 사용자에게 묻는다.
- 이 스킬은 **설계 시드까지만** — 구현은 플래너의 ▶실행(디스패치)으로 항목 단위 진행.
