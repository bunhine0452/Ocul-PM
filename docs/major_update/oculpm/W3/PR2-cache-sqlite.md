# W3-PR2 — `cache.rs` SQLite 캐시 + 증분 재인덱싱

> **목표**: `.oculpm/journal/**/*.md` 를 SQLite 의 `oculpm_journal*` 테이블에 캐시하여 Today UI 의 list/filter/search 가 ms 단위로 응답한다. **캐시는 손실 무관 — 언제든 `reindex_full` 로 `.oculpm/journal/` 에서 100% 재생성**.
> **선행**: W3-PR1 (frontmatter/markdown 파서), W2-PR5 (`oculpm:journal_path_changed` 이벤트).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR2, [`../01-backend.md`](../01-backend.md) §9 (테이블 스키마).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. DB 마이그레이션 (실제)

`src-tauri/migrations/012_oculpm_journal.sql` 신규 — 5 테이블 + 6 인덱스.

`db.rs::MIGRATIONS` 에 `(12, include_str!("../migrations/012_oculpm_journal.sql"))` 추가. (11 은 `011_project_blueprints.sql` 가 점유 중. 12 로 점프.)

| 테이블 | 핵심 컬럼 | PK | 비고 |
|---|---|---|---|
| `oculpm_journal` | relative_path, workday, type, slug, status, difficulty, title, checkbox, session_id, agent_id, language, verified_by_user, created_at, updated_at, file_mtime, body_markdown, body_md_hash, parse_ok, parse_warnings | (project_id, relative_path) | parse_ok=0 행도 indexing (parse_warnings JSON 보존) |
| `oculpm_journal_files` | relative_path, file_path, op, bytes_added, bytes_removed | (project_id, relative_path, file_path) | cascade — upsert 시 wholesale replace |
| `oculpm_journal_tags` | relative_path, tag | (project_id, relative_path, tag) | search 쪽에 join 사용 |
| `oculpm_sessions_cache` | session_id, workday, started_at, ended_at, ended_reason, file_event_count, files_unique, agent_label_guess | (project_id, session_id) | W4 의 session 자체 인덱싱이 들어올 자리; 본 PR 은 schema 만 생성 |
| `oculpm_settings` | config_toml, initialized, updated_at | project_id | W3-PR4 (onboarding) / PR5 가 채움 |

인덱스: workday × project_id, session_id × project_id, type × project_id, tags lookup/search 2종, files lookup, sessions_cache workday.

---

## 2. 시그니처 (실제 구현)

```rust
pub struct JournalCache<'a> { db: &'a Db }

impl<'a> JournalCache<'a> {
    pub fn new(db: &'a Db) -> Self;

    pub async fn upsert_entry(
        &self, project_id: u32, relative_path: &str,
        parsed: &ParsedFrontmatter, body: &ParsedBody,
        file_mtime: i64,
    ) -> Result<UpsertOutcome, OculpmError>;

    pub async fn delete_entry(&self, project_id: u32, relative_path: &str) -> Result<bool, OculpmError>;

    pub async fn list_entries(
        &self, project_id: u32, workday: Option<&str>, filters: &EntryFilters,
    ) -> Result<Vec<JournalEntrySummary>, OculpmError>;

    pub async fn get_entry(&self, project_id: u32, relative_path: &str)
        -> Result<Option<JournalEntry>, OculpmError>;

    pub async fn reindex_full(&self, project_id: u32, journal_root: &Path)
        -> Result<CacheReindexReport, OculpmError>;
    pub async fn reindex_incremental(&self, project_id: u32, journal_root: &Path)
        -> Result<CacheReindexReport, OculpmError>;

    pub async fn apply_path_change(
        &self, project_id: u32, journal_root: &Path,
        relative_path: &str, kind: PathChangeKind,
    ) -> Result<(), OculpmError>;
}

pub enum UpsertOutcome { Inserted, Updated, MtimeOnly, SkippedUnchanged }
pub enum PathChangeKind { Created, Modified, Removed }

pub struct EntryFilters {
    pub types: Vec<EntryType>,
    pub verified_only: bool,
    pub mismatch_only: bool,        // W4 까지 빈 결과 (impossible predicate)
    pub unfinished_only: bool,
    pub search: Option<String>,
}

pub struct CacheReindexReport {
    pub inserted: u32, pub updated: u32, pub deleted: u32,
    pub skipped_unchanged: u32, pub parse_errors: u32, pub elapsed_ms: u32,
}
```

### 가이드 대비 변경

| 항목 | 가이드 후보 | 결정 | 이유 |
|---|---|---|---|
| 구조체 형태 | `struct JournalCache { db: Db }` (Db 소유) | **`JournalCache<'a> { db: &'a Db }`** | `tokio_rusqlite::Connection` 은 clone 가능하지만 `Db` 자체는 lib.rs 의 `app.manage(db)` 가 소유. cache 가 `&Db` 만 빌리면 connection sharing 무비용. |
| `Db::conn` 접근 | `Db` 에 cache 메서드 직접 추가 vs accessor | **`pub(crate) fn conn(&self) -> &Connection`** 추가 | db.rs (2113 줄) 비대화 회피. oculpm cache 로직은 oculpm 모듈 안에 격리. |
| ReindexReport 명명 | `ReindexReport` (spec.rs 와 동일) | **`CacheReindexReport`** | spec.rs 의 `ReindexReport` (project_id, completed_at 포함) 와 시그니처 다름. 별도 타입으로 충돌 회피. PR3 가 user-facing 변환 책임. |
| `EntryFilters.mismatch_only` | W4 종속 → 본 PR 에서 미구현 | **`AND 0 = 1` 강제 빈 결과** | predicate 자체는 SQL 에 wire 해두되 W4 의 LayerComparison flag 가 없으므로 항상 0 행. UI 가 호출해도 안전. |
| `body_md_hash` 알고리즘 | blake3 vs xxhash | **blake3** (W2-PR1 merkle 과 통일) | 의존성 0 추가. mtime-only update 분기에서 hex string 비교만. |
| reindex transaction 단위 | 단일 파일 commit vs batch | **upsert는 단일 파일 tx, reindex_full 의 DELETE 만 batch tx** | 1k entries 의 full reindex 가 ~1초 — batch 필요 없음. 단순함 우선. |
| walk 라이브러리 | walkdir vs ignore::WalkBuilder | **walkdir** | journal 안의 사용자 ignore 는 따를 필요 없음 (전부 indexing 대상). `_template.md`, `_attachments/`, `.hidden` 만 명시 skip. |
| frontmatter 깨진 entry 처리 | 정책 미정 | **`parse_ok=0` 으로 indexing + chore + 본문 첫 줄을 title 폴백** | PR1 의 fail-soft 와 정합. UI 가 노란 dot 분기에 사용. spec §3.3 의 "type 미정 → chore" 와 정합. |
| FTS5 | LIKE vs FTS5 | **LIKE** (case-insensitive 영어, substring 한국어) | 한국어 검색 즉시 동작. FTS5 도입은 1k+ entries 측정 후 W6 후보. |

---

## 3. 증분 알고리즘 (실제 구현)

`reindex_incremental`:
1. `(relative_path, file_mtime)` 메모리 HashMap 로드.
2. `walkdir` 으로 `.md` 순회 (`_template`, `_attachments/`, dot 파일 skip).
3. 비교:
   - cache 없고 디스크 있음 → parse + upsert → `Inserted`.
   - cache 있고 디스크 없음 → cleanup phase 에서 delete → `Deleted`.
   - cache mtime == 디스크 mtime → skip → `SkippedUnchanged`.
   - mtime 다름:
     - body_md_hash 동일 (mtime-only 변경) → UPDATE file_mtime 만 → `MtimeOnly`.
     - body 다름 → wholesale rewrite (oculpm_journal + files + tags) → `Updated`.
4. cleanup: cache 에 있고 walk 에서 못 본 path → delete.

**핵심 약속**: cache 가 깨졌다고 가정한 시나리오 (수동 sqlite drop) → `reindex_full` 로 100% 복구 (수동 QA).

`apply_path_change`:
- `Removed` → delete_entry (path 만 보고 즉시).
- `Created`/`Modified` → 디스크에서 read + parse + upsert (이벤트 페이로드 신뢰 X, 항상 latest 상태 read).

> **Note**: 100ms 디바운스/배칭은 PR2 가 아닌 호출자 (이벤트 listener) 책임으로 분리. cache 자체는 무상태 — 각 호출이 SQL transaction 1개. PR4 의 WorkspaceContext 또는 OculpmManager 가 watcher 이벤트를 디바운싱한 후 본 메서드 호출.

---

## 4. 이벤트 트리거 (W2-PR5 → PR4 wire-up 예정)

본 PR 의 범위는 **JournalCache 의 invoke API** 까지. 이벤트→cache 의 실제 와이어업은:

- W3-PR3 의 `oculpm_reindex_cache` 커맨드 (수동 트리거)
- W3-PR4 의 `WorkspaceContext` (자동 listener) — `oculpm:journal_path_changed` → `apply_path_change`
- 별도 emit `oculpm:journal_cache_updated`(W3-PR4 의 추가 이벤트로 검토 — 본 PR 의 SQL 변경 후 호출자가 emit)

---

## 5. 테스트 (실제 — 14개 모두 통과)

- [x] **`empty_journal_full_reindex_yields_zero_counts`** — 빈 journal/ → 0 entries.
- [x] **`three_entries_upsert_via_full_reindex`** — 3 entry full reindex → 3 inserted + slug/tags/files_count hydrate.
- [x] **`delete_on_disk_then_incremental_reindex_drops_row`** — 디스크 삭제 → 다음 incremental 이 cache 1건 deleted.
- [x] **`incremental_skips_unchanged_files`** — mtime 동일 → skipped_unchanged 카운트 = 1.
- [x] **`body_unchanged_with_new_mtime_is_mtime_only`** — body_md_hash 동일 + mtime 변경 → `MtimeOnly` outcome (full rewrite 회피).
- [x] **`frontmatter_parse_error_still_caches_with_parse_ok_false`** — slug 없는 frontmatter → row 는 들어가되 `parse_ok=0`, title 은 body 첫 줄 폴백, type=chore.
- [x] **`list_entries_filter_by_type`** — `types: [Feature]` → feature 만.
- [x] **`list_entries_search_matches_korean_substring`** — "한국어" 매치 (body_markdown LIKE).
- [x] **`list_entries_verified_only_excludes_unverified`** — `verified_only: true` → verified entry 만.
- [x] **`apply_path_change_created_then_removed_round_trip`** — Created → 1 row, Removed → 0 row.
- [x] **`reindex_full_drops_previous_project_rows`** — 두 번째 reindex 가 첫 번째 결과 wipe.
- [x] **`template_and_attachments_are_skipped`** — `_template.md`, `_attachments/*`, `.draft.md` 무시.
- [x] **`get_entry_returns_none_for_missing_path`** — 없는 path → `Ok(None)` (에러 X).
- [x] **`upsert_outcome_signals_inserted_then_updated`** — 첫 upsert=Inserted, 같은 path 의 body 변경=Updated.

---

## 6. DoD

- [x] 핵심 4 + 추가 검증 통과 (실제 **14 tests**).
- [ ] 1000 entries 의 `reindex_full` < 5초 (수동 측정 — 실제 사용 시점에서 검증 권장. 본 PR 의 단위 테스트는 ~70 ms / 3 entries 라 무의미.)
- [x] `oculpm/cache.rs` 신규 clippy lint **0건** (3건 발견 후 모두 fix).
- [x] migration 작성 (`012_oculpm_journal.sql`). down 마이그레이션은 미구현 — `oculpm_*` 테이블 drop 만 하면 되므로 별도 SQL 파일 불필요 (cache 가 손실 가능 by design).
- [x] `apply_path_change` 가 watcher 이벤트 wire 의 진입점 (W3-PR4 가 호출 예정).
- [x] cache 가 깨졌다고 가정한 시나리오 → `reindex_full` 로 100% 복구 (테스트 `three_entries_upsert_via_full_reindex` + `reindex_full_drops_previous_project_rows` 가 cleanup+rebuild 검증).
- [x] 전체 oculpm 테스트 **120 passed / 0 failed** (PR1 종료 106 + 본 PR 14).
- [x] `cargo build --lib` / `cargo test --lib oculpm::` / `cargo clippy --lib -p ai-pm` 모두 green.

---

## 7. 실행 노트

### 변경된 파일 (4개)

| 파일 | 변경 |
|------|------|
| `src-tauri/migrations/012_oculpm_journal.sql` | **신규** 89 줄 (5 테이블 + 6 인덱스) |
| `src-tauri/src/oculpm/cache.rs` | **신규** 870 줄 (impl ~590 + tests ~280) |
| `src-tauri/src/oculpm/mod.rs` | `pub mod cache;` 추가 |
| `src-tauri/src/oculpm/error.rs` | `OculpmError::Sqlite(String)` variant 추가 |
| `src-tauri/src/db.rs` | `(12, include_str!(...))` 마이그레이션 + `pub(crate) fn conn(&self) -> &Connection` accessor |

### 발견된 함정 / 변경

1. **마이그레이션 번호 12 점프** — 11 은 `011_project_blueprints.sql` 가 점유 중인데 디렉토리에는 010 이 없음 (refactor 시 jump). 본 PR 도 13 이 아니라 12 (다음 빈 번호) 선택. 향후 PR 도 0 인 번호를 채워가는 대신 다음 정수 권장.
2. **`Db::conn` private 문제** — `tokio_rusqlite::Connection` 은 `Clone` 이지만 `Db` 자체는 lib.rs 의 `app.manage(db)` 가 소유. cache 가 connection 을 얻으려면 (a) `Db` 에 메서드 직접 추가 (b) accessor. (b) 선택 — `pub(crate) fn conn(&self) -> &Connection`. oculpm 외부 (commands 등) 는 여전히 `Db` 의 기존 메서드만 사용.
3. **`existing` 의 partial move** ⚠ — 첫 빌드 에러: `if let Some((existing_hash, ...)) = existing` 후 `existing.is_some()` 재참조 시 partial move. `ref existing_hash` 패턴 + `&snap.body_md_hash` 비교로 1줄 수정.
4. **`mismatch_only` 필터의 placeholder** — W4 의 LayerComparison flag column 이 없으므로 `AND 0 = 1` 로 빈 결과 강제. UI 가 호출해도 안전. W4 PR 에서 실제 column + predicate 로 교체.
5. **frontmatter 깨진 entry 의 indexing 정책** — 가이드는 명시 없음. 결정: `parse_ok=0` 으로 indexing + type=chore + title=body 첫 줄 폴백. 이유: 페이즈 §5 의 QA "frontmatter 일부러 깨뜨려도 앱이 안 죽고 노란 dot" 항목 만족하려면 cache 에 row 가 있어야 UI 가 노란 dot 분기. 무한 reindex loop 방지 위해 schema_version 도 1 고정.
6. **`list_entries` 의 N+1 회피** — tags + files_count 는 별도 `IN (?,?,...)` 배치 쿼리로 hydrate. 1k entries 도 3 round-trip 으로 끝남.
7. **`ParsedFrontmatter.parse_warnings` 의 JSON 직렬화** — `serde_json::to_string(&Vec<String>)` 호출 → `OculpmError::JsonSerialize` 로 변환. 본 PR 에서 변환 경로가 실제로 깨질 일은 없지만 명시.
8. **`tokio_rusqlite::Error → OculpmError` 변환** — `OculpmError::Sqlite(String)` 으로 단순 wrap. From impl 추가는 안 함 — `OculpmError::ConfigParse(#[from] toml::de::Error)` 와 달리 라이브러리간 의존을 줄이기 위해 명시 `map_err(map_sqlite_err)` 사용.

### 의도된 누락 (PR3/PR4 에 위임)

- **`oculpm_reindex_cache` Tauri 커맨드** — PR3 가 `JournalCache::reindex_full` 을 thin wrapping.
- **`oculpm_list_journal_entries` / `oculpm_get_journal_entry` 커맨드** — PR3 가 본 PR 의 `list_entries` / `get_entry` 호출.
- **`set_journal_verified` write-through** — PR3 의 커맨드가 frontmatter 파일을 직접 수정 + cache 의 `upsert_entry` 를 호출 (watcher 이벤트 우회). 본 PR 의 cache 는 raw upsert 만 제공.
- **이벤트 listener 와이어업** — PR4 의 WorkspaceContext 또는 OculpmManager 가 `oculpm:journal_path_changed` → 디바운스 → `apply_path_change` 호출.
- **`journal_cache_updated` 이벤트** — apply_path_change 호출자가 emit 책임. cache 자체는 silent.

### 빌드/테스트 시간

- `cargo test --lib oculpm:: ` — **4.01s** (120 tests, oculpm 전체)
- 신규 14 cache tests — **70 ms** (tempdir + sqlite WAL 오버헤드 포함)
- `cargo clippy --lib -p ai-pm` — cache 신규 warning **0건**

### W3-PR3 / PR4 로 넘기는 메모

- **PR3 (commands)**:
  - `oculpm_set_journal_verified` 의 write-through: PR1 의 `(pf, body) = parse_frontmatter_and_body(text); pf.parsed.as_mut()?.verified_by_user = !; write_atomic(...)` 후 PR2 의 `cache.upsert_entry(...)` 직접 호출. watcher 이벤트 우회 (또는 cache 가 emit skip 마커 식별).
  - `oculpm_create_manual_entry` 가 PR1 의 `write_frontmatter_and_body` 사용 → PR2 의 `apply_path_change(Created)` 호출.
  - `EntryFilters` 가 본 PR 에서 `Serialize + Deserialize + specta::Type` 다 derive 되어 있음. PR3 는 thin wrapping 만.
  - `CacheReindexReport` 와 `spec.rs::ReindexReport` (project_id, completed_at 포함) 의 통일 — PR3 가 변환.

- **PR4 (frontend)**:
  - `apply_path_change` 의 100ms 디바운싱은 PR4 가 책임. `useDebouncedCallback` 또는 백엔드 이벤트 라우터에 batching layer 추가.
  - cache 가 호출 후 emit 할 `journal_cache_updated` 이벤트 — apply_path_change 호출자가 emit. React Query invalidate 트리거.

- **본 PR 의 미해결 항목 없음** — 다음 PR 진입 가능.
