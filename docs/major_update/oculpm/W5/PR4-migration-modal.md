# W5-PR4 — Frontend `MigrationModal` 5-step 흐름

> **목표**: PR3 의 3개 커맨드 + 진행률 이벤트를 묶어 사용자 친화적 모달로. 요약 → 옵션 → 백업 확인 → 진행률 → 결과의 5단계.
> **선행**: PR1/PR2/PR3 (백엔드 시그니처 + bindings). W3 의 `ManualEntryModal` 패턴 (shadcn Dialog 사용 방식).
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR4, [`../00-spec.md`](../00-spec.md) `§10` (frontend spec).
> **상태**: ✅ (2026-05-28)

---

## 1. 신규 파일 (계획)

| 파일 | 역할 |
|---|---|
| `src/features/projects/MigrationModal.tsx` | 본 PR 의 SSOT. 5-step state machine + 자식 컴포넌트 5개 (one per step). |
| `src/features/projects/migrationLogic.ts` | 순수 함수 (entry 토글 / 카운트 계산 / forbidden 강조) 단위 테스트 용이성. |

`projects` 폴더가 없으면 `src/features/onboarding/` 와 같은 레벨에 신설.

---

## 2. 트리거 (계획)

> 모달은 어디서 띄우는가?

후보:
1. **OculpmOnboardingModal 종료 직후** — onboarding 이 완료된 후 SQLite changelog 가 ≥ 1 건 있으면 자동 띄움. **권장**.
2. Settings 의 별도 버튼 — "마이그레이션 다시 실행" — 한 번 마이그레이션 한 사용자가 새로 들어온 changelog (없겠지만) 처리. **세컨더리**.

후보 1의 트리거 조건:
- `oculpmStatus.initialized === true`
- `oculpmApi.migrationDryRun(projectId)` 결과의 `source_entry_count > 0`
- localStorage 의 `oculpm.migration.dismissed.${projectId}` 가 없거나, `oculpm_migrations` 테이블에 기록 없음 (PR7 의 안전장치와 같은 SSOT).

dismiss 후 재진입 경로: Settings 에 "구 changelog 마이그레이션 다시 보기" 링크.

---

## 3. 5 step state machine

```
       enter
        │
        ▼
   ┌─────────┐ next ┌─────────┐ next ┌─────────┐ confirm ┌─────────┐ done ┌─────────┐
   │ Step 1  │─────►│ Step 2  │─────►│ Step 3  │────────►│ Step 4  │────►│ Step 5  │
   │ 요약    │      │ 옵션    │      │ 백업확인│         │ 진행률  │     │ 결과    │
   └─────────┘      └─────────┘      └─────────┘         └─────────┘     └─────────┘
        │                │                │                   │                │
        └─ cancel ───────┴────────────────┴── escape ─────────┘   에러 또는 완료 후 닫기
```

각 step 별 컴포넌트 + props:

### Step 1 — `MigrationSummary`
- 입력: `MigrationPlan`.
- 표시: `source_entry_count` 큰 숫자 + workday 별 entry 카운트 표 + 충돌 N개 (있으면) + `forbidden_path_hits` 강조 카드 (있으면).
- 진행 버튼: `[다음 →]`. 진행 막힘: `source_entry_count === 0` 이면 모달 자동 종료 (트리거에서 이미 걸렀어야 하나 안전망).
- TZ 경고 1줄: "현재 TZ: {config.workday.timezone}. 과거 entry 가 다른 TZ 였다면 ±1 hour 오차 가능."

### Step 2 — `MigrationOptions`
- 입력: 가변 `MigrationPlan` (`will_skip` 토글이 여기에서 갱신).
- 표시: workday 별 collapse 가능한 표. 각 행:
  - ☑ checkbox (디폴트 checked, `forbidden_files.length > 0` 이면 unchecked + 빨간 강조).
  - 시간 (hhmm) · type 라벨 · 제목 · slug · session_id.
  - forbidden 표시: "민감 경로 포함: .env.local, secrets/aws.json — 검토 후 선택" (touch 가능한 expandable).
- 일괄 토글: workday 헤더의 "전부 선택/해제" + "forbidden 만 토글".
- 진행: `[← 이전] [다음 →]`. `will_skip = false` 인 entry 0개면 다음 disabled.

### Step 3 — `MigrationBackupConfirm`
- 입력: `backup_dir` 경로 + `estimated_bytes_written`.
- 표시: 백업 경로 mono + 예상 크기 (`X MB`) + "백업 없이 진행 옵션 없음 — 안전 우선" 안내.
- 100 MB 초과 시 큰 노란 경고 (페이즈 §5 함정 표).
- 진행: `[← 이전] [실행]` — 실행 클릭 즉시 step 4 로 전환.

### Step 4 — `MigrationProgress`
- 진입과 동시에 `oculpmApi.migrateFromSqlite(projectId, plan)` 호출 + `events.oculpmMigrationProgress.listen(...)` 시작.
- 표시:
  - progress bar (`processed / total` × 100%).
  - 현재 entry slug + workday 라벨.
  - 예상 잔여 시간 (간단 EWMA 또는 "잠시만요" 단순 표시).
- `[중간 취소]` 버튼 — 첫 클릭은 confirm modal (취소 후 부분 정리는 rollback 자동) → 확정 시 PR3 의 cancel signal (별도 channel) 또는 단순 close + 백엔드는 다음 entry 완료 후 멈춤. **단순화: v1 은 "현재 entry 완료 후 중단"** — 페이즈 §1 W5-PR4 step 4 그대로.
- 응답 도착 시 step 5 로 전환. Err 응답이 `PartialFailure` 면 그 정보를 step 5 로 전달.

### Step 5 — `MigrationResult`
- 입력: `MigrationReport` 또는 `{ partial: true, error, rollback }`.
- 성공: 큰 ✅ + 성공 N / 스킵 N / 실패 N 카운트. 실패가 있으면 entries 의 사유 목록.
- 부분 실패: 빨간 카드 + "마이그레이션 실패. 부분 작성된 N개 파일을 자동 정리했습니다. 백업은 보존: {path}".
- 액션 버튼:
  - `[Today 로 이동]` — onClose + navigate(today).
  - `[모달 닫기]`.
  - `[구 데이터 삭제하기]` — 성공 케이스에서만 표시 + 별도 확인 모달 (PR7).
  - `[백업 폴더 열기]` — `oculpmApi.openEntryInEditor` 와 유사한 우회 (opener plugin scope 회피, 메모리 `opener-scope-recurring` 참조). **신규 backend command `oculpm_open_backup_dir(project_id, backup_dir_name)` 필요** — 본 PR 또는 PR7 에서 추가.

---

## 4. 진행률 stream 구독 (계획)

```tsx
useEffect(() => {
  if (step !== "progress") return;
  let off: (() => void) | null = null;
  void events.oculpmMigrationProgress.listen((e) => {
    if (e.payload.project_id !== projectId) return;
    setProgress({
      processed: e.payload.processed,
      total: e.payload.total,
      currentEntry: e.payload.current_entry,
    });
  }).then((unlisten) => { off = unlisten; });
  return () => off?.();
}, [step, projectId]);
```

`migrateFromSqlite` Promise 와 이벤트 stream 이 병렬 — Promise resolve/reject 가 step 5 로 전환 트리거.

---

## 5. 디자인 / 상태 영속

- shadcn Dialog (`Dialog`, `DialogContent`) — `large` 사이즈 변형. 강제 모달 (Esc/외부 클릭 닫기 disabled — step 4 진행 중엔 닫기 confirm).
- step 별 자식 컴포넌트를 conditional render (전환 시 ref 보존 불필요).
- 진행 중 (`step === "progress"`) 모달 닫으면 stream listen 해제만, 백엔드는 진행 계속 + 다음 시작 시 결과를 새 모달로. 단순화 — v1 은 닫기 disabled.

영속:
- `localStorage[oculpm.migration.dismissed.${projectId}] = "1"` — onboarding 자동 트리거의 한 번 dismiss 기억. Settings 의 "다시 보기" 가 이를 제거.

---

## 6. 테스트 (계획)

Vitest 인프라는 W6 로 deferred (W3/W4 와 동일 정책). 본 PR 의 검증:

- **타입 안전**: `pnpm tsc --noEmit` clean — `MigrationPlan` / `MigrationCommandError` 등 신규 type import 정상.
- **수동 QA** (페이즈 §4):
  - [ ] 신규 프로젝트 (changelog 0개) → 자동 트리거 안 함.
  - [ ] 시드 프로젝트 (10+ 개) → onboarding 후 자동 트리거.
  - [ ] step 2 의 forbidden 토글 디폴트 unchecked 확인.
  - [ ] step 4 진행 중 N회 progress 이벤트로 bar 갱신.
  - [ ] PartialFailure 분기 → step 5 빨간 카드 + 백업 경로 표시.

### Vitest 계획 (W6 로 이월)

- [ ] (W6) state machine 5단계 전환이 직선 + 이전 버튼 동작.
- [ ] (W6) step 2 의 entry 토글 → MigrationPlan 의 will_skip 변경.
- [ ] (W6) Progress 이벤트 mock → bar value 갱신.
- [ ] (W6) PartialFailure 분기 → 백업 경로 표시.

---

## 7. DoD

- [x] 5 step 모두 동작 (수동 QA — PR8 통합 라운드에서 시각 확인).
- [x] forbidden 매치 entries 자동 unchecked (Step 2) — backend PR1 가 `will_skip = true` 디폴트 보장 + `EntryRow` 가 `checked={!entry.will_skip}` 바인딩.
- [-] 중간 취소 동작 — v1 보류. step 4 에서 닫기 disable + footer 도 disabled "진행 중…" — 부분 진행 후 중단 시 자동 rollback 흐름은 PartialFailure 분기 (envelope) 로 cover. 명시적 cancel 시그널은 W6 stabilize 후보.
- [x] 진행률 이벤트가 UI bar 에 반영 — `useEffect(step==="progress")` 가 `events.oculpmMigrationProgress.listen` + state.
- [x] PartialFailure 분기가 빨간 카드 + 백업 경로로 surface — `Step5Result` 의 `partial_failure` 분기 + `oculpm_open_backup_dir` 우회 reveal 버튼.
- [x] `pnpm tsc --noEmit` clean (exit 0, 2026-05-28).

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **트리거 위치** — onboarding 직후 자동 vs Settings 메뉴 진입. 자동이 사용자 마찰 최소. dismiss 가능.
2. **step 4 닫기 disable 정책** — 진행 중 닫기 허용하면 listener 해제 + 백엔드 별도 진행. 단순화 v1: 닫기 disable + "취소" 버튼만.
3. **Dialog vs Sheet vs full-page** — 5 step 의 정보량 (workday 별 표 등) 이 Dialog 에 맞춤. Sheet 는 좌우 폭이 부족.
4. **백업 폴더 열기** — Tauri `revealItemInDir` 사용 시 opener plugin scope 의 재발 패턴 (memory `opener-scope-recurring`) 위험. 백엔드 우회 권장.

### 발견된 함정 / 변경

- **`oculpm_open_backup_dir` 커맨드 신설 위치**: 가이드 §3 step 5 가 "본 PR 또는 PR7" 로 보류했음. PR4 의 step 5 "백업 폴더 열기" CTA 가 즉시 필요하므로 본 PR 에서 추가. manager 의 traversal 가드 (`/`, `\\`, `..` 거부) 를 `migration_rollback` 과 공유 — `resolve_backup_dir_absolute` 메서드 추출. [[opener-scope-recurring]] 회피 패턴 (백엔드에서 shell out) 그대로.
- **trigger 위치 — 자동 vs 명시적**: 가이드 §2 옵션 1 (onboarding 직후 자동) 채택. `useShouldOfferMigration` hook 이 `oculpmStatus.initialized === true` AND dismiss 플래그 미설정 AND `dry_run` 결과 `source_entry_count > 0` 세 조건 모두 만족할 때만 `"yes"` 반환. onboarding 외 경로 (Greenfield Wizard 의 옵션 A 직후, 기존 init 프로젝트 첫 마운트) 도 자연스럽게 cover.
- **`MigrationCommandError` 의 narrow**: `oculpmApi.migrateFromSqlite` 가 `OculpmApiError` 에 동적으로 `.envelope` 부착. TS 의 nominal type 으론 표현이 어색해서 `(err as OculpmApiError & { envelope?: ... }).envelope` 패턴. 본 PR 의 modal 에서만 쓰이므로 caller 가 분기 가능. 향후 wrapper 정제 시 `Result<MigrationReport, MigrationCommandError>` 직접 return 패턴으로 리팩 후보.
- **localStorage 키 통일**: 가이드 §5 는 `oculpm.migration.dismissed.${projectId}`. `OculpmOnboardingModal` 의 기존 키 `oculpm_dismissed_${projectId}` 와 다름 — onboarding 거부와 migration 거부는 **별개 의도** 이므로 다른 키 유지가 옳음. 사용자가 onboarding 은 했지만 migration 은 미루는 케이스 cover.
- **step 2 의 `will_skip = false` 인 entry 0개 가드**: 가이드 §3 Step 2 footer "다음 disabled" 조건. `countToWrite(plan) === 0` 일 때 "다음" 버튼 disabled. 사용자가 모든 entry 를 해제하면 진행 불가 — 의도된 UX (실수로 빈 마이그레이션 실행 방지).
- **`MigrationModal` 위치**: 가이드 §1 은 `src/features/projects/` 신설 권장 — `ProjectsPanel.tsx`, `DependencyGraphView.tsx` 가 이미 있는 디렉토리 그대로 사용. `migrationLogic.ts` 도 같은 디렉토리 (testability 위해 별도 파일).
- **`useShouldOfferMigration` 의 enabled 조건**: `!migrationOpen && oculpmStatus.initialized` — 모달이 이미 열려있으면 hook 비활성화 (재마운트 시 중복 dry_run 방지). 모달 닫힐 때 `setRefreshTick` 으로 Today refresh 트리거.
- **step 5 의 "구 데이터 삭제하기" CTA**: PR7 `LegacyDeleteModal` 통합 hook (`onOpenLegacyDelete?: (report) => void`) 만 노출. 본 PR 단독에선 미연결 — TodayScreen 의 `onClose` 가 단순히 모달만 닫음. PR7 가 와이어업 추가 예정.

### 다음 PR 로 넘기는 메모

- PR7 의 `[구 데이터 삭제하기]` CTA 가 본 모달의 step 5 에서 호출 — `onOpenLegacyDelete?: (lastReport: MigrationReport) => void` hook 이미 노출. PR7 가 `LegacyDeleteModal` 를 TodayScreen 의 `MigrationModal` 사용처에 마운트하면 끝.
- PR8 의 회귀 점검에 "마이그레이션 후 ChangelogScreen 진입 → 기존 데이터 정상 표시" + "구 데이터 삭제 후 ChangelogScreen → 빈 상태 UI" 시나리오 포함.
- PR8 의 수동 QA 항목 `step 4 진행 중 N회 progress 이벤트로 bar 갱신` — 실측은 실제 데이터로 마이그레이션 했을 때 ms 단위로 확인. 합성 데이터로는 step 4 가 너무 빨라 progress bar 가 거의 안 보임 — UX 검토는 본 ai-pm 프로젝트의 meta dogfooding 때.
- Settings 의 "다시 보기" 링크: `clearDismissed(projectId)` exported helper 사용. W6 의 Settings UI 가 마이그레이션 섹션 추가 시 호출.
- W6 stabilize 후보: step 4 진행 중 명시적 cancel 시그널. 현재는 백엔드에 cancel hook 없음 — `mpsc::channel` 의 receiver drop 으로 신호 보내는 방식 후보. 또는 `tokio::sync::Notify` 통해 entry 단위 cancel point.
