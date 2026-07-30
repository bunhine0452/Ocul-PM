// PR-CI5 — 추천 스킬 갤러리 데이터 (마스터플랜 트랙4 / EDD-lite 의 앞단).
//
// 백엔드 없이 순수 데이터다: 설치는 기존 `skills_save`(create=true) 를 그대로
// 재사용하고, 중복 가드는 (a) UI 의 "설치됨" 상태 + (b) skills_save 의 동명
// 거부가 이중으로 막는다. `run-evals` 템플릿이 EVALS.md 의 `## 기록` 표 규약을
// 정의한다 — PR-CI6 회고 eval 추이가 같은 표를 파싱한다 (형식 변경 금지).

export interface GallerySkill {
  /** `.claude/skills/<id>/SKILL.md` 폴더명 (kebab-case). */
  id: string;
  /** 목록 표시명 (한국어). */
  label: string;
  /** 목록 부제 — 뭘 해주는 스킬인지 한 줄. */
  summary: string;
  /** SKILL.md 전문 (frontmatter 포함). */
  content: string;
}

export const GALLERY_SKILLS: GallerySkill[] = [
  {
    id: "project-inception",
    label: "project-inception — 아이디어를 설계 산출물로",
    summary: "새 프로젝트/기능의 시작을 문제정의(discussion)→3-depth 계획→EVALS.md→초기 rules 로 시드합니다",
    content: `---
name: project-inception
description: Use when kicking off a new project or a new feature area in an ocul-pm tracked project (.oculpm/ present) — turns an idea into a problem statement (discussion doc), a 3-depth plan (plan_create), EVALS.md done-criteria, and starter .claude/rules, all in ocul-pm's file formats.
---

# project-inception — 아이디어를 설계 산출물로

새 프로젝트(또는 새 기능 영역)를 시작할 때, 아이디어를 ocul-pm 파일 체계에 **그대로 물리는** 4종 산출물로 바꿉니다. 성공 기준은 문서를 "만드는 것"이 아니라 — **기존 도구가 무수정으로 소비하는 것**입니다 (discussion→플래너 승격, EVALS→회고 추이, rules→에이전트 자동 로드).

## STAGE 0 — 문제 정의 (discussion)

1. 사용자에게 3가지만 짧게 확인: **누구의 어떤 문제**인가 · **완성의 정의**(무엇이 되면 성공?) · **비목표**(안 만드는 것).
2. \`.oculpm/agents/discussion-spec.md\` 를 읽고 그 규격대로 \`.oculpm/discussion/<slug>/discussion.md\` 를 만든다 — \`## 문제 정의\` 를 먼저, 후보 접근안은 \`### 방안 {#opt-id}\` 로 2개 이상, 트레이드오프 명시.
3. 사용자가 방안을 고르면 \`## 결론\` 을 쓰고 status 를 resolved 로.

## STAGE 1 — 계획 (plan_create)

결론을 **3-depth 계획**으로: \`plan_create\` MCP 도구로 phases(마일스톤) → items(작업) → children(하위 작업, 1단계)을 만든다. 항목은 "검증 가능한 동사구" 한 줄 — "로그인" 이 아니라 "이메일 로그인 happy-path 가 동작한다". 도구가 없으면 AGENTS.md §4 의 폴백 규격으로 직접 작성.

## STAGE 2 — 완료 정의 (EVALS.md)

프로젝트 루트에 \`EVALS.md\` 를 만든다: 결론의 "완성의 정의"를 **실행/재현 가능한 평가 항목**(체크리스트/시나리오)으로 옮기고, 맨 아래에 기록 표를 둔다:

| 날짜 | 스위트 | 통과 | 메모 |
|---|---|---|---|

이 표의 형식(날짜 · 스위트 · N/M)은 바꾸지 말 것 — ocul-pm 회고 화면이 그대로 파싱해 추이를 그린다 (run-evals 스킬이 실행·기록을 담당).

## STAGE 3 — 초기 규칙 (.claude/rules)

스택·결정에서 **근거가 있는 것만** 1~3개를 \`.claude/rules/<name>.md\` 로 남긴다. 조건부 규칙은 frontmatter \`paths: ["src/api/**"]\` 로 스코프를 좁힌다 (없으면 상시 로드 — 토큰 비용을 의식할 것). 범용 조언("좋은 코드를 쓰자")은 금지 — 이 프로젝트에서만 참인 제약만.

## 금지

- discussion 에 진척/실행 로그를 쌓지 말 것 — 그건 플래너·일지의 일.
- 산출물 4종(discussion·plan·EVALS.md·rules) 외의 문서를 남발하지 말 것.
- 평가 기준을 통과 가능하게 미리 약화하지 말 것 — 애매하면 사용자에게 묻는다.
- 이 스킬은 **설계 시드까지만** — 구현은 플래너의 ▶실행(디스패치)으로 항목 단위 진행.
`,
  },
  {
    id: "self-audit",
    label: "self-audit — 완료 선언 전 자기 감사",
    summary: "\"다 했다\"고 말하기 전에 요구사항 대조·게이트 실행·diff 재검토를 강제합니다",
    content: `---
name: self-audit
description: 작업을 "완료"라고 보고하기 직전, 스스로 결과를 감사할 때. 커밋/PR 직전 최종 점검에도 사용.
---

# self-audit — 완료 선언 전 자기 감사

작업을 끝냈다고 말하기 전에, 아래를 스스로 검증하고 결과를 한 줄씩 보고하세요.

## 절차

1. **요구사항 대조** — 사용자가 요청한 것을 다시 읽고, 산출물이 각 항목을 실제로 충족하는지 하나씩 대조한다.
2. **게이트 실행** — 프로젝트의 빌드/테스트/린트 명령을 실제로 실행하고 exit 0 을 확인한다 (추측 금지).
3. **diff 재검토** — 변경 diff 를 처음 보는 리뷰어의 눈으로 훑고 디버그 잔재, 주석 처리된 코드, 의도치 않은 파일, 누락된 에지 케이스를 찾는다.
4. **거짓 완료 방지** — 실패했거나 건너뛴 것이 있으면 "완료" 대신 실제 상태를 그대로 보고한다.
5. 발견된 문제는 고치고 1~4 를 반복한다. 두 번 연속 깨끗하면 완료를 선언한다.

## 보고 형식

- 각 단계 결과를 ✅/❌ 로 한 줄씩 보고한다.
- ❌ 가 하나라도 남아 있으면 완료를 선언하지 않는다.
`,
  },
  {
    id: "run-evals",
    label: "run-evals — EVALS.md 평가 실행·기록",
    summary: "프로젝트의 완료 정의(EVALS.md)를 실제로 실행·채점하고 추이 표에 기록합니다",
    content: `---
name: run-evals
description: 기능 구현·수정을 마친 뒤 프로젝트의 EVALS.md 평가 기준을 실행/채점할 때. "evals 돌려줘" 요청이나 완료 게이트 검증에 사용.
---

# run-evals — EVALS.md 평가 실행

프로젝트 루트의 \`EVALS.md\` 가 이 프로젝트의 **완료 정의(definition of done)** 입니다.

## 절차

1. \`EVALS.md\` 를 읽고 평가 항목(체크리스트/시나리오)을 파악한다. 파일이 없으면 사용자에게 만들지 물어본다.
2. 각 항목을 **실제로 실행/재현**해 통과 여부를 판정한다 — 코드를 읽고 "될 것 같다"로 판정하지 않는다.
3. 결과를 \`EVALS.md\` 의 \`## 기록\` 표에 한 줄 append 한다 (표가 없으면 아래 형식으로 만든다):

| 날짜 | 스위트 | 통과 | 메모 |
|---|---|---|---|
| YYYY-MM-DD | 스위트명 | 통과수/전체수 | 실패 요약 |

4. 실패 항목은 원인을 조사해 보고하고, 수정 후 재실행한다.

## 규칙

- \`## 기록\` 표의 형식(날짜 · 스위트 · N/M)은 바꾸지 않는다 — ocul-pm 회고 화면이 이 표를 읽어 추이를 그린다.
- 통과율을 부풀리지 않는다. 애매하면 실패로 센다.
- 평가를 통과시키기 위해 평가 기준을 약화시키지 않는다 — 기준을 바꿔야 하면 이유를 보고하고 승인 받는다.
`,
  },
  {
    id: "tdd-workflow",
    label: "tdd-workflow — 테스트 먼저",
    summary: "실패하는 테스트를 먼저 쓰고 최소 구현→그린→리팩토링 사이클을 강제합니다",
    content: `---
name: tdd-workflow
description: 새 기능·버그 수정을 테스트 먼저(TDD)로 진행할 때. "TDD로 해줘", "테스트 먼저" 요청이나 회귀가 잦은 영역 작업에 사용.
---

# tdd-workflow — 테스트 먼저

## 절차

1. **실패하는 테스트 먼저** — 구현 전에 기대 동작을 테스트로 적고, 실행해 **실패를 눈으로 확인**한다 (버그 수정이면 재현 테스트).
2. **최소 구현** — 그 테스트를 통과시키는 최소한의 코드만 쓴다.
3. **그린 확인** — 새 테스트 + 기존 스위트 전체를 실행해 회귀가 없음을 확인한다.
4. **리팩토링** — 그린을 유지하며 정리하고, 끝나면 스위트를 다시 돌린다.
5. 다음 동작 단위로 1~4 를 반복한다.

## 규칙

- 테스트가 실패하는 것을 보기 전에는 구현을 시작하지 않는다 (통과부터 하는 테스트는 아무것도 증명하지 못한다).
- 테스트를 통과시키려고 테스트를 약화시키지 않는다 — 기대를 바꿔야 하면 이유를 사용자에게 보고한다.
- 커버리지 숫자보다 시나리오: 해피패스 1개 + 에지 케이스 2개 이상을 기본으로 한다.
`,
  },
];
