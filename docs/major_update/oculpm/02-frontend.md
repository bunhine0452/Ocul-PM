# 프론트엔드 (React / TypeScript) 구현 계획

> 참조: [`00-spec.md`](./00-spec.md), [`01-backend.md`](./01-backend.md)
> 대상 코드: `src/`

---

## 1. 신규 / 변경 디렉토리

```
src/
├── types/
│   └── oculpm.ts                   # specta 가 백엔드에서 자동 생성 (수동 편집 X)
├── api/
│   └── oculpm.ts                   # 커맨드 래퍼 (try/catch + 토스트 + 타입 안전)
├── contexts/
│   └── WorkspaceContext.tsx        # ※ 변경 — Today 디폴트 + oculpm session 상태 추가
├── features/
│   ├── today/
│   │   ├── TodayScreen.tsx         # ※ 전면 재설계
│   │   ├── TimelineView.tsx        # NEW — 시간순 카드 스택
│   │   ├── CategoryFilterBar.tsx   # NEW — Bug/Feature/Error/Refactor/Chore + Verified
│   │   ├── SessionCard.tsx         # NEW — 세션 헤더 + 그 안의 entry 들
│   │   ├── JournalEntryCard.tsx    # NEW
│   │   ├── JournalEntryDetail.tsx  # NEW — 우측 패널 또는 모달
│   │   ├── LayerComparison.tsx     # NEW — index vs journal 정합성 배지
│   │   └── EmptyToday.tsx          # NEW — onboarding/empty 상태
│   ├── overview/
│   │   ├── OverviewScreen.tsx      # ※ 재포지셔닝 (집계 뷰)
│   │   ├── ActivityHeatmap.tsx     # NEW — 7/30/90일 활동
│   │   ├── UnfinishedChecklist.tsx # NEW — [ ] 미완료 모음
│   │   ├── AgentBreakdown.tsx      # NEW — 에이전트별 작성 비중
│   │   └── DifficultyMix.tsx       # NEW — 난이도 분포
│   ├── oculpm/                     # NEW — 공통 컴포넌트
│   │   ├── DiffVsNarrative.tsx     # NEW — file_changes vs files_touched 시각화
│   │   ├── FrontmatterBadge.tsx    # NEW — type/status/difficulty 배지
│   │   ├── AgentBadge.tsx          # NEW
│   │   └── VerifiedToggle.tsx      # NEW
│   ├── settings/
│   │   └── OculpmSettings.tsx      # NEW — config.toml 편집 UI
│   └── projects/
│       ├── OculpmOnboardingModal.tsx # NEW — 첫 진입 시
│       └── MigrationModal.tsx        # NEW — SQLite → .oculpm
├── components/
│   ├── CommandPalette.tsx          # ※ 변경 — 새 명령 추가
│   └── ToastProvider.tsx           # (있다면) 새 토스트 타입 등록
└── App.tsx                         # ※ 변경 — 디폴트 탭 today, 사이드바 순서
```

---

## 2. TypeScript 타입 (자동 생성 + 수동 보강)

### 2.1 자동 생성 (`src/types/oculpm.ts`)

`tauri-specta` 가 빌드 시점에 `01-backend.md §4` 의 Rust 타입들을 모두 변환. **수동 편집 금지**. 백엔드 타입이 바뀌면 `pnpm tauri dev` 가 재생성.

예상 export:
```ts
export type EntryType = "bug" | "feature" | "error" | "refactor" | "chore";
export type EntryStatus = "planned" | "in_progress" | "done" | "abandoned";
export type Difficulty = "superhigh" | "high" | "medium" | "low" | "verylow";
export type FileOp = "create" | "update" | "delete" | "rename" | "correct";
export interface JournalEntry { ... }
export interface JournalFrontmatter { ... }
export interface Session { ... }
export interface FileChangeEvent { ... }
export interface LayerComparison { ... }
export interface OculpmConfig { ... }
// 이벤트 페이로드
export interface OculpmSessionStarted { ... }
// ... 등
```

### 2.2 프론트 전용 보강 (`src/api/oculpm.ts`)

```ts
import { commands, events } from "@/bindings"; // specta 가 생성한 묶음
import type { JournalEntry, Session, OculpmConfig } from "@/types/oculpm";

export const oculpmApi = {
  async init(projectId: number) {
    return unwrap(await commands.oculpmInit(projectId));
  },
  async getStatus(projectId: number) {
    return unwrap(await commands.oculpmGetStatus(projectId));
  },
  async listJournalEntries(projectId: number, workday?: string) {
    return unwrap(await commands.oculpmListJournalEntries(projectId, workday ?? null));
  },
  async getJournalEntry(projectId: number, relativePath: string) {
    return unwrap(await commands.oculpmGetJournalEntry(projectId, relativePath));
  },
  async compareLayers(projectId: number, sessionId: string) {
    return unwrap(await commands.oculpmCompareLayers(projectId, sessionId));
  },
  // ...전체 20+ 커맨드
};

function unwrap<T>(r: { status: "ok"; data: T } | { status: "error"; error: string }): T {
  if (r.status === "ok") return r.data;
  throw new Error(r.error);
}
```

### 2.3 React Query 통합

기존에 React Query 가 있는 경우, 다음 key 컨벤션:
- `["oculpm", projectId, "journal", workday]`
- `["oculpm", projectId, "sessions", workday]`
- `["oculpm", projectId, "config"]`
- `["oculpm", projectId, "compare", sessionId]`

이벤트(`oculpm:file_changed`, `oculpm:journal_added` 등)가 오면 해당 key 들을 `queryClient.invalidateQueries`.

없으면 컴포넌트 안에서 `useEffect` + `listen` 으로 처리. 어느 쪽이든 결정은 기존 코드 컨벤션을 따른다.

---

## 3. `WorkspaceContext` 변경

기존 `src/contexts/WorkspaceContext.tsx` 에 다음 상태 추가:

```ts
type WorkspaceContextValue = {
  // 기존 필드 ...

  // NEW — oculpm 통합
  oculpmEnabled: boolean;                // 프로젝트마다 토글 가능
  currentSession: Session | null;        // 이벤트로 실시간 업데이트
  workdayKey: string;                    // "20260522" — 자정 넘어가면 자동 갱신
  oculpmStatus: "ready" | "uninitialized" | "read_only" | "error";

  // 액션
  refreshOculpmStatus: () => Promise<void>;
  startSessionManual: () => Promise<void>;
  endSessionManual: (sessionId: string) => Promise<void>;
};
```

**디폴트 탭 변경**: 기존 `defaultTab: "overview"` → `defaultTab: "today"`. localStorage 마이그레이션:
- `WorkspaceContext` 의 마이그레이션 함수가 schema_version 을 한 단계 올리면서 `defaultTab` 을 today 로 강제 (기존 사용자도 마이그레이션됨).
- 사용자가 명시적으로 overview 로 변경한 경우는 존중 (다음 필드 추가: `defaultTabUserOverride: boolean`).

`docs/2026521/W1/04-workspace-context.md` 와 `07-localstorage-migration.md` 의 마이그레이션 패턴을 그대로 따른다.

---

## 4. `App.tsx` — 사이드바 / 라우팅 변경

| 기존 순서 | 새 순서 |
|---|---|
| Overview → Today → Code → Chat → ... | **Today → Overview** → Code → Chat → ... |

- 프로젝트 진입 시 디폴트 라우트 `/p/:id/today` (또는 현재의 탭 컨벤션에 맞춤).
- Today 아이콘은 좀 더 눈에 띄게 (배지로 미확인 verify 카운트 표시).
- Overview 아이콘은 그래프 류로 교체 (재포지셔닝 명확화).

키보드 단축키 (CommandPalette + 글로벌):
- `g t` → Today
- `g o` → Overview
- `cmd+shift+s` → 수동 세션 시작/종료 토글
- `cmd+shift+j` → 새 journal 엔트리 작성 (사용자 수동 작성 가능 — `agent.id = "manual"`)
- `?` → 단축키 도움말

---

## 5. `TodayScreen` 전면 재설계

### 5.1 레이아웃 (Desktop 1440 기준)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Today · 2026-05-22 (목)   workday: 20260522   tz: Asia/Seoul   [⚙]      │  ← 헤더
├──────────────────────────────────────────────────────────────────────────┤
│  [전체]  [버그]  [기능]  [에러]  [리팩토링]  [잡일]   |  [미검증만]  [검색] │  ← 카테고리 필터
├──────────────────────────────────────────────┬───────────────────────────┤
│                                              │                           │
│  ▼ Session 20260522-003                      │   Detail Panel            │
│    09:13 → 11:47 · 47 files · claude-code    │   (선택된 entry)          │
│    ┌─────────────────────────────────────┐   │                           │
│    │ [bug] [medium] [done]               │   │   ┌─────────────────────┐ │
│    │ Changelog Export 파라미터 불일치   │   │   │ [bug] [medium] [✓]  │ │
│    │ 09:25 · src-tauri/src/db.rs etc.    │   │   │ ...                 │ │
│    │ [⚠ narrative mismatch]              │   │   │ ## 발생 원인       │ │
│    └─────────────────────────────────────┘   │   │ ...                 │ │
│    ┌─────────────────────────────────────┐   │   │ [Verify ✓]          │ │
│    │ [feature] [high] [done]             │   │   └─────────────────────┘ │
│    │ Chat + QuickEdit 통합               │   │                           │
│    └─────────────────────────────────────┘   │                           │
│                                              │                           │
│  ▼ Session 20260522-002                      │                           │
│    ...                                       │                           │
│                                              │                           │
└──────────────────────────────────────────────┴───────────────────────────┘
```

좌측 70% 타임라인, 우측 30% 디테일. 디테일 패널은 entry 클릭 시에만 표시 (없으면 좌측 100%).

### 5.2 `TimelineView` 컴포넌트

```tsx
type Props = {
  sessions: Session[];                  // sorted desc by started_at
  entriesBySession: Map<string, JournalEntrySummary[]>;
  filter: CategoryFilter;
  selectedEntryPath?: string;
  onSelect: (path: string) => void;
};
```

- 세션 단위로 collapsible. 디폴트 열림 (오늘 첫 세션 = 가장 위).
- 같은 세션 안의 entry 들은 `created_at` ASC.
- entry 가 0 개인 세션도 표시 ("이 세션에는 기록된 narrative 가 없습니다 — 자동 감지된 파일 변경 N개" 식 안내). 클릭 시 `DiffVsNarrative` 모달.

### 5.3 `JournalEntryCard`

```
┌─────────────────────────────────────────────────────────────────┐
│ [bug] [medium] [done]  [⚠ narrative mismatch]      09:25 · ✓ 미검증│
│ Changelog Export 파라미터 불일치                                  │
│ src-tauri/src/db.rs · src/features/code/AiWorkbench.tsx          │
└─────────────────────────────────────────────────────────────────┘
```

- 타입 배지 색상 (Tailwind): bug=red, feature=green, error=orange, refactor=blue, chore=gray.
- difficulty 배지 농도로 표현.
- status: 체크박스 (`[ ]` / `[x]`) 시각화.
- `narrative mismatch`: `LayerComparison.mismatch_severity != "ok"` 일 때.
- mtime hover 시 절대시각 툴팁.

### 5.4 `JournalEntryDetail`

- 마크다운 본문 렌더링 (기존 changelog 의 마크다운 렌더러 재사용).
- 상단: frontmatter 의 핵심 필드 (type, difficulty, status, agent, session 링크).
- 본문 위/아래: `[Verify ✓]` 버튼 → `oculpmApi.setJournalVerified`.
- "원본 파일 열기" 버튼 (OS file manager + 에디터). Tauri `opener` 플러그인.
- 우상단 "Compare with index" 토글 → `DiffVsNarrative` 펼침.

### 5.5 `CategoryFilterBar`

- 5개 type chip + "전체".
- 토글류: `verified_only`, `mismatch_only`, `unfinished_only` (`[ ]` 만).
- 텍스트 검색 — 디바운스 200ms, body+title+tags 매치.
- 필터 상태는 URL 쿼리 또는 localStorage 저장 (디폴트 후자, 프로젝트별).

### 5.6 `EmptyToday`

3 가지 빈 상태:

| 상태 | UI |
|---|---|
| `.oculpm/` 자체가 없음 | 큰 카드 "ocul-pm 으로 이 프로젝트를 추적할까요?" → `OculpmOnboardingModal` 띄움 |
| `.oculpm/` 있는데 오늘 폴더 없음 | "오늘은 아직 기록이 없습니다. 코드를 수정하면 자동으로 잡힙니다." + 수동 entry 작성 버튼 |
| 오늘 폴더 있는데 entry 0 (file_changes 만 있음) | "오늘 N 개의 파일이 변경됐지만 narrative 가 작성되지 않았습니다. 에이전트 설정을 확인하세요." + 어댑터 상태 패널 + DiffVsNarrative 보기 버튼 |

세 번째가 가장 중요 — 외부 LLM 이 규칙을 안 지킬 때 사용자에게 즉시 노출.

---

## 6. `OverviewScreen` 재포지셔닝

기존 `OverviewScreen.tsx` 의 내용은 대부분 Today 로 이주. 새 Overview = **집계/메타 뷰**.

레이아웃:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Project Overview                                                         │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  │
│  │ Activity Heatmap   │  │ Difficulty Mix     │  │ Agent Breakdown    │  │
│  │ (90일 캘린더 그리드)│  │ (도넛/스택바)      │  │ (바)               │  │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Unfinished Checklist (status != done & checkbox == false)          │  │
│  │ - [ ] 2026-05-21 [feature] LLM 모델 셀렉터 ...                     │  │
│  │ - [ ] 2026-05-19 [bug] 다이얼로그 닫힘 ...                         │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Recent Sessions (30일)                                              │  │
│  │ 표: 날짜, 세션수, 총 시간, 파일수, narrative 작성률                 │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- 모든 위젯이 cache (SQLite) 쿼리로 동작 (대용량 시 빠르게).
- 클릭 시 Today 의 해당 날짜로 이동.

---

## 7. `DiffVsNarrative` — 이중 레이어 핵심 UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer Comparison · Session 20260522-003                  [닫기]    │
├──────────────────────────────────┬──────────────────────────────────┤
│  Ground Truth (index)            │  Narrative (journal)             │
│  파일 워처가 감지한 변경         │  LLM 이 기록한 작업              │
├──────────────────────────────────┼──────────────────────────────────┤
│  ✓ src-tauri/src/db.rs           │  ✓ src-tauri/src/db.rs           │
│  ✓ src/features/code/AiW.tsx     │  ✓ src/features/code/AiW.tsx     │
│  ⚠ src-tauri/src/commands/*.rs   │  (누락 — narrative 없음)         │
│  (누락 — 사용자가 직접 본 변경) │  ⚠ src/legacy/Foo.tsx            │
│                                  │     (환각 — 실제로 안 바뀜)     │
├──────────────────────────────────┴──────────────────────────────────┤
│  요약: index 7개 / journal 5개 / 일치 4개 / 누락 3개 / 환각 1개    │
│  [어댑터 규칙 다시 보내기]  [수동 narrative 작성]                  │
└─────────────────────────────────────────────────────────────────────┘
```

- 좌측 = `LayerComparison.index_files`.
- 우측 = `LayerComparison.journal_files`.
- `only_in_index` 는 좌측에 ⚠ + "narrative 누락".
- `only_in_journal` 은 우측에 ⚠ + "환각 의심".
- 하단 액션은 mismatch 발생 시에만 표시.

---

## 8. `OculpmSettings` — config.toml 편집 UI

`Settings` 모달 또는 페이지에 새 섹션 "ocul-pm".

각 키를 폼 필드로:
- **Workday**:
  - timezone: combobox (IANA tz 검색).
  - day_starts_at: time picker.
- **Session**:
  - inactivity_timeout_minutes: slider 5–120.
  - auto_close_on_workday_boundary: toggle.
- **Git**:
  - journal_committed: toggle. 끄면 `.gitignore` 관리 블록이 `journal/` 도 ignore 로 변경.
  - forbid_journal_for_paths: tag list editor.
  - auto_redact_patterns: textarea (정규식 1줄 1패턴). 우측에 "테스트" 영역.
- **Watcher**:
  - ignore: tag list.
  - respect_gitignore: toggle.
  - debounce_ms: number.
- **Agents**:
  - active: multi-select. 토글 시 즉시 어댑터 동기화 (확인 다이얼로그).
  - auto_detect_on_open: toggle.
  - auto_sync_adapters: toggle.
  - "에이전트 감지" 버튼 → `oculpm_detect_agents`.
  - "규칙 다시 동기화" 버튼 → `oculpm_sync_agent_rules`.

저장 시 검증 실패하면 인라인 에러. 성공 시 toast + 워처 재시작 (필요한 경우).

---

## 9. `OculpmOnboardingModal`

첫 진입 시 1회. `.oculpm/` 부재 검사로 트리거.

3 step:

1. **소개**: "ocul-pm 이 이 프로젝트의 작업을 자동 기록할 수 있어요." + 차이점 설명 (수동 changelog vs 자동).
2. **에이전트 선택**: 감지된 에이전트 목록 + 사용자 토글.
3. **요약**: 무엇이 어디에 생성되는지 (`.oculpm/`, 어댑터 경로) + git 정책 안내 + 확인.

확인 시 `oculpm_init` 호출. 거절 시 다음 진입 때 다시 묻지 않음 (`localStorage: oculpm_dismissed_<projectId> = true`). 우상단 상태바에 작은 "ocul-pm 활성화" 링크 유지.

---

## 10. `MigrationModal` (SQLite → .oculpm)

기존 SQLite changelog 가 N>0 개인 프로젝트에서 onboarding 후 추가로 묻는다.

```
┌───────────────────────────────────────────────────────────────────┐
│  기존 데이터 마이그레이션                                          │
├───────────────────────────────────────────────────────────────────┤
│  이 프로젝트의 기존 changelog (42 개) 를 .oculpm/journal/ 로      │
│  변환할 수 있습니다.                                                │
│                                                                    │
│  ✓ 백업이 .oculpm.backup-pre-migration-2026-05-22T20-55-00/ 에      │
│    저장됩니다. 언제든 되돌릴 수 있습니다.                          │
│                                                                    │
│  마이그레이션될 항목:                                              │
│  - 2026-05-22: 8개 entry (Bugs 4, Features 4)                     │
│  - 2026-05-21: 12개 entry ...                                      │
│  - ...                                                             │
│                                                                    │
│  ⚠ 충돌 예상: 0건                                                 │
│                                                                    │
│  [건너뛰기]  [백업만 만들기]  [지금 마이그레이션]                  │
└───────────────────────────────────────────────────────────────────┘
```

- "지금 마이그레이션" → `oculpm_migrate_from_sqlite` 호출. 진행률 progress bar.
- 완료 후 결과 화면 (성공 N, 스킵 M, 실패 0).
- 실패가 있으면 실패 entry 목록 + 사용자가 수동으로 처리.

---

## 11. 이벤트 처리 (실시간 업데이트)

`useEffect` 안에서:

```tsx
useEffect(() => {
  if (!projectId) return;
  const unlisten = events.oculpmJournalAdded.listen((e) => {
    if (e.payload.projectId !== projectId) return;
    queryClient.invalidateQueries(["oculpm", projectId, "journal"]);
    toast.info("새 작업 기록이 추가되었습니다.", {
      action: { label: "보기", onClick: () => openEntry(e.payload.relativePath) }
    });
  });
  // ... session_started/ended, file_changed (스로틀), integrity_warning ...
  return () => { unlisten.then(fn => fn()); };
}, [projectId]);
```

`file_changed` 는 분당 수십~수백 건 가능 → **카운트만 누적**해서 1초마다 한 번 UI 반영. 디테일 패널에 "오늘 N 파일 변경됨" 만 표시.

---

## 12. `CommandPalette` 변경

`src/components/CommandPalette.tsx` 에 새 명령 추가:

| 명령 | 동작 |
|---|---|
| "Today 로 이동" | navigate today |
| "Overview 로 이동" | navigate overview |
| "세션 수동 시작" | `oculpmApi.startSessionManual` |
| "세션 수동 종료" | active session 있을 때만 |
| "수동 작업 기록 작성" | 새 entry 마크다운 에디터 모달 |
| "어댑터 규칙 다시 보내기" | `oculpmApi.syncAgentRules` |
| "이중 레이어 비교 (오늘 마지막 세션)" | `DiffVsNarrative` 열기 |
| "ocul-pm 설정 열기" | settings 의 oculpm 섹션 |

---

## 13. 디자인 시스템 / 접근성 / 다크모드

- shadcn 컴포넌트 + Tailwind v4 (기존과 동일).
- 색상 토큰: 기존 사용 중인 토큰 재사용. 새 entry type 색은 `colors.bug`, `colors.feature` 식으로 토큰화.
- 모든 인터랙티브 요소에 `aria-label`, focus ring.
- mismatch 배지 같은 경고는 색 + 아이콘 + 텍스트 3중. 색맹 안전.
- Reduce motion: timeline animation `prefers-reduced-motion` 존중.

---

## 14. 로딩 / 에러 / 빈 상태 매트릭스

| 상황 | UI |
|---|---|
| Initial loading (커맨드 호출 중) | skeleton (3 카드) |
| `.oculpm/` 미존재 | EmptyToday 변형 1 |
| 락 점유 (다른 인스턴스) | 노란 배너 "다른 윈도우에서 이 프로젝트를 사용 중입니다. 읽기 전용 모드로 표시 중." |
| 워처 에러 | 빨간 배너 + 재시작 버튼 |
| 마이그레이션 진행 중 | full-screen modal lock |
| 어댑터 drift (외부 수정 감지) | 토스트 "Cursor 규칙 파일이 외부에서 수정됐습니다. 동기화하시겠어요? [동기화] [무시]" |
| 본문 frontmatter 깨짐 | entry card 에 노란 배지, detail 에서 "원본 보기" 옵션 |

---

## 15. 작업 분해 체크리스트 (프론트 view)

`03-rollout.md` 와 매핑.

- [ ] **F-1** specta 자동 생성 확인 + `src/types/oculpm.ts` ignore 처리
- [ ] **F-2** `src/api/oculpm.ts` 래퍼
- [ ] **F-3** `WorkspaceContext` 확장 + localStorage 마이그레이션
- [ ] **F-4** `App.tsx` 사이드바 순서 + 디폴트 탭
- [ ] **F-5** `EmptyToday` 3 변형 + `OculpmOnboardingModal`
- [ ] **F-6** `TimelineView` + `SessionCard` + `JournalEntryCard`
- [ ] **F-7** `JournalEntryDetail` + 마크다운 렌더
- [ ] **F-8** `CategoryFilterBar` (필터 상태 영속화)
- [ ] **F-9** `DiffVsNarrative` + `LayerComparison` API 통합
- [ ] **F-10** `OverviewScreen` 재포지셔닝 + 4 위젯
- [ ] **F-11** `OculpmSettings` 폼
- [ ] **F-12** `MigrationModal` + 진행률
- [ ] **F-13** 이벤트 listener 통합 + 토스트
- [ ] **F-14** `CommandPalette` 새 명령
- [ ] **F-15** 빈/로딩/에러 상태 마무리 + a11y 점검
- [ ] **F-16** 다크모드/디자인 토큰 정리
