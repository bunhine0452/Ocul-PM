# W5-PR2 — 마이그레이션 롤백 + 부분 실패 처리

> **목표**: PR1 의 `execute` 가 panic / 에러로 죽거나, 사용자가 명시적으로 되돌리고 싶을 때 `manifest.json` 기반으로 안전하게 cleanup. backup_dir 는 보존.
> **선행**: PR1 의 `execute` + `manifest.json` 구조 + `MigrationReport.written_paths` + `backup_dir`.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR2.
> **상태**: ⬜

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

- [ ] 5개 신규 테스트 통과 (`rollback` 3 + 부분 실패 2).
- [ ] `rollback` 후 cache 와 디스크가 마이그레이션 전 상태와 동일.
- [ ] backup_dir 은 절대 삭제되지 않음 (`backup_dir_preserved: true` 항상).
- [ ] `execute_with_rollback` 가 panic/Err 양쪽 분기를 모두 잡아 자동 정리.
- [ ] `RollbackReport` specta export.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **panic 캐치 위치** — `execute` 본체 안 vs `execute_with_rollback` wrapper. wrapper 가 더 깔끔 (execute 가 순수 비즈니스 로직 유지). spawn 채택.
2. **manifest 의 JSONL vs JSON 배열** — JSONL 이 partial-write 친화적 (한 줄씩 fsync). 정상 종료 시 마지막 줄 끝 newline 보장. JSON 배열은 닫는 `]` 가 없으면 전체 invalid → 위험.
3. **synthetic sessions 의 cleanup 책임** — rollback 안에 두는 vs 별 단계. 같은 backup_dir 의 manifest 가 session_id 도 들고 있어야 함. 페이즈 §1 의 manifest 포맷에 `session_id` 필드 추가 권장.
4. **rollback 중 워처 정지** — execute 와 동일한 패턴. drift 감지 + journal 이벤트가 헛도는 잡음 방지.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR3 의 커맨드가 본 PR 의 `execute_with_rollback` 를 호출 — 실패 시 `MigrationFailureWithRollback` 을 `String` Err 가 아니라 구조화된 응답으로 반환할 수 있게 envelope 디자인 검토.
- PR4 의 결과 화면이 `RollbackReport.deleted_files.len()` + `backup_dir` 경로 surface — 사용자가 백업 폴더로 이동할 수 있도록 reveal 버튼 (W4 의 `oculpm_open_entry_in_editor` 와 같은 우회 방식 권장; opener plugin scope 의 재발 패턴 회피).
- PR7 의 안전장치: rollback 이력은 별도 테이블 (`oculpm_migrations`) 의 `last_rollback_at` 으로 기록 → "최근 rollback 후 24시간 내엔 다시 migrate 권유 안 함" 로직 후보.
