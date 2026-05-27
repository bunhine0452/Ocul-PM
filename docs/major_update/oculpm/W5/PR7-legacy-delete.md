# W5-PR7 — "구 SQLite changelog 데이터 삭제" 안전 액션

> **목표**: 마이그레이션 검증 후 사용자가 명시적으로 구 `changelog_entries` + `changelog_files` 데이터를 truncate. 다중 안전장치 (마이그레이션 이력 + confirm_token + slug 타이핑 + 별도 백업) 로 실수 방지.
> **선행**: PR1~PR4. 특히 `MigrationReport.success_count > 0` 결과가 SQLite `oculpm_migrations` 테이블에 기록됨 (PR3 또는 본 PR 의 신규 마이그레이션).
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR7.
> **상태**: ⬜

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

- [ ] `confirm_token` 검증 4 분기 (잘못된 형식 / 매치 없음 / 이미 삭제 / success_count 0) 모두 거부.
- [ ] 마이그레이션 이력 없으면 메뉴/CTA 자체 hidden.
- [ ] 삭제 후 `changelog_entries.count() == 0` + `changelog_files.count() == 0`.
- [ ] 안전 백업 폴더 자동 생성 + json dump 존재.
- [ ] `oculpm_migrations.legacy_deleted_at` 갱신.
- [ ] backend 5 테스트 PASS.

---

## 8. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **history 기록 시점** — PR3 의 `oculpm_migrate_from_sqlite` 성공 분기에 INSERT (가까운 SSOT) vs 본 PR 에서 별 sync 메서드. 전자가 단순.
2. **safety_backup_dir 의 보존 기간** — 페이즈 §2.4 의 `auto_delete_backup_after_days = 7` 정책이 본 백업에도 적용? 안전성 위해 별도 정책 (legacy-deletion 은 30일 이상) 권장.
3. **slug 타이핑의 문구** — `"delete-legacy-changelog"` (24자) — 페이즈 §1 W5-PR7. 한국어 ("구-데이터-삭제") 도 검토했으나 영어 slug 가 사용자 실수 방지에 더 안전 (한글 자모 입력 모드 변환).
4. **truncate vs DELETE WHERE project_id** — SQLite 의 `DROP TABLE`/`TRUNCATE` 는 다른 프로젝트 영향. project_id 필터로 DELETE 만 사용 — multi-project 안전.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR8 의 회귀 점검: 삭제 후 ChangelogScreen 진입 → "이 프로젝트에는 구 changelog 데이터가 없습니다. Today 로 이동" 빈 상태 UI.
- PR8 의 deprecated 배너: ChangelogScreen 상단에 "이 화면은 1.0 부터 read-only 가 됩니다. Today 사용을 권장합니다."
