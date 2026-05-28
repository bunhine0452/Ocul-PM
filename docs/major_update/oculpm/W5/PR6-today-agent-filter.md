# W5-PR6 — Today 의 agent 필터 확장 (W4 보완)

> **목표**: W3-PR8 의 `CategoryFilterBar` + W3-PR8 의 `CategoryFilter` 에 `agents: Set<string>` 추가. UI 에서 멀티 선택, 백엔드 `EntryFilters` 도 agent 필터 추가, OverviewScreen 의 AgentBreakdown 클릭 wire 완성.
> **선행**: W3-PR8 의 `filters.ts` + `CategoryFilterBar.tsx`. PR5 의 AgentBreakdown 가 클릭 callback 만 wire 한 상태.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR6.
> **상태**: ✅ (2026-05-28)

---

## 1. 변경 파일 (계획)

| 파일 | 변경 |
|---|---|
| `src/features/oculpm/filters.ts` | `CategoryFilter.agents: Set<string>` 추가 + serialize/load 갱신 + `toEntryFilters` 확장. |
| `src/features/oculpm/CategoryFilterBar.tsx` | agent 멀티-select dropdown 추가. |
| `src-tauri/src/oculpm/cache.rs` | `EntryFilters.agents: Vec<String>` 필드 추가 + `list_journal_entries` SQL 의 `agent_id IN (...)` 절. |
| `src-tauri/src/oculpm/spec.rs` 또는 wherever `EntryFilters` 가 정의됨 | wire DTO 확장 (specta export 자동 갱신). |
| `src/features/overview/widgets/AgentBreakdown.tsx` | PR5 에서 prepared callback 활성화 — `navigateToToday({ filter: { agents: new Set([clicked]) } })`. |

---

## 2. 타입 (계획)

```ts
// filters.ts
export interface CategoryFilter {
  types: Set<EntryType>;
  /** NEW — empty set = show all agents. Values: agent_id (`claude-code`,
   *  `cursor`, `antigravity`, `gemini-cli`, `agents-md`, `manual`, 그리고
   *  사용자가 본 적 있는 임의 agent_id). */
  agents: Set<string>;
  verifiedOnly: boolean;
  mismatchOnly: boolean;
  unfinishedOnly: boolean;
  search: string;
}
```

`EntryType` 의 5개 enum 과 달리, `agent_id` 는 사용자 데이터 (LLM 측에서 임의로 적을 수 있음). 따라서 필터 UI 의 드롭다운은:
- **fixed 옵션**: 알려진 5개 (`claude-code` / `cursor` / `antigravity` / `gemini-cli` / `agents-md` / `manual` — 정확히는 6개. spec 의 KNOWN_AGENT_IDS 와 동기화).
- **observed 옵션**: 현재 workday 의 entries 에서 본 적 있는 agent_id (cache 에서 distinct).

backend wire:
```rust
pub struct EntryFilters {
    pub types: Vec<EntryType>,
    pub agents: Vec<String>,         // empty = no constraint
    pub verified_only: bool,
    pub mismatch_only: bool,
    pub unfinished_only: bool,
    pub search: Option<String>,
}
```

`list_journal_entries` 의 WHERE 절에 `(agent_id IN (?,?,...)` placeholder bind. `agents.is_empty()` 면 절 자체 생략.

---

## 3. UI (계획)

CategoryFilterBar 의 현재 레이아웃 (chip 그룹 + 체크박스 + 검색):

```
[전체] · [BUG] [FEATURE] [ERROR] [REFACTOR] [CHORE]   ☐ 검증됨만  ☐ mismatch 만  ☐ 미완료만   [🔍 검색…]
```

확장:

```
[전체] · [BUG] [FEATURE] [ERROR] [REFACTOR] [CHORE]   [에이전트 ▾]   ☐ 검증됨만 …
```

`[에이전트 ▾]` dropdown:
- 라벨: agents.size === 0 ? "에이전트" : `에이전트 (${agents.size})`.
- 패널: 알려진 6 agent + observed agents (중복 제거). 각각 ☑.
- 푸터: `[전부 선택] [초기화]`.

`localStorage` 의 serialized 형식 확장:

```ts
interface SerializedFilter {
  types: EntryType[];
  agents: string[];           // NEW
  verifiedOnly: boolean;
  mismatchOnly: boolean;
  unfinishedOnly: boolean;
  search: string;
}
```

기존 사용자의 저장값 (agents 필드 없음) 은 `loadFilter` 가 `[]` 로 default — 무중단 마이그레이션.

---

## 4. observed agents 데이터 소스 (계획)

옵션 A: cache 에서 distinct
```sql
SELECT DISTINCT agent_id FROM oculpm_journal
  WHERE project_id = ? AND parse_ok = 1
  ORDER BY agent_id;
```
프런트가 직접 invoke. 새 커맨드 `oculpm_observed_agent_ids(project_id)` 신설.

옵션 B: TimelineView 가 이미 entries 들고 있으니 클라가 derive
- React state 에서 `useMemo(() => new Set(entries.map(e => e.agent_id)), [entries])`.
- 단점: 다른 workday 의 agent 는 보이지 않음 (오늘 안 본 agent 로는 필터 못 함).

**옵션 A 권장** — Overview 의 AgentBreakdown 와도 SSOT 일치.

---

## 5. 테스트 (계획)

### 백엔드 (`oculpm::cache::tests`)

- [ ] `list_entries_filter_by_agent_includes_only_matching` — 시드 3 entries (claude-code, cursor, manual) + `agents = ["cursor"]` 필터 → 1건.
- [ ] `list_entries_filter_by_agent_empty_set_shows_all` — `agents = []` → 3건.
- [ ] `list_entries_filter_combines_type_and_agent` — types=[feature] + agents=[cursor] → 교집합.
- [ ] `observed_agent_ids_returns_distinct_sorted` — 시드 → distinct sorted 결과.

### 프런트 (Vitest, W6 로 이월)

- [ ] (W6) agent 드롭다운 토글 → CategoryFilter.agents 갱신.
- [ ] (W6) localStorage roundtrip 에 agents 보존.
- [ ] (W6) AgentBreakdown 클릭 → TodayScreen 의 agents 필터 1개로 navigate.

### 수동 QA

- [ ] 에이전트 드롭다운에서 1개 선택 → TimelineView 에 그 agent 의 entries 만.
- [ ] dropdown 의 observed 목록에 어제 작성한 agent 도 포함.
- [ ] Overview 의 AgentBreakdown 막대 클릭 → Today 의 agent 필터로 점프.

---

## 6. DoD

- [x] agent 필터 토글 동작 + 다른 필터와 AND 결합 — `EntryFilters.agents IN (...)` SQL + `list_entries_filter_combines_type_and_agent` 테스트.
- [x] Overview 의 AgentBreakdown 클릭 → Today 의 agent 필터 1개로 navigate — `AgentBreakdown` 의 onclick `navigateToToday({ filter: { agents: [id] } })` 가 bus 에 push, TodayScreen `useEffect` 가 `consumePendingNavTarget` 으로 흡수 + filter merge + saveFilter.
- [x] localStorage 의 기존 (agents 필드 없는) 저장값이 무중단으로 default `[]` 흡수 — `SerializedFilter.agents?: string[]` + `loadFilter` 가 `Array.isArray(p.agents) ? ... : []` 처리.
- [x] backend 4 신규 테스트 PASS — `list_entries_filter_by_agent_includes_only_matching` / `_empty_set_shows_all` / `list_entries_filter_combines_type_and_agent` / `observed_agent_ids_returns_distinct_sorted`. 누적 cache tests 23/23 PASS (2026-05-28).
- [x] `pnpm tsc --noEmit` clean (exit 0, 2026-05-28).

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **observed agents 의 fetch 주기** — 매 mount vs CategoryFilterBar 열 때마다. 후자가 가볍 (1회만). 새 entry 작성 직후 누락 가능성은 작음 (dropdown 다시 열면 갱신).
2. **fixed list 의 표기** — `claude-code` 의 사용자 친화 표시 ("Claude Code"). 단순 매핑 함수 + KNOWN_AGENT_IDS 와 동기화.
3. **observed 안에 fixed list 중복** — set union 으로 제거. fixed 가 항상 위, observed extra 가 아래 정렬.
4. **`agents = []` 의 의미** — "모두" vs "없음". `types` 와 동일하게 "모두" 채택.

### 발견된 함정 / 변경

- **PR5의 `difficulties` 필드도 함께 추가**: PR5 doc은 "PR6에선 agent만" 이라 적었지만 PR5 의 DifficultyMix 클릭이 `navigateToToday({ filter: { difficulties: [...] } })` 를 호출하는데 consume + filter 가 둘 다 미구현이었음. 본 PR 에서 `CategoryFilter.difficulties: Set<Difficulty>` + `EntryFilters.difficulties: Vec<Difficulty>` + SQL `WHERE difficulty IN (...)` 동시 추가. UI 칩 그룹은 추가하지 않음 — DifficultyMix 클릭으로만 적용되고, "초기화" 버튼은 W6 stabilize 후보. 적용된 필터는 Today 의 entries 수 차이로만 시각 표시.
- **`EntryFilters` 에 `#[derive(Default)]`**: 기존 코드가 `EntryFilters { types: vec![], ... }` 같은 명시 초기화 + 일부 위치에서 `..Default::default()`. PR6 가 두 필드 추가하면서 모든 명시 초기화 위치 (manager의 `overview_stats` 내 unfinished 필터 등) 를 `Default::default()` 패턴으로 통일. `serde(default)` 도 같이 — 기존 wire payload 가 두 필드 없이 오면 자동 채워짐 (PR1 의 dry_run 도 PR6 이전 시점이라 호환성 필요).
- **`oculpm_observed_agent_ids` 의 빈 응답**: 프로젝트가 초기화는 됐지만 entries 가 0인 시점에 호출 → 빈 array 반환. dropdown 은 `KNOWN_AGENT_IDS` (6개) 만 보임 + "observed" 배지는 누구에게도 안 붙음. 의도된 UX.
- **dropdown 의 click-outside 닫기**: `mousedown` 리스너 + `agentMenuRef.current.contains(target)` 체크. Esc 닫기는 W6 polish.
- **`navigateToToday({ kind: "workday" / "workday-entry" })` consume**: 가이드 §3 의 "dayOffset 계산 후 적용" 은 anchor date 기준 차이가 필요한데 본 PR 에선 명시 미구현 (filter만 consume). 사용자가 timeline 의 날짜 navigation 버튼으로 직접 이동. PR8 통합 라운드의 polish 후보.
- **`KNOWN_AGENT_IDS` 정렬 + 중복 제거**: dropdown 리스트는 `new Set(KNOWN_AGENT_IDS + observed)` 의 array 화 — 알려진 6 agent + observed extras 합집합. "observed" 배지는 실측 agent 만 표시 — 사용자가 어느 게 더미인지 식별 가능.

### 다음 PR 로 넘기는 메모

- PR8 의 회귀 점검: 기존 사용자 (agents/difficulties 필드 없는 localStorage) → 마이그레이션 코드 없이 default `[]` 가 잘 흡수되는지 1회 확인.
- PR8 의 시각 검증: AgentBreakdown 클릭 + DifficultyMix 슬라이스 클릭이 Today 에서 실제 entries 가 줄어드는지 확인 (수동 QA §4 항목 12, 13).
- 본 PR 의 `oculpm_observed_agent_ids` 가 W6 의 Settings UI ("에이전트 분포 사이드바") 로 재사용 가능 — 인터페이스 stable 유지.
- W6 stabilize 후보:
  - difficulty 칩 그룹 (현재는 DifficultyMix 클릭으로만 set)
  - 필터 dropdown Esc 닫기
  - `navigateToToday({ kind: "workday" })` 의 anchor-date 기반 dayOffset 자동 점프
