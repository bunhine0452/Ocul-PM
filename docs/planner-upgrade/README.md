# Planner Upgrade — AI-maintained Living Plan

> 위상: Planner 를 *수동 goal/subtask CRUD* 에서 **AI 가 작성·자기갱신하는 살아있는 계획 문서**로 승격하는 라운드의 문서 세트.
> 작성일 2026-06-07. 작성 도구 attribution: claude-code (Opus 4.8).
> 형식 선례: [`../Lite-update/Fianl_UI_update_before1.0/`](../Lite-update/Fianl_UI_update_before1.0/) (특히 `05-implementation-checklist.md` 의 *살아있는 진척표* 형식).

## 한 줄 요약

일지(Journal)가 *AGENTS.md 프로토콜로 AI 가 `.oculpm/journal/` 에 마크다운을 drop → watcher 가 인덱싱* 하듯, **Planner 도 `.oculpm/planner/*.md` 를 SSOT 로 두고 AI 가 작업 진행에 맞춰 자기갱신**한다. 누가(어떤 AI 가) 갱신했는지 항목별로 기록한다.

## 확정된 방향 (사용자 결정 2026-06-07)

- **작성 모델 = 파일 기반(.md SSOT) + watcher.** SQLite 는 투영(캐시). (다른 후보: SQLite+AI 커맨드 — 기각, 에이전트 불문성/​git 추적성 약함.)
- **다음 단계 = 설계 문서 우선** (본 세트), 잠금 후 구현.

## 문서

| # | 문서 | 내용 |
|---|---|---|
| 00 | [`00-master-plan.md`](./00-master-plan.md) | SSOT. 컨셉, 일지와의 구분(불변식), scope/non-goals, 잠금 결정 §0 |
| 01 | [`01-data-model-and-markdown-spec.md`](./01-data-model-and-markdown-spec.md) | `.oculpm/planner/*.md` 포맷(frontmatter·상태 글리프·갱신 로그·결정) + SQLite `plan_*` 투영 스키마 |
| 02 | [`02-agents-protocol-and-attribution.md`](./02-agents-protocol-and-attribution.md) | AGENTS.md "Planner 갱신 규칙" + 에이전트 템플릿 5종 delta + 귀속(attribution) 모델 |
| 03 | [`03-ui-screen-spec.md`](./03-ui-screen-spec.md) | PlannerScreenV2 재설계 — 문서형 체크리스트, 귀속 칩, 진척 롤업, 결정 레일 |
| 04 | [`04-implementation-checklist.md`](./04-implementation-checklist.md) | 살아있는 진척표(PR-PLN 0~5 DoD + 결정 로그 + 상태표). 본 라운드의 *도그푸딩 대상 1호* |

## 비목표 (이 라운드 아님)

- 일지(Journal) 파이프라인 변경 — Planner 는 일지를 *참조* 만.
- 외부 프로젝트 관리 SaaS 연동(Jira 등).
- 멀티유저/실시간 협업 동기화.
