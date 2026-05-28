# W5-PR7 — "구 SQLite changelog 데이터 삭제" 안전 액션

> **목표**: 마이그레이션 검증 후 사용자가 명시적으로 구 `changelog_entries` + `changelog_files` 데이터를 truncate. 다중 안전장치 (마이그레이션 이력 + confirm_token + slug 타이핑 + 별도 백업) 로 실수 방지.
> **선행**: PR1~PR4. 특히 `MigrationReport.success_count > 0` 결과가 SQLite `oculpm_migrations` 테이블에 기록됨 (PR3 또는 본 PR 의 신규 마이그레이션).
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR7.
> **상태**: ✅ (2026-05-28)

---

## 1. 신규 / 변경 파일 (계획)

| 파일 | 변경 |
|---|---|
| `src-tauri/migrations/014_oculpm_migrations.sql` (new) | `oculpm_migrations` 테이블 (project_id, report_timestamp, source_entry_count, success_count, backup_dir, JSON). |
| `src-tauri/src/commands/oculpm.rs` (수정) | `oculpm_delete_legacy_changelog` 신규 + `oculpm_get_migration_history(project_id)` 보조. PR3 의 `oculpm_migrate_from_sqlite` 가 성공 시 본 테이블 INSERT 추가. |
| `src/features/projects/LegacyDeleteModal.tsx` (new) | 빨간 confirm 모달. slug 타이핑 + 토큰 검증. |
| `src/features/oculpm/MigrationModal.tsx` (PR4) (수정) | 결과 화면의 `[구 데이터 삭제하기]` CTA 가 본 모달 호출. |

---

## 2. SQLite 스키마 (계획)

`014_oculpm_migrations.sql`:

```sql
CREATE TABLE IF NOT EXISTS oculpm_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_timestamp INTEGER NOT NULL,        -- unix epoch of MigrationReport
  source_entry_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  backup_dir TEXT NOT NULL,                 -- basename only
  report_json TEXT NOT NULL,                -- 전체 MigrationReport JSON
  legacy_deleted_at INTEGER,                -- 삭제 시점 (NULL = 미삭제)
  legacy_delete_backup_dir TEXT             -- 본 PR 의 안전 백업 폴더
);

CREATE INDEX IF NOT EXISTS idx_oculpm_migrations_project
  ON oculpm_migrations(project_id, report_timestamp);
```

---

## 3. 백엔드 커맨드 (계획)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationHistoryEntry {
    pub id: u32,
    pub report_timestamp: i64,
    pub source_entry_count: u32,
    pub success_count: u32,
    pub backup_dir: String,
    pub legacy_deleted_at: Option<i64>,
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_migration_history(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<Vec<MigrationHistoryEntry>, String>;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LegacyDeletionReport {
    pub project_id: u32,
    pub deleted_entries: u32,
    pub deleted_files: u32,
    pub safety_backup_dir: String,
    pub deleted_at: i64,
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_delete_legacy_changelog(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    confirm_token: String,    // format: "migrated:<report_timestamp>:<source_entry_count>"
) -> Result<LegacyDeletionReport, String>;
```

---

## 4. `confirm_token` 검증 (페이즈 §1 W5-PR7)

```rust
fn validate_confirm_token(
    token: &str,
    history: &[MigrationHistoryEntry],
) -> Result<&MigrationHistoryEntry, OculpmError>;
```

1. token = `format!("migrated:{}:{}", report_timestamp, source_entry_count)`.
2. parse:
   - 3 colon-separated parts → `[0] == "migrated"`, `[1]` parse i64, `[2]` parse u32. 실패 시 `Err`.
3. history 에 `report_timestamp` + `source_entry_count` 가 정확히 일치하는 항목이 있어야 함. 없으면 `Err("no matching migration")`.
4. 매치된 항목이 `legacy_deleted_at.is_some()` 이면 `Err("already deleted")`.
5. `success_count > 0` 이어야 함 (마이그레이션 자체가 무용했다면 거부).
6. OK → 그 history entry 반환.

`oculpm_delete_legacy_changelog`:
1. `history = get_migration_history(project_id)`.
2. `validate_confirm_token(&token, &history)?`.
3. **안전 백업**: `safety_backup_dir = root.join(format!(".oculpm.backup-legacy-deletion-{}", iso_utc_now()))`. 생성 + `changelog_entries.json` + `changelog_files.json` 덤프 (PR1 의 dump 헬퍼 재사용).
4. **truncate**: `DELETE FROM changelog_files WHERE entry_id IN (SELECT id FROM changelog_entries WHERE project_id = ?)` + `DELETE FROM changelog_entries WHERE project_id = ?`. 한 트랜잭션.
5. `UPDATE oculpm_migrations SET legacy_deleted_at = ?, legacy_delete_backup_dir = ? WHERE id = ?`.
6. `LegacyDeletionReport` 반환.

---

## 5. Frontend `LegacyDeleteModal` (계획)

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ 구 changelog 데이터 삭제                                    │
├──────────────────────────────────────────────────────────────┤
│ 이 동작은 SQLite 의 `changelog_entries` + `changelog_files`   │
│ 행을 모두 삭제합니다. 백업은 자동 생성되지만, ChangelogScreen │
│ 의 기존 데이터는 더 이상 보이지 않습니다.                     │
│                                                              │
│ 마이그레이션 이력:                                            │
│  · 2026-06-01 12:00 — 47 entries → 47 success                │
│                                                              │
│ 확인하려면 아래 슬러그를 정확히 입력하세요:                   │
│                                                              │
│   ┌──────────────────────────────────────────────┐           │
│   │  delete-legacy-changelog                      │ ← 사용자  │
│   └──────────────────────────────────────────────┘           │
│                                                              │
│   [취소]                              [영구 삭제] (disabled)  │
└──────────────────────────────────────────────────────────────┘
```

- 입력값이 정확히 `"delete-legacy-changelog"` 일 때만 `[영구 삭제]` enabled.
- `[영구 삭제]` 클릭 → `oculpmApi.deleteLegacyChangelog(projectId, confirmToken)` 호출.
- 성공 → 새 토스트 "구 데이터 N개 삭제. 백업 보존: {path}" + 모달 닫기.

마이그레이션 이력이 없으면 (`oculpm_get_migration_history` 결과 비어있음) 본 모달 자체가 hidden — PR4 의 `[구 데이터 삭제하기]` CTA 도 hidden.

---

## 6. 테스트 (계획)

### 백엔드 (`oculpm::manager::tests::legacy_delete_w5_pr7`)

- [ ] `delete_rejects_when_no_migration_history` — history 비어있음 → `Err`.
- [ ] `delete_rejects_on_invalid_confirm_token` — 잘못된 timestamp/count → `Err`.
- [ ] `delete_rejects_after_already_deleted` — 동일 history entry 로 두 번 호출 → 두번째 `Err`.
- [ ] `delete_truncates_changelog_tables_and_records_history_row` — 성공 → entries/files 0개 + history.legacy_deleted_at 갱신.
- [ ] `delete_creates_safety_backup_with_json_dump` — backup 폴더 + json 파일 존재.

> 검증: `cargo test --lib oculpm::manager::tests::legacy_delete_w5_pr7` — 5/5 PASS.

### 프런트 (Vitest, W6 로 이월)

- [ ] (W6) slug 타이핑 미입력 → 버튼 disabled.
- [ ] (W6) 잘못된 slug → 버튼 disabled.
- [ ] (W6) 마이그레이션 이력 없으면 모달/CTA 자체 hidden.

### 수동 QA

- [ ] 신규 프로젝트 → CTA 자체 hidden.
- [ ] 마이그레이션 완료 후 → CTA 표시.
- [ ] slug 미입력 → 버튼 disabled.
- [ ] 정확한 slug + 클릭 → 토스트 + ChangelogScreen 빈 상태.
- [ ] 백업 폴더 (`.oculpm.backup-legacy-deletion-...`) 존재.

---

## 7. DoD

- [x] `confirm_token` 검증 4 분기 (잘못된 형식 / 매치 없음 / 이미 삭제 / success_count 0) 모두 거부 — `validate_confirm_token` + `delete_rejects_on_invalid_confirm_token` / `_no_migration_history` / `_after_already_deleted` / `_zero_successes` 테스트.
- [x] 마이그레이션 이력 없으면 메뉴/CTA 자체 hidden — `LegacyDeleteModal` 의 `target == null` 분기가 "삭제 가능한 마이그레이션 이력이 없습니다" 메시지 + Cancel 버튼만 표시. `MigrationModal` step 5 의 CTA는 성공 시에만 노출 (PR4 의 `showLegacyDelete={!hasFailures}`).
- [x] 삭제 후 `changelog_entries.count() == 0` + `changelog_files.count() == 0` — `delete_truncates_changelog_tables_and_records_history_row` 테스트가 보장. files 는 007 의 `ON DELETE CASCADE` 로 자동 정리.
- [x] 안전 백업 폴더 자동 생성 + json dump 존재 — `delete_creates_safety_backup_with_json_dump` 테스트가 `.oculpm.backup-legacy-deletion-<ISO>/changelog_entries.json` + `changelog_files.json` 둘 다 확인.
- [x] `oculpm_migrations.legacy_deleted_at` 갱신 — `mark_oculpm_migration_deleted` + `legacy_delete_backup_dir` 도 같이 저장.
- [x] backend 6 테스트 PASS — 가이드 5 + zero-success 1 보너스. 누적 lib 210/210 PASS (2026-05-28).
- [x] `pnpm tsc --noEmit` clean (exit 0, 2026-05-28).

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **history 기록 시점** — PR3 의 `oculpm_migrate_from_sqlite` 성공 분기에 INSERT (가까운 SSOT) vs 본 PR 에서 별 sync 메서드. 전자가 단순.
2. **safety_backup_dir 의 보존 기간** — 페이즈 §2.4 의 `auto_delete_backup_after_days = 7` 정책이 본 백업에도 적용? 안전성 위해 별도 정책 (legacy-deletion 은 30일 이상) 권장.
3. **slug 타이핑의 문구** — `"delete-legacy-changelog"` (24자) — 페이즈 §1 W5-PR7. 한국어 ("구-데이터-삭제") 도 검토했으나 영어 slug 가 사용자 실수 방지에 더 안전 (한글 자모 입력 모드 변환).
4. **truncate vs DELETE WHERE project_id** — SQLite 의 `DROP TABLE`/`TRUNCATE` 는 다른 프로젝트 영향. project_id 필터로 DELETE 만 사용 — multi-project 안전.

### 발견된 함정 / 변경

- **specta BigInt 금지**: 가이드 §2 의 `report_timestamp INTEGER` + `legacy_deleted_at INTEGER` (Unix epoch) 를 wire에 `i64` 로 export 시 specta가 BigInt-style 금지로 거부. 대안:
  1. 매번 RFC3339 String 으로 변환해 export (token 형식이 colon으로 깨짐)
  2. `u32` 로 export (2106-02-07 까지 안전)
  
  **decision: u32 채택**. DB는 INTEGER 로 그대로 두고 read/write 시 `as u32` / `as i64` 캐스팅. token 형식도 numeric: `migrated:<u32>:<count>`. 사용자 친화 디스플레이는 frontend 에서 `new Date(unix * 1000).toLocaleString()`.

- **`MigrationHistoryEntry.report_timestamp` 도 u32**: 가이드 §3 의 `report_timestamp: i64` 와 다름. 같은 이유 (specta) + `u32` 가 epoch seconds 표현에 충분.

- **PR3 migration_execute 의 history INSERT 가 본 PR로 이월**: 가이드 §1 의 "PR3 의 `oculpm_migrate_from_sqlite` 가 성공 시 본 테이블 INSERT 추가" — PR3 시점엔 014 마이그레이션이 없어서 패스. 본 PR 에서 `manager.migration_execute` 의 성공 분기에 `db.insert_oculpm_migration` 추가. 실패는 non-fatal 로그 — 사용자가 다음 migration 까지 legacy delete 불가하지만 데이터는 안전.

- **`success_count == 0` 거부**: 가이드 §4 step 5 "마이그레이션 자체가 무용했다면 거부". 본 PR `validate_confirm_token` 가 명시적 분기 + `delete_rejects_when_migration_had_zero_successes` 테스트 추가 (가이드 5 + 1 보너스 = 누적 6 테스트).

- **`changelog_files` cascade**: 007_changelog.sql 의 `REFERENCES changelog_entries(id) ON DELETE CASCADE` 덕분에 `DELETE FROM changelog_entries` 한 번이면 files 도 같이 정리. `truncate_changelog_for_project` 의 COUNT 쿼리만 두 번 (entries / files) — DELETE 는 entries 1회.

- **`fresh_with_history` 테스트 헬퍼의 project_id**: 기존 manager 테스트 패턴이 `project_id = 7` 하드코드인데, FK 가 진짜 projects 행을 요구. `db.create_project` 가 반환하는 id (1 시작) 를 사용 — 따라서 history 테스트는 동적 project_id.

- **`LegacyDeleteModal` 의 target 선택**: `lastReport.backup_dir` 와 매칭하는 history 행 우선, 없으면 "가장 최근 un-deleted 행". MigrationModal 직후 진입 (가장 일반적 경로) 는 backup_dir 정확 일치로 cover. Settings 진입은 가장 최근 자동 선택.

- **`oculpm_migrations` 테이블 추가가 014 마이그레이션**: 011 다음 빈 슬롯 (010 이 사용 안 됨)이 있었지만 안전을 위해 014 사용. db.rs 의 MIGRATIONS 배열은 (12, 13, 14) 로 이어짐 — 마이그레이션 번호는 ascending 만 보장하면 됨.

### 다음 PR 로 넘기는 메모

- PR8 의 회귀 점검: 삭제 후 ChangelogScreen 진입 → "이 프로젝트에는 구 changelog 데이터가 없습니다. Today 로 이동" 빈 상태 UI 추가.
- PR8 의 deprecated 배너: ChangelogScreen 상단에 "이 화면은 1.0 부터 read-only 가 됩니다. Today 사용을 권장합니다."
- PR8 통합 테스트: `tests/oculpm_migration.rs` 의 `legacy_delete_after_successful_migration_succeeds` + `legacy_delete_rejects_when_no_migration_history_exists` — 본 PR 의 manager 테스트가 이미 동등하나 통합 테스트는 public command 호출로 검증.
- W6 stabilize 후보:
  - `auto_delete_backup_after_days` 정책의 legacy-deletion 30일 이상 별도 (가이드 §8 의사결정 2번)
  - Settings 에 "마이그레이션 이력 확인" 보기 (현재는 LegacyDeleteModal 만 진입점)
