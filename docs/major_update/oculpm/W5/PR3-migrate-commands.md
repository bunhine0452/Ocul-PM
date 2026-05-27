# W5-PR3 — 마이그레이션 Tauri 커맨드 3개

> **목표**: PR1 / PR2 의 manager 메서드를 프런트에 노출. dry_run / migrate_from_sqlite / rollback + 진행률 stream 이벤트 1개.
> **선행**: PR1 `dry_run` + `execute_with_rollback`. PR2 `rollback` + `RollbackReport`.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR3.
> **상태**: ⬜

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

- [ ] 3개 커맨드 invoke 성공.
- [ ] specta TS export 자동 갱신 (`bindings.ts` 에 3 커맨드 + 1 이벤트 + 5 타입).
- [ ] `OculpmMigrationProgress` 이벤트가 execute 중 N회 emit (N = plan.total).
- [ ] PartialFailure 분기가 프런트에 구조화된 형태로 도달 (string Err 으로 떨어지지 않음).
- [ ] `lib.rs:collect_commands![]` + `collect_events![]` 등록 누락 없음.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **에러 envelope** — `Result<T, String>` (현재 oculpm 커맨드 컨벤션) vs `Result<T, MigrationCommandError>`. 구조화 에러는 후자가 정직. specta 가 enum 도 export 가능. **후자 채택**.
2. **진행률 channel 크기** — 64 면 fast producer (수 ms 마다 entry 처리) 도 충분. drop 시 데이터 손실 (UI 미세 갱신 누락) 은 허용 — total/processed 차이로 catch up.
3. **dry_run 의 재호출 가능성** — UI 가 모달을 닫고 다시 열 때 dry_run 을 다시 호출하면 새 backup_dir 이름 (ISO timestamp 다름) 이 생성됨. backup_dir 가 비어있다면 (`execute` 전) 무해. PR4 가 한 세션 내에선 dry_run 결과를 캐싱 권장.
4. **rollback 의 backup_dir 입력** — 전체 경로 vs basename. basename 만 받아 backend 가 project_root 와 join → 사용자가 임의 디렉토리 삭제 못 하게 제한 (보안).

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR4 가 `OculpmMigrationProgress` 이벤트를 listen + progress bar 갱신.
- PR4 가 `MigrationCommandError::PartialFailure` 분기를 별도 화면 (백업 위치 안내 + 자동 정리 N개) 으로 표시.
- PR7 의 `oculpm_delete_legacy_changelog` 가 이번 PR 의 `MigrationReport.success_count` + `reportTimestamp` 를 보고 안전장치 검증 — 그러려면 본 PR 이 마이그레이션 이력을 SQLite `oculpm_migrations` 테이블에 기록해야 함. **마이그레이션 작성: 본 PR 또는 PR7**.
