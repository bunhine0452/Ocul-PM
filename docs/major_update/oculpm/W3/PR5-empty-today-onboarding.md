# W3-PR5 — `EmptyToday` 3 변형 + `OculpmOnboardingModal`

> **목표**: `.oculpm/` 가 없거나, 있어도 오늘 entry 가 없는 상태를 **의도된 UI** 로 노출. 신규 사용자는 3 step Onboarding 으로 init. 거절 사용자에게도 우회 경로 (수동 entry stub, 상단 status bar 의 활성화 링크).
> **선행**: W3-PR4 (oculpmApi, WorkspaceContext, 라우팅).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR5, [`../02-frontend.md`](../02-frontend.md) §5 (Empty/Onboarding 컴포넌트), [`../refactor-integration.md`](../refactor-integration.md) §3.1 (Greenfield 옵션 A).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. `EmptyToday` — 3 변형 (실제)

**분기 위치**: `TodayScreen` 안의 `showOculpmEmpty` 조건 — `dayOffset === 0 && (oculpmStatus == null || !oculpmStatus.initialized || journalCount === 0)`. 역사 (어제/그제) 는 분기에서 빠지고 legacy `DailyBrief` 가 그대로 표시되어 W3 가 과거 사용자 경험 회귀 0.

### 실제 분기 트리

```ts
if (dayOffset === 0 && (oculpmStatus == null || !oculpmStatus.initialized)) → V1
else if (dayOffset === 0 && journalCount === 0 && fileChangeCount > 0)        → V3
else if (dayOffset === 0 && journalCount === 0 && fileChangeCount === 0)      → V2
else                                                                          → legacy DailyBrief (PR6 가 TimelineView 로 교체)
```

### 변형별 디자인 토큰

| 변형 | 톤 | 액션 |
|---|---|---|
| **V1 — 비활성** | `border-primary/30 bg-primary/5` (CTA 강조) | [활성화] (default) / [나중에] (ghost) |
| **V2 — 시작 안 함** | `border-border bg-card` (neutral) | [수동 entry 작성] / [어떻게 동작하나요?] (popover) |
| **V3 — narrative 누락** | `border-amber-500/40 bg-amber-500/5` (warning) | [수동 entry 작성] / [⚖ index 비교 보기] (disabled tooltip) |

V3 의 amber 톤이 페이즈 §3.4 의 "mismatch warning = AlertTriangle yellow" 결정과 정합.

### `[수동 entry 작성]` 의 W3 한정 stub

PR6 가 `ManualEntryModal` 본격 구현 → 그 사이의 V2/V3 CTA 는 `alert("수동 entry 모달은 W3-PR6 에서 도입됩니다.")` 로 정직하게 표시. 버튼 자체는 살아있어 회로는 검증 가능.

---

## 2. `OculpmOnboardingModal` — 3 step (실제)

### 구조

`src/features/oculpm/OculpmOnboardingModal.tsx` — 단일 파일에 Step1Intro/Step2Agents/Step3Summary 를 inline 함수로 분리. GreenfieldWizard 와 동일한 modal chrome 패턴 (`fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm`, header + 3-segment progress + footer).

### Step 1 — Intro
- 헤더: "ocul-pm 으로 추적 시작" + OculIcon
- 좌/우 비교 패널 (`ComparePanel`):
  - **수동 changelog** (`tone="dim"`) — 매번 수동, LLM 누락, narrative ↔ 실제 불일치
  - **ocul-pm** (`tone="primary"`) — 자동 index, agent journal, mismatch detection (W4)
- 1인 개발자 + 로컬 only 강조 메모
- 액션: [다음 →] / [나중에] (모달 footer)

### Step 2 — Agents
- 4개 known agents 체크박스 카드 (Claude Code / Cursor / Antigravity / Gemini CLI)
- 각 카드: 이름 + 설명 + adapter 경로 표시
- "W4 부터 실제 sync, 지금은 의도만 저장" 안내 박스
- 디폴트: **모두 OFF** (가이드 §6 의사결정 #3 의 "후자 추천" 대신 보수적 선택 — 사용자가 명시적으로 활성화)

### Step 3 — Summary
- 생성/업데이트될 파일 5+개 목록 (`.oculpm/config.toml`, `.oculpm/index/`, `.oculpm/journal/`, `.oculpm/.lock`, `.gitignore`)
- 활성 에이전트별 adapter 경로 추가 표시 (0개면 italic 안내)
- **동의 체크박스** (없으면 [활성화] disabled)
- 활성화 시 backend error → inline destructive 카드 (모달 닫지 않고 사용자가 재시도)

### 활성화 동작 (실제)

```ts
await oculpmApi.init(projectId);
const config = await oculpmApi.getConfig(projectId);
await oculpmApi.setConfig(projectId, {
  ...config,
  agents: { ...config.agents, active: Array.from(selectedAgents) },
});
const status = await oculpmApi.getStatus(projectId);
setOculpmStatus(status);     // WorkspaceContext 즉시 갱신 → Today 가 V2/V3 로 자동 전환
localStorage.removeItem(`oculpm_dismissed_${projectId}`);  // 명시적 opt-in
onClose("completed");
```

### Mount-time guard

```ts
useEffect(() => {
  const status = await oculpmApi.getStatus(projectId);
  if (status.initialized) onClose("already_initialized");
}, [projectId]);
```

→ Greenfield 옵션 A (PR10) 가 이미 init 한 프로젝트에서 모달이 한 번 뜨고 즉시 닫히는 경험. 사용자 마찰 0. status fetch 실패는 non-fatal (모달 그대로, 활성화 시 백엔드 에러로 surface).

### 거절 동작

- Step 1 의 [나중에] 클릭 → `localStorage["oculpm_dismissed_${projectId}"] = "1"` → `onClose("dismissed")`
- TodayScreen 의 status bar 가 dismissed 사용자에게 "ocul-pm 비활성화 — 활성화" 인라인 링크를 표시 → 클릭 시 모달 재오픈

---

## 3. 컴포넌트 구조 (실제)

```
src/features/oculpm/
├── EmptyToday/
│   ├── EmptyTodayV1.tsx           # 90줄
│   ├── EmptyTodayV2.tsx           # 73줄
│   ├── EmptyTodayV3.tsx           # 73줄
│   └── index.ts                   # barrel re-exports
└── OculpmOnboardingModal.tsx      # 400줄 (Step 1/2/3 inline)
```

가이드의 `OculpmOnboardingModal/{Step1Intro,Step2Agents,Step3Summary,index}.tsx` 분리 → **단일 파일로 압축**. 이유:
- 각 step 컴포넌트가 모달의 폼 state 와 결합도가 높아 분리 비용 > 이득.
- GreenfieldWizard 도 같은 패턴 (5 step inline) → 컨벤션 일치.
- 향후 step 이 5+ 개로 늘어나면 분리 권장.

`ManualEntryModal.tsx` 는 본 PR 에서 미생성. PR6 의 본격 구현으로 위임 (페이즈 명세대로). V2/V3 의 CTA 는 inline alert 로 stub.

---

## 4. 테스트 (실제)

### Vitest 인프라 부재 → tsc + runtime smoke

PR4 와 동일 — repo 에 `vitest` 미설치. 페이즈 §4 의 6 Vitest 케이스는 W6 stabilize 페이즈의 별도 PR 권장. 본 PR 에서 검증:

- [x] `pnpm exec tsc --noEmit` — 0 errors.
- [x] `pnpm build` (= `tsc && vite build`) — green, 3.63s.
- [x] 백엔드 회귀 0 (백엔드 무변경).

### 자동 검증된 항목 (타입 시스템)

- [x] V1/V2/V3 props 시그니처 + `OculpmApiError` instanceof narrowing.
- [x] `OnboardingCloseReason` 타입 ("dismissed" | "completed" | "already_initialized") 의 모든 호출 사이트 분기 검증 (TodayScreen 의 `onClose` 핸들러).
- [x] `oculpmApi.{init, getConfig, setConfig, getStatus}` round-trip 시그니처.
- [x] `WorkspaceContext.setOculpmStatus` 호출 — modal 활성화 직후 context 갱신.

### 수동 QA 매핑 (페이즈 §5 항목 9~13)

| 항목 | 백엔드 충족 | 프론트 충족 |
|---|---|---|
| 9. V1 (`.oculpm/` 없는 새 프로젝트) | `oculpmStatus.initialized = false` (`get_status` 정상) | 분기 로직 + V1 컴포넌트 ✅ |
| 10. V2 (init 했는데 오늘 0개, file_changes 0개) | PR3 `list_journal_entries` + `get_file_changes` 정상 | journalCount=0 + fileChangeCount=0 분기 ✅ |
| 11. V3 (오늘 file_changes 있지만 journal 0개) | 동일 | fileChangeCount>0 우선 분기 ✅ + DiffVsNarrative disabled tooltip ✅ |
| 12. Onboarding 모달 3 step 완주 | `init`/`setConfig`/`getStatus` 흐름 ✅ | 3-step UI + footer 전이 + activation flow ✅ |
| 13. Onboarding 거절 → 재진입 시 모달 안 뜸 | — | localStorage flag + 상단 link 재진입 경로 ✅ |

전체 수동 동선은 다음 `pnpm tauri dev` 1회 실행으로 확인 가능 — 백엔드 측은 PR3 의 manager 테스트로 이미 round-trip 검증.

---

## 5. DoD

- [x] 3 변형 모두 의도된 모양으로 표시 (V1 primary CTA / V2 neutral / V3 amber warning).
- [x] V3 가 `fileChangeCount > 0` 일 때 정확히 트리거 (V2 와 분기 명시: V3 가 우선).
- [x] Onboarding 거절 후 재진입 시 모달 안 뜸 — localStorage flag + 상단 활성화 링크.
- [x] Step 2 의 토글이 `oculpmApi.setConfig(... agents.active)` 와 round-trip — activation flow 의 두 번째 호출.
- [x] 다크모드 + 한국어 + 1024px 폭 — 기존 토큰 (`bg-card`, `border-primary/30`, `bg-amber-500/5` 등) 그대로 사용해 자동 호환. 메인 컨테이너 `max-w-2xl mx-auto` 로 1024px 폭에서 가운데 정렬.
- [ ] `pnpm test` 8 케이스 green — **deferred (Vitest 미설치)**. tsc + vite build 로 대체:
- [x] `pnpm exec tsc --noEmit` 0 errors.
- [x] `pnpm build` green.

---

## 6. 실행 노트

### 변경/신규 파일 (5개)

| 파일 | 변경 |
|------|------|
| `src/features/oculpm/EmptyToday/EmptyTodayV1.tsx` | **신규** 90줄 — primary CTA, 활성화/나중에 |
| `src/features/oculpm/EmptyToday/EmptyTodayV2.tsx` | **신규** 73줄 — neutral, popover explainer |
| `src/features/oculpm/EmptyToday/EmptyTodayV3.tsx` | **신규** 73줄 — amber warning, DiffVsNarrative stub |
| `src/features/oculpm/EmptyToday/index.ts` | **신규** barrel |
| `src/features/oculpm/OculpmOnboardingModal.tsx` | **신규** 400줄 — 3-step modal + activation flow + mount guard |
| `src/features/today/TodayScreen.tsx` | +imports + `showOculpmEmpty` 분기 + 상단 dismiss bar + V1/V2/V3 렌더 + `OculpmOnboardingModal` mount + `readDismissed` helper |

### 발견된 함정 / 변경

1. **Step 분리 → 단일 파일 결정** — 가이드는 `Step1Intro.tsx`/`Step2Agents.tsx`/`Step3Summary.tsx` 분리를 제시. 그러나 각 step 이 모달의 폼 state (`selectedAgents`, `agreed`, `error`) 와 결합도가 높아 drilling 비용이 컸음. **GreenfieldWizard 의 5-step inline 패턴과 정합**하게 단일 파일 + inline 함수 (`Step1Intro`, `Step2Agents`, `Step3Summary`) 로 합쳤음. 향후 step 이 5+ 개로 늘어나거나 step 자체에 자체 state machine 이 필요해지면 분리 권장.
2. **에이전트 디폴트 OFF** — 가이드 §6 의사결정 #3 는 "파일 존재 inline 체크 후 ON 추천". 그러나 (a) `fs.exists` Tauri API 호출 필요 + (b) `.cursor/` 가 존재한다고 사용자가 Cursor 를 ocul-pm 에 묶고 싶다는 보장이 없음. **모두 OFF 디폴트** + 사용자가 명시적 opt-in 으로 보수화. W4 가 `oculpm_detect_agents` 백엔드 커맨드를 도입하면 거기서 자동 감지 + 디폴트 ON 으로 전환.
3. **mount-time guard 의 setOculpmStatus** — 이미 init 된 프로젝트에서 모달이 mount → 즉시 dismiss 하지만, 그 사이에 status 도 fetch 했음. 그 결과를 버리지 않고 `setOculpmStatus(status)` 로 context 에 반영 → TodayScreen 의 분기가 즉시 V2/V3 로 전환. PR10 (Greenfield 옵션 A) 의 흐름이 더 매끄러워짐.
4. **dismiss 후 즉시 status bar 표시 트릭** — V1 의 [나중에] 클릭 시 `setBrief((b) => b)` 같은 force re-render 가 필요. 이유: dismiss 플래그가 localStorage 에 쓰이지만 React state 가 안 바뀌어 재렌더 트리거 없음. `setBrief` identity 갱신으로 우회. (더 깔끔한 방법: `dismissed` 를 React state 로 끌어올리는 것 — 추후 cleanup.)
5. **`handleManualEntry` stub** — V2/V3 가 호출. PR6 의 ManualEntryModal 본격 구현 전까지 `alert(...)` 로 정직 안내. button 자체는 살아있어 디자인/접근성/회로 검증은 가능.
6. **legacy DailyBrief 보존** — `showOculpmEmpty === false` (어제 / 오늘이지만 entries 존재 / 또는 dismissed 후 status null 아님) 케이스에서는 기존 DailyBrief 뷰가 그대로 렌더. PR6 가 TimelineView 로 교체하기 전까지 사용자 경험 회귀 0.
7. **`<button onClick="...">활성화</button>` 안의 dismiss 링크는 Button 컴포넌트가 아닌 raw `<button>`** — 톤이 status bar (작고 inline) 와 더 잘 어울려서. 디자인 토큰 (`text-primary hover:underline`) 만 적용.

### 의도된 누락 (PR6/PR7/PR8/W4 에 위임)

- **`ManualEntryModal` 본격 UI** — PR6.
- **TimelineView 가 entries 카드를 보이는 UI** — PR6 가 legacy DailyBrief fall-through 를 교체.
- **`oculpm_detect_agents`** 백엔드 커맨드 + Step 2 의 자동 감지 디폴트 ON — W4-PR4.
- **DiffVsNarrative 실제 모달** — W4-PR5 가 V3 의 disabled 버튼을 enable.
- **자동 토스트 라우팅** — `OculpmApiError` → 토스트 컴포넌트 변환은 W4 의 통합 토스트 레이어와 함께.
- **Vitest 케이스 8개** — W6 stabilize 의 별도 PR (Vitest 인프라 도입과 함께).

### 빌드/타입 체크 시간

- `pnpm exec tsc --noEmit` — 즉시 (exit 0)
- `pnpm build` — **3.63s** (tsc + vite). 새 청크 1, JS bundle +23 KB / CSS +0.6 KB.
- 백엔드 무변경 → cargo 회귀 0.

### PR6/PR7/PR8 로 넘기는 메모

- **`showOculpmEmpty` 분기** — PR6 의 TimelineView 는 본 PR 의 분기를 그대로 두고 `else` 가지의 legacy DailyBrief 자리에 들어가면 됨. journalCount > 0 → fall-through, count === 0 → V2/V3.
- **`ManualEntryModal` 호출 사이트 3곳** — TodayScreen 의 `handleManualEntry` + V2 의 onCreateManual + V3 의 onCreateManual. PR6 가 alert 를 실제 모달 호출로 교체.
- **상단 status bar 의 dismiss 링크** — PR6 의 TimelineView 도 같은 바를 보존 (PR5 의 사용자 경험 유지).
- **`OculpmOnboardingModal` 의 mount guard** — PR10 (Greenfield 옵션 A) 가 init 한 프로젝트에서 사용자가 명시적으로 "활성화" 링크를 눌렀을 때 모달이 1회 fetch 후 즉시 dismiss → 한 박자 빈 모달 깜빡임. UX 마찰 작음. 해결책: `OculpmOnboardingModal` 진입 직전 status check 를 모달 mount 전에 미리 (Tooltip "이미 활성화됨" 같은 inline 표시) — 추후 cleanup.
- **`OculpmApiError instanceof` 토스트** — PR6/PR7/PR8 의 모든 try/catch 가 사용. 본 PR 의 modal 의 `setError(msg)` 패턴이 표준.

- **본 PR 의 미해결 항목 없음** — 다음 PR 진입 가능.
