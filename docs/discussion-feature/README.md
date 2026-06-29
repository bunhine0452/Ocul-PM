# 문제 해결 (Discussion) — 결정 *전* 의 토의·조사 문서

> 위상: 작업일지·플래너·회고가 모두 다루지 못하는 **"결정 전(pre-decision) 탐색 단계"** 를 1급 기능으로 추가하는 라운드의 문서 세트.
> 작성일 2026-06-29. 작성 도구 attribution: claude-code (Opus 4.8).
> 형식 선례: [`../planner-upgrade/`](../planner-upgrade/) (파일 기반 `.oculpm/` 문서타입 + 화면 + 커맨드 + 캐시 + AGENTS 의 동형 구조).

## 한 줄 요약

플래너가 *"무엇을, 어디까지"* (결정 후), 작업일지가 *"무엇을 했나"* (실행 후), 회고가 *"어떤 패턴이었나"* (사후 집계)라면, **문제 해결(Discussion)** 은 그 *앞* 단계다 — *"이게 문제인가? 어떤 안들이 있나? 무엇을 할까?"* 를 한 세션에 끝나지 않게, 조사 자료를 붙여가며 정리하는 **살아있는 회의록/RFC 문서**. 플래너처럼 `.oculpm/discussion/<slug>/discussion.md` 를 디스크 SSOT 로 두고, 결론이 나면 플래너로 *승격* 한다.

## 확정된 방향 (사용자 결정 2026-06-29)

- **별도 기능이다.** 작업일지·플래너·회고·AI 패널 어디에도 "결정 전 미결정 탐색" 단계가 없음 → 퍼널의 맨 앞을 채운다. ([`00`](./00-master-plan.md) §2 불변식)
- **저장 = 파일 기반(.md SSOT) + watcher.** SQLite 는 목록/검색용 투영(캐시). (다른 후보: SQLite 우선 — 기각, 제품 철학(디스크 SSOT)·git 추적성·외부 에이전트 가독성 약함.)
- **AI 패널과의 관계 = 공존하되 v1 은 "채팅 없는 수동 문서".** in-app AI 토의 엔진은 *연동하지 않음*(다음 라운드). 사람(앱 에디터) + 외부 에이전트(파일 직접 편집)가 작성한다. AI 패널은 그대로 둔다.
- **범위 = 풀 기능 한 라운드** — 구조화 문서 + 조사 자료 첨부 + 플래너 승격 브리지 + Today 노출까지. (단, in-app AI 토의 제외 — 위 결정과 정합.)
- **다음 단계 = 설계 문서 우선** (본 세트), 잠금 후 구현.

## 문서

| # | 문서 | 내용 |
|---|---|---|
| 00 | [`00-master-plan.md`](./00-master-plan.md) | SSOT. 정체성, 4개 기능과의 구분(불변식), scope/non-goals, 잠금 결정 §5 |
| 01 | [`01-data-model-and-markdown-spec.md`](./01-data-model-and-markdown-spec.md) | `.oculpm/discussion/<slug>/` 트리 + `discussion.md` 포맷(frontmatter·섹션·첨부·토의 로그) + SQLite 투영 스키마 + 커맨드 |
| 02 | [`02-agents-protocol.md`](./02-agents-protocol.md) | AGENTS.md "문제 해결 문서" 규칙(언제·어떻게 쓰는가) + 템플릿 delta + 귀속 모델 + AI 참여(다음 라운드)의 경계 |
| 03 | [`03-ui-screen-spec.md`](./03-ui-screen-spec.md) | DiscussionScreenV2 — 목록 + 2-pane(문서 렌더/편집) + 첨부 UX + "플래너로 승격" + Today 노출 |
| 04 | [`04-implementation-checklist.md`](./04-implementation-checklist.md) | 살아있는 진척표(PR-DISC 0~5 DoD + 결정 로그 + 상태표). 본 라운드의 *도그푸딩 대상* |

## 비목표 (이 라운드 아님)

- **in-app AI 토의 엔진 연동** — AI 가 문제 해결 문서 안에서 직접 대화/제안하는 기능. 문서 포맷은 forward-compat 하게 설계하되(토의 로그의 `작성자` 필드), 연동 자체는 다음 라운드.
- 작업일지·플래너·회고 파이프라인 변경 — 문제 해결은 이들을 *낳거나 참조* 만.
- 외부 PM/문서 SaaS(Notion/Confluence/Linear) 연동.
- 멀티유저 실시간 협업/충돌 병합 (단일 사용자 + git 가정).
