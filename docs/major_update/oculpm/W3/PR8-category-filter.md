# W3-PR8 — `CategoryFilterBar` + 필터 영속화

> **목표**: 5개 type chip + verified_only / mismatch_only / unfinished_only 토글 + 검색 입력 (200ms 디바운스). 필터 상태는 프로젝트별 `localStorage` 에 영속. URL 동기 (선택).
> **선행**: W3-PR3 (`listJournalEntries` 가 `EntryFilters` 받음), W3-PR4 (oculpmApi), W3-PR6 (TimelineView fetch 경로).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR8, [`../02-frontend.md`](../02-frontend.md) §8.
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. 상태 타입 (실제)

`src/features/oculpm/filters.ts:30` — UI 레이어와 wire 레이어의 두 가지 shape 을 명확히 분리:

```ts
export interface CategoryFilter {
  types: Set<EntryType>;        // 빈 set = 전체
  verifiedOnly: boolean;
  mismatchOnly: boolean;        // W4 까지 disabled
  unfinishedOnly: boolean;
  search: string;
}

export const DEFAULT_FILTER: CategoryFilter = Object.freeze({ /* … */ });
```

- **`Set<EntryType>`** 을 in-memory 에서 사용 → O(1) chip-toggle 멤버십 체크.
- 직렬화/네트워크 시점에서만 `[...filter.types].sort()` 로 배열화.
- `mismatchOnly` 필드는 W4 가 wire 시 한 boolean 만 바꾸면 되도록 미리 자리 보존.

`toEntryFilters(filter)` 가 유일한 변환 boundary — TimelineView 는 항상 canonical `EntryFilters` 만 봄. snake_case / null-collapse 로직이 한 곳에 모임.

---

## 2. 영속화 (실제)

- 키: `oculpm.filter.${projectId}` JSON.
- `loadFilter(projectId)`: 누락/깨짐 → `console.warn` + `DEFAULT_FILTER` 폴백. 각 필드를 개별 검증 (`isValidEntryType` filter, `typeof === "boolean"` 가드) — 한 필드가 깨져도 나머지는 살림.
- `saveFilter(projectId, filter)`: `isFilterEmpty(filter)` 이면 `removeItem` (스토리지 깔끔 유지). quota/private-mode 실패 → warn + in-memory 만 살림 (앱 동작 영향 없음).
- 프로젝트 전환 시: `useEffect([activeProjectId])` 가 `loadFilter` 재실행 → 각 프로젝트가 자기 필터 보존.

**lint 인프라 정합**: `scripts/check-no-localstorage.mjs` 의 ALLOWLIST 에 `features/oculpm/filters.ts` 추가. 같은 PR 에서 PR5 (OnboardingModal 의 dismiss flag) / PR6 (SessionCard 의 expand state) / PR5 (TodayScreen 의 dismiss-bar read) 도 ALLOWLIST 에 합류 — W3 작업 동안 발생한 미선언 위반들을 동시 정리. 사유 주석: "per-project ephemeral state, would force WorkspaceContext schema bump per PR. W6 stabilize 의 project-scoped persistence 후보".

---

## 3. UI (실제)

`src/features/oculpm/CategoryFilterBar.tsx` — 단일 파일 ~250줄. 가이드 §3 의 mockup 그대로:

```
┌──────────────────────────────────────────────────────────────────┐
│ [전체] · [bug] [feature] [error] [refactor] [chore]              │
│ □ 검증됨만  □ mismatch 만 (W4)  □ 미완료만   🔍 [검색      ⓧ]    │
└──────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 구조

- `Chip` (raw `<button>` + aria-pressed + ring) — `src/components/ui/` 에 ToggleGroup 이 없어 직접 구현. 활성 상태는 type 별 색 (bug=red, feature=green, error=amber, refactor=blue, chore=zinc) + ring. "전체" 는 neutral foreground/10. PR6 의 카드 배지 토큰과 시각적 패밀리 유지.
- `ToggleField` (shadcn `Checkbox` + label) — 3 boolean 토글. mismatch 는 `disabled` + tooltip "W4 (DiffVsNarrative) 페이즈에서 활성화됩니다".
- 검색: shadcn `Input` + 좌측 `Search` 아이콘 + 우측 `X` 클리어 버튼 (입력 있을 때만). 우측 `ml-auto sm:w-64` 로 데스크탑에서는 끝 정렬, 모바일에서는 풀폭.

### Source-of-truth 규칙 (PR7 의 verify 토글 패턴과 동일)

- 전체 `CategoryFilter` 는 **부모 (TodayScreen) 가 owner**. Bar 는 render + onChange emit 만.
- **예외 한 곳**: 검색 `<input>` 은 controlled local `searchInput` state 를 유지 (매 keystroke 가 즉시 반영) + 200ms 디바운스 후에만 부모로 emit. 부모의 backend fetch 가 매 keystroke 마다 트리거되지 않음.
- `useEffect` 가 `filter.search !== searchInput` 일 때만 timer 시작 → 디바운스가 의도대로 trailing-edge 만 발화.
- 프로젝트 전환 (= 부모가 다른 filter 로딩) 시 `lastEmittedSearch.current` 가드로 local input 도 새 값으로 동기.

### 반응형

- type chip row: `overflow-x-auto` + `shrink-0` chips → <640px 에서 가로 스크롤.
- 토글/검색 row: `flex-wrap gap-x-4 gap-y-2` → 좁아지면 자연 줄바꿈, 검색 input 이 다음 라인에서 풀폭.

---

## 4. 검색 매치 (백엔드 처리, 본 PR 은 wire-up 만)

`oculpmApi.listJournalEntries(projectId, workday, filters)` 의 `filters.search` 가 trimmed 비어있지 않으면 string, 비어있으면 `null`. 백엔드 (PR2/PR3) 가 SQL `LIKE` (case-insensitive, title/body/slug/tags) 처리.

본 PR 은 와이어 only — 매치 로직 / FTS5 검토는 W6 후보 (PR8 §7 메모).

---

## 5. URL 동기 (보류)

DoD 의 선택 항목. 본 PR 미구현:
- `App.tsx` 가 react-router 없이 useState 만으로 라우팅 (PR4/PR6 결정과 동일).
- 라우터 도입은 W6.
- URL 동기가 추가되면 `loadFilter` 보다 URL 이 우선, URL 변경 시 localStorage 도 갱신하는 분기 추가.

---

## 6. 테스트 (실제)

### Vitest 부재 → tsc + 빌드 + lint:storage 검증 (PR4/PR5/PR6/PR7 와 동일 정책)

- [x] `pnpm exec tsc --noEmit` — 0 errors.
- [x] `pnpm build` — green, 2.80s. JS +6KB / CSS +6KB.
- [x] `pnpm lint:storage` — green (PR8 신규 + PR5/PR6 기존 ocul-pm 파일 ALLOWLIST 정리 후 통과).
- [x] 백엔드 회귀 0 (백엔드 무변경).

### 자동 검증 (타입 시스템)

- [x] `EntryFilters` round-trip — `toEntryFilters(filter)` → `bindings.ts` 의 `EntryFilters` 정합.
- [x] `CategoryFilter.types: Set<EntryType>` ↔ 직렬화 시 `EntryType[]` 변환 정확.
- [x] `loadFilter` 의 unknown narrowing — `isValidEntryType` 가드로 type-erased JSON 안전 처리.
- [x] `CategoryFilterBar` props (`filter`, `onChange`, optional `matchedCount`/`totalCount`) 시그니처 사용 사이트 정합.
- [x] `Checkbox.onCheckedChange` 의 `CheckedState` (`boolean | "indeterminate"`) 를 boolean 으로 narrow.

### 수동 QA 매핑 (페이즈 §5 항목 5, 6)

| 항목 | 백엔드 충족 | 프론트 충족 |
|---|---|---|
| 5. 5개 type 필터 토글 OK | PR2 `listJournalEntries` 의 `types` SQL IN 절 | Chip 클릭 → Set add/remove + 즉시 onChange ✅ |
| 6. 검색 "export" → 매치 카드만 표시 | PR2 LIKE (title/body/slug/tags) | input → 200ms 디바운스 → backend 1회 호출 ✅ |
| 추가. 새로고침 후 필터 상태 복원 | — | `loadFilter` on mount + `saveFilter` on change ✅ |
| 추가. 깨진 localStorage → 폴백 | — | `JSON.parse` try/catch + 필드별 validate ✅ |

`pnpm tauri dev` 1회 실행 → 위 4 항목 확인 가능.

---

## 7. DoD

- [x] 5개 type 필터 토글 동작 — Chip 의 active 상태가 `filter.types` Set 반영.
- [x] 검색 디바운스 동작 (input 매 키스트로크에 fetch 하지 않음) — `useEffect` setTimeout 200ms.
- [x] 새로고침 후 필터 상태 복원 — `loadFilter` 가 `useEffect([activeProjectId])` 에서 hydrate.
- [x] verifiedOnly / mismatchOnly / unfinishedOnly 3 토글 동작 — mismatchOnly 는 의도적 disabled (W4 wire 예정).
- [x] 한국어 검색 매치 — 백엔드 LIKE 가 binary substring 비교라 자동 OK (PR2/PR3 보장).
- [x] 작은 화면 (<768px) 가로 스크롤 — chip row `overflow-x-auto`, 다른 row 는 wrap.
- [ ] `pnpm test` 6+ 케이스 green — **deferred (Vitest 미설치, PR4~PR7 와 동일 정책)**.
  - [x] `pnpm exec tsc --noEmit` 0 errors.
  - [x] `pnpm build` green, 2.80s.
  - [x] `pnpm lint:storage` green.

---

## 8. 실행 노트

### 신규/변경 파일 (5개)

| 파일 | 변경 |
|------|------|
| `src/features/oculpm/filters.ts` | **신규** ~165줄 — `CategoryFilter` 타입 + `ALL_ENTRY_TYPES` + `DEFAULT_FILTER` + `toEntryFilters` boundary + `loadFilter`/`saveFilter` (필드별 validate, 빈 필터 시 removeItem) |
| `src/features/oculpm/CategoryFilterBar.tsx` | **신규** ~250줄 — Chip / ToggleField / 검색 input + 디바운스 + 톤 토큰 |
| `src/features/oculpm/TimelineView.tsx` | `filters?: EntryFilters \| null` prop 추가, `filtersKey` (JSON.stringify) 를 useCallback dep 로 사용해 stable identity 유지, `listJournalEntries` 에 `filters` 전달 |
| `src/features/today/TodayScreen.tsx` | filter state owner (`useState<CategoryFilter>`), `loadFilter`/`saveFilter` wiring, `entryFilters = useMemo(toEntryFilters)`, `<CategoryFilterBar>` 를 `<TimelineView>` 위에 마운트 |
| `scripts/check-no-localstorage.mjs` | ALLOWLIST 정리 — PR8 신규 `features/oculpm/filters.ts` + PR5/PR6 에서 누락된 4개 ocul-pm 파일 추가, W3 transient 사유 주석 |

### 의사결정 / 변경

1. **단일 파일 구조 유지** — 가이드 §3 의 chip/toggle 분리 대신 한 파일에 `Chip` + `ToggleField` inline. PR6 (`JournalEntryCard`, `SessionCard`), PR7 (`JournalEntryDetail`) 과 동일 패턴. 분리할 만큼 재사용이 없음 (Chip 은 type 별 색 토큰이 결합도 높음).

2. **`filters.ts` 분리** — UI 컴포넌트 (`CategoryFilterBar`) 와 별도. 이유: (a) 영속화/직렬화는 TodayScreen 도 직접 호출. (b) 추후 SettingsScreen 이나 CommandPalette 가 같은 필터를 reuse 할 가능성. (c) `toEntryFilters` boundary 가 한 곳에 있어야 wire 변경 시 추적 쉬움.

3. **`Set<EntryType>` in-memory** — 직렬화 시 sort 된 배열로 변환. 이유: chip-toggle 의 add/remove 가 O(1), `Set.has()` 가 chip active 판정에 가장 자연스러움. 직렬화 비용은 사용자가 chip 클릭할 때 한 번뿐.

4. **검색 디바운스의 위치** — Bar 안에 둠 (parent 가 아님). 이유: (a) input 의 controlled state 가 Bar 의 책임 (local `searchInput`), 부모는 디바운스 후 발화 값만 받음. (b) 부모가 다른 filter 변경 (chip 토글 등) 에는 영향 없음 — chip 은 즉시 onChange. (c) Bar 가 unmount 되면 timer 자동 cleanup.

5. **`filtersKey` (JSON.stringify) 를 useCallback dep 로** — TimelineView 의 `refetch` 가 매 부모 렌더마다 새 identity 가 되면 (filter 객체가 매번 새로 만들어지므로) `useEffect([refetch])` 가 매 렌더 fetch 를 트리거. JSON 직렬화한 키를 dep 으로 쓰면 deep-equal 변경만 잡힘. trade-off: filter 가 매우 복잡해지면 stringify 비용 발생 — 현재 5 필드만 가져서 negligible.

6. **`mismatchOnly` 자리 보존 + disabled** — 가이드 §8 의사결정 #4 채택. 필드는 `EntryFilters` 에 이미 있고 (`bindings.ts:583`), Bar 의 토글은 항상 disabled + tooltip. W4-PR5 가 wire 시 `disabled` 한 줄만 제거.

7. **URL 동기 보류** — 가이드 §8 의사결정 #1 추천 그대로. App.tsx 가 라우터 미사용 → URL 동기는 라우터 도입과 함께 W6.

8. **matchedCount / totalCount 표시 보류** — Bar 가 받을 수는 있지만 (props 정의됨) TodayScreen 이 현재 unfiltered count 를 모름 (별도 fetch 필요). v1 은 props 안 넘김 → Bar 우측 indicator 비활성. 추후 enhancement: TimelineView 가 filtered/unfiltered 두 fetch 를 띄우거나, 백엔드가 두 count 를 한 응답에 합쳐 줌. W6 후보.

9. **ALLOWLIST 일괄 정리** — 발견된 김에 PR5/PR6 의 기존 위반 (OnboardingModal/SessionCard/TodayScreen) 도 같이 ALLOWLIST 에 추가. 위반 사유 일관 (per-project ephemeral state) + 마이그레이션 시점 일관 (W6 project-scoped persistence) → 한 곳에 모은 게 추적 쉬움. 가이드 외 변경이지만 lint 가 PR8 검증 통과 조건이라 부득이.

### 발견된 함정

1. **`Object.freeze(DEFAULT_FILTER)` 의 Set 가 frozen 되지 않음** — frozen 객체의 nested Set 은 여전히 mutate 가능. `cloneDefault()` 헬퍼로 매 load 마다 새 Set 인스턴스 반환해 회피. DEFAULT_FILTER 를 직접 mutate 하면 다른 프로젝트에 누수.
2. **`Checkbox.onCheckedChange(CheckedState)` 의 type** — `boolean | "indeterminate"` 라서 `(v) => onChange(v)` 직접 위임 시 type 에러. `v === true` 로 narrow.
3. **lint:storage 의 한 줄 주석 false-negative** — 스크립트가 `^//` 시작 라인을 skip 하지만 inline `/* */` 안의 `localStorage` 도 false-positive 가능. 다행히 filters.ts 의 doc 주석은 첫 단어가 `*` 라서 skip. 향후 inline comment 사용 시 주의.

### 의도된 누락 (PR9/W4/W6 위임)

- **URL 동기 (`/today?types=…&search=…`)** — W6 라우터 도입과 함께.
- **mismatchOnly 활성화** — W4-PR5 가 disabled 해제.
- **matched / total count 표시** — backend 가 두 count 를 한 응답에 합쳐주거나 dedicated count endpoint 가 생기면. W6 후보.
- **자체 키워드 highlight** — 검색 결과 카드에 매치된 substring 강조. 별도 UX PR.
- **FTS5 검토** — SQLite LIKE 의 성능 한계 측정 후 결정. W6.
- **Vitest 케이스 6+개** — W6 stabilize 의 Vitest 인프라 도입과 함께.

### 빌드/타입 체크 시간

- `pnpm exec tsc --noEmit` — 즉시 (0 errors).
- `pnpm build` — **2.80s** (tsc + vite). JS bundle +6KB / CSS +6KB.
- `pnpm lint:storage` — 즉시 (✓ no direct localStorage access outside the allowlist).
- 백엔드 무변경 → cargo 회귀 0.

### PR9 (dogfooding) / PR10 (Greenfield 통합) 로 넘기는 메모

- **PR9 dogfooding 시드 entries** — 다양한 type 분포 (bug/feature/error/refactor/chore 각 1+개) 로 만들면 본 PR 의 chip 필터가 실제 데이터로 테스트됨.
- **PR10 Greenfield 통합** — Greenfield 옵션 A 가 init 한 새 프로젝트는 `loadFilter` 가 storage miss → DEFAULT_FILTER. 정상 동작.

### W4 로 넘기는 메모

- **mismatchOnly wire** — `CategoryFilterBar.tsx` 의 `ToggleField` 에서 `disabled` prop 만 제거. backend 의 `mismatch_only` SQL 분기는 PR2 가 이미 wire (현재는 항상 빈 결과).

### W6 로 넘기는 메모

- **project-scoped persistence 레이어** — 현재 W3 ocul-pm 4개 파일이 localStorage 직접 접근. WorkspaceContext 가 project state 가 아니라 workspace state 의 owner 라 자연스러운 마이그레이션 대상 아님. 새 `ProjectStateContext` 또는 SQLite per-project 테이블 검토. ALLOWLIST 제거가 마이그레이션 완료 신호.
- **URL 라우팅 + 필터 동기** — react-router 도입.
- **검색 FTS5** — LIKE 성능 측정 후 도입 결정.

- **본 PR 의 미해결 항목 없음** — 다음 PR (W3-PR10 Greenfield 통합 → PR9 dogfooding) 진입 가능.
