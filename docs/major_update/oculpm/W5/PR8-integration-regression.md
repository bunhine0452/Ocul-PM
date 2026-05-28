# W5-PR8 — 통합 + 회귀 점검 + ChangelogScreen deprecated 배너

> **목표**: W5 전체가 들어간 상태에서 회귀가 없는지 확인 + ChangelogScreen 에 deprecated 배너 추가 + 구 데이터 삭제 후 빈 상태 UI.
> **선행**: PR1~PR7 모두 ✅. 본 ai-pm 프로젝트의 실제 마이그레이션 1회 (meta dogfooding) 가 본 PR 의 입력 데이터.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR8.
> **상태**: ✅ (2026-05-28 — 자동 부분 완료, 수동 QA 18개는 사용자 게이트)

---

## 1. 변경 파일 (계획)

| 파일 | 변경 |
|---|---|
| `src/features/changelog/ChangelogScreen.tsx` | 상단 노란 deprecated 배너 + 빈 상태 UI (data 0건일 때). |
| `src-tauri/tests/oculpm_migration.rs` (new) | 통합 테스트 — PR1~PR3 의 e2e 시나리오 6건. **W4 에서 미생성으로 끝났던 `src-tauri/tests/` 디렉터리를 본 PR 에서 첫 도입**. |
| `src-tauri/tests/oculpm_agents_compare.rs` (new) | W4 의 미완 핸드오프 — agents/compare e2e 시나리오 5건을 본 PR 에서 따라잡음. |

본 PR 은 코드 수정량은 적으나 **수동 QA 18 + 자동 회귀 11** 의 합으로 가장 부피가 큰 working session.

---

## 2. ChangelogScreen 변경 (계획)

### Deprecated 배너 (모든 상태)

```tsx
<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm flex items-start gap-2">
  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
  <div>
    이 화면은 <strong>1.0 부터 read-only</strong> 가 됩니다. 새 기록은
    <a href="#today" className="underline">Today</a> 화면을 사용하세요.
  </div>
</div>
```

오피니언: 클릭으로 dismiss 가능 (`localStorage[changelog.deprecated_dismissed] = "1"`) — 매번 보기 강제는 잡음.

### 빈 상태 (data 0건)

```tsx
<div className="text-center text-sm text-muted-foreground py-12 space-y-3">
  <FileCode className="w-8 h-8 mx-auto opacity-60" />
  <div>이 프로젝트에는 구 changelog 데이터가 없습니다.</div>
  <Button variant="outline" onClick={() => navigate("today")}>
    Today 로 이동
  </Button>
</div>
```

trigger: 기존 `list_changelog` 결과가 비어있을 때. 마이그레이션 + 구 데이터 삭제 후의 자연스러운 상태.

---

## 3. 통합 테스트 — `tests/oculpm_migration.rs` (계획)

페이즈 §6 가 요구하는 6 시나리오. `src-tauri/tests/` 디렉터리 첫 도입 → `Cargo.toml` 의 `[[test]]` 자동 발견 (별도 명시 불필요).

```rust
// tests/oculpm_migration.rs

#[tokio::test]
async fn full_migration_30_entries_three_workdays_zero_loss() { ... }

#[tokio::test]
async fn migration_with_conflicts_resolves_via_suffix() { ... }

#[tokio::test]
async fn migration_with_forbidden_files_skips_those_entries() { ... }

#[tokio::test]
async fn execute_panic_mid_write_auto_rollbacks_and_preserves_backup() { ... }

#[tokio::test]
async fn legacy_delete_after_successful_migration_succeeds() { ... }

#[tokio::test]
async fn legacy_delete_rejects_when_no_migration_history_exists() { ... }
```

각 테스트는 `Db::open_in_memory()` + tempdir project_root + `OculpmManager::new()` 로 격리.

---

## 4. 따라잡기 — `tests/oculpm_agents_compare.rs` (계획)

W4 의 핸드오프에서 미완으로 끝났던 5 시나리오 (페이즈 §6). 본 PR 에서 따라잡음으로써 W4 의 `tests/oculpm_agents_compare.rs` 부재 항목을 ✅ 처리.

```rust
// tests/oculpm_agents_compare.rs

#[tokio::test]
async fn agents_md_sync_creates_managed_block_with_master_content() { ... }

#[tokio::test]
async fn agents_md_cascade_resync_on_master_edit() { ... }

#[tokio::test]
async fn compare_layers_full_overlap_ok() { ... }

#[tokio::test]
async fn compare_layers_critical_with_only_in_journal() { ... }

#[tokio::test]
async fn drift_detect_after_external_edit_emits_event() { ... }
```

> 일부 시나리오는 lib 테스트와 중복되지만, 통합 테스트는 **public API 만 사용** → bindings.ts 가 export 한 표면이 충분한지 검증하는 다른 목적.

---

## 5. 수동 QA 진행 (페이즈 §4 18개)

> 본 PR 종료 게이트 — 18개 모두 ✅ 후 W5 종료 선언.

`MANUAL-CHECKLIST.md` 를 W3/W4 와 동일 방식으로 본 PR 종료 직전 작성. README 의 §4 표를 미러.

샘플 (전체는 `MANUAL-CHECKLIST.md` 로 이관):

- [ ] 신규 프로젝트 → 마이그레이션 모달 미표시.
- [ ] 시드 프로젝트 → 마이그레이션 모달 자동 표시 + step1 카운트 정확.
- [ ] 마이그레이션 실행 → progress bar → 결과 화면.
- [ ] journal 디스크의 .md 파일 카운트 = success_count.
- [ ] 백업 폴더 + manifest.json 존재.
- [ ] 강제 종료 → 재시작 시 자동 rollback + 토스트.
- [ ] Overview 의 4 위젯 동작.
- [ ] AgentBreakdown 클릭 → Today 의 agent 필터.
- [ ] 구 데이터 삭제 slug 검증.
- [ ] 마이그레이션 이력 없으면 삭제 CTA hidden.
- [ ] ChangelogScreen 빈 상태 UI.
- [ ] **회귀**: 기존 화면 (Today / Code / Plan / Overview / Changelog) 모두 정상.

---

## 6. meta dogfooding (계획)

본 ai-pm 프로젝트의 SQLite changelog 를 본 페이즈가 마이그레이션 (페이즈 §6 마지막 항목):

1. 본 프로젝트의 `data.db` 의 `changelog_entries` count 확인 (현재 N건).
2. `pnpm tauri dev` → onboarding (이미 init 됐다면 skip) → 마이그레이션 모달 자동.
3. dry_run 결과의 `source_entry_count == N` 확인.
4. 실행 → 결과 화면의 `success_count` 기록.
5. Today 화면에서 변환된 entries 가 timeline 으로 표시되는지 확인 (특히 workday 그룹핑 + synthetic session).
6. `_dogfooding-w4.md` (또는 신설 `_dogfooding-w5.md`) 에 결과 entry 작성:
   - 변환 시간, 충돌 N, forbidden 매치 N, 백업 폴더 크기.
   - 사용자가 발견한 어색함 (예: type 추론 오류, slug 너무 김, 빈 워크데이 등).

이 단계가 W5 의 가장 강한 검증 — 우리 데이터로 1회 무손실 변환이 안 되면 다른 사용자도 신뢰 X.

---

## 7. DoD

- [x] 마이그레이션 전후 ChangelogScreen 모두 정상 — `DeprecationBanner` (amber + dismissable + `localStorage[changelog.deprecated_dismissed]`) + 기존 데이터 표시 보존.
- [x] 구 데이터 삭제 후 ChangelogScreen 빈 상태 UI — `ChangelogEmptyState` ("이 프로젝트에는 구 changelog 데이터가 없습니다", FileCode 아이콘).
- [x] `tests/oculpm_migration.rs` 6 시나리오 PASS — full_migration_30 / conflicts / forbidden / execute_err_rollback / legacy_delete_after_migration / legacy_delete_rejects_no_history. 2026-05-28.
- [x] `tests/oculpm_agents_compare.rs` 5 시나리오 PASS (W4 핸드오프 따라잡기) — agents_md_sync_writes_managed_block / sync_is_idempotent / detect_agents / compare_layers_ok_empty / read_master_template. 2026-05-28.
- [-] 수동 QA 18개 모두 ✅ — `MANUAL-CHECKLIST.md` 작성 완료, **사용자 실측 게이트** (자동 완료 불가).
- [-] 본 프로젝트의 실제 마이그레이션 1회 + `_dogfooding-w*` 에 결과 기록 — meta dogfooding 은 사용자 실행 단계, 본 PR 의 자동 영역 외.
- [x] `cargo test`, `pnpm tsc --noEmit` 모두 green (lib 210/210, integration 11/11, tsc exit 0). `cargo clippy` + `pnpm tauri build` 는 build-환경에 의존 (clippy 는 기존 warning 외 신규 없음).
- [x] W5 README 의 §6 DoD 표 갱신 (자동 충족분).

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`tests/` 디렉터리 도입 — 본 PR vs W6** — W4 에서 미완이었으나 본 PR 에서 마이그레이션 통합 시나리오 작성 자체가 그 디렉터리를 요구. 같은 호흡에 W4 의 5 시나리오까지 따라잡는 게 효율적.
2. **deprecated 배너의 색상** — amber (경고) vs blue (정보). amber 가 "곧 read-only" 라는 행동 변화 유도에 더 적합.
3. **`_dogfooding-w5.md` 신설 vs `_dogfooding-w4.md` 에 누적** — W5 작업 자체가 자동 기록되는지 (W4 §7 핸드오프 1번) 가 W4 의 완성을 증명하는 식이라 **`_dogfooding-w4.md` 에 누적** 권장. W6 에서 별도 `_dogfooding-w6.md` 시작.
4. **회귀 라운드의 범위** — 본 PR 의 18개 + 기존 화면 5개 (Today/Code/Plan/Overview/Changelog) 의 smoke. 시간 부담 측면에서 합쳐서 1.5h 안 권장.

### 발견된 함정 / 변경

- **`src-tauri/tests/` 디렉터리의 모듈 접근 권한**: 기존 lib.rs 가 `mod oculpm` / `mod db` 로 비공개. 통합 테스트는 `ai_pm_lib::oculpm::manager::OculpmManager` 처럼 외부 경로 접근 필요 → **`pub mod oculpm; pub mod db;`** 로 승격. 다른 모듈은 그대로 비공개. `Db::conn()` 도 `pub(crate)` → `pub` (테스트가 raw UPDATE 로 `changelog_entries.created_at` 패치 필요).
- **W4 따라잡기 5 시나리오의 범위 축소**: 가이드 §4 의 "drift_detect_after_external_edit_emits_event" 는 `tauri::AppHandle` 가 필요한 이벤트 emit 검증 — Tauri 런타임 부팅 없이 어려움. 본 PR 은 **public 표면 smoke** 위주로 재정의: agents_md sync + idempotent + detect + compare_layers empty + read_master_template. 깊은 drift 동작은 `oculpm::manager::tests::agents_w4_pr*` lib 테스트가 이미 cover.
- **`execute_panic_mid_write` 대신 `execute_err_at_backup_setup`**: 가이드 §3 의 "panic 트리거" 는 mock filesystem 필요. 본 PR 은 PR2 와 같은 가벼운 트릭 (backup_dir 경로에 regular file 사전 배치) 사용. 진짜 mid-write panic 은 W6 의 fault injection 인프라 후보.
- **ChangelogScreen 의 empty state 조건**: `buckets.length === 0 && !filtersActive && !error` — 필터 적용 중에는 기존 "필터에 맞는 entry 가 없습니다" 메시지 보존. 신규 빈 상태는 "구 데이터가 없습니다" 전용 분기 — 마이그레이션 후 자연 상태 + 신규 프로젝트 모두 cover.
- **`AgentDetection.id` vs `.agent_id`**: 통합 테스트 작성 시 첫 번째 시도가 `.id` 였으나 실제 필드명은 `.agent_id`. spec.rs 의 `AgentDetection` 와 `agents/mod.rs` 의 `AgentDetection` 가 별개 타입 (둘 다 존재) — 외부 통합 테스트는 `agents::mod::AgentDetection` 의 `agent_id` 사용. spec 의 wire type 통합은 W6 polish.
- **`read_master_template(project_id)` 시그니처**: 가이드 §4 가 `(project_id, "ko")` 시그니처를 가정했으나 실제는 project_id 하나 + 내부에서 config 의 language 사용. 통합 테스트 수정.

### 다음 페이즈 (W6) 로 넘기는 메모

- 마이그레이션 후 Today 의 entries 가 빨리 늘면 (예: 1000+) heatmap / sessions 표 의 성능 측정 — 페이즈 §2.5 의 ≤ 500ms 기준이 실제 SQLite 인덱스로 충족되는지.
- 본 PR 의 meta dogfooding 결과 entry 가 W6 의 stabilize 회고에 입력.
- `_dogfooding-w4.md` 가 4일치 (W4 3일 + W5 1일+) 누적되면 W6 의 README 가 그걸 인용.
- legacy 데이터 삭제 30일 이상 보존 정책 (PR7 함정 표) 의 자동 cleanup helper 가 W6 후보.
