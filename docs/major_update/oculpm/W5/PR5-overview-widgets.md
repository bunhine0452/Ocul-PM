# W5-PR5 — Frontend `OverviewScreen` 재포지셔닝 + 4 위젯

> **목표**: 기존 OverviewScreen 의 프로젝트 메타 표시를 1줄 헤더로 축소하고, 그 아래에 ocul-pm 집계 4 위젯 (ActivityHeatmap / DifficultyMix / AgentBreakdown / UnfinishedChecklist) + RecentSessions 표를 배치. 모든 위젯 → Today navigate.
> **선행**: W3 의 `oculpm_journal` 캐시 + W2 의 `oculpm_sessions_cache`. W6 의 PR6 (agent 필터) 와 PR5 의 AgentBreakdown 가 연동.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR5, deprecations §3.2 옵션 A.
> **상태**: ✅ (2026-05-28)

---

## 1. 변경 파일 (계획)

| 파일 | 변경 |
|---|---|
| `src/features/overview/OverviewScreen.tsx` | 거의 풀 재작성. 기존 메타 표시는 `ProjectMetaHeader` 로 압축 흡수. |
| `src/features/overview/ProjectMetaHeader.tsx` (new) | 1줄 요약 + `[▼ 더보기]` expanding 패널. |
| `src/features/overview/widgets/ActivityHeatmap.tsx` (new) | 90일 GitHub 스타일 캘린더. |
| `src/features/overview/widgets/DifficultyMix.tsx` (new) | 도넛 차트. |
| `src/features/overview/widgets/AgentBreakdown.tsx` (new) | 가로 막대. |
| `src/features/overview/widgets/UnfinishedChecklist.tsx` (new) | unfinished entries 50개. |
| `src/features/overview/widgets/RecentSessions.tsx` (new) | 30일 sessions 표. |
| `src/features/overview/api.ts` (new) | 단일 fetch 함수 — 모든 위젯이 한 응답에서 read. |
| `src-tauri/src/commands/oculpm.rs` (수정) | `oculpm_overview_stats(project_id, window_days)` 신규 커맨드 — 4 위젯 + RecentSessions 데이터 한 방. |

---

## 2. 백엔드 커맨드 (계획)

```rust
#[tauri::command]
#[specta::specta]
pub async fn oculpm_overview_stats(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    window_days: u32,    // 보통 90 (heatmap), 30 (sessions). 둘 다 쓰려면 max=90 받고 클라가 슬라이스.
) -> Result<OculpmOverviewStats, String>;
```

```rust
pub struct OculpmOverviewStats {
    pub generated_at: String,
    pub window_days: u32,
    pub heatmap_cells: Vec<HeatmapCell>,        // 윈도우 안의 모든 workday (entries 없는 날도 0 으로)
    pub difficulty_mix: DifficultyMix,
    pub agent_breakdown: Vec<AgentCount>,
    pub unfinished_entries: Vec<JournalEntrySummary>,  // 최대 50개, date desc
    pub recent_sessions: Vec<SessionDailyAgg>,
}

pub struct HeatmapCell {
    pub workday: String,        // YYYYMMDD
    pub entry_count: u32,
    pub file_event_count: u32,
    pub score: u32,             // log-scaled (entries*5 + file_events) 가속
}

pub struct DifficultyMix {
    pub verylow: u32, pub low: u32, pub medium: u32, pub high: u32, pub superhigh: u32,
    pub null_count: u32,        // difficulty 미지정
}

pub struct AgentCount {
    pub agent_id: String,
    pub entry_count: u32,
    pub share: f32,             // 0..1
}

pub struct SessionDailyAgg {
    pub workday: String,
    pub session_count: u32,
    pub total_active_seconds: u64,
    pub files_unique: u32,
    pub journal_entry_count: u32,
    pub narrative_rate: f32,    // entries / sessions_with_file_events
}
```

쿼리 전략:
- 단일 `GROUP BY workday` SQL 로 heatmap_cells.
- `GROUP BY difficulty` 로 mix.
- `GROUP BY agent_id` 로 breakdown.
- `WHERE status != 'done' OR checkbox = 0` → `ORDER BY created_at DESC LIMIT 50` → unfinished.
- `oculpm_sessions_cache GROUP BY workday` → recent_sessions.

윈도우 90일 + 30 entries/day → ≤ 2700 rows. SQLite 인덱스 `(project_id, workday)` 로 < 50 ms (페이즈 §2.5).

---

## 3. ProjectMetaHeader 디자인 (계획)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ai-pm · Tauri 2 · React 19 · Rust (rusqlite, tokio)        [▼ 더보기]│
└──────────────────────────────────────────────────────────────────────┘
```

데이터 소스: 기존 `generate_project_overview` / `get_project_overview` 의 `identity` + `stack_json`. 1줄로 압축:

```ts
const summary = `${identity} · ${stack.languages[0]} · ${stack.frameworks[0]} · ${stack.libraries.slice(0,2).join(", ")}`;
```

`[▼ 더보기]` 클릭:
- expanding panel 에 전체 `overview_md` 마크다운 렌더.
- 우상단 `[↻ 새로고침]` → `refresh_project_overview_if_stale`.
- 상태 영속: `localStorage[oculpm.overview.header_expanded.${projectId}]`.

긴 1줄 처리: `truncate` + hover 시 tooltip 전체 표시. 펼침 유도는 expanding panel 로.

---

## 4. 위젯 디자인 (계획)

### `ActivityHeatmap`
- 90일 그리드 (13 weeks × 7 days). 빈 셀 회색, 활동 셀 emerald scale (4단계).
- hover tooltip: "2026-05-22 (수) · 8 entries · 47 file events".
- 셀 클릭 → `navigate("today", { dayOffset: targetWorkday - today })`. TodayScreen 의 dayOffset 가 anchor 기반이므로 직접 string 전달 권장 → TodayScreen 의 navigate 핸들러 확장 (small wire).
- 빈 셀 70% 초과 시 "최근 30일만 보기" 토글 디폴트 (페이즈 §5 함정).

### `DifficultyMix`
- 도넛. 5개 difficulty + `null_count` (회색).
- legend 에 absolute count.
- 슬라이스 클릭 → `navigate("today")` + `CategoryFilter` 의 `difficulties: Set([clicked])` 설정.

### `AgentBreakdown`
- 가로 막대. 6 agents (`claude-code`, `cursor`, `antigravity`, `gemini-cli`, `agents-md`, `manual`) — 실측에 따라 정렬.
- 클릭 → `navigate("today")` + `CategoryFilter.agents = Set([clicked])` (PR6 의 필터 확장 의존).

### `UnfinishedChecklist`
- `JournalEntrySummary[]` 최대 50.
- 각 항목: type 칩 + 제목 + workday + agent.
- 클릭 → `navigate("today", { dayOffset: ..., selectEntry: relative_path })`.

### `RecentSessions`
- 표. 컬럼: 날짜, 세션, active, files, narrative %.
- 행 클릭 → 그 workday 의 Today 로.

---

## 5. 클릭 → Today navigate 의 통일 (계획)

`src/lib/todayNavigate.ts` (new):

```ts
type TodayNavTarget =
  | { kind: "workday"; workday: string }
  | { kind: "workday-entry"; workday: string; relativePath: string }
  | { kind: "filter"; filter: Partial<CategoryFilter> };

export function navigateToToday(target: TodayNavTarget): void;
```

내부: navigate(today) + queryString 또는 zustand store (workspace context 의 기존 패턴) 에 의도 push → TodayScreen 의 mount 시 1회 소비.

`CategoryFilter` 의 `agents` 가 PR6 의 작업이므로 본 PR 에선 `difficulties` 만 보장. AgentBreakdown 클릭은 PR6 완료 후 wire.

---

## 6. 테스트 (계획)

### 백엔드 (`oculpm::manager::tests::overview_w5_pr5`)

- [ ] `overview_stats_aggregates_heatmap_cells_for_window` — 90일 시드 (각 날 3 entries) → 90 cells, 각 entry_count == 3.
- [ ] `overview_stats_groups_difficulty_mix_with_null_count` — 다양한 difficulty 시드 → 정확한 카운트.
- [ ] `overview_stats_agent_breakdown_share_sums_to_one` — 3 agents 비율 합 ≈ 1.0 (float 허용).
- [ ] `overview_stats_unfinished_caps_at_fifty` — 100 unfinished 시드 → length 50, date desc 정렬.
- [ ] `overview_stats_recent_sessions_narrative_rate_handles_zero_sessions` — sessions 0 인 날 → narrative_rate = 0 (NaN 방지).

> 검증: `cargo test --lib oculpm::manager::tests::overview_w5_pr5` — 5/5 PASS.

### 프런트 (Vitest, W6 로 이월)

- [ ] (W6) 90일 시드 → ActivityHeatmap 의 셀 length 90.
- [ ] (W6) DifficultyMix 슬라이스 클릭 → `navigateToToday` mock 호출 + filter 인자 정확.
- [ ] (W6) AgentBreakdown 클릭 → agent 필터 인자 (PR6 필요).
- [ ] (W6) UnfinishedChecklist 의 entry 클릭 → `selectEntry` 전달.
- [ ] (W6) 1000 entry 시드 → 페이지 로드 < 500 ms (per-render benchmark).

### 수동 QA

- [ ] 90일 셀 표시 + hover tooltip.
- [ ] 도넛 슬라이스 클릭 navigate 동작.
- [ ] AgentBreakdown 클릭 navigate (PR6 통합 후).
- [ ] UnfinishedChecklist 50개 표시.
- [ ] ProjectMetaHeader 펼침 토글 + localStorage 영속.

---

## 7. DoD

- [x] 4 위젯 + RecentSessions + ProjectMetaHeader 모두 mount + 데이터 표시 — `OverviewScreen` 의 신규 widget 섹션이 `overviewStats` 기준 conditional render.
- [x] 모든 위젯 클릭 → Today navigate 정확 — `navigateToToday({ kind: ... })` 호출. `workday` / `workday-entry` 경로는 즉시 동작, `filter` 경로 (DifficultyMix / AgentBreakdown) 는 intent 만 push (실제 list filter 적용은 PR6 의 agent + difficulty 필터 후 wire).
- [-] 1000 entry 데이터에서 페이지 로드 ≤ 500 ms — backend SQL 은 `GROUP BY workday/agent_id/difficulty` 인덱스 사용, 측정은 PR8 의 meta dogfooding 결과로 검증.
- [x] 백엔드 5개 단위 테스트 PASS — `oculpm::cache::tests::overview_stats_*` 5 PASS (heatmap/difficulty/agent/unfinished/recent_sessions), 누적 lib 200/200 (2026-05-28).
- [x] `pnpm tsc --noEmit` clean (exit 0, 2026-05-28).

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **단일 커맨드 vs 4개 커맨드** — 단일이 round-trip 1회로 가볍고, 위젯 mount 가 동시. 4개는 lazy 로딩 가능하지만 위젯이 모두 above-the-fold 라 의미 없음. **단일 채택**.
2. **`window_days` 의 max** — 90 (heatmap 기준). 더 큰 윈도우 (연간) 는 W6 이상.
3. **차트 라이브러리** — `recharts` (이미 의존성에 있다면) vs 직접 SVG. AgentBreakdown / DifficultyMix 는 간단해서 직접 SVG 가능. ActivityHeatmap 도 grid + tailwind 로 충분. **직접 SVG/CSS 채택** — 의존성 최소화.
4. **agent 필터의 PR 의존** — AgentBreakdown 클릭은 PR6 완료 후 활성. 본 PR 은 클릭 핸들러 callback 만 wire, "PR6 필요" 라벨로 시각화.

### 발견된 함정 / 변경

- **`AgentCount.share` / `SessionDailyAgg.narrative_rate` 가 specta 에서 `f32` → `number | null`**: f32 가 NaN 가능성을 보고 specta 가 nullable 로 export. 백엔드는 `0.0` 으로 보장하지만 TS 쪽에선 `(value ?? 0)` 패턴 필수. `AgentBreakdown` / `RecentSessions` 가 `?? 0` 적용.
- **`JournalEntrySummary.entry_type` vs `type`**: 가이드 §4 에서 `entry_type` 으로 적었으나 실제 필드명은 `type` (spec.rs `serde(rename = "type")`). `UnfinishedChecklist` 에서 `e.type` 로 수정.
- **`refreshProjectOverviewIfStale` 시그니처**: 가이드 §3 의 "[↻ 새로고침] → `refresh_project_overview_if_stale`" 는 (project_id) 만 받는다고 가정했으나 실제 (project_id, provider, model) 3개 인자 필요. `ProjectMetaHeader` 의 refresh 는 spinner-only 노옵 (실제 재생성은 메인 화면의 "개요 다시 생성" 버튼이 이미 처리). W6 의 Settings UI 가 provider/model 을 같은 컴포넌트에 들고 있다면 그쪽에서 재시도 hook 추가.
- **`navigateToToday` 의 filter wire**: 가이드 §5 의 `Partial<CategoryFilter>` 시그니처는 CategoryFilter 에 `difficulties` + `agents` 필드를 전제하나 두 필드 모두 본 PR 시점엔 없음. 본 PR 은 `filter: { difficulties?: Difficulty[], agents?: string[] }` 로 시그니처 단순화 — PR6 에서 `agents` 추가, difficulty 도 같이 wire. 현재는 `navigateToToday({ kind: "filter", ... })` 호출 시 intent 만 bus 에 push 되고 TodayScreen 이 mount 시 consume 하는 코드는 PR6 에서 추가.
- **widget 데이터 fresh 정책**: `OverviewScreen` mount 마다 한 번 fetch + Today/Code 탭에서 돌아올 때 stale. live update 는 W6 stabilize 후보 (예: `events.oculpmJournalAdded` 구독으로 invalidate).
- **`ActivityHeatmap` weekday 정렬**: 가이드 §4 의 "13 weeks × 7 days" 매트릭스는 정확한 요일 정렬이 필요하지만 본 PR 은 단순 7-row chunk (시작 요일 무시). 90일이라는 길이가 강한 시각 신호이므로 v1 으로 충분. W6 에서 정렬 polish.
- **`StackCard` / `IdentityCard` 제거**: 가이드 §1 의 "기존 메타 표시는 ProjectMetaHeader 로 압축 흡수" 그대로. 사용자가 expand 패널 펼치면 `overview.identity` + `overview.overview_md` 가 마크다운 한 덩어리로 보임. 칩 형태 stack 표시는 1줄 summary 의 `framework · languages · data` 로 압축됨.

### 다음 PR 로 넘기는 메모

- PR6 의 `CategoryFilter.agents` (+ `difficulties`) 추가 후 본 PR 의 `navigateToToday({ kind: "filter", filter: ... })` consume 로직을 TodayScreen mount 에 추가 — `consumePendingNavTarget()` 호출 + filter merge.
- PR8 의 회귀 점검: 기존 OverviewScreen 의 메타 표시 사용자가 `ProjectMetaHeader` 의 1줄 + 펼침 패널로 동일 정보를 얻는지 확인.
- PR8 의 meta dogfooding: 본 ai-pm 의 실제 데이터 (~100+ entries) 로 페이지 로드 시간 측정 + 1000 entry 시나리오 시뮬레이션.
- W6 stabilize 후보:
  - ActivityHeatmap 의 ISO weekday 정렬 + 월 라벨
  - widget live update (journal_added 이벤트 구독)
  - "최근 30일만 보기" 토글 (가이드 §4 의 70% empty 시 자동 옵션)
  - SVG donut DifficultyMix (현재는 stacked bar)
