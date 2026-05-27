# W5-PR2 — 마이그레이션 롤백 + 부분 실패 처리

> **목표**: PR1 의 `execute` 가 panic / 에러로 죽거나, 사용자가 명시적으로 되돌리고 싶을 때 `manifest.json` 기반으로 안전하게 cleanup. backup_dir 는 보존.
> **선행**: PR1 의 `execute` + `manifest.json` 구조 + `MigrationReport.written_paths` + `backup_dir`.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR2.
> **상태**: ✅ (2026-05-28)

---

## 1. 변경 파일 (계획)

| 파일 | 역할 |
|---|---|
| `src-tauri/src/oculpm/migrate_from_sqlite.rs` (수정) | `rollback` 함수 + `RollbackReport` 추가. PR1 의 `execute` 본체에 `catch_unwind` + 에러 분기에서 rollback 자동 호출 wrapper. |

별도 모듈로 빼지 않는 이유: rollback 알고리즘이 `execute` 의 manifest 포맷에 100% 의존 → 같은 파일에 두는 게 SSOT 유지에 유리.

---

## 2. 타입

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RollbackReport {
    pub project_id: u32,
    pub backup_dir: PathBuf,
    pub deleted_files: Vec<String>,
    pub deleted_cache_rows: u32,
    pub manifest_entries_total: u32,
    pub manifest_entries_missing_on_disk: u32,   // 이미 사용자가 손으로 지운 경우
    pub backup_dir_preserved: bool,              // 항상 true (안전)
}
```

`manifest_entries_missing_on_disk` 는 rollback 이 "이미 누가 지운 파일" 을 만났을 때 잡음 없이 진행하기 위한 안전 카운터. 사용자에게는 "N 파일 정리 (그중 K개는 이미 부재)" 식으로 표시.

---

## 3. 알고리즘 — `rollback`

```rust
pub async fn rollback(
    db: &Db,
    project_id: u32,
    root: &Path,
    backup_dir: &Path,
) -> Result<RollbackReport, OculpmError>;
```

1. `manifest_path = backup_dir.join("manifest.json")` 읽기.
   - 파일 없음 → `OculpmError::InvalidConfig("backup_dir missing manifest.json")` (페이즈 §5: backup 없이 진행 옵션 X).
   - 형식: JSONL — 한 줄당 한 entry. 마지막 줄이 잘려있을 수 있음 (write 도중 죽음). JSON 파싱 실패 줄은 silently skip + 카운트만 기록.
2. **워처 일시정지** — `manager.watcher_stop(project_id)` (rollback 중 fs event 가 cache reindex 를 헛돌게 하지 않게).
3. **파일 삭제**: 각 manifest entry 의 `target_relative_path` 를 `journal_root.join(...)` 로 절대 경로 변환 → `fs::remove_file` 시도.
   - `NotFound` 는 카운트만 (`manifest_entries_missing_on_disk += 1`).
   - 그 외 IO 에러는 즉시 Err 반환 (다음 단계로 가지 않음 — 사용자가 디스크 권한 문제 등을 먼저 해결해야).
4. **synthetic sessions 정리**: manifest 에 기록된 session_id 들 (`migrated-{workday}-{NNN}`) 을 `index/{workday}/sessions.ndjson` 에서 제거. 단순 라인 필터 (`rg -v` 효과) 로 rewrite + atomic.
5. **cache 행 삭제**: `JournalCache::delete_entries(project_id, &written_paths)` 호출 — W3 에 helper 가 없으면 본 PR 에서 신설 (`DELETE FROM oculpm_journal WHERE project_id = ? AND relative_path = ?` loop).
6. **빈 디렉토리 정리**: workday 폴더가 마이그레이션 entries 만으로 채워졌으면 (`fs::read_dir(...).next().is_none()`) 폴더 자체 제거. TypeFolder 도 같이.
7. **backup_dir 보존** — 절대 삭제 X. 사용자 회수 가능성을 위함.
8. **워처 재시작**.
9. `RollbackReport` 반환.

`rollback` 자체가 idempotent: 같은 backup_dir 로 2회 호출 시 두번째는 모든 파일이 NotFound → `manifest_entries_missing_on_disk == manifest_entries_total` 로 정상 반환.

---

## 4. 부분 실패 자동 처리 — `execute` 의 wrapper

```rust
pub async fn execute_with_rollback(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    config: &OculpmConfig,
    plan: MigrationPlan,
    progress: Option<tokio::sync::mpsc::Sender<MigrationProgress>>,
) -> Result<MigrationReport, MigrationFailureWithRollback>;

pub struct MigrationFailureWithRollback {
    pub error: OculpmError,
    pub rollback: RollbackReport,
}
```

- 내부에서 `execute(...)` 호출 → `Ok` 면 그대로 반환.
- `Err` 면:
  1. `backup_dir = plan.backup_dir` (execute 가 이미 만들어둠).
  2. `rollback(db, project_id, root, &backup_dir).await` 호출 (best-effort — rollback 자체가 Err 면 두 에러 합쳐서 반환).
  3. `MigrationFailureWithRollback { error, rollback }` 반환.

PR3 의 커맨드는 이 wrapper 를 호출 → 프런트가 자동 정리 결과를 한 응답으로 받음 ("실패 + 자동 정리 N개 완료, 백업 보존").

`std::panic::catch_unwind` 는 async 본문에서 까다로움 — `tokio::task::spawn` + `JoinHandle::await` 가 panic 을 `JoinError::is_panic()` 으로 surface. PR3 가 spawn 으로 호출.

---

## 5. 테스트 (계획)

페이즈 §3: `rollback` 3 + 부분 실패 2 = 5개. PR1 의 15 + 본 PR 의 5 = 누적 20개.

### `rollback` (`oculpm::migrate_from_sqlite::tests`)

- [ ] `rollback_deletes_files_from_manifest_and_preserves_backup` — execute 후 rollback → written_paths 디스크에서 사라짐, backup_dir/changelog_entries.json 그대로.
- [ ] `rollback_is_idempotent_when_files_already_missing` — 같은 backup 으로 rollback 2회 → 두번째는 `manifest_entries_missing_on_disk == total`.
- [ ] `rollback_strips_synthetic_sessions_from_index_ndjson` — sessions.ndjson 에서 `migrated-*` session 라인만 제거, 다른 session 보존.

### 부분 실패 (`oculpm::migrate_from_sqlite::tests`)

- [ ] `execute_panic_mid_write_triggers_auto_rollback` — 3번째 entry write 직전 forced panic → wrapper 가 rollback → 디스크에 1번째 / 2번째 entry 의 파일 0개. backup 보존.
- [ ] `execute_io_error_mid_write_triggers_auto_rollback` — write_atomic 가 ENOSPC 등 시뮬레이션 (mock filesystem 또는 권한 0 디렉토리) → wrapper 가 rollback, 동일하게 디스크 정리.

> 검증: `cargo test --lib oculpm::migrate_from_sqlite` — 본 PR 종료 시 누적 20/20 PASS.

---

## 6. DoD

- [x] 6개 신규 테스트 통과 (`rollback` 3 + non-synthetic preserve 보너스 1 + `execute_with_rollback` 2). 누적 21/21 PASS, 2026-05-28.
- [x] `rollback` 후 cache 와 디스크가 마이그레이션 전 상태와 동일 (`rollback_deletes_files_from_manifest_and_preserves_backup`).
- [x] backup_dir 은 절대 삭제되지 않음 (`backup_dir_preserved: true` 항상 — 테스트가 assert).
- [x] `execute_with_rollback` 가 Err 분기를 잡아 자동 정리 (`execute_with_rollback_triggers_rollback_when_backup_dir_blocked`). panic 분기는 PR3 의 `tokio::spawn` + JoinError::is_panic() 으로 해결 — 본 PR 의 wrapper 는 동기적 Err 만 핸들.
- [x] `RollbackReport` specta export — spec.rs 의 `#[derive(Type)]` 로 이미 노출. 필드 확장 (backup_dir, deleted_cache_rows, manifest_entries_total, manifest_entries_missing_on_disk, stripped_session_count, backup_dir_preserved) 도 자동 반영.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **panic 캐치 위치** — `execute` 본체 안 vs `execute_with_rollback` wrapper. wrapper 가 더 깔끔 (execute 가 순수 비즈니스 로직 유지). spawn 채택.
2. **manifest 의 JSONL vs JSON 배열** — JSONL 이 partial-write 친화적 (한 줄씩 fsync). 정상 종료 시 마지막 줄 끝 newline 보장. JSON 배열은 닫는 `]` 가 없으면 전체 invalid → 위험.
3. **synthetic sessions 의 cleanup 책임** — rollback 안에 두는 vs 별 단계. 같은 backup_dir 의 manifest 가 session_id 도 들고 있어야 함. 페이즈 §1 의 manifest 포맷에 `session_id` 필드 추가 권장.
4. **rollback 중 워처 정지** — execute 와 동일한 패턴. drift 감지 + journal 이벤트가 헛도는 잡음 방지.

### 발견된 함정 / 변경

- **`RollbackReport` 필드 확장**: spec.rs 가 W5 미리 선언했던 minimal 정의 (`project_id`, `removed_paths`, `completed_at`) 를 가이드 §2 의 7개 필드로 확장. wire breaking change 가능성 — 사용 처가 본 모듈 외 0건이라 안전. 향후 추가는 `Option<>` 으로.
- **synthetic session cleanup 방식**: 가이드 §3 step 4 는 "라인 필터 (rg -v 효과) 로 rewrite" 라고 적혀있으나, IndexWriter 가 sessions.json (JSON 단일 파일) 을 사용하므로 라인 필터 X. 실제 구현은 `serde_json::Value` 로 deserialize → `sessions` 배열에서 id 매치 element retain → 재직렬화. atomic_io::write_atomic 으로 다시 씀. [[oculpm-session-id-format]] 메모리 참조.
- **panic 분기 처리**: 가이드 §4 는 `tokio::task::spawn` + `JoinError::is_panic()` 으로 panic 을 잡으라고 권장. 본 PR 의 `execute_with_rollback` 은 단순 `execute().await` 호출 — panic 잡지 못함. 이유: 본 모듈은 manager 와 결합하지 않으므로 spawn 컨텍스트가 없음. **PR3 의 Tauri 커맨드에서 spawn + JoinError 처리** (가이드 §4 의 마지막 문단대로). 본 PR 은 동기 Err 만 잡음.
- **빈 디렉토리 정리**: 가이드 §3 step 6 의 "TypeFolder 도 같이" 정리. 본 PR 의 `prune_empty_dirs` 가 워크데이 폴더 + 그 아래 type 폴더 (`Bugs/`, `Features_to_add/` 등) 까지 빈 거 제거. journal_root 자체는 보존 (cache가 다시 만들 수 있게).
- **테스트의 fault injection**: 가이드 §5 의 "execute_panic_mid_write" / "execute_io_error_mid_write" 는 mock filesystem 필요 — 본 PR 은 `backup_dir` 경로에 미리 regular file 을 두어 `create_dir_all` 가 실패하는 가벼운 방식으로 대체 (`execute_with_rollback_triggers_rollback_when_backup_dir_blocked`). 진짜 mid-write fault injection 은 PR8 의 통합 테스트 인프라로 이월.
- **`MigrationFailureWithRollback` 위치**: 가이드 §4 의 `pub struct MigrationFailureWithRollback { error: OculpmError, rollback: RollbackReport }` 와 다르게, 본 PR 은 rollback 자체도 실패할 수 있다는 점을 명시 — `rollback: Result<RollbackReport, OculpmError>`. PR3 에서 envelope 변환 시 이 분기를 사용자에게 어떻게 보여줄지 결정.

### 다음 PR 로 넘기는 메모

- PR3 의 커맨드가 본 PR 의 `execute_with_rollback` 를 호출 — 실패 시 `MigrationFailureWithRollback { execute_error, rollback: Result<...> }` 을 `MigrationCommandError` (가이드 §1) 의 PartialFailure 변형으로 변환. **rollback 도 실패한 경우** (`rollback: Err`) 는 사용자에게 "백업 폴더에서 수동 복구 필요" 안내가 필요 — PR4 결과 화면의 추가 분기.
- PR3 의 커맨드에서 **panic 처리** 책임: `tokio::spawn` 으로 `execute_with_rollback` 감싸고 JoinHandle::is_panic() 분기 추가 (가이드 §4 의 마지막 문단). 본 PR 의 wrapper 는 동기 Err 만 처리.
- PR4 의 결과 화면이 `RollbackReport.removed_paths.len()` + `RollbackReport.backup_dir` (basename) 경로 surface — 사용자가 백업 폴더로 이동할 수 있도록 reveal 버튼은 신규 backend command `oculpm_open_backup_dir(project_id, backup_dir_basename)` 필요 (W4 의 `oculpm_open_entry_in_editor` 같은 우회. [[opener-scope-recurring]] 재발 회피).
- PR7 의 안전장치: rollback 이력은 별도 테이블 (`oculpm_migrations`) 의 `last_rollback_at` 으로 기록 → "최근 rollback 후 24시간 내엔 다시 migrate 권유 안 함" 로직 후보. 본 PR 의 `RollbackReport.completed_at` (RFC3339) 이 그 값.
- `IndexWriter` 에 `delete_session(id)` public API 추가는 본 PR 에서 보류 — sessions.json 을 직접 manipulate 하는 PR2/PR7 외에는 use case 없음. 필요 시 W6 stabilize 단계에서 리팩.
