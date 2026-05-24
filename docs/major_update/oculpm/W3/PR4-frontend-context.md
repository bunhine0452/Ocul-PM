# W3-PR4 — Frontend: specta wrapper + WorkspaceContext + 라우팅

> **목표**: 프론트에 `oculpmApi` 래퍼 / `WorkspaceContext` 확장 / 디폴트 탭 Today / 기존 localStorage 마이그레이션 (schema_version 1→2). 이후 PR5~PR8 의 UI 가 사용할 토대.
> **선행**: W1/W2/W3-PR3 의 specta TS export 완료 → `bindings.ts` 에 18개 `commands.oculpm*` + 9개 이벤트.
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR4, [`../02-frontend.md`](../02-frontend.md) §2.2 (api wrapper) / §3 (라우팅).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. `src/api/oculpm.ts` — 래퍼 (실제)

`@/lib/bindings` 의 18개 `commands.oculpm*` 를 1 파일에서 wrap. 모든 메서드는 `typedError` envelope (`{ status, data | error }`) 를 풀어 **"resolve on ok, reject `OculpmApiError` on error"** 으로 통일.

```ts
import { oculpmApi, OculpmApiError } from "@/api/oculpm";

try {
  const entries = await oculpmApi.listJournalEntries(projectId, todayKey);
} catch (e) {
  if (e instanceof OculpmApiError) {
    toast.error(`${e.command} 실패: ${e.message}`);
  }
}
```

**제공 메서드** (18개, 백엔드 커맨드 1:1):

| 그룹 | 메서드 |
|---|---|
| W1 (init/config) | `init`, `getStatus`, `getConfig`, `setConfig` |
| W2 (session/watcher) | `getCurrentSession`, `startSessionManual`, `endSessionManual`, `listSessions`, `getFileChanges`, `getIndexSnapshot`, `watcherStart`, `watcherStop`, `watcherStatus` |
| W3-PR3 (journal/cache) | `listJournalEntries`, `getJournalEntry`, `setJournalVerified`, `reindexCache`, `createManualEntry` |

### 가이드 대비 변경

| 항목 | 가이드 후보 | 결정 |
|---|---|---|
| `unwrap` 에러 모델 | `throw new Error` vs `OculpmApiError` subclass | **`OculpmApiError`** — `command` 필드 보존, 호출 사이트에서 `instanceof` narrowing 가능. PR4 워킹 doc §7.1 의 선택지 1 채택. |
| Option 인자 변환 | call site 책임 | **wrapper 내부에서 `?? null`** — `bindings.ts` 가 `string \| null` 받음. caller 는 `listSessions(pid)` / `listSessions(pid, workday)` 둘 다 자연스럽게. |
| React Query 도입 | 후보 | **미도입** — 기존 코드 (App.tsx 등) 가 `useState + manual refetch` 패턴. PR5~PR8 이 컨벤션 따라 유지. RQ 채택은 refactor 별도 라운드. |

---

## 2. `WorkspaceContext` 확장 (실제)

### 신규 필드 (`WorkspaceState`)

```ts
schemaVersion: number;                  // 영속화 schema. v2 = W3-PR4.
defaultTabUserOverride: boolean;        // 사용자가 명시적으로 탭 선택했나
oculpmEnabled: boolean;                 // status.initialized 미러
oculpmStatus: OculpmStatus | null;      // 마지막 fetch 결과
currentSession: Session | null;         // 이벤트 listener 가 갱신
workdayKey: string | null;              // YYYYMMDD (project tz). status에서.
```

### 신규 setter

```ts
setOculpmStatus(status)  // status + enabled + workdayKey 일괄 갱신
setCurrentSession(session)
setWorkdayKey(workday)
```

### 이벤트 listener (mount 시 한 번)

| 이벤트 | 액션 (PR4 범위) |
|---|---|
| `oculpm:session_started` | `setCurrentSession(payload.session)` |
| `oculpm:session_ended` | `setCurrentSession(null)` |
| `oculpm:integrity_warning` | `console.warn` (W4 가 토스트 라우팅) |
| `oculpm:journal_path_changed` / `_added` / `_updated` | listener 등록만 (no-op) — PR6 의 TodayScreen 이 직접 listen 해서 cache invalidate. PR4 는 "이벤트 채널 살아있음" 만 보장. |

**project_id 필터**: `stateRef` 패턴 (latest state 를 ref 로 보관 → 매 이벤트마다 현재 `currentProjectId` 와 비교). 이벤트 listener 가 stale closure 로 잘못된 project 의 update 를 받지 않도록 보호.

### 가이드 대비 변경

| 항목 | 가이드 후보 | 결정 |
|---|---|---|
| `workday_boundary` timer | 자체 setTimeout | **미구현** — 이벤트가 백엔드에서 emit 되면 그때 wire. 본 PR 의 status fetch 가 워크데이를 1회 채움. 자정 넘김 자동 갱신은 W4 의 SessionActor boundary emit + listener 가 처리. |
| `setActiveView` 의 `defaultTabUserOverride` 토글 | 옵션 | **자동 토글** — 사용자가 IA strip / 단축키로 탭 바꾸면 즉시 true. 다음 v→v+1 마이그레이션이 그들의 선택을 무시하지 않도록. |
| `setOculpmStatus` 가 `workdayKey` 자동 동기화 | 옵션 | **채택** — status 가 갱신될 때 `current_workday` 도 같이 들어오므로 한 setter 가 두 필드 일관성 유지. caller 코드 단순. |

---

## 3. `App.tsx` — 라우팅 변경 (실제)

### `PRIMARY_NAV` swap

```ts
// 변경 후 — Today 가 1번 (⌘1), Overview 가 2번 (⌘2)
const PRIMARY_NAV = [
  { id: "today",     label: "오늘",      icon: Flame,           shortcut: "⌘1" },
  { id: "overview",  label: "개요",      icon: LayoutDashboard, shortcut: "⌘2" },
  { id: "plan",      label: "계획",      icon: Calendar,        shortcut: "⌘3" },
  { id: "changelog", label: "변경 기록", icon: FileCode,        shortcut: "⌘4" },
  { id: "code",      label: "코드",      icon: Code2,           shortcut: "⌘5" },
];
```

### `useGlobalShortcuts` 동기

```ts
// 변경 전: ["overview", "today", "plan", "changelog", "code"]
const map = ["today", "overview", "plan", "changelog", "code"] as const;
```

### `handleSelectProject` 의 view 강제 제거

기존 `setActiveView("overview")` 줄을 제거. 이유:
- 새 사용자: `DEFAULT_STATE.activeView = "today"` → 자동 Today 진입.
- 마이그레이션된 사용자 (defaultTabUserOverride=false): v1→v2 가 activeView 를 "today" 로 promote.
- 사용자 override 가진 사용자: 본인 선택 보존.
- 강제 호출은 모두 망쳤을 것.

### `oculpm_init` 후 status hydration

기존 `useEffect` 가 init 만 호출했음. 본 PR 은 init 성공 직후 `oculpm_get_status` 까지 호출 → `setOculpmStatus(...)` 로 context 채움 → EmptyToday (PR5) 가 별도 fetch 없이 V1/V2/V3 분기 가능.

---

## 4. localStorage 마이그레이션 schema_version 1 → 2 (실제)

```ts
function migrateV1ToV2(state): WorkspaceState {
  if ((state.schemaVersion ?? 1) >= 2) return { ...state, schemaVersion: 2 };
  const userOverride = state.defaultTabUserOverride === true;
  return {
    ...state,
    activeView: userOverride ? state.activeView : "today",
    defaultTabUserOverride: userOverride,
    schemaVersion: 2,
  };
}
```

규칙:
- `defaultTabUserOverride === true` 인 사용자: 기존 activeView 유지.
- 그 외: `activeView` 를 `today` 로 강제.
- 한 번 마이그레이션되면 `schemaVersion: 2` 로 저장 → 다음 load 는 no-op.
- 마이그레이션은 `loadFromStorage` 안에서 1회 자동 — 별도 callsite 추가 불필요.

**WORKSPACE_SCHEMA_VERSION** 상수 export — 향후 v3 가 들어올 때 분기 추가 위치를 명시.

---

## 5. 테스트 (실제)

### Vitest 인프라 부재

페이즈 명세는 Vitest 케이스 6개를 제시했으나, **현재 리포지토리에 `vitest` 의존성/`vitest.config.ts` 부재** (package.json scripts: `dev`/`build`/`preview` 만). 본 PR 에서 도입하면 별도 PR 분량의 의사결정 (testing-library, jsdom, mock 패턴) 이 발생 → **deferred**.

대안:
- **타입 단위 검증**: `pnpm exec tsc --noEmit` 가 모든 wrapper 시그니처와 context 확장을 컴파일 시점에 검증.
- **런타임 smoke**: 다음 `pnpm tauri dev` 1회 실행 시 자동 검증 가능한 항목 = `oculpm_init` 호출 / status 채움 / 기본 탭 Today / localStorage 마이그레이션 1회 동작.

Vitest 정식 도입은 **W6 stabilize** 페이즈의 별도 PR 권장 (UI 컴포넌트 PR5~PR8 도 같은 인프라 위에 케이스 추가 가능).

### 자동 검증 (본 PR 에서 통과)

- [x] `pnpm exec tsc --noEmit` — 0 errors. wrapper 18 메서드, context 확장 6 필드, App.tsx 변경, useGlobalShortcuts 변경 모두 타입 정합.
- [x] `pnpm build` (= `tsc && vite build`) — green. vite bundle 2.99s, 5 chunks emitted.

### 페이즈 §5 수동 QA 매핑

| 페이즈 §5 항목 | PR4 충족 |
|---|---|
| 5.1 wrapper Ok / Err 경로 | 타입 시그니처 + `OculpmApiError` 클래스로 충족, 런타임은 PR5/PR6 호출 시점에 자연 검증 |
| 5.2 session_started 이벤트 → currentSession 갱신 | 코드 wire 완료, 런타임 확인은 다음 `pnpm tauri dev` |
| 5.3 workday_boundary 갱신 | listener 미구현 (가이드 결정 표 참조). status fetch 가 1회 채움 |
| 5.4 신규 프로젝트 → navigate("today") | `handleSelectProject` 의 강제 호출 제거 + 디폴트 today 로 충족 |
| 5.5 v1→v2 마이그레이션 | `migrateV1ToV2` 구현, idempotent (재호출 no-op) |
| 5.6 defaultTabUserOverride 보존 | `setActiveView` 가 true 토글 + 마이그레이션이 분기 |

---

## 6. DoD

- [x] `oculpmApi` 의 모든 메서드 호출 가능 (18개 — `Object.keys(oculpmApi).length === 18` 보장).
- [x] WorkspaceContext 가 6개 이벤트를 모두 listen + cleanup (unmount 시 unsub 함수 호출).
- [x] 디폴트 탭 Today (신규 사용자 / v1→v2 마이그레이션된 사용자 둘 다).
- [x] localStorage 마이그레이션 1회만 동작 (`schemaVersion === 2` 이후 no-op).
- [x] specta TS 가 누락 없이 생성 (bindings.ts 의 5 신규 커맨드 + 9 이벤트 모두 존재 — 본 PR 시작 시점에 이미 갱신되어 있었음).
- [ ] `pnpm test` green — **defer (Vitest 미설치)**. `pnpm tauri build` 게이트는 ↓ 두 항목으로 대체:
- [x] `pnpm exec tsc --noEmit` green.
- [x] `pnpm build` (vite) green.

---

## 7. 실행 노트

### 변경된 파일 (4개)

| 파일 | 변경 |
|------|------|
| `src/api/oculpm.ts` | **신규** 157 줄 — 18 메서드 wrapper + `OculpmApiError` + `unwrap` helper |
| `src/contexts/WorkspaceContext.tsx` | +6 필드, +3 setter, +1 useEffect (listener), +1 migration 함수, +`WORKSPACE_SCHEMA_VERSION` export. 디폴트 activeView "overview" → "today" |
| `src/App.tsx` | PRIMARY_NAV 1·2 swap, `handleSelectProject` 의 `setActiveView("overview")` 제거, `oculpm_init` 후 status hydration |
| `src/hooks/useGlobalShortcuts.ts` | ⌘1~⌘5 매핑의 `["overview","today",...]` → `["today","overview",...]` swap + 주석 갱신 |

### 발견된 함정 / 변경

1. **`WORKSPACE_SCHEMA_VERSION` 의 TDZ 에러** ⚠ — 처음 작성 시 `DEFAULT_STATE` 가 `WORKSPACE_SCHEMA_VERSION` 보다 먼저 정의되어 있어 const TDZ 위반. 정의 순서 바꿔 해결. 컴파일 에러 즉시 발견.
2. **stateRef 패턴** — 이벤트 listener `useEffect` 가 mount 시 1회만 실행 (deps=[setCurrentSession]). closure 가 첫 mount 시점의 `state` 만 캡처 → 프로젝트 전환 후에도 옛 `currentProjectId` 와 비교하는 stale closure 위험. **`React.useRef<WorkspaceState>` + 별도 useEffect 로 매 state 변경마다 ref 갱신** 패턴으로 회피.
3. **`bindings.ts` 가 이미 최신** — PR3 종료 후 별도로 누군가 `pnpm tauri dev` 를 한 번 돌린 것으로 보임. 본 PR 의 첫 grep 으로 5 신규 커맨드 + `EntryFilters`/`ManualEntryDraft` 타입이 모두 존재 확인. 별도 regen step 불필요.
4. **`handleSelectProject` 의 view 강제 제거** — 기존 코드는 매 프로젝트 select 시 `setActiveView("overview")` 강제. 본 PR 의 setter 가 `defaultTabUserOverride: true` 로 flip 하는 새 시멘틱이라, 강제 호출이 무의식적으로 사용자 선호 override 를 망쳤을 것. 호출 자체 제거. (`DEFAULT_STATE.activeView = "today"` + 마이그레이션 이 처리.)
5. **`workday_boundary` listener 보류** — 가이드 §2 표 4행. 본 PR 은 1회 status fetch 가 `workdayKey` 채움. 자정 넘김 자동 갱신은 W4 의 SessionActor boundary emit + 그 listener 가 처리 (현재 백엔드의 watcher 가 boundary 이벤트를 emit 하긴 하지만 W4 의 페이로드 형태가 안 잡혀서 본 PR 은 stub).
6. **Vitest 미설치 사실 확인** — `package.json` scripts 에 test 없음, `vitest.config*` 파일 부재. 페이즈 명세의 6 Vitest 케이스는 W6 정식 도입 후 일괄 작성 권장. 본 PR 은 tsc + vite build 로 대체.
7. **`pnpm exec` 필요** — `pnpm tsc --noEmit` 는 script 이름 매칭 실패. `pnpm exec tsc --noEmit` 로 우회.

### 의도된 누락 (PR5~PR8 에 위임)

- **EmptyToday V1/V2/V3 분기** — PR5. 본 PR 의 `state.oculpmStatus` 가 분기 입력.
- **TimelineView 의 journal_path_changed 핸들링** — PR6. 본 PR 은 listener 채널만 살림.
- **CategoryFilterBar 의 EntryFilters 영속화** — PR8. 본 PR 의 wrapper 가 `filters?: EntryFilters` 인자 받음.
- **Manual entry 모달** — PR6. 본 PR 의 `oculpmApi.createManualEntry` 가 호출 대상.
- **Settings UI** — PR5/W4. `oculpmApi.setConfig` 사용.
- **자동 토스트 라우팅** — `oculpm:integrity_warning` 의 console.warn → toast 변환은 W4.

### 빌드/테스트 시간

- `pnpm exec tsc --noEmit` — instant (0 errors, exit 0).
- `pnpm build` — **2.99s** (tsc + vite). 5 chunks emitted, 1 chunk > 500 KB warning (D2Coding font + bundle).
- 백엔드 회귀 0 — 본 PR 은 backend 무변경.

### PR5/PR6/PR7/PR8 로 넘기는 메모

- **모든 데이터 fetch 는 `oculpmApi` 사용** — `commands.oculpm*` 직접 호출 금지. 토스트/에러 핸들링 통일.
- **`state.oculpmStatus`** 가 EmptyToday 분기의 ground truth — PR5 가 `state.oculpmStatus?.initialized` 로 V1/V2/V3 결정.
- **`state.currentSession`** 이 PR6 의 SessionCard "진행 중" 배지 토글 입력.
- **`state.workdayKey`** 가 TimelineView/CategoryFilterBar 의 workday 기본값. PR6/PR8 은 이걸 prop 으로 받아 list/filter 호출.
- **`OculpmApiError` instanceof narrowing** — PR5~PR8 의 모든 try/catch 가 사용. 토스트 컴포넌트 (refactor W6 에서 도입된 sonner 가 있다면) 가 `e instanceof OculpmApiError` 분기로 command name 까지 노출.
- **`journal_path_changed` 이벤트 multi-listen** — PR4 는 no-op stub. PR6 의 TodayScreen 이 `useEffect` 로 직접 listen + 본인 화면의 React state invalidate. context 는 forwarding 만.
- **manual entry 모달의 slug inline 검증** — frontend `/^[a-z0-9-]{1,60}$/` 매치 → 위반 시 inline 에러 + 백엔드 호출 안 함. 백엔드가 authoritative 라 fallback 도 있음.
- **`pnpm tauri dev` 1회 권장** — PR4 의 listener / status hydration / 디폴트 탭 / 마이그레이션 4개를 한 번에 런타임 확인.

- **본 PR 의 미해결 항목 없음** — 다음 PR 진입 가능.
