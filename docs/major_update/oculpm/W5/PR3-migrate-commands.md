# W5-PR3 — 마이그레이션 Tauri 커맨드 3개

> **목표**: PR1 / PR2 의 manager 메서드를 프런트에 노출. dry_run / migrate_from_sqlite / rollback + 진행률 stream 이벤트 1개.
> **선행**: PR1 `dry_run` + `execute_with_rollback`. PR2 `rollback` + `RollbackReport`.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR3.
> **상태**: ✅ (2026-05-28)

---

## 1. 신규 커맨드 (계획)

`src-tauri/src/commands/oculpm.rs` 에 추가:

```rust
#[tauri::command]
#[specta::specta]
pub async fn oculpm_migration_dry_run(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<MigrationPlan, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_migrate_from_sqlite(
    app: AppHandle,
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    plan: MigrationPlan,
) -> Result<MigrationReport, MigrationCommandError>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_migration_rollback(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    backup_dir_name: String,    // basename only (e.g. ".oculpm.backup-pre-migration-20260601T120000Z")
) -> Result<RollbackReport, String>;
```

`MigrationCommandError` 는 success / partial-failure 의 두 분기를 들고 다니는 enum (PR2 의 `MigrationFailureWithRollback` 을 wire 친화 형태로):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind")]
pub enum MigrationCommandError {
    /// 가장 흔한 경우 — execute 가 일부 entry 만 실패. 자동 rollback 결과 포함.
    PartialFailure { error: String, rollback: RollbackReport },
    /// dry_run 자체가 깨졌거나, manifest write 도 못한 경우.
    Aborted { error: String },
}
```

---

## 2. 진행률 이벤트 (계획)

`src-tauri/src/oculpm/spec.rs` 에 추가:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct OculpmMigrationProgress {
    pub project_id: u32,
    pub processed: u32,
    pub total: u32,
    pub current_entry: String,    // slug — 사용자에게 "지금 어떤 entry 처리 중" 표시
}
```

`lib.rs:collect_events![]` 에 등록.

PR1 의 `execute` 가 `Option<mpsc::Sender<MigrationProgress>>` 를 받는데, 본 커맨드가:
1. `tokio::sync::mpsc::channel(64)` 생성 → tx 를 manager 에 전달.
2. 별도 task `tokio::spawn` 으로 rx 를 drain → 각 메시지를 `OculpmMigrationProgress::new(...).emit(&app)` 으로 발사.
3. `execute_with_rollback` 완료 후 tx drop → rx 종료 → spawn task 자연 종료.

---

## 3. 등록 (계획)

`src-tauri/src/lib.rs`:

```rust
use crate::commands::oculpm::{
    ...,
    oculpm_migration_dry_run, oculpm_migrate_from_sqlite, oculpm_migration_rollback,
};

let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
    ...,
    oculpm_migration_dry_run,
    oculpm_migrate_from_sqlite,
    oculpm_migration_rollback,
])
.events(collect_events![
    ...,
    crate::oculpm::spec::OculpmMigrationProgress,
]);
```

---

## 4. 프런트 wrapper (계획)

`src/api/oculpm.ts` 에 추가:

```ts
migrationDryRun: (projectId: number) =>
  unwrap<MigrationPlan>(
    "oculpm_migration_dry_run",
    commands.oculpmMigrationDryRun(projectId),
  ),

migrateFromSqlite: (projectId: number, plan: MigrationPlan) =>
  // 본 커맨드는 Err 가 String 이 아닌 MigrationCommandError — unwrap 헬퍼 보강 필요.
  // 또는 commands 직접 호출 후 분기.
  ...,

migrationRollback: (projectId: number, backupDirName: string) =>
  unwrap<RollbackReport>(
    "oculpm_migration_rollback",
    commands.oculpmMigrationRollback(projectId, backupDirName),
  ),
```

`migrateFromSqlite` 가 구조화 에러를 들고 다니므로 `OculpmApiError` 의 일반 흐름과 분리 — PR4 의 모달이 PartialFailure 분기를 직접 핸들.

---

## 5. 테스트 (계획)

본 PR 은 wire-up 위주. manager 메서드 자체는 PR1/PR2 가 단위로 보장. 따라서 검증은:

- [ ] `oculpm_migration_dry_run` 호출 → `MigrationPlan` 반환 (Tauri integration test 시 mock 가능. 가능하면 `src-tauri/tests/oculpm_migration.rs` 에 시드 DB + 호출 1건).
- [ ] `oculpm_migrate_from_sqlite` 호출 후 5+ `OculpmMigrationProgress` 이벤트 emit (event collector 활용).
- [ ] `oculpm_migration_rollback` 호출 → 디스크 정리 (PR2 의 단위 테스트가 사실상 동등 보장 — 본 PR 은 wire 만 확인).
- [ ] `MigrationPlan` / `MigrationReport` / `RollbackReport` / `MigrationCommandError` / `OculpmMigrationProgress` 가 bindings.ts 에 export — `pnpm tsc --noEmit` clean.

> 검증: cargo test 통과 + 신규 type 5종이 src/lib/bindings.ts 에 자동 생성.

---

## 6. DoD

- [x] 3개 커맨드 invoke 성공 (`oculpm_migration_dry_run`, `oculpm_migrate_from_sqlite`, `oculpm_migration_rollback`).
- [x] specta TS export 자동 갱신 — `bindings.ts` 에 3 커맨드 (`oculpmMigrationDryRun`/`oculpmMigrateFromSqlite`/`oculpmMigrationRollback`) + 1 이벤트 (`oculpmMigrationProgress`) + 5 타입 (`MigrationPlan`/`MigrationReport`/`RollbackReport`/`MigrationCommandError`/`OculpmMigrationProgress`) + 보조 (`MigrationEntryPlan`/`MigrationWorkdayPlan`/`MigrationConflict`/`MigrationFailure`) 모두 노출. `cargo test --lib bindings_export_test` 가 정규화 게이트.
- [x] `OculpmMigrationProgress` 이벤트가 execute 중 emit — 커맨드 본체가 `mpsc::channel(64)` + `tokio::spawn` drain 으로 wire-up. `cargo test`는 백엔드 PR1/PR2 단위로 채널 동작 검증 (`execute_writes_target_files_with_synthetic_sessions` 가 plan.total 만큼 success_count 가 누적되는 것을 확인).
- [x] PartialFailure 분기가 프런트에 구조화된 형태로 도달 — `MigrationCommandError` 가 `#[serde(tag = "kind", rename_all = "snake_case")]` 이라 `{kind: "partial_failure", ...} | {kind: "aborted", ...}` 로 TS unify. `oculpmApi.migrateFromSqlite` 가 `OculpmApiError` 에 `.envelope` 필드 attach 해 caller 가 분기 가능.
- [x] `lib.rs:collect_commands![]` + `collect_events![]` 등록 누락 없음 — 본 PR 의 신규 항목 3 commands + 1 event 모두 포함. `build_specta_builder()` 헬퍼로 추출해 test 와 runtime 이 같은 list 공유.
- [x] `pnpm tsc --noEmit` 통과 (exit 0, 2026-05-28).

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **에러 envelope** — `Result<T, String>` (현재 oculpm 커맨드 컨벤션) vs `Result<T, MigrationCommandError>`. 구조화 에러는 후자가 정직. specta 가 enum 도 export 가능. **후자 채택**.
2. **진행률 channel 크기** — 64 면 fast producer (수 ms 마다 entry 처리) 도 충분. drop 시 데이터 손실 (UI 미세 갱신 누락) 은 허용 — total/processed 차이로 catch up.
3. **dry_run 의 재호출 가능성** — UI 가 모달을 닫고 다시 열 때 dry_run 을 다시 호출하면 새 backup_dir 이름 (ISO timestamp 다름) 이 생성됨. backup_dir 가 비어있다면 (`execute` 전) 무해. PR4 가 한 세션 내에선 dry_run 결과를 캐싱 권장.
4. **rollback 의 backup_dir 입력** — 전체 경로 vs basename. basename 만 받아 backend 가 project_root 와 join → 사용자가 임의 디렉토리 삭제 못 하게 제한 (보안).

### 발견된 함정 / 변경

- **bindings.ts 자동 export 트리거**: 기존 export 는 `pub fn run()` 안의 `#[cfg(debug_assertions)] builder.export(...)` 가 유일한 트리거 — Tauri 앱이 실제 부팅돼야 갱신. PR3 의 신규 타입을 빠르게 검증하려면 `pnpm tauri dev` 필요. 대신 본 PR 에서 **`build_specta_builder()` 헬퍼 함수로 collect_commands/collect_events 추출 + `#[cfg(test)] export_bindings_typescript` 테스트 추가**. 이제 `cargo test` 가 bindings.ts 를 자동 갱신 → CI / 로컬 모두 sync.
- **`MigrationCommandError::PartialFailure` 의 `rollback`**: PR2 의 `MigrationFailureWithRollback.rollback` 은 `Result<RollbackReport, OculpmError>`. 본 PR 커맨드가 변환할 때 rollback 도 실패한 경우엔 `Aborted` 분기로 디스플레이 — `PartialFailure` 는 rollback 자체는 성공한 케이스 한정. 가이드 §1 의 두 분기 의미를 더 명확히 정의 (rollback 성공/실패 기준).
- **panic 분기 처리**: PR2 핸드오프에서 위임받은 `tokio::spawn + JoinError::is_panic()` 패턴 — 본 PR 에선 미적용. Tauri 의 invoke handler 가 panic 을 그 자체로 잡아 JS Err 로 surface 하기는 함 (DevTools 에서 stack trace 보임). 명시적 rollback 트리거는 PR8 통합 테스트 / W6 stabilize 로 이월. **trade-off**: invoke handler panic 분기에서는 backup_dir 가 남고 manifest 도 부분 작성됨 → 사용자가 settings 에서 "수동 rollback" 버튼으로 회수. 모달 (PR4) 의 step 5 에 그 안내 추가 권장.
- **watcher pause/resume 위치**: 본 PR 의 manager 메서드 `migration_execute` / `migration_rollback` 가 모두 watcher 를 일시정지 → 마이그레이션 → 재시작. `watcher_status` 로 사전 running 여부를 캡쳐해 **사용자가 명시적으로 정지해뒀던 워처를 함부로 재시작하지 않음**. 가이드 §1 W5-PR3 에 없었던 디테일.
- **`backup_dir_basename` 의 traversal 가드**: 가이드 §7 의 의사결정 4번 ("basename 만 받아 backend 가 project_root 와 join → 사용자가 임의 디렉토리 삭제 못 하게 제한") 을 manager 단에서 명시적으로 reject — `/`, `\\`, `..` 포함 시 `OculpmError::InvalidConfig`. 프런트 wrapper 가 잘못 path 를 넘겨도 백엔드에서 차단.
- **`oculpmApi.migrateFromSqlite` 의 envelope 노출**: `OculpmApiError` 에 동적으로 `.envelope` 필드 attach 하는 방식. TypeScript 의 nominal type 으로는 표현이 어색하지만, caller 가 `err instanceof OculpmApiError && "envelope" in err && err.envelope.kind === "partial_failure"` 로 narrow 가능. PR4 모달이 이 패턴 사용.

### 다음 PR 로 넘기는 메모

- PR4 가 `events.oculpmMigrationProgress.listen((e) => ...)` 로 progress bar 갱신. payload 의 `project_id` 로 multi-project 환경 필터링.
- PR4 가 `MigrationCommandError` 분기를 별도 화면 (백업 위치 안내 + 자동 정리 N개) 으로 표시. `oculpmApi.migrateFromSqlite` 가 throw 한 `OculpmApiError.envelope` 를 narrow → kind 별 처리.
- PR4 의 "백업 폴더 열기" CTA 는 새 backend command 필요 (`oculpm_open_backup_dir(project_id, basename)`) — manager 의 traversal 가드 패턴 재사용. [[opener-scope-recurring]] 회피.
- PR7 의 `oculpm_delete_legacy_changelog` 가 이번 PR 의 `MigrationReport.completed_at` (RFC3339) + `success_count` 를 입력으로. 마이그레이션 이력 SQLite 기록 (`oculpm_migrations` 테이블) 은 **PR7 에 위임** — PR3 는 단순 in-memory 결과 반환만, PR7 의 014 migration 가 도입되면 manager 메서드 `migration_execute` 가 성공 시 row INSERT 추가. 본 PR 은 그 변경을 위한 hook point 만 열어둠.
- W6 stabilize 후보: `tokio::spawn + JoinError::is_panic()` 으로 명시적 panic-rollback 분기. 본 PR 의 wrapper 는 단순 sync await — Tauri 의 panic 캐치에 의존.
