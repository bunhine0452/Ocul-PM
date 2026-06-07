# 00. Planner Upgrade — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-06-07. attribution: claude-code (Opus 4.8).
> 형식 선례: [`../Lite-update/Fianl_UI_update_before1.0/00-master-plan.md`](../Lite-update/Fianl_UI_update_before1.0/00-master-plan.md).

---

## 0. Executive Summary (한 페이지)

ocul-pm 의 **일지(Journal)** 는 이미 *AI 가 쓴다*: 외부 에이전트(Claude Code / Gemini / Cursor / Antigravity)가 프로젝트 루트 `AGENTS.md` 의 규칙을 따라 `.oculpm/journal/<날짜>/<범주>/*.md` 에 마크다운을 떨구면, watcher 가 인덱싱하고 `oculpm_journal` 캐시에 들어간다. 누가 썼는지는 `agent_id` + `session_id` 로 귀속된다 (Today 의 AgentBreakdown 색까지).

반면 **Planner** 는 여전히 *사람이 앱에서 클릭* 하는 SQLite CRUD 다 (`goals` / `subtasks`, `PlannerScreenV2.tsx` 에선 "새 목표" 버튼조차 비활성). AI 가 관여하지 않고, 누가 갱신했는지 기록이 없으며, 작업이 진행돼도 스스로 갱신되지 않는다.

이 라운드의 명령은 단순하다: **Planner 를 일지와 동일한 "AI 가 쓰는 파일 기반 시스템" 으로 끌어올린다.** Planner 는 `05-implementation-checklist.md` 같은 *살아있는 체크리스트 문서* 가 되고, 작업이 진행될 때마다 그 작업을 한 AI 가 해당 항목의 상태를 갱신하며, **어떤 AI 가 갱신했는지** 가 항목별로 남는다.

핵심 통찰: 참고 문서 `05-implementation-checklist.md` 자체가 우리가 원하는 Planner 의 모양이다 — ☑/☐/⚠/→이월 상태, 인라인으로 잠긴 결정(Decision A/B…), 하단의 진행 상태표. Planner 는 *그 문서를 만드는 도구* 가 된다.

---

## 1. Planner 의 정체성 (1.0 이후)

> "Planner 는 *지금 무엇을, 어디까지* 하고 있는지의 **단일한 현재 진실** 이다. 일지는 *무슨 일이 있었는지* 의 **불변 기록** 이다."

| 기둥 | 의미 |
|---|---|
| 전망적(prospective) | 앞으로 할 일 + 진척. 일지(회고적)와 시간축이 반대 |
| 살아있음(living) | 제자리에서 *갱신* 됨. 한 항목 = 현재 상태 1개 (최신 승) + 갱신 로그 |
| AI 작성 | 일하는 그 에이전트가 일지를 쓰며 *대응 Plan 항목도 갱신* — "스스로 업데이트" |
| 귀속(attributed) | 항목별·갱신별로 *어떤 AI 가* 바꿨는지 기록 |
| 근거 보유 | 결정(Decision)을 1급 시민으로 인라인 잠금 — "왜" 를 들고 다님 |
| 파일 SSOT | `.oculpm/planner/*.md` 가 진실. SQLite 는 빠른 집계용 투영. git-diff·사람 편집 가능 |

---

## 2. 일지(Journal) 와의 구분 — 불변식 (가장 중요)

겹침을 영구히 막는 4개 불변식. 모든 후속 문서·코드·리뷰는 이를 위반하면 안 된다.

1. **시간축.** 일지 = 회고(이미 일어난 일). Planner = 전망(하려는 일) + 현재 진척.
2. **변경 의미론.** 일지 = append-only 다건/하루, *불변*. Planner 노드 = *제자리 갱신*, 현재 상태 1개 + 갱신 로그.
3. **소유 방향.** Planner 항목이 일지 entry 를 *참조* 한다(증거). 일지는 Plan 상태를 *소유하지 않는다*.
4. **진실의 단위.** 일지 = "이 세션에 이 파일들이 이렇게 바뀜". Planner = "이 목표가 ▣ 진행중, 62%, 마지막으로 claude-code 가 6/1 에 갱신".

> 한 줄 테스트: *"이 정보가 나중에 바뀌면 안 되는 기록인가?"* → 일지. *"이 정보의 현재 값이 계속 변하는가?"* → Planner.

---

## 3. 시스템 개요 (데이터 흐름)

```
                 ┌─────────────────────── 작성자 ───────────────────────┐
   외부 에이전트(Claude Code/Gemini/Cursor)          인앱 AI 패널        사람
        │ AGENTS.md "Planner 규칙" 따라                │ "계획 갱신" 커맨드  │ 앱 편집 커맨드
        │ .md 직접 편집(+ plan-log append)            │ (LLM 이 .md 재작성) │ (atomic_io managed block)
        ▼                                             ▼                    ▼
   ┌──────────────────────────  .oculpm/planner/<slug>.md  (SSOT)  ──────────────────────┐
   │  frontmatter + 체크리스트(상태 글리프 + 항목 id) + 결정 블록 + 갱신 로그(managed)        │
   └───────────────────────────────────────────┬───────────────────────────────────────┘
                                                │ watcher(기존 .oculpm watcher 확장)
                                                ▼  파싱·투영 (마크다운 = 진실)
            SQLite 캐시:  plan ·  plan_item ·  plan_item_update ·  plan_decision
                                                │
                                                ▼
                       PlannerScreenV2  (문서형 체크리스트 + 귀속 칩 + 진척 롤업)
```

- 작성 경로 3개(외부 에이전트 / 인앱 AI / 사람) **모두 같은 `.md` SSOT 에 쓴다.** 귀속(`agent_id`)으로 구분.
- watcher·frontmatter·atomic_io·redact·index 는 일지 인프라를 **재사용** → 백엔드 신규 표면 최소화.

---

## 4. Scope / Non-goals

### In scope (PR-PLN 0~5, [`04-implementation-checklist.md`](./04-implementation-checklist.md))
- `.oculpm/planner/` 트리 + 마크다운 SSOT 포맷 ([`01`](./01-data-model-and-markdown-spec.md)).
- SQLite `plan_*` 투영 + watcher 확장.
- AGENTS.md "Planner 갱신 규칙" + 에이전트 템플릿 5종 ([`02`](./02-agents-protocol-and-attribution.md)).
- 항목별 귀속(누가/언제/무엇을→무엇으로) + 갱신 로그.
- PlannerScreenV2 재설계 ([`03`](./03-ui-screen-spec.md)).
- 일지 ↔ Plan 상호참조(기존 subtask 의 죽은 "일지" 링크를 실연결).
- 인앱 AI "계획 갱신" 커맨드.
- 기존 `goals`/`subtasks` → plan 마이그레이션(데이터 보존).

### Non-goals (이 라운드 아님)
- 일지 파이프라인 변경.
- 외부 PM SaaS(Jira/Linear) 연동.
- 멀티유저 실시간 동기화/충돌 병합 UI (단일 사용자 + git 가정).
- 간트/캘린더 타임라인 재설계 (레거시 CalendarView 는 유지·후속).

---

## 5. §0 잠금 결정 (확정분 — 2026-06-07)

> 진행 중 추가 결정은 [`04-implementation-checklist.md`](./04-implementation-checklist.md) §0 에 누적하고 본 표를 갱신한다 (참고 문서 §5 운영 흐름과 동일).

| 결정 | 잠금 값 |
|---|---|
| 작성 모델 | **파일 기반 `.md` SSOT + watcher 투영** (사용자 결정) |
| SSOT 위치 | `.oculpm/planner/<slug>.md` (일지와 형제 트리) |
| SQLite 역할 | 읽기 전용 투영(캐시). 진실 아님 → 재구축 가능 |
| 상태 어휘 | `todo ☐ / in_progress ▣ / done ☑ / blocked ⚠ / deferred → / dropped ✗` (참고 문서 글리프) |
| 항목 식별 | 안정 id `{#slug}` — 편집·재정렬에도 귀속/링크 보존 |
| 귀속 입자 | **항목별 · 갱신별** 로그 (plan-level 마지막-편집자 아님) |
| 귀속 정체성 | 일지와 동일 `agent_id` 체계 재사용 (`.oculpm/agents/`, AgentBreakdown 색). 사람=​`user` |
| 결정(Decision) | Planner 의 1급 시민. 인라인 잠금 블록 + `plan_decision` 캐시 |
| 일지 연동 | Plan→일지 *참조만*. 자동 진척은 *제안* 에 그치고 덮어쓰기 금지 (불변식 §2-3) |
| 동시쓰기 안전 | 기존 `.oculpm/.lock` + atomic_io managed-block 재사용 |
| 마이그레이션 | `goals`/`subtasks` → 단일 "기존 목표" plan 으로 1회 변환(보존), 이후 .md SSOT |

---

## 6. 위험 & 완화

| 위험 | 완화 |
|---|---|
| AI 가 .md 포맷을 깨뜨림 | 파서는 *관용적*(글리프 누락 시 todo 로 폴백) + managed block 으로 갱신 로그 격리. 깨진 항목은 UI 에 ⚠ 로 노출(침묵 실패 금지) |
| 일지와 기능 중복으로 표류 | §2 불변식을 리뷰 체크리스트화. Plan 은 상태를 *소유*, 일지는 *증거* |
| 항목 id 충돌/중복 | watcher 투영 시 `(project_id, plan_id, item_id)` UNIQUE, 중복은 마지막 승 + ⚠ |
| 귀속 위조(에이전트가 남의 id 기입) | 단일 사용자·로컬 우선 도구라 신뢰 모델 가정. plan-log 는 append-only 표기 |
| 대형 plan 성능 | SQLite 투영으로 집계, .md 재파싱은 watcher 디바운스 |

---

## 7. 진행 상태 (요약 — 상세는 §04)

| PR-PLN | 제목 | 상태 |
|---|---|---|
| 0 | 스키마 + 파일트리 + 파서 + watcher | ✅ done (`c2deb79`+`2973f04`) |
| 1 | 마크다운 SSOT 포맷 + 수동편집 커맨드 + 갱신로그 | ✅ done (`308bb29`) |
| 2 | AGENTS.md Planner 규칙 + 템플릿 5종 + 귀속 | ✅ done (`9d650c8`) |
| 3 | PlannerScreenV2 재설계 | ✅ done (`08960d7`) |
| 4 | 일지 ↔ Plan 상호참조 + 진척 제안 | ✅ done (`6dfd9d1`) |
| 5 | 인앱 AI "계획 갱신" 커맨드 + 마이그레이션 | ✅ done (`a7be10f`) |

**라운드 종료 (2026-06-07).** 전 PR done · cargo test --lib 251 · 프론트 typecheck/test 113/lint green.
이월(후속 폴리시): watcher 라이브-push(외부 편집 즉시 반영). 런타임 검증: 인앱 AI 갱신·마이그레이션 dogfood, 기존 프로젝트는 agents 재싱크로 §7 반영.
