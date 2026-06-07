# 03. PlannerScreenV2 재설계 — 문서형 살아있는 체크리스트

> 위상: [`00`](./00-master-plan.md) 의 정체성을 화면으로. 현행 `src/features/planner/PlannerScreenV2.tsx`(평면 goal/subtask 카드)를 *문서형 체크리스트* 로 진화.
> 시각 토큰: ui_v2 토큰 시스템 준수([[ui-v2-architecture-decisions]] — `--accent` 녹색, `[data-theme=dark]`, 자체 SVG 0, Icons.tsx 단일 출구). 레거시 `PlannerPanel`/`GoalCard` 무변경.

---

## 1. 현행 → 목표 비교

| | 현행 PlannerScreenV2 | 목표 |
|---|---|---|
| 단위 | goal → subtask(2단계) | plan → phase → item(+서브) + 결정 |
| 상태 | done/미done(체크) | 6 상태 글리프(☐▣☑⚠→✗) |
| 진척 | goal.progress or done/total | 가중 롤업 + phase 파생 |
| 작성 | "새 목표" 비활성, 수동 | AI(외부/인앱) + 사람, 같은 .md |
| 귀속 | 없음 | 항목별 에이전트 칩 + 이력 |
| 일지 | 죽은 "일지" 링크 | 실제 상호참조(항목↔entry) |
| 근거 | 없음 | 결정(Decision) 레일 |

---

## 2. 레이아웃 (목업 톤 — 880px 컬럼)

```
┌ Toolbar  "Planner"  [plan ▾ 선택]   [진행중]칩   [AI에게 갱신 요청]  [편집] ┐
├──────────────────────────────────────────────────────────────────────────┤
│  ┌ Plan 헤더 카드 ───────────────────────────────────────────────┐        │
│  │  ◴ 62%   fastembed 안정화        [active]                       │        │
│  │  진척 링   ☑3 ▣1 ⚠1 →2  · 기여: ⬡claude-code ⬡user            │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                                                            │
│  ▾ Phase A — 캐시 경로 안정화                              (3/4 · 75%)      │
│     ☑ fastembed 캐시 절대경로 고정      ⬡claude-code·2h   📓3  ⓘ           │
│     ▣ 패키징 빌드 모델 시드 검증        ⬡claude-code·1h   📓1               │
│     ⚠ 첫 실행 465MB 다운로드 UX  ⟶ 진행 UI 부재          ⬡user·6/7          │
│     → 모델 번들링  ⟶ 이월: 배포 라운드                                       │
│                                                                            │
│  ▸ Phase B — 검색 품질                                    (0/1 · 0%)        │
│                                                                            │
│  ┌ 결정(Decisions) ────────────────────────────────────────────┐          │
│  │ Decision A — 캐시는 app_data_dir 절대경로   🔒6/7 claude-code │  → #abs… │
│  └──────────────────────────────────────────────────────────────┘          │
│                                                                            │
│  진행 상태표 (자동)   Phase A 75% · 마지막 claude-code 2h …                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 컴포넌트 (신규, ui_v2 토큰)

| 컴포넌트 | 책임 |
|---|---|
| `PlannerScreenV2`(개편) | plan 선택 + 데이터 로드(`plan_list`/`plan_get`) + 라우팅 |
| `PlanHeader` | 진척 링, 상태 카운트 pill, 기여 에이전트 칩 |
| `PhaseSection` | 접힘/펼침(상태 `plannerOpen` 재사용), phase 진척 파생 |
| `PlanItemRow` | 상태 글리프 + title + **AttributionChip** + 일지 카운트 + 결정 ⓘ |
| `AttributionChip` | agent 아바타+상대시간(`agentColor.ts` 재사용). 클릭→이력 |
| `ItemHistoryPopover` | `plan_item_history` 타임라인(누가/언제/from→to/일지) |
| `DecisionCard` | 잠긴 결정 블록(근거 + 영향 항목 링크) |
| `PlanStatusTable` | 하단 자동 진행표(참고문서 §7 형) |
| `PlanEditModal` | 사람 편집(글리프 set/항목 추가) → `plan_apply_edit`. ui_v2 모달 패턴([[ui-v2-architecture-decisions]] §0.12) |

아이콘은 `Icons.tsx` 에 `CircleDot`(in_progress)/`Ban`(dropped)/`ArrowRightToLine`(deferred) lucide re-export 추가(자체 SVG 0).

---

## 4. 상호작용

| 동작 | 결과 |
|---|---|
| 항목 글리프 클릭(편집 모드) | 상태 순환 set → `plan_apply_edit`(agent_id=`user`) → optimistic + watcher 재투영 |
| AttributionChip 클릭 | `ItemHistoryPopover` 이력 |
| 📓 일지 카운트 클릭 | 연결된 일지로 이동(journal 화면 + 해당 entry focus, 기존 핸드오프 재사용) |
| ⓘ 결정 | 해당 DecisionCard 로 스크롤/하이라이트 |
| "AI에게 갱신 요청" | 인앱 AI(`plan_apply_edit` via LLM, [`04`](./04-implementation-checklist.md) PR-PLN 5) — plan 컨텍스트+최근 일지로 갱신 제안 |
| ⌘4 | Planner 진입(기존). ⌘N = 새 목표(plan_create 모달) |

진척 자동 제안(보조, 불변식 §2-3 준수): 항목과 연관된 일지가 N건 이상이면 행에 *제안 배지*("관련 일지 3건 — 완료?") — **클릭해야** 상태 변경. 침묵 덮어쓰기 금지.

---

## 5. 라이브성
watcher 가 `.oculpm/planner/**` 변경 emit → 프론트가 구독(기존 oculpm watcher 이벤트 채널 재사용) → 현재 plan 이면 `plan_get` 재조회. 외부 에이전트가 작업 중 항목을 [x] 로 바꾸면 **앱에서 실시간으로 ☑ + 귀속 칩** 이 갱신됨(Today 라이브와 동형 체험).

---

## 6. 테스트 (DoD)
- `planner_v2.test.tsx`: 6 상태 글리프 렌더, 진척 롤업 계산, AttributionChip 라벨, 빈 상태, axe 0 violations(light+dark).
- 파서 단위테스트는 Rust 측([`01`](./01-data-model-and-markdown-spec.md) §3.2, PR-PLN 0).
- watcher 라이브·인앱 AI 는 dogfood 런타임 검증(스트리밍/PTY 처럼 jsdom 한계).

---

## 7. 레거시/플래그
- 레거시 `src/legacy/planner/PlannerPanel.tsx` **0 diff**(보존). ui_v2 만 신 화면.
- 기존 `WorkspaceContext.plannerOpen`(goalId→bool) → itemId/phase 키로 재해석(마이그레이션 deletion-tolerant).
