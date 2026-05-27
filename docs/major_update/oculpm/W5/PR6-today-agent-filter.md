# W5-PR6 — Today 의 agent 필터 확장 (W4 보완)

> **목표**: W3-PR8 의 `CategoryFilterBar` + W3-PR8 의 `CategoryFilter` 에 `agents: Set<string>` 추가. UI 에서 멀티 선택, 백엔드 `EntryFilters` 도 agent 필터 추가, OverviewScreen 의 AgentBreakdown 클릭 wire 완성.
> **선행**: W3-PR8 의 `filters.ts` + `CategoryFilterBar.tsx`. PR5 의 AgentBreakdown 가 클릭 callback 만 wire 한 상태.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR6.
> **상태**: ⬜

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

- [ ] agent 필터 토글 동작 + 다른 필터와 AND 결합.
- [ ] Overview 의 AgentBreakdown 클릭 → Today 의 agent 필터 1개로 navigate.
- [ ] localStorage 의 기존 (agents 필드 없는) 저장값이 무중단으로 default `[]` 흡수.
- [ ] backend 4 신규 테스트 PASS.
- [ ] `pnpm tsc --noEmit` clean.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **observed agents 의 fetch 주기** — 매 mount vs CategoryFilterBar 열 때마다. 후자가 가볍 (1회만). 새 entry 작성 직후 누락 가능성은 작음 (dropdown 다시 열면 갱신).
2. **fixed list 의 표기** — `claude-code` 의 사용자 친화 표시 ("Claude Code"). 단순 매핑 함수 + KNOWN_AGENT_IDS 와 동기화.
3. **observed 안에 fixed list 중복** — set union 으로 제거. fixed 가 항상 위, observed extra 가 아래 정렬.
4. **`agents = []` 의 의미** — "모두" vs "없음". `types` 와 동일하게 "모두" 채택.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR8 의 회귀 점검: 기존 사용자 (agents 필드 없는 localStorage) → 마이그레이션 코드 없이 default `[]` 가 잘 흡수되는지 1회 확인.
- 본 PR 의 `oculpm_observed_agent_ids` 가 W6 의 Settings UI ("에이전트 분포 사이드바") 로 재사용 가능 — 인터페이스 stable 유지.
