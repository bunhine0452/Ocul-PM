# W3-PR4 — Frontend: specta wrapper + WorkspaceContext + 라우팅

> **목표**: 프론트에 `oculpmApi` 래퍼 / `WorkspaceContext` 확장 / 디폴트 탭 Today / 기존 localStorage 마이그레이션 (schema_version 1→2). 이후 PR5~PR8 의 UI 가 사용할 토대.
> **선행**: W1/W2/W3-PR3 의 specta TS export 완료 → `bindings.ts` 에 18개 `commands.oculpm*` + 6개 이벤트.
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR4, [`../02-frontend.md`](../02-frontend.md) §2.2 (api wrapper) / §3 (라우팅).

---

## 1. `src/api/oculpm.ts` — 래퍼 (계획)

`02-frontend.md §2.2` 의 12+ 메서드를 1 file 에 모음. 각 메서드는 `commands.oculpm*` 을 호출하고 `Result<T, string>` → `T | throw` 로 변환.

```ts
export const oculpmApi = {
  // W1
  init: (projectId: number) => unwrap(commands.oculpmInit(projectId)),
  getStatus: (projectId: number) => unwrap(commands.oculpmGetStatus(projectId)),
  getConfig: (projectId: number) => unwrap(commands.oculpmGetConfig(projectId)),
  setConfig: (projectId: number, patch: Partial<OculpmConfig>) =>
    unwrap(commands.oculpmSetConfig(projectId, patch)),

  // W2
  getCurrentSession: (projectId: number) => unwrap(commands.oculpmGetCurrentSession(projectId)),
  startSessionManual: (projectId: number) => unwrap(commands.oculpmStartSessionManual(projectId)),
  endSessionManual: (projectId: number, sessionId: string) =>
    unwrap(commands.oculpmEndSessionManual(projectId, sessionId)),
  listSessions: (projectId: number, workday?: string) =>
    unwrap(commands.oculpmListSessions(projectId, workday ?? null)),
  getFileChanges: (projectId: number, workday: string, sessionId?: string) =>
    unwrap(commands.oculpmGetFileChanges(projectId, workday, sessionId ?? null)),
  getIndexSnapshot: (projectId: number, workday: string, kind: SnapshotKind) =>
    unwrap(commands.oculpmGetIndexSnapshot(projectId, workday, kind)),
  watcherStart: (projectId: number) => unwrap(commands.oculpmWatcherStart(projectId)),
  watcherStop:  (projectId: number) => unwrap(commands.oculpmWatcherStop(projectId)),
  watcherStatus:(projectId: number) => unwrap(commands.oculpmWatcherStatus(projectId)),

  // W3 (PR3)
  listJournalEntries: (projectId: number, workday?: string, filters?: EntryFiltersDto) =>
    unwrap(commands.oculpmListJournalEntries(projectId, workday ?? null, filters ?? null)),
  getJournalEntry: (projectId: number, relativePath: string) =>
    unwrap(commands.oculpmGetJournalEntry(projectId, relativePath)),
  setJournalVerified: (projectId: number, relativePath: string, verified: boolean) =>
    unwrap(commands.oculpmSetJournalVerified(projectId, relativePath, verified)),
  reindexCache: (projectId: number) => unwrap(commands.oculpmReindexCache(projectId)),
  createManualEntry: (projectId: number, draft: ManualEntryDraft) =>
    unwrap(commands.oculpmCreateManualEntry(projectId, draft)),
};
```

`unwrap` helper:
```ts
function unwrap<T>(promise: Promise<Result<T, string>>): Promise<T> {
  return promise.then((r) => (r.status === "ok" ? r.data : Promise.reject(new Error(r.error))));
}
```

---

## 2. `WorkspaceContext` 확장 (계획)

기존 context 에 다음 필드 추가:

```ts
type WorkspaceState = {
  // ... 기존 ...
  oculpmEnabled: boolean;
  oculpmStatus: OculpmStatusView | null;
  currentSession: Session | null;
  workdayKey: string;            // "20260524" — 자정 (실제는 KST 03:00) 넘기면 갱신
};
```

이벤트 listener (Provider mount 시):

| 이벤트 | 액션 |
|---|---|
| `oculpm:session_started` | `setCurrentSession(payload.session)` |
| `oculpm:session_ended` | `setCurrentSession(null)` |
| `oculpm:workday_boundary` | `setWorkdayKey(payload.new_workday)` + React Query invalidate (`oculpm`, projectId, "*") |
| `oculpm:journal_path_changed` | React Query invalidate (`oculpm`, projectId, "journal", workday) |
| `oculpm:journal_cache_updated` | (PR2 신규) 동일 invalidate — 이쪽이 batch 이므로 우선 |
| `oculpm:integrity_warning` | 토스트 (PR-W4 에서 정식 처리, W3 에서는 console.warn) |

`workdayKey` 자동 갱신: `WorkdayResolver` 의 next_boundary 까지 `setTimeout`. boundary 도달 시 새 timer 등록.

---

## 3. `App.tsx` — 라우팅 변경

`PRIMARY_NAV` 의 1·2번 swap (refactor W6 에서 정의된 한국어 5항목 위에서):

| 순서 | 라벨 | ID | shortcut | 비고 |
|---|---|---|---|---|
| 1 | **오늘** | `today` | **⌘1** | 디폴트 탭 (배지: unread verified — W4 에서 wire, W3 은 자리만) |
| 2 | **개요** | `overview` | **⌘2** | W5-PR5 에서 집계 뷰 |
| 3 | 계획 | `plan` | ⌘3 | 변동 없음 |
| 4 | 변경 기록 | `changelog` | ⌘4 | W5 부터 read-only 배너 |
| 5 | 코드 | `code` | ⌘5 | 변동 없음 |

- 신규 프로젝트 select 시 `navigate("today")` 로 자동 redirect.
- shortcut 충돌 점검: 글로벌 `⌘+Shift+J` (수동 entry), `⌘+Shift+S` (세션 토글), `⌘+F` (검색) 는 `⌘1`~`⌘5` 와 겹치지 않음.

---

## 4. localStorage 마이그레이션 (schema_version 1 → 2)

기존 `workspace` 스토리지에 `schema_version` 키 추가/검사:

```ts
const stored = JSON.parse(localStorage.getItem("workspace") ?? "{}");
if ((stored.schema_version ?? 1) < 2) {
  if (!stored.defaultTabUserOverride) {
    stored.defaultTab = "today";
  }
  stored.schema_version = 2;
  localStorage.setItem("workspace", JSON.stringify(stored));
}
```

규칙:
- `defaultTab` 이 명시적 user override (`defaultTabUserOverride: true`) 인 경우 기존 값 유지.
- 그 외는 `today` 로 강제.
- 한 번 마이그레이션되면 다시 안 함.

---

## 5. 테스트 (계획)

### Vitest

- [ ] `oculpmApi.unwrap` — Ok / Err 경로.
- [ ] `WorkspaceContext` — `oculpm:session_started` 이벤트 mock → `currentSession` 업데이트.
- [ ] `WorkspaceContext` — `oculpm:workday_boundary` → workdayKey 갱신 + invalidate 호출 횟수.
- [ ] `App` 라우팅 — 신규 프로젝트 select → `navigate("today")` 호출.
- [ ] localStorage 마이그레이션 — `schema_version` 없음 + `defaultTab="overview"` → `defaultTab="today"` 로 갱신, `schema_version=2`.
- [ ] localStorage 마이그레이션 — `defaultTabUserOverride: true` → defaultTab 유지.

### 수동 E2E

- [ ] DevTools 콘솔에서 6개 이벤트 listener mount 로그 확인.
- [ ] 신규 프로젝트 진입 시 Today 가 디폴트.
- [ ] 기존 사용자 storage (Overview default) → 1회 리로드 후 Today.
- [ ] `defaultTabUserOverride=true` 인 사용자 → 기존값 유지.

---

## 6. DoD

- [ ] `oculpmApi` 의 모든 메서드가 호출 가능 (mount 시 `console.log(Object.keys(oculpmApi).length)` ≥ 17).
- [ ] WorkspaceContext 가 6개 이벤트를 모두 listen + cleanup (unmount 시 unsub).
- [ ] 디폴트 탭 Today (신규/마이그레이션된 사용자 둘 다).
- [ ] localStorage 마이그레이션 1회만 동작 (재진입 시 no-op).
- [ ] specta TS 가 누락 없이 생성 (`bindings.ts` 가 빌드 산출에 항상 갱신).
- [ ] `pnpm test` green, `pnpm tauri build` green.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`unwrap` 의 에러 모델**: `throw new Error` vs `Promise.reject(new OculpmApiError(...))`. 후자가 토스트에서 type narrowing 에 유리. → 후자 추천.
2. **React Query 도입 여부**: PR2/PR3 의 list 갱신을 RQ 의 invalidate 로 쓸 것인가, useState + manual refetch 로 쓸 것인가. → 기존 코드 컨벤션 확인 후 결정 (refactor W6 이후 RQ 도입 여부 점검).
3. **`workday_boundary` timer**: tab 비활성 시 `setTimeout` 이 throttle 됨 → focus 복귀 시 한 번 재계산하는 fallback.
4. **`defaultTabUserOverride`** 키가 기존에 없음 → 마이그레이션 후에는 사용자가 직접 탭 바꾸면 자동으로 `true` 로 세팅 (PR5 onboarding 결정 / 일반 탭 변경 hook).

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR5/PR6/PR7/PR8 의 모든 데이터 fetch 는 `oculpmApi` 만 사용 — 직접 `commands.*` 호출 금지.
- `WorkspaceContext` 의 `currentSession` 은 PR6 의 SessionCard 가 "진행 중" 배지 토글에 사용.
- `workdayKey` 변경 시 Today 의 list 가 자동 새 workday 로 — PR6 의 `TimelineView` 가 prop 으로 받음.
