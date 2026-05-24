# W3-PR8 — `CategoryFilterBar` + 필터 영속화

> **목표**: 5개 type chip + verified_only / mismatch_only / unfinished_only 토글 + 검색 입력 (200ms 디바운스). 필터 상태는 프로젝트별 `localStorage` 에 영속. URL 동기 (선택).
> **선행**: W3-PR3 (`listJournalEntries` 가 `EntryFilters` 받음), W3-PR4 (oculpmApi).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR8, [`../02-frontend.md`](../02-frontend.md) §8.

---

## 1. 상태 타입 (계획)

```ts
type CategoryFilter = {
  types: Set<EntryType>;          // 빈 set = 전체
  verifiedOnly: boolean;
  mismatchOnly: boolean;
  unfinishedOnly: boolean;        // checkbox === false || status !== "done"
  search: string;                 // 디바운스 200ms
};

const DEFAULT_FILTER: CategoryFilter = {
  types: new Set(),
  verifiedOnly: false,
  mismatchOnly: false,
  unfinishedOnly: false,
  search: "",
};
```

---

## 2. 영속화 (계획)

`localStorage["oculpm.filter." + projectId]` JSON.

직렬화 시 `Set<EntryType>` → 정렬된 `EntryType[]`. 역직렬화 시 다시 Set.

읽기 실패 / 깨짐 → `DEFAULT_FILTER` 로 폴백 (로그 warn).

프로젝트별이라 같은 워크스페이스에서 프로젝트 전환 시 각자 보존.

---

## 3. UI (계획)

```
┌──────────────────────────────────────────────────────────────────┐
│ [전체] [버그] [기능] [에러] [리팩] [잡일]  ·  □ 미검증  □ mismatch│
│ □ 미완료만                                       🔍 [검색      ]  │
└──────────────────────────────────────────────────────────────────┘
```

- 5 type chip: shadcn `ToggleGroup` (type="multiple") + "전체" 가상 chip — 클릭 시 types 비움.
- 3 boolean 토글: 체크박스 또는 작은 chip.
- 검색 input: shadcn `Input` + 좌측 search 아이콘. 200ms 디바운스 (lodash 또는 자체 `useDebouncedValue`).
- 작은 화면 (<768px) 에서 chip 들 가로 스크롤.

### 시각 토큰 (페이즈 §3.4)

- chip radius: `var(--radius-chip)` (999px).
- 활성 chip: type 배지 색상 + ring.
- 비활성 chip: muted bg.

---

## 4. 검색 매치 (계획)

`listJournalEntries(projectId, workday, filters)` 가 filters.search 를 백엔드로 보냄. 백엔드 (PR2/PR3) 가 SQL LIKE (case-insensitive) 로 매치:

- title
- body_markdown
- slug
- tags (oculpm_journal_tags JOIN)

한국어 정상 매치 (SQLite 의 NOCASE 는 ASCII 한정 — `LIKE` 가 binary 비교지만 `'%' || query || '%'` 는 substring 그대로 → 한국어 매치 OK).

대소문자 무시는 영어만 보장 (`LOWER(title) LIKE LOWER(?)`). 한국어 case 는 의미 없음 → 그대로.

---

## 5. URL 동기 (선택)

```
/today?types=bug,feature&verified=1&search=export
```

브라우저 history API 또는 React Router. 새로고침 시 복원.

URL ↔ localStorage 충돌:
- URL 이 명시되면 URL 우선 + localStorage 갱신.
- URL 없으면 localStorage 우선.

URL 동기는 nice-to-have — DoD 에서는 선택 항목.

---

## 6. 테스트 (계획)

### Vitest (페이즈 §4 카테고리 필터 3개 + 추가)

- [ ] 5개 type chip 토글 — types Set 정확히 add/remove.
- [ ] "전체" chip 클릭 → types 비움.
- [ ] verifiedOnly 토글 → filter 의 verifiedOnly 갱신.
- [ ] 검색 input 매 키스트로크 → fetch 안 함 (200ms 디바운스 검증).
- [ ] 디바운스 200ms 후 fetch 1회 호출.
- [ ] localStorage 영속화 — set 후 새로고침 mock → 복원.
- [ ] 깨진 localStorage → DEFAULT_FILTER 폴백 + console.warn.

### 수동 QA (페이즈 §5 항목 5, 6)

- [ ] 5개 type 필터 토글 OK.
- [ ] 검색 "export" → 매치 카드만 표시.
- [ ] 새로고침 후 필터 상태 복원.

---

## 7. DoD

- [ ] 5개 type 필터 토글 동작.
- [ ] 검색 디바운스 동작 (input 매 키스트로크에 fetch 하지 않음).
- [ ] 새로고침 후 필터 상태 복원.
- [ ] verifiedOnly / mismatchOnly / unfinishedOnly 3 토글 동작.
- [ ] 한국어 검색 매치.
- [ ] 작은 화면 (<768px) 가로 스크롤.
- [ ] `pnpm test` 6+ 케이스 green.

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **URL 동기 여부**: 본 PR 의 DoD 에 넣지 말고 후속 (W6) 으로 미루는 게 안전 — 라우터 변경 충격 vs 가치.
2. **"unfinished_only" 정의**: `checkbox === false || status !== "done"` — checkbox 가 null 인 entry 는 unfinished 로 볼지 결정. → null 은 unfinished 아님 (status 만 기준).
3. **검색 디바운스 라이브러리**: `useDebouncedValue` 자체 구현 (15 줄) vs `use-debounce`. → 자체 구현 추천.
4. **mismatchOnly** — W4 의 LayerComparison 결과가 필요. W3 에서는 자리만 + 항상 disabled / tooltip "다음 페이즈".

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- W4 의 mismatch detection 이 wire 되면 mismatchOnly 토글 활성화.
- W6 의 FTS5 검토 — LIKE 의 성능 한계 측정 후 결정.
- W3-PR6 의 TimelineView 가 filter 변화를 prop 으로 받아 listEntries 재호출.
