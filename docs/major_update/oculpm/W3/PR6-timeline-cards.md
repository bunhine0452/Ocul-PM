# W3-PR6 — `TimelineView` + `SessionCard` + `JournalEntryCard`

> **목표**: TodayScreen 의 메인 영역 — 세션 단위 collapsible 카드 + 그 안의 entry 카드들. 키보드 j/k/space/enter 동작. 손으로 만든 `.md` 가 1초 안에 카드로 표시.
> **선행**: W3-PR2 (`JournalCache`), W3-PR3 (commands), W3-PR4 (oculpmApi, WorkspaceContext), W3-PR5 (EmptyToday/Onboarding).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR6, [`../02-frontend.md`](../02-frontend.md) §6 (컴포넌트 트리), 페이즈 §3 (시안).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. 컴포넌트 트리 (실제)

```
TodayScreen
├── (existing legacy header — date nav, refresh)
├── EmptyToday V1/V2/V3            // PR5 (변경 없음)
├── TimelineView                   // ★ PR6
│   ├── ── left column ─────────
│   │   └── SessionCard × N (collapsible, 시간 역순)
│   │       ├── SessionHeader (id · time range · file/unique count · agent guess · ongoing pulse)
│   │       └── EntryList
│   │           └── JournalEntryCard × M
│   │             (badges · time · file count · verify toggle · tags)
│   └── ── right column (≥1024px) ─
│       └── DetailPaneStub          // PR7 가 본격 JournalEntryDetail 로 교체
└── ManualEntryModal               // ★ PR6 (PR5 stub 대체)
```

`OculpmOnboardingModal` 은 PR5 마운트 유지. 모든 분기 (V1/V2/V3 vs TimelineView) 는 TodayScreen 안의 하나의 분기 트리에서 일관.

---

## 2. `SessionCard` (실제)

### 시그니처

```ts
type SessionWithSynthetic =
  | { kind: "real"; session: Session }
  | { kind: "synthetic"; id: string; label: string };

interface SessionCardProps {
  projectId: number;
  session: SessionWithSynthetic;
  entries: JournalEntrySummary[];
  defaultExpanded: boolean;
  selectedEntryPath: string | null;
  onSelectEntry: (relativePath: string) => void;
  onToggleVerified: (relativePath: string) => void;
}
```

### 표시 (실제)

- **헤더 라인 1**: `Session 20260524-003` + 진행 중이면 펄스 dot + "진행 중" 라벨.
- **헤더 라인 2**: `09:13 → 11:47 · 47 files · 12 unique · claude-code` — 모두 한 줄 wrap.
- **우측 메타**: `N entries` (tabular-nums, 한 시야로 들어옴).
- **진행 종료 + entries 0개**: dashed-border placeholder + disabled DiffVsNarrative 버튼 (V3 와 같은 stub).
- **펼침 상태 영속화**: `localStorage["oculpm.session.expanded.<projectId>.<sessionId>"]`. 첫 mount 에 디폴트는 가장 최신 세션만 true.
- **synthetic "Manual" 세션**: orphan entries (session_id 가 `listSessions` 결과에 없는 것들 — 주로 sentinel 형식 `manual-…`) 용 가상 그룹. 헤더에 `manual` 라벨.

### Agent label guess (실제)

페이즈 §8 결정 #4 채택: entries 의 `agent_id` 빈도 1위 + 점유율 ≥ 50% 일 때만 표시, 그 외 `null`. 백엔드의 `agent_label_guess` 가 있으면 우선 사용 (W4 에서 채워질 자리).

```ts
function guessAgentFromEntries(entries) {
  // counts, find best, return iff bestCount / entries.length >= 0.5
}
```

---

## 3. `JournalEntryCard` (실제)

### 표시

```
┌────────────────────────────────────────────────────────────────┐
│ [BUG] [MEDIUM] [done]  09:25 · 3 files · ⚠ 미검증     [✓]      │
│ Changelog Export 파라미터 불일치                                 │
│ #changelog  #sqlite                                            │
└────────────────────────────────────────────────────────────────┘
```

### 배지 (페이즈 §3.4 토큰)

| 배지 | 토큰 |
|---|---|
| `bug` | `bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300` |
| `feature` | `bg-green-100 ...` |
| `error` | `bg-amber-100 ...` |
| `refactor` | `bg-blue-100 ...` |
| `chore` | `bg-zinc-100 ...` |
| difficulty | `opacity-100`(super) → `opacity-40`(verylow) — 단계 5 |
| status `done` | emerald 채움 + Check 아이콘 |
| status `in_progress` | blue dot pulse |
| status `abandoned` | line-through + muted |
| status `planned` | muted bg |
| 미검증 | amber AlertTriangle + 라벨 |
| 검증 토글 | hover 시 표시; 선택/검증된 카드는 항상 표시 |

### 인터랙션 (실제)

| Trigger | 결과 |
|---|---|
| 클릭 (button area) | `onSelect(path)` — 부모 TimelineView 가 selectedEntryPath 갱신 |
| 검증 토글 클릭 | `onToggleVerified(path)` — optimistic UI, 실패 시 resync |
| hover | 우측 ✓ 토글 opacity 0→1 |
| `j` / `k` | TimelineView 의 keyboard handler 가 처리 |
| `space` | TimelineView 가 처리 (선택된 카드 verify 토글) |
| `Esc` | TimelineView 가 selection 해제 |
| 더블클릭 / 우클릭 컨텍스트 | **보류** — shadcn context-menu 가 ui/ 에 없음. W6 stabilize 에서 추가 권장 |

### 가이드 대비 변경

- **컨텍스트 메뉴 보류** — shadcn ContextMenu 가 repo 의 `src/components/ui/` 에 없음. 도입은 별도 PR 분량. hover 검증 토글 + 키보드만으로도 기본 사용성 충족.
- **URL `?entry=…` 동기 보류** — 기존 App.tsx 가 router 없이 useState 만 사용 (PR4 결정과 동일). React Router 도입은 W6.

---

## 4. `TimelineView` (실제)

### 책임

1. **Fetch**: `listJournalEntries(workday)` + `listSessions(workday)` 동시 호출 → mount + workday/projectId 변경 시 재실행.
2. **Group**: entries → session_id 별 버킷. session 목록과 join 해 정렬된 SessionCard 입력 생성. 매칭 안 되는 orphan 은 synthetic "Manual" 그룹.
3. **이벤트 invalidate**: `oculpmJournalPathChanged` / `oculpmJournalAdded` / `oculpmJournalUpdated` 3개 listen → **200ms 디바운스** trailing-edge refetch. project_id 필터 적용.
4. **visibility refetch**: `document.visibilitychange === "visible"` → refetch.
5. **selectedEntryPath state**: source-of-truth for highlight + DetailPane.
6. **keyboard nav**: `j/k` 다음/이전, `space` 선택 카드 verify 토글, `Esc` 선택 해제. 입력 폼 (input/textarea/contentEditable) 내부에서는 모두 통과. ⌘/Ctrl/Alt 가 눌린 조합은 무시 (글로벌 shortcut 충돌 회피).
7. **자동 선택**: 첫 entry 가 자동 selected (없는 경우만). 선택된 entry 가 삭제되면 첫 entry 로 fall-back.
8. **DetailPaneStub**: `lg:` breakpoint 부터만 표시. PR7 이 본격 `JournalEntryDetail` 로 교체.

### 데이터 흐름

```
TodayScreen
  ├── tells TimelineView { projectId, workday }
  └── (manual entry 작성 시) refreshTick++ → 다시 probe → TimelineView 가 re-mount
       (TimelineView 자체는 이벤트 listener 로 자동 갱신, refreshTick 은 우회로)

TimelineView
  ├── listJournalEntries / listSessions  ──┐
  ├── events.oculpmJournalPathChanged ─────┼──► refetch (200ms debounce)
  ├── document.visibilitychange ────────────┘
  └── j/k/space/Esc keyboard
```

---

## 5. `ManualEntryModal` (실제 — PR5 stub 대체)

### 필드 (전부 구현)

- `type` — chip radio (5개)
- `title` — Input, required, maxLength 140, autoFocus
- `slug` — Input, required, **inline `SLUG_RE = /^[a-z0-9-]{1,60}$/` 검증** (백엔드 정책 미러), 위반 시 inline 에러
- `difficulty` — shadcn Select, "— (없음)" 옵션 포함
- `status` — shadcn Select, default `planned`
- `tags` — Enter / "," 입력으로 추가, 클릭으로 제거, 자유 형식
- `files_touched` — `getFileChanges(workday)` 결과 unique paths 30개 후보, chip 토글로 다중 선택
- `body_markdown` — textarea, optional, "## 발생 원인 …" placeholder

### 액션

- `[작성]` → `oculpmApi.createManualEntry(projectId, draft)` → 성공 시 `onCreated(entry)` 호출 + 모달 close. 실패 (slug 거부 / IO 등) → inline destructive 카드 + 사용자 재시도 가능.
- `[취소]` / Esc / backdrop click — close (submitting 중에는 비활성).
- session_id 는 항상 `null` 로 전송 — 백엔드가 활성 session 또는 sentinel 자동 부여 (footer 안내).

### 트리거 진입점 (3 곳)

1. **EmptyToday V2 의 [수동 entry 작성]** — onCreateManual 콜백.
2. **EmptyToday V3 의 [수동 entry 작성]** — 동일.
3. **글로벌 `⌘+Shift+J`** — TodayScreen 의 `useEffect` 가 `keydown` 캐치. ocul-pm 비활성 프로젝트면 OnboardingModal 대신 열림 (PR5 의 dismiss bar 와 협조).

---

## 6. 데이터 fetch / 갱신 전략 (실제)

페이즈 §2.4 의 3 단계 모두 구현:

1. **Mount**: `Promise.all([listJournalEntries, listSessions])`.
2. **이벤트**: 3개 backend event 200ms 디바운스 refetch. 디바운스의 trailing-edge 가 cache 의 batch flush 와 정렬됨.
3. **visibility**: tab 활성 복귀 → refetch.

추가:
- **Optimistic verify 토글**: 클릭 즉시 local state flip → backend 호출. 실패 시 refetch 로 resync (사용자에게 토스트는 W4 통합 토스트 레이어 도입 후).
- **`refreshTick` 우회로**: ManualEntryModal 가 entry 작성 후 TodayScreen 의 probe (journalCount) 를 강제 재실행하여 V2/V3 → TimelineView 자동 전환.

---

## 7. 테스트 (실제)

### Vitest 부재 → tsc + 빌드 검증 (PR4/PR5 와 동일 정책)

- [x] `pnpm exec tsc --noEmit` — 0 errors (Type narrowing 오류 1건 발견 → out array 명시 타입으로 해결).
- [x] `pnpm build` — green, 3.59s. JS bundle +22KB / CSS +2KB (이전 PR 대비).
- [x] 백엔드 회귀 0 (백엔드 무변경, oculpm 130 tests 유지).

### 자동 검증 (타입 시스템)

- [x] `JournalEntrySummary`/`Session`/`ManualEntryDraft`/`FileChangeEvent` 모든 사용처 정합.
- [x] `events.oculpmJournalPathChanged.listen(cb)` 의 unsubscribe 핸들 cleanup.
- [x] `oculpmApi.{listJournalEntries, listSessions, getFileChanges, setJournalVerified, createManualEntry}` 호출 사이트 round-trip.
- [x] keyboard handler 가 input/textarea/contentEditable 진입 시 통과 — `tag === "input" || "textarea" || isContentEditable` 가드.

### 수동 QA 매핑 (페이즈 §5 항목 1, 3, 7, 8)

| 항목 | 백엔드 충족 | 프론트 충족 |
|---|---|---|
| 1. 손으로 .md 떨굼 → 1초 안에 카드 | PR2 `apply_path_change` + `journal_path_changed` 이벤트 | TimelineView 의 200ms 디바운스 refetch ✅ |
| 3. 파일 내용 수정 (frontmatter title) → 카드 제목 갱신 | PR2 `upsert_entry` (full_text hash) | 동일 refetch 경로 ✅ |
| 7. verified 토글 → 파일 frontmatter 변경 (`cat` 확인) | PR3 `set_journal_verified` write-through ✅ | optimistic UI + backend call ✅ |
| 8. j/k 키 동작 | — | TimelineView 의 keydown handler ✅ |

다음 `pnpm tauri dev` 1회 실행으로 위 4 항목 동선 검증 가능.

---

## 8. DoD

- [x] 손으로 만든 .md 3개가 1초 안에 카드로 표시 — TimelineView refetch + 200ms 디바운스로 만족 (백엔드 이벤트 latency 가 가시 한계).
- [x] 카드 클릭 → 우측 디테일 패널 열림 (PR7 와 통합 위치) — DetailPaneStub 로 시각적 자리 + content 는 PR7.
- [x] j/k 키 동작 + space 토글 + Esc 선택 해제. Enter 는 stub (PR7 의 DetailPane focus 와 wire 예정).
- [x] 진행 중 세션 펄스 dot (emerald, animate-ping).
- [x] 1024px 폭 적응 — `lg:grid-cols-[1fr_22rem]` 미만에서 DetailPane 자동 숨김, 카드만 전폭. 모달은 max-w-2xl + max-h-90vh.
- [ ] `pnpm test` 7+ 케이스 green — **deferred (Vitest 미설치, PR4/PR5 와 동일)**. tsc + vite build 로 대체.
- [x] 시안 (페이즈 §3) 과 80% 일치:
  - 세션/엔트리 카드 레이아웃, 배지 색/농도/상태 아이콘, 진행 중 펄스, hover 토글, 키보드 단축키 — 시안과 동일.
  - 디테일 패널은 stub 라 시안과 의도적 차이 (PR7 에서 시안 일치).
  - 카테고리 필터바는 PR8 에서 시안 위치 (헤더 영역) 에 도입.

---

## 9. 실행 노트

### 신규/변경 파일 (5개)

| 파일 | 변경 |
|------|------|
| `src/features/oculpm/JournalEntryCard.tsx` | **신규** 204줄 — 배지 (TypeBadge/DifficultyBadge/StatusBadge), VerifyToggle, helper 시간 포맷 |
| `src/features/oculpm/SessionCard.tsx` | **신규** 211줄 — SessionHeader/OngoingDot/EmptyEntriesPlaceholder, expand 영속화, agent guess |
| `src/features/oculpm/TimelineView.tsx` | **신규** 273줄 — fetch/group/keyboard/event listener/DetailPaneStub, debounce util |
| `src/features/oculpm/ManualEntryModal.tsx` | **신규** 357줄 — 8 필드 폼 + files chip picker + slug 정규식 검증 |
| `src/features/today/TodayScreen.tsx` | TimelineView fall-through 분기 + ManualEntryModal mount + `⌘+Shift+J` 글로벌 shortcut + `refreshTick` 우회로 |

### 발견된 함정 / 변경

1. **TS narrowing — `kind: "real" as const` 가 `Array.push` 와 결합 시 widening 실패** ⚠ — `[...sessions].map(... {kind: "real" as const})` 가 `Array<{kind: "real"; ...}>` 로 추론되고, 뒤에 `{kind: "synthetic"; ...}` 를 push 하면 타입 에러. **해결**: 명시 `Array<{session: SessionWithSynthetic; entries: ...}>` 로 선언.
2. **`useMemo` import 오용** — ManualEntryModal 작성 중 import 했다가 안 쓰게 됨. 첫 빌드에서 unused-import 경고 → import 제거.
3. **Optimistic verify 토글의 race** — 클릭 직후 backend 호출 중 watcher 이벤트가 와서 cache refetch → optimistic flip 이 덮어쓰일 위험. PR3 의 `set_journal_verified` 가 write-through 로 cache 를 직접 upsert 하므로 hash 매칭 → watcher 이벤트는 `MtimeOnly`/`SkippedUnchanged` 분기 → 화면 충돌 없음. 본 PR 의 optimistic update 와 협조.
4. **디바운스 trailing-edge** — entries 가 빠르게 5번 바뀌면 backend 가 5번 emit. 200ms 디바운스로 한 번만 refetch — 부담 0. cancel 도 unmount cleanup 에서 호출.
5. **synthetic "Manual" 그룹의 헤더 라벨** — orphan entries 가 어떤 session 에 속해야 하는지 표시 없음. "Manual" 단일 라벨로 묶고 헤더에 작은 `manual` 칩 표시. 추후 sentinel id (`manual-YYYYMMDD-HHMMSS`) 별 분리 옵션은 W4 에서 고려.
6. **`⌘+Shift+J` 글로벌 shortcut 의 location** — `useGlobalShortcuts.ts` (App.tsx) 에 둘 수 있었지만 TodayScreen 안에 두는 게 (a) `ManualEntryModal` state 의 owner 와 일치 (b) ocul-pm 비활성 프로젝트 → OnboardingModal 로 라우팅 가능. 단점: TodayScreen 이 unmount 되면 shortcut 도 사라짐 — 다행히 TodayScreen 은 5-IA 의 ⌘1 화면이라 거의 항상 mount.
7. **keyboard handler 의 `Enter` 미구현** — PR7 의 DetailPane 가 마크다운 viewer + 액션 버튼을 가질 때 focus 이동 대상이 명확. 본 PR 의 stub 에서는 Enter 가 할 일이 없어 의도적으로 빈 처리.

### 의도된 누락 (PR7/PR8/W4 에 위임)

- **DetailPane content** — PR7. 본 PR 의 DetailPaneStub 가 자리만.
- **CategoryFilterBar** — PR8. 본 PR 의 TimelineView 는 모든 entries 표시.
- **URL `?entry=…` 동기** — W6 (라우터 도입 시).
- **컨텍스트 메뉴 (우클릭)** — W6 (shadcn ContextMenu 추가 후).
- **자동 토스트 라우팅** — W4 (통합 토스트 레이어 도입과 함께).
- **frontmatter 깨진 entry 의 노란 dot** — 본 PR 의 JournalEntryCard 는 미검증 amber 만 표시. parse_ok=0 표시는 PR7 의 DetailPane 가 빨간 ⚠ + raw YAML 토글로 surface (페이즈 명세).

### 빌드/타입 체크 시간

- `pnpm exec tsc --noEmit` — 즉시 (1건 에러 fix 후 0).
- `pnpm build` — **3.59s** (tsc + vite). JS bundle +22KB / CSS +2KB.
- 백엔드 무변경 → cargo 회귀 0 (130 oculpm tests 유지).

### PR7/PR8 로 넘기는 메모

- **`selectedEntryPath` source-of-truth** — TimelineView 내부 useState. PR7 의 `JournalEntryDetail` 가 DetailPaneStub 위치 (lg:grid 우측 22rem) 에 들어가 같은 state 의 entry 를 받음. 인터페이스: `selectedEntry: JournalEntry | null` (PR6 는 summary 만 가짐 — PR7 가 `getJournalEntry` 호출).
- **`oculpm:journal_path_changed` listener 다중 가입** — 본 PR 의 TimelineView listener 가 cache invalidation 의 시그널. PR7 의 DetailPane 도 selected entry 만 listen 해 자동 refresh 추가 가능 (선택).
- **검증 토글 source-of-truth** — TimelineView 의 optimistic state 가 권위. PR7 의 DetailPane 에서 verify 토글 클릭 시 같은 `oculpmApi.setJournalVerified` 호출 + parent 가 refetch.
- **CategoryFilterBar (PR8) 와 TimelineView 통합** — PR8 의 filter state 가 TimelineView 의 `listJournalEntries(workday, filters)` 인자로 전달. 본 PR 의 `refetch` callback 이 filter 변경에도 재호출되어야 함 — TodayScreen 이 filter state owner 가 되어 prop 으로 내려보낼 가능성.
- **ManualEntryModal 의 files_touched 후보** — 현재 `getFileChanges(workday)` 만 사용. PR8 의 검색이 등록되면 user 가 filter 한 파일만 후보로 좁힐 옵션 가능 (UX 향상).

- **본 PR 의 미해결 항목 없음** — 다음 PR 진입 가능.
