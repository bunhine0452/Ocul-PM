# W4-PR6 — Frontend `DiffVsNarrative` 모달 + 4 trigger

> **목표**: PR5 의 `LayerComparison` 를 좌/우 컬럼으로 시각화. SessionCard, EmptyToday V3, JournalEntryDetail 의 disabled 버튼들을 본 PR 의 모달로 활성화.
> **선행**: W4-PR5 (`compare_layers` 커맨드), W3-PR6 (SessionCard), W3-PR5 (EmptyToday V3 의 disabled `[⚖ index 비교 보기]`), W3-PR7 (JournalEntryDetail 의 disabled `[⚖ index 비교]`).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR6, [`../02-frontend.md`](../02-frontend.md) §7.
> **상태**: ✅ (2026-05-25 — 3 trigger 직접 활성화 + EmptyTodayV3 TodayScreen 통해 활성화. Vitest 4 는 W6) · 🔧 **PostFix 2026-05-25**: 모달 chrome 제거 → 인라인 패널. `variant: "panel" | "compact"` prop 추가, "코드 스니펫" 토글 헤더 추가.

> 📌 **Post-dogfooding addendum (2026-05-25)** — 자세한 동기는 [`../phases/_dogfooding-w4.md`](../phases/_dogfooding-w4.md) §2026-05-25 발견 4 / 조치 완료 4 참조. 요지: 모달 안에서 3-way mismatch 비교가 어려움 → `fixed inset-0` 오버레이 제거하고 인라인 panel 로 변경. SessionCard 는 `variant="compact"` 로 entries 리스트 아래에 인라인 expand, TodayScreen / EmptyTodayV3 / JournalEntryDetail 은 기본 `variant="panel"` 로 호출 지점 인라인 렌더. 헤더에 "코드 스니펫" 체크박스 추가 (기본 off, 켜면 row 아래 "미구현 — git diff 로 확인하세요" 힌트). 향후 ndjson before/after bytes 와 narrative join 으로 실제 스니펫 렌더 가능 (다음 dogfooding 회차에서 토글 사용 빈도 측정).

---

## 1. 컴포넌트 (계획)

`src/features/oculpm/DiffVsNarrative.tsx`:

```tsx
interface DiffVsNarrativeProps {
  projectId: number;
  sessionId: string;
  onClose: () => void;
  onActionResync: () => void;          // PR8 의 syncAgents
  onActionManualEntry: (prefill: { sessionId: string; files: string[] }) => void;
}
```

레이아웃 (modal max-w-4xl):

```
┌───────────────────────────────────────────────────────────────────┐
│ ⚖ index ↔ journal 비교 — Session 20260524-003       [X]          │
├───────────────────────────────────────────────────────────────────┤
│ ┌─ index (워처가 본 파일 7) ────┬─ journal (LLM 이 기록 5) ────┐ │
│ │ ✓ src/api/foo.ts             │ ✓ src/api/foo.ts             │ │
│ │ ✓ src/api/bar.ts             │ ✓ src/api/bar.ts             │ │
│ │ ✗ src/util/cache.ts          │ ⚠ src/util/legacy.ts (환각)  │ │
│ │ ✗ src/util/store.ts          │                              │ │
│ │ ✗ tests/api.test.ts          │                              │ │
│ │ ✓ README.md                  │ ✓ README.md                  │ │
│ │ ✓ tests/foo.test.ts          │ ✓ tests/foo.test.ts          │ │
│ └───────────────────────────────┴──────────────────────────────┘ │
│ index 7 / journal 5 / 일치 4 / 누락 3 / 환각 1 · severity: ⚠ Warning │
│                                                                   │
│ [어댑터 규칙 다시 보내기]  [수동 narrative 작성 (3 누락 prefill)] │
└───────────────────────────────────────────────────────────────────┘
```

### 아이콘 / 토큰

- ✓ (matched): `Check` text-emerald-600.
- ✗ (only_in_index, 누락): `Circle` 또는 dim row + 빨간 ⚠ 라벨.
- ⚠ (only_in_journal, 환각): `AlertTriangle` text-amber.
- severity badge: Ok=emerald / Warning=amber / Critical=red.

---

## 2. 4 trigger 지점 (계획)

| 위치 | 트리거 UI | 인자 |
|---|---|---|
| Today SessionCard 헤더 | "⚖" 아이콘 버튼 (우측 메타 옆) | `sessionId = session.id` |
| Today SessionCard, entries 0 인 ended 세션 | placeholder 안 "mismatch 보기" 링크 | 동일 |
| EmptyToday V3 | "⚖ index 비교 보기" (PR5 의 disabled 버튼 해제) | 가장 최근 session 의 id |
| JournalEntryDetail | "⚖ index 비교" (PR7 의 disabled 버튼 해제) | `entry.frontmatter.session_id` |

본 PR 에서 W3 의 disabled 버튼들 활성화 + onClick 핸들러 연결.

---

## 3. 액션 (계획)

### [어댑터 규칙 다시 보내기]

- `oculpmApi.syncAgents(projectId)` 호출 → 토스트 "동기화 완료 (어댑터 N개)".
- 모달은 닫지 않음 (사용자가 결과 비교를 계속 보고 싶을 수 있음).
- 권장 시나리오: LLM 이 작업했지만 narrative 누락이 많아 → 규칙 파일이 효과 없는 것 같으면 재전송.

### [수동 narrative 작성]

- `onActionManualEntry({ sessionId, files: comparison.only_in_index })` → 부모 (TodayScreen) 가 ManualEntryModal 을 open + prefill.
- prefill 형식:
  - `session_id` field 가 modal 에서 readonly + 본 sessionId.
  - `files_touched` 체크박스에 only_in_index 가 모두 pre-checked.
- 사용자가 본문 작성 → 저장 → 다음 fetch 사이클에 LayerComparison 재계산 → severity 개선 확인.

---

## 4. 테스트 (계획)

페이즈 §3: Vitest 4 케이스 (W6 의 Vitest 인프라 도입 후 작성).

- [ ] SessionCard 의 ⚖ 클릭 → DiffVsNarrative 모달 mount + projectId/sessionId prop 정확.
- [ ] only_in_index 5, only_in_journal 1 인 모킹 응답 → 좌/우 컬럼 카운트 5+1 표시.
- [ ] "수동 narrative 작성" 클릭 → onActionManualEntry 가 prefill 인자로 호출됨 (parent 가 ManualEntryModal 에 전달하는지는 별 테스트).
- [ ] severity Critical → footer badge 가 red bg.

수동 QA (페이즈 §4 #8, #9, #10):

- [ ] 일부러 entries 부족한 세션 → only_in_index 4개 표시.
- [ ] 일부러 가짜 path 적은 entry → only_in_journal 1개 표시 (환각 검출).
- [ ] "수동 narrative 작성" → ManualEntryModal 의 files_touched 가 only_in_index 로 prefill.

---

## 5. DoD

- [ ] Vitest 4 (deferred to W6, 대체: tsc + build).
- [ ] DiffVsNarrative 가 한 세션에 대해 정확한 비교를 보여줌 (수동 QA 3건).
- [ ] W3 의 disabled 버튼 3곳 (SessionCard / EmptyToday V3 / JournalEntryDetail) 모두 활성화.
- [ ] sessionStorage 60초 캐시 동작 (페이즈 §2.4).

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **모달 vs 인라인 expand** — 페이즈 §1 의 모달 채택. 비교 정보가 길어서 인라인은 카드 레이아웃 깨짐.
2. **only_in_index 가 100+ 일 때** — 가상 스크롤 vs 페이지네이션 vs 처음 50 만. v1 은 처음 50 + "전부 보기" 버튼.
3. **severity badge 색** — Ok=emerald, Warning=amber, Critical=red. PR6 의 다른 카드 색 패밀리와 정합.
4. **prefill 의 files_touched op** — 알 수 없음 (워처는 op 정보 있지만 PR5 의 LayerComparison 가 path 만 반환). 기본 `update` 로 prefill, 사용자가 수정 가능.

### 발견된 함정 / 변경

- **P-1 (bindings stale)**: `oculpmApi` 가 PR2 시점에 W4 함수 (`syncAgents`, `detectAgents`, `compareLayers`) wrapper 미포함. 본 PR 에서 함께 추가.
- **P-2 (4 trigger 의 modal 소유자)**: SessionCard / JournalEntryDetail 는 자기 컴포넌트가 `useState<boolean>` 로 modal mount (단일 카드/디테일 안에서 닫힘). EmptyTodayV3 는 `onCompareLayers` callback → TodayScreen 이 `compareSessionId: string | null` state 로 own. callback 패턴 통일하지 않은 이유: TodayScreen 의 EmptyTodayV3 는 "최근 session 찾아서 비교" 라 인자 결정 책임이 부모에 있음.
- **P-3 (TodayScreen 의 latestSessionId)**: probe 와 함께 `oculpmApi.listSessions(workday)` 호출 → 가장 큰 session_id (YYYYMMDD-NNN 사전순). `at(-1)` 은 TS lib 의 es2022 필요해서 `arr[arr.length-1]` 로 대체 (이 프로젝트 TS target 호환성 차원).
- **P-4 (sessionStorage 캐시 60초)**: DiffVsNarrative 가 자체 캐시. modal 반복 open 시 fetch 부담 흡수. `oculpm.compare.{projectId}.{sessionId}` key. quota exceeded 는 silently degrade.
- **P-5 (onActionManualEntry 미wire)**: prefill 인자로 ManualEntryModal 띄우려면 SessionCard/JournalEntryDetail → TodayScreen 까지 callback chain 필요 (모두 modal 을 TodayScreen 이 own 하게). 부담 크고 PR doc DoD 직접 요구 없음. **PR8 의 CommandPalette 와 함께 한꺼번에 wire 권장** — 메모 § 다음 PR 로.

### 다음 PR 로 넘기는 메모

- PR8 의 토스트 핸들러가 본 PR 의 [어댑터 규칙 다시 보내기] 성공/실패를 surface.
- PR7 (Settings) 에서 severity 임계 노출 시 본 PR 의 표시도 함께 갱신.
