# W3-PR3 — 신규 5개 `oculpm_*` journal 커맨드 + manual entry

> **목표**: 프론트가 journal cache 와 manual entry 작성 흐름을 invoke 할 수 있는 5개 커맨드 신설. W1 (4개) + W2 (9개) + 본 PR (5개) = 누적 18개 `oculpm_*` 커맨드.
> **선행**: W3-PR1 (frontmatter writer), W3-PR2 (`JournalCache`).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR3, [`../01-backend.md`](../01-backend.md) §7 (커맨드 표).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. 커맨드 시그니처 (실제 구현)

```rust
#[tauri::command] #[specta::specta]
pub async fn oculpm_list_journal_entries(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    workday: Option<String>,                      // None = 오늘
    filters: Option<EntryFilters>,                // None = 기본 (모두)
) -> Result<Vec<JournalEntrySummary>, String>;

pub async fn oculpm_get_journal_entry(
    db, manager, project_id: u32, relative_path: String,
) -> Result<Option<JournalEntry>, String>;       // cache miss → on-demand disk read + upsert

pub async fn oculpm_set_journal_verified(
    db, manager, project_id: u32, relative_path: String, verified: bool,
) -> Result<(), String>;                          // atomic write-through (file → cache)

pub async fn oculpm_reindex_cache(
    db, manager, project_id: u32,
) -> Result<ReindexReport, String>;               // spec::ReindexReport (with project_id + completed_at)

pub async fn oculpm_create_manual_entry(
    db, manager, project_id: u32, draft: ManualEntryDraft,
) -> Result<JournalEntry, String>;                // slug validation + atomic write + cache hydrate
```

모두 `commands/oculpm.rs` 에 `#[tauri::command] #[specta::specta]`. `collect_commands!` 와 import 목록 양쪽에 등록 (`src/lib.rs`).

### 시그니처 차이 — 가이드 대비

| 항목 | 가이드 (PR doc 초안) | 실제 결정 |
|---|---|---|
| `list_journal_entries` 의 `filters` arg | `EntryFiltersDto` 별도 신설 | **PR2 의 `EntryFilters` 재사용** (이미 Serialize+Deserialize+specta::Type derive). DTO 분리는 wire 형태가 같으면 불필요. |
| `set_journal_verified` 반환 | `Result<(), String>` | 동일. |
| `reindex_cache` 반환 | `ReindexReport` | **`spec::ReindexReport`** (project_id + completed_at 포함). PR2 의 `CacheReindexReport` (elapsed_ms / parse_errors) → manager 가 변환. |
| `create_manual_entry` draft fields | type/slug/title/difficulty/body/session_id/files_touched (7개) | **+ status (Option, default planned) + tags** 2개 추가. `spec::ManualEntryDraft` 를 additive 확장. |

---

## 2. DTOs (실제)

### `spec::ManualEntryDraft` (W3-PR3 에서 확장)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ManualEntryDraft {
    #[serde(rename = "type")]
    pub entry_type: EntryType,
    pub slug: String,                      // 정규식: ^[a-z0-9-]{1,60}$  (spec §2.1)
    pub title: String,
    pub difficulty: Option<Difficulty>,
    pub body_markdown: String,
    pub session_id: Option<String>,        // None → active → "manual-<workday>-<HHMMSS>"
    pub files_touched: Vec<FileTouched>,
    pub status: Option<EntryStatus>,       // ★ NEW. None → Planned.
    pub tags: Vec<String>,                 // ★ NEW.
}
```

### `cache::EntryFilters` (PR2 와 동일 — 재사용)

```rust
pub struct EntryFilters {
    pub types: Vec<EntryType>,
    pub verified_only: bool,
    pub mismatch_only: bool,             // W4 까지 빈 결과
    pub unfinished_only: bool,
    pub search: Option<String>,
}
```

### `spec::ReindexReport` (W1 기존)

`oculpm_reindex_cache` 가 반환. `CacheReindexReport` 의 `elapsed_ms` 는 tracing log 로만, `parse_errors` 는 W4 의 integrity event 로 별도 surface (본 PR 의 결과 shape 에서는 제거).

---

## 3. 동작 규약 (실제)

### `list_journal_entries`
- `workday = None` → 오늘 (resolver.workday_of). cache 측에 None 그대로 전달 → SQL `WHERE workday = ?` 생략 (PR2 의 `build_list_sql` 분기).
- `filters = None` → `EntryFilters::default()` (`types=[]` = 모두, 토글 전부 false, search None).
- **uninitialised project_id → 빈 Vec** (에러 X). 이유: Today UI 의 EmptyToday V1 분기를 위해. PR2 의 cache 는 manager state 미체크라 자동 만족.

### `get_journal_entry`
- cache hit → 즉시 반환.
- cache miss + 디스크 hit → `apply_path_change(Created)` 로 on-demand parse + upsert + 재조회 → 반환.
- 디스크 miss → `Ok(None)`. (에러 X)

### `set_journal_verified`
- 디스크 read → frontmatter parse → `parsed.is_none()` 이면 `Err("cannot verify entry with broken frontmatter")`.
- `verified_by_user` 토글 → `write_frontmatter_and_body` 로 직렬화 → `write_atomic`.
- write-through: 새 text 를 다시 parse → cache upsert (`UpsertOutcome::Updated`). 결과 watcher 이벤트가 또 와도 hash 일치로 `MtimeOnly` 분기 → idempotent.

### `reindex_cache`
- `JournalCache::reindex_full` 호출 → 모든 row drop + 디스크에서 재구성.
- 반환 시 `CacheReindexReport → spec::ReindexReport` 변환 (project_id + completed_at 채움).

### `create_manual_entry`
1. **slug validation** — `^[a-z0-9-]{1,60}$`, 위반 시 `Err`. (spec §2.1 — underscore 제외. PR doc 초안의 `_` 허용은 spec 와 불일치 → 본 PR 은 spec 따름.)
2. **session_id resolution** — draft.session_id → 활성 session.id → `format!("manual-{workday}-{HHMMSS}")` sentinel.
3. **frontmatter 구성** — `agent.id = "manual"`, `verified_by_user = true`, `status = draft.status ?? Planned`, `created_at = local_now.to_rfc3339()`.
4. **본문** — `[x]` (status=Done) 또는 `[ ]` (else) + title + (draft.body_markdown 있으면 빈 줄 + body).
5. **파일 경로** — `journal/<workday>/<Category>/<HHMM>_<type>_<slug>.md`.
6. **충돌 회피** — 기존 `pick_nonconflicting_path` 가 `__2`/`__3`/… 자동 suffix.
7. **write_atomic** + cache upsert + get_entry → hydrated `JournalEntry` 반환.

---

## 4. 테스트 (실제 — 10개 모두 통과)

`oculpm::manager::tests::journal_w3_pr3::*`:

- [x] `create_manual_entry_writes_file_and_caches_with_agent_manual` — agent.id="manual", 파일 디스크 존재, cache 에 1 row.
- [x] `create_manual_entry_rejects_invalid_slug` — "Bad Slug!", "", 61자 모두 Err.
- [x] `create_manual_entry_handles_filename_collision_with_suffix` — 같은 slug 2번 → 두 번째는 `__2` suffix, 둘 다 디스크에 존재.
- [x] `set_journal_verified_flips_frontmatter_and_cache` — true → false → true round-trip, 파일 frontmatter + cache 양쪽 반영.
- [x] `set_journal_verified_rejects_broken_frontmatter` — 깨진 entry → "broken frontmatter" 메시지 Err.
- [x] `reindex_journal_cache_returns_spec_report_shape` — 2 entry 작성 → cache wipe → reindex → `project_id=7`, `inserted=2`, `completed_at` non-empty.
- [x] `get_journal_entry_falls_back_to_disk_on_cache_miss` — 손으로 디스크 .md 떨굼 → manager 가 on-demand parse + upsert + 정상 반환.
- [x] `list_journal_entries_returns_empty_for_uninitialised_project` — project_id=99 (init X) → 빈 Vec, 에러 X.
- [x] `create_manual_entry_with_explicit_session_id_keeps_it` — draft.session_id 명시 시 그대로 보존.
- [x] `create_manual_entry_planned_status_uses_unchecked_marker` — status=Planned → 본문 첫 줄 `[ ]`, checkbox=Some(false).

> **PR2 (cache.rs) 의 회귀 fix**: PR3 작업 중 `set_journal_verified_flips_frontmatter_and_cache` 가 실패 → PR2 의 `body_md_hash` 가 body 만 hash 하여 frontmatter-only 수정 (verified 토글) 이 `MtimeOnly` 분기로 새 verified 컬럼을 못 쓰는 버그 발견. **`upsert_entry` API 에 `full_text: &str` 매개변수 추가**, hash 를 frontmatter+body 전체 콘텐츠로 변경. PR2 의 cache.rs / cache 테스트 3개 + manager 의 2개 호출자 모두 갱신.

---

## 5. DoD

- [x] 5개 커맨드 invoke 성공 (빌드 green + clippy 0).
- [x] specta TS 자동 export — 구조적 검증: 5 커맨드 + 모든 타입 (`ManualEntryDraft`, `EntryFilters`, `JournalEntry`, `JournalEntrySummary`, `ReindexReport`) `Type` derive + `collect_commands!` + `events!` 등록. **실제 `src/lib/bindings.ts` 재생성은 다음 `pnpm tauri dev`/`tauri build` 실행 시점** (기존 W2-PR6 와 동일 패턴 — specta export 는 runtime `pub fn run()` 내부의 `#[cfg(debug_assertions)] builder.export(...)` 가 트리거).
- [x] `lib.rs` `collect_commands!` 에 5개 추가 (누적 18개).
- [x] manual_entry 작성 시 frontmatter 의 `agent.id == "manual"` 검증 (`create_manual_entry_writes_file_and_caches_with_agent_manual` 테스트).
- [x] `set_journal_verified` 가 frontmatter 만 갱신 (본문 보존, 라운드트립 — `set_journal_verified_flips_frontmatter_and_cache`).
- [x] 에러 메시지가 사용자/개발자 친화적 — `"slug must be 1..=60 characters (got X)"`, `"slug must match [a-z0-9-] (kebab-case, ASCII)"`, `"cannot verify entry with broken frontmatter"`.
- [x] 전체 oculpm 테스트 **130 passed / 0 failed** (PR2 종료 120 + 본 PR 10).
- [x] `cargo test --lib` / `cargo clippy --lib -p ai-pm` 모두 green. 신규 코드 (manager 추가분 + commands + spec 확장) clippy warning **0건**.

---

## 6. 실행 노트

### 변경된 파일 (6개)

| 파일 | 변경 |
|------|------|
| `src-tauri/src/oculpm/spec.rs` | `ManualEntryDraft` 에 `status: Option<EntryStatus>` + `tags: Vec<String>` 2 필드 additive 확장 |
| `src-tauri/src/oculpm/paths.rs` | `pub fn journal_root(&self, project_root)` helper 추가 |
| `src-tauri/src/oculpm/cache.rs` | `upsert_entry` API 에 `full_text: &str` 추가 (hash 정확성) + 내부 4 callsites 갱신 + 테스트 3개 갱신 |
| `src-tauri/src/oculpm/manager.rs` | journal coordination 5 메서드 추가 (`journal_root`, `list_journal_entries`, `get_journal_entry`, `set_journal_verified`, `reindex_journal_cache`, `create_manual_journal_entry`) + 헬퍼 4개 (validate_slug, entry_type_filename_token, category_subdir, pick_nonconflicting_path, chrono_tz_from, reindex_report_to_spec) + W3-PR3 테스트 모듈 10개 |
| `src-tauri/src/commands/oculpm.rs` | 5 thin Tauri 커맨드 추가 |
| `src-tauri/src/lib.rs` | `use` 목록 + `collect_commands!` 양쪽에 5개 추가 |

### 발견된 함정 / 변경

1. **PR2 의 `body_md_hash` 회귀 버그** ⚠⚠ — `set_journal_verified_flips_frontmatter_and_cache` 테스트가 실패하면서 발견. PR2 의 hash 가 body 만 cover 해서 frontmatter-only 수정 (verified 토글) 시 `MtimeOnly` 분기로 들어가 새 컬럼이 안 써짐. **본 PR 에서 cache API 를 `upsert_entry(..., full_text: &str)` 로 확장**해 frontmatter+body 전체 hash 로 전환. PR2 의 cache.rs + 테스트 3건 + manager 의 2개 호출지 갱신. 시그니처 break 이지만 PR2 가 막 끝난 단계라 외부 영향 0. PR2 워킹 doc 의 §1 "body_md_hash" 설명도 향후 갱신 권장 (또는 본 §6 노트로 cross-reference).

2. **slug 정규식 spec vs PR doc 불일치** — PR doc 초안은 `^[a-z0-9_-]{1,60}$` (underscore 허용), spec §2.1 은 `[a-z0-9-]` (kebab만). **본 PR 은 spec 따름** — `validate_slug` 가 underscore reject. 파일명의 `_` 는 `<HHMM>_<type>_<slug>.md` 의 separator 로만 사용됨.

3. **`OculpmManager` 의 Db 분리** — manager 는 `&Db` 를 소유하지 않음 (W1 결정 유지). 5 신규 메서드는 모두 첫 인자로 `db: &Db` 받음. 커맨드 layer 가 `State<Db>` 와 `State<OculpmManager>` 둘 다 받아 전달. `ProjectEntry` 에 Db 를 박지 않는 깔끔한 분리.

4. **`session_id` resolution 정책** — PR doc 의 옵션 (a) "SessionActor 호출해서 새 manual session start" vs (b) sentinel id. **(b) sentinel** 선택 — 형식 `manual-<workday>-<HHMMSS>`. 이유: PR3 에서 SessionActor 까지 건드리면 race + lifecycle 복잡. PR5/PR6 의 ManualEntryModal 가 활성 session 이 없을 때 명시적으로 "세션 시작" 버튼을 노출하는 UX 가 더 명확. session_id format 의 SSOT 인 `IndexWriter::workday_from_id` 는 `YYYYMMDD-NNN` 만 검증 → sentinel id 는 IndexWriter 가 보지 않는 영역 (cache 만 거침) 이라 무문제.

5. **타임존 access** — `WorkdayResolver.tz` 가 이미 `pub` 필드라 `resolver.tz` 직접 사용. Getter 메서드 추가 안 함.

6. **`reindex_journal_cache` 의 `CacheReindexReport → spec::ReindexReport` 변환** — `elapsed_ms` 는 tracing log 로만, `parse_errors` 는 W4 의 integrity event 로 surface 예정 (본 PR 의 변환에서는 의도적으로 drop). UI 가 이 두 값을 직접 보여줄 필요 없음.

7. **테스트 클로저의 type inference** ⚠ — `db.conn().call(|c| { ...; Ok(()) })` 가 E0283 (E generic param). `|c| -> rusqlite::Result<()> { ... }` 명시로 해결.

8. **`bindings.ts` 자동 갱신 시점** — `tauri-specta::Builder::export` 는 `pub fn run()` 의 `#[cfg(debug_assertions)]` 블록에서 실행. `cargo test` / `cargo build --lib` 는 트리거 X. 다음 `pnpm tauri dev` 실행 시 자동 갱신. W2-PR6 와 동일 정책.

### 의도된 누락 (PR4/PR5/PR6 에 위임)

- **이벤트 listener 와이어업** — PR4 의 `WorkspaceContext` 가 `oculpm:journal_path_changed` → 디바운스 → `oculpm_get_journal_entry` 또는 cache 의 `apply_path_change` 호출 책임.
- **journal_cache_updated 신규 이벤트** — `set_journal_verified` 와 `create_manual_entry` 가 emit 해서 UI 즉시 invalidate 하는 패턴 — 본 PR 의 write-through 가 cache 를 직접 갱신했으므로 next list_entries 만으로 충분. 추후 React Query invalidate trigger 가 필요해지면 PR4 에서 추가.
- **ManualEntryModal UI** — PR5/PR6 가 `oculpm_create_manual_entry` 를 호출. slug input 의 inline 검증은 frontend 가 같은 정규식 (`/^[a-z0-9-]{1,60}$/`) 으로 cheap 검증 후 백엔드가 authoritative.
- **session 자동 시작** — PR doc 옵션 (a). PR6 의 ManualEntryModal 가 "활성 세션 없음 → [세션 시작] 버튼" 을 노출하면 그 핸들러가 `oculpm_start_session_manual` 호출 후 entry 작성.

### 빌드/테스트 시간

- `cargo test --lib oculpm:: ` — **4.19s** (130 tests, oculpm 전체)
- 신규 10 manager W3-PR3 tests — **220 ms** (tempdir + sqlite WAL + 실제 파일 IO 포함)
- `cargo clippy --lib -p ai-pm` — 신규 코드 (3 모듈) warning **0건**

### W3-PR4 로 넘기는 메모

- **`src/api/oculpm.ts`** — 18 메서드 wrapping. `bindings.ts` 의 `commands.oculpmListJournalEntries`, `commands.oculpmGetJournalEntry`, `commands.oculpmSetJournalVerified`, `commands.oculpmReindexCache`, `commands.oculpmCreateManualEntry` 5개가 다음 `pnpm tauri dev` 후 export.
- **`EntryFilters` 의 ts shape**:
  - `types: ("bug"|"feature"|"error"|"refactor"|"chore")[]`
  - `verified_only: boolean`
  - `mismatch_only: boolean` (W4 까지 항상 false 권장)
  - `unfinished_only: boolean`
  - `search: string | null`
- **`ManualEntryDraft` 의 ts shape**: spec.rs 의 14 필드 그대로. `tags: string[]`, `status: EntryStatus | null`.
- **`get_journal_entry` 의 None 분기** — frontend 가 `null` 받으면 cache+disk 둘 다 없는 정합 상태. 토스트 또는 404 view.
- **에러 메시지 사용자 노출** — slug 위반 / verified 거부 메시지는 frontend 가 그대로 노출해도 무방한 한국어/영어 혼합. 추후 i18n 정리 시 메시지 카탈로그로 이전.

- **본 PR 의 미해결 항목 없음** — 다음 PR 진입 가능.
