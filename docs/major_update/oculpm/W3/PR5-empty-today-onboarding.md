# W3-PR5 — `EmptyToday` 3 변형 + `OculpmOnboardingModal`

> **목표**: `.oculpm/` 가 없거나, 있어도 오늘 entry 가 없는 상태를 **의도된 UI** 로 노출. 신규 사용자는 3 step Onboarding 으로 init. 거절 사용자에게도 우회 경로 (수동 entry, 상단 활성화 링크).
> **선행**: W3-PR4 (oculpmApi, WorkspaceContext, 라우팅).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR5, [`../02-frontend.md`](../02-frontend.md) §5 (Empty/Onboarding 컴포넌트), [`../refactor-integration.md`](../refactor-integration.md) §3.1 (Greenfield 옵션 A).

---

## 1. `EmptyToday` — 3 변형 (계획)

**분기 로직** (TodayScreen 안에서 결정):

```ts
const status = useOculpmStatus(projectId);   // initialized: bool
const entriesQ = useJournalEntries(projectId, workdayKey);
const changesQ = useFileChanges(projectId, workdayKey);

if (!status.initialized) return <EmptyTodayV1 onActivate={openOnboarding} />;
if (entriesQ.data?.length === 0 && changesQ.data?.length === 0)
  return <EmptyTodayV2 onCreateManual={openManualEntryModal} />;
if (entriesQ.data?.length === 0 && (changesQ.data?.length ?? 0) > 0)
  return <EmptyTodayV3 fileChangeCount={changesQ.data.length} onOpenDiff={openDiffModal} />;
// else TimelineView (PR6)
```

| 변형 | 조건 | 카드 메시지 | 1차 액션 | 2차 액션 |
|---|---|---|---|---|
| **V1 — 비활성** | `initialized == false` | "ocul-pm 으로 이 프로젝트를 추적할까요?" + 효과 설명 | [활성화] → Onboarding 모달 | [나중에] → 상단 링크만 유지 |
| **V2 — 시작 안 함** | initialized + 오늘 entries 0 + file_changes 0 | "오늘은 아직 기록이 없습니다. 코드를 수정하면 자동 추적됩니다." | [수동 entry 작성] → ManualEntryModal | [어떻게 동작하나요?] popover |
| **V3 — narrative 누락** | initialized + 오늘 entries 0 + file_changes > 0 | "오늘 {N}개 파일이 변경됐지만 narrative 가 작성되지 않았습니다." + 어댑터 상태 | [수동 entry 작성] | [⚖ index 비교 보기] (W4 까지 disabled, tooltip "다음 페이즈") |

V3 는 외부 LLM 이 규칙을 안 따를 때 사용자가 즉시 인지하는 핵심 UI (페이즈 §0 / R-1 완화책).

---

## 2. `OculpmOnboardingModal` — 3 step (계획)

### Step 1 — 소개
- 헤더: "ocul-pm 이 이 프로젝트의 작업을 자동 기록할 수 있어요."
- 도식 (작은 비교 그림):
  - 왼쪽: "수동 changelog" — 직접 작성 / 누락 / 불일치.
  - 오른쪽: "ocul-pm" — 파일 변경 자동 추적 + LLM 이 narrative 생성 (W4 이후).
- [다음 →]

### Step 2 — 에이전트 선택
- 자동 감지된 에이전트 (W4 까지는 단순 토글, 실제 sync 는 W4).
- 체크박스 4개: Claude Code / Cursor / Antigravity / Gemini CLI.
- 디폴트: 감지된 항목만 ON.
- 메모: "여기서 켠 에이전트는 W4 부터 `.oculpm/journal/` 에 자동으로 entry 를 씁니다."
- [← 이전] [다음 →]

### Step 3 — 요약 + 확인
- 무엇이 어디에 생기는지 명시:
  - `.oculpm/config.toml` 생성.
  - `.oculpm/index/` 생성 (`.gitignore` 자동).
  - `.oculpm/journal/` 생성 (`git tracked`).
  - 활성 에이전트 별 rule 파일 경로 표시 (W4 에서 실제 sync, W3 은 경로만).
- 체크박스: "위 변경에 동의합니다" (활성화 조건).
- [← 이전] [활성화]

**활성화 동작**:
1. `oculpmApi.init(projectId)` — `.oculpm/` 생성 + lock 획득.
2. `oculpmApi.setConfig(projectId, { agents: { active: [...selected] } })`.
3. 성공 토스트.
4. 모달 close → TodayScreen 이 status 재요청 → EmptyTodayV2 또는 V3.

**거절 동작** (Step 1 [나중에]):
- `localStorage["oculpm_dismissed_${projectId}"] = true`.
- 상단 status bar 에 "ocul-pm 비활성화 — 활성화" 링크 유지 (모달 다시 열 수 있는 진입점).

**자동 dismiss** (PR10 의 통합):
- mount 시 status 확인. 이미 `initialized` 면 즉시 `onClose({ reason: "already_initialized" })`. Greenfield 흐름과 충돌 방지.

---

## 3. 컴포넌트 구조

```
src/features/oculpm/
├── EmptyToday/
│   ├── EmptyTodayV1.tsx
│   ├── EmptyTodayV2.tsx
│   ├── EmptyTodayV3.tsx
│   └── index.ts
├── OculpmOnboardingModal/
│   ├── OculpmOnboardingModal.tsx
│   ├── Step1Intro.tsx
│   ├── Step2Agents.tsx
│   ├── Step3Summary.tsx
│   └── index.ts
└── ManualEntryModal.tsx     // PR6 와 공유. PR5 에서 stub, PR6 에서 본격 구현.
```

ManualEntryModal 의 본격 구현은 PR6. 본 PR 은 stub (`alert("coming in PR6")` 또는 디스에이블 + tooltip).

---

## 4. 테스트 (계획)

### Vitest (페이즈 §4 의 "empty 변형 분기 3개" + onboarding 추가)

- [ ] V1 렌더: `getStatus` mock 의 `initialized: false` → V1 노출.
- [ ] V2 렌더: initialized=true + entries=[] + changes=[] → V2 노출.
- [ ] V3 렌더: initialized=true + entries=[] + changes=[...3] → V3 노출 + "3개 파일" 텍스트.
- [ ] V3 의 DiffVsNarrative 버튼은 disabled (tooltip "다음 페이즈" 확인).
- [ ] Onboarding Step 1 → 2 → 3 → 활성화 → `oculpmApi.init` + `setConfig` 호출.
- [ ] Onboarding Step 3 의 동의 체크박스 없으면 [활성화] disabled.
- [ ] [나중에] → localStorage 갱신, 재렌더 시 V1 의 [활성화] 는 살아있고 상단 링크 표시.
- [ ] 이미 initialized 인 상태에서 modal mount → 즉시 onClose 호출.

### 수동 QA (페이즈 §5 항목 9~13)

- [ ] V1 (`.oculpm/` 없는 새 프로젝트): "활성화" 카드.
- [ ] V2 (init 했는데 오늘 0개, file_changes 0개): "코드 수정하세요" 카드.
- [ ] V3 (오늘 file_changes 있지만 journal 0개): "narrative 누락" 카드 + DiffVsNarrative 버튼 (disabled OK).
- [ ] Onboarding 모달 3 step 완주.
- [ ] Onboarding 거절 → 재진입 시 모달 안 뜸, 상단 링크 유지.

---

## 5. DoD

- [ ] 3 변형 모두 의도된 모양으로 표시 (스크린샷 첨부).
- [ ] V3 가 file_changes 있을 때 정확히 트리거됨 (V2 와의 분기 정확).
- [ ] Onboarding 거절 후 재진입 시 모달 안 뜸.
- [ ] Step 2 의 토글이 `oculpmApi.setConfig(... agents.active)` 와 round-trip.
- [ ] 다크모드 + 한국어 + 1024px 폭 모두 깨짐 없음.
- [ ] `pnpm test` 8 케이스 green.

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **shadcn `Dialog` vs 커스텀 모달**: 기존 GreenfieldWizard 가 어떤 것 쓰는지 확인 후 통일. (refactor W6 에서 정한 컨벤션.)
2. **V1/V2/V3 의 시각 톤**: V1=parent action (큼), V2=guidance (중), V3=warning (노란 엣지). 디자인 토큰 사용 (페이즈 §3.4).
3. **Step 2 의 에이전트 감지**: `oculpm_detect_agents` 는 W4-PR4 의 커맨드 → W3 에서는 미구현 가정하고 4개를 모두 OFF default + 사용자가 직접 선택. **또는** 파일 존재만 inline 체크 (`fs.exists(".cursor/")` 등). 후자 추천.
4. **V3 의 "어댑터 상태"**: W4 전이므로 "다음 페이즈에 자동으로 채워집니다" 메시지로 대체.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR6 의 `ManualEntryModal` 본격 구현 — Step 2/3 의 폼 컴포넌트가 모달과 일부 재사용 가능.
- PR10 의 `OculpmOnboardingModal` self-dismiss 통합 — 본 PR 의 mount-time status 체크가 PR10 의 옵션 A 와 충돌 없는지 검증.
- W4 의 `OculpmSettings` 가 Step 2 의 에이전트 토글 UI 와 시각 / 시그니처 통일.
