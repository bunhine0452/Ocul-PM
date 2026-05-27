# W5-PR1 — `migrate_from_sqlite.rs` 핵심 알고리즘 + dry-run

> **목표**: SQLite `changelog_entries` + `changelog_files` 를 `.oculpm/journal/` 의 markdown 파일로 무손실 변환하는 알고리즘 (read-only `dry_run` + 실제 `execute`) 작성.
> **선행**: W4 전체 ✅ — 특히 `OculpmManager::sync_agents`, `JournalCache::upsert_entry`, `paths::WorkdayResolver`. W3 의 `frontmatter::write_frontmatter_and_body` + `atomic_io::write_atomic` 재사용.
> **참조**: [`../phases/W5-migration-overview.md`](../phases/W5-migration-overview.md) §W5-PR1, [`../00-spec.md`](../00-spec.md) §3 (frontmatter), §6 (journal path).
> **상태**: ⬜

---

## 1. 신규 파일 (계획)

| 파일 | 역할 |
|---|---|
| `src-tauri/src/oculpm/migrate_from_sqlite.rs` | 본 PR 의 SSOT. `dry_run` + `execute` + 보조 타입. |
| `src-tauri/src/oculpm/mod.rs` (수정) | `pub mod migrate_from_sqlite;` 추가. |

`OculpmManager` 가 메서드를 노출 (`pub async fn migrate_dry_run(...)`, `pub async fn migrate_execute(...)`) — PR3 의 Tauri 커맨드는 이 메서드를 호출.

---

## 2. 타입 (페이즈 §1 W5-PR1 그대로)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationPlan {
    pub project_id: u32,
    pub source_entry_count: u32,
    pub by_workday: Vec<MigrationWorkdayPlan>,
    pub conflicts: Vec<MigrationConflict>,
    pub backup_dir: PathBuf,
    pub forbidden_path_hits: u32,
    pub estimated_bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationWorkdayPlan {
    pub workday: String,
    pub synthetic_session_count: u32,
    pub entries: Vec<MigrationEntryPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationEntryPlan {
    pub source_entry_id: u32,
    pub target_relative_path: String,
    pub type_inferred: EntryType,
    pub slug: String,
    pub session_id: String,
    pub forbidden_files: Vec<String>,   // 이 entry 의 files 중 forbid 매치
    pub will_skip: bool,                // 사용자가 confirm 후의 final flag
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationConflict {
    pub source_entry_id: u32,
    pub conflicting_target_path: String,
    pub resolution: ConflictResolution,  // SuffixAdded | Skipped
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
pub enum ConflictResolution { SuffixAdded, Skipped }

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationReport {
    pub success_count: u32,
    pub skipped_count: u32,
    pub failed: Vec<MigrationFailure>,
    pub backup_dir: PathBuf,
    pub written_paths: Vec<String>,     // PR2 rollback 의 입력
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MigrationFailure {
    pub source_entry_id: u32,
    pub target_relative_path: String,
    pub reason: String,
}
```

`source_entry_count` / `by_workday` 분리: UI 가 step 1 요약에서 합계 표시 + step 2 옵션에서 entry 별 토글 모두 지원.

---

## 3. 알고리즘 — `dry_run`

```rust
pub async fn dry_run(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    config: &OculpmConfig,
) -> Result<MigrationPlan, OculpmError>;
```

1. SQLite `changelog_entries WHERE project_id = ?` 전체 fetch (정렬: `created_at ASC`). 각 entry 의 `changelog_files` 도 join 으로 같이.
2. 빈 결과 → 즉시 `MigrationPlan::empty(...)` 반환 (모달이 "마이그레이션할 entry 없음" 표시).
3. 각 entry 처리:
   - `workday = resolver.workday_of_unix(entry.created_at)` — `paths::workday_of` 재사용 (timezone + day_starts_at 반영).
   - `hhmm = resolver.hhmm_of_unix(entry.created_at)` — `paths::hhmm_of` 신설 또는 inline.
   - `type_inferred`:
     - `entry.category` 가 enum 매치 (`feature` | `bug` | `refactor` | `docs` | `test` | `chore`) 이면 그대로 (docs/test 는 `chore` 로 폴드).
     - 매치 실패 시 §2.2 의 키워드 휴리스틱 (fix → bug, feat/add → feature, refactor/리팩 → refactor, 그 외 → chore).
   - `slug = slugify(entry.user_intent | entry.title | entry.ai_summary.first_line)` — 40자 cap, kebab-case ASCII.
   - `target_relative_path = format!("{workday}/{TypeFolder}/{hhmm}_{type}_{slug}.md")`.
   - **충돌 검사**: 같은 plan 안 + 디스크 (`journal_root.join(target).exists()`) 모두. 충돌 시 `slug__2`, `__3` 까지 시도 → 그 이후엔 `MigrationConflict { resolution: Skipped }` + `will_skip = true`.
   - **forbidden 검사**: `entry.changelog_files[].file_path` 중 `is_forbidden_path(p, &config.git.forbid_journal_for_paths)` 매치된 path 들을 `forbidden_files` 에 모음. 1개라도 있으면 `will_skip = true` 디폴트 (UI 가 사용자에게 unchecked 로 표시).
4. workday 별 그룹핑 → 30분 클러스터로 synthetic session 생성 (§4 알고리즘).
5. `backup_dir = root.join(format!(".oculpm.backup-pre-migration-{}", iso_utc_now()))` — 폴더는 아직 생성 X (`execute` 가 생성).
6. `estimated_bytes_written = entries.map(|e| e.body_len() + 800).sum()` — 800 = frontmatter + 마진 추정.
7. `MigrationPlan` 반환.

**디스크 변경 0** 보장 — `dry_run` 호출 후 `git status` 가 clean 이어야 함 (테스트로 강제).

---

## 4. synthetic session 클러스터링 (페이즈 §2.1)

```rust
fn cluster_sessions(entries: &[Entry], workday: &str) -> Vec<SyntheticSession>;
```

- 같은 workday 의 entries 를 `created_at ASC` 정렬.
- 인접 두 entry 의 시간 차가 **30분 초과**면 새 session.
- 한 session 의 `started_at = entries[0].created_at`, `ended_at = entries[-1].created_at`.
- session_id = `format!("migrated-{workday}-{:03}", idx + 1)` (1부터).

→ `execute` 가 `.oculpm/index/{workday}/sessions.ndjson` 에 이 synthetic sessions 를 append (W2 의 `IndexWriter::upsert_session` 재사용, `agent_label_guess = "migrated"`, `ended_reason = SyntheticMigrated` 신규 enum 값).

대안 (단일 session-per-day) 은 W3 TimelineView 의 SessionCard 가 의미를 잃어서 reject.

---

## 5. 알고리즘 — `execute`

```rust
pub async fn execute(
    db: &Db,
    project_id: u32,
    root: &Path,
    resolver: &WorkdayResolver,
    config: &OculpmConfig,
    plan: MigrationPlan,
    progress: Option<tokio::sync::mpsc::Sender<MigrationProgress>>,
) -> Result<MigrationReport, OculpmError>;
```

1. **lock 재확인** — `LockGuard::acquire(root)?`. 이미 보유 중이면 borrow.
2. **워처 일시정지** — `manager.watcher_stop(project_id)`. `execute` 종료 (성공/실패 모두) 후 `watcher_start` 재호출.
3. **백업 디렉토리** — `fs::create_dir_all(&plan.backup_dir)?` + 다음을 덤프:
   - `backup_dir/changelog_entries.json` — `serde_json::to_writer_pretty(...)`.
   - `backup_dir/changelog_files.json`.
   - `backup_dir/manifest.json` — 빈 배열로 시작. 각 entry write 후 append.
4. **for each workday in plan.by_workday**:
   - `ensure_workday_dirs(root, workday)` (W2 `paths` 헬퍼).
   - 그 workday 의 synthetic sessions 를 `index/{workday}/sessions.ndjson` 에 append.
   - for entry in workday.entries (`will_skip == false`):
     - frontmatter 합성:
       - `schema_version: 1`, `type: type_inferred`, `slug`, `status: "done"`, `difficulty: None`,
       - `created_at: rfc3339(entry.created_at, resolver.tz)`,
       - `session_id: synthetic_session_id`,
       - `agent: { id: entry.external_tool.unwrap_or("manual"), version: None }`,
       - `language: "ko"`,
       - `verified_by_user: true` (사용자가 과거에 직접 만든 entry 이므로),
       - `files_touched: forbidden 제외한 changelog_files 의 path + op` (op 매핑: `created → "add" | modified → "update" | deleted → "delete" | renamed → "rename"`),
       - `tags: []`.
     - body 합성 (markdown):
       - 첫 줄 `[x] {entry.title | user_intent}`.
       - `## 변경 요약` — `entry.ai_summary` 그대로.
       - `## 파일 변경` — `entry.changelog_files` 의 path + per_file_summary 표.
       - body 64KB cap (페이즈 §5 함정) — 초과 시 truncate + tags 에 `body-truncated` 추가.
     - `write_atomic(target_abs, content.as_bytes())?`.
     - manifest.json append (한 줄, atomic): `{ "source_entry_id": ..., "target_relative_path": ..., "written_at": "..." }`.
     - `progress.send(MigrationProgress { processed: n, total: m, current_entry: &slug })?` (Some 일 때).
     - report.success_count += 1, report.written_paths.push(rel).
5. **cache 자동 reindex** — `manager.reindex_journal_cache_incremental(db, project_id).await?` — W3 의 mtime 키 증분.
6. **워처 재시작**.
7. `MigrationReport` 반환.

**panic / 에러 시 동작**: `execute` 가 어느 단계에서든 Err 를 반환하면 PR3 의 커맨드가 자동으로 PR2 의 `rollback(backup_dir)` 호출. `execute` 자체는 partial state 정리 책임 없음 — manifest.json 이 SSOT.

---

## 6. type 추론 (페이즈 §2.2)

```rust
fn infer_type(category: Option<&str>, user_intent: &str) -> EntryType;
```

| input | output |
|---|---|
| `Some("feature" | "feat")` | `EntryType::Feature` |
| `Some("bug" | "fix")` | `EntryType::Bug` |
| `Some("error")` | `EntryType::Error` |
| `Some("refactor" | "refac")` | `EntryType::Refactor` |
| `Some("docs" | "doc" | "test" | "chore")` | `EntryType::Chore` |
| `None` + user_intent 키워드 매치 | 위 매핑과 동일 |
| 모두 실패 | `EntryType::Chore` (안전 기본값) |

키워드 (대소문자 무시): `fix`, `버그`, `오류`, `에러` → `bug`. `feat`, `add`, `기능`, `추가` → `feature`. `refactor`, `리팩` → `refactor`. 휴리스틱 결과는 모달의 step 2 에서 사용자가 수정 가능 (필드 추가는 W5-PR4 의 옵션).

---

## 7. 테스트 (계획)

페이즈 §3 의 매트릭스: `dry_run` 6 + `execute` 5 + 충돌/forbidden 4 = 15개 단위.

### `dry_run` (`oculpm::migrate_from_sqlite::tests`)

- [ ] `dry_run_yields_zero_for_empty_changelog` — entries 0개 → plan 의 카운트 0.
- [ ] `dry_run_counts_match_source_entry_count` — 30 entries 시드 → `source_entry_count == 30`.
- [ ] `dry_run_clusters_30min_gaps_into_separate_sessions` — 인접 entries 가 31분 차이 → 2 session.
- [ ] `dry_run_assigns_workdays_via_resolver` — entries 가 day_starts_at 경계 양쪽이면 다른 workday.
- [ ] `dry_run_does_not_touch_disk` — 호출 전후 `journal_root` 의 `walkdir.count()` 동일.
- [ ] `dry_run_infers_type_from_category_then_keywords` — category 매핑 + 휴리스틱 둘 다 검증.

### `execute` (`oculpm::migrate_from_sqlite::tests`)

- [ ] `execute_writes_target_files_with_synthetic_sessions` — 5 entries → 5 .md 파일 + sessions.ndjson 1줄.
- [ ] `execute_backs_up_sqlite_dumps_before_writing` — `backup_dir/changelog_entries.json` 존재 + 카운트 일치.
- [ ] `execute_appends_manifest_per_entry_write` — 5 entries → manifest.json 5줄.
- [ ] `execute_triggers_incremental_reindex` — execute 후 `oculpm_journal` 캐시 행 5개.
- [ ] `execute_skips_will_skip_entries` — plan 의 will_skip=true 인 entry 는 write 안 됨.

### 충돌 + forbidden (`oculpm::migrate_from_sqlite::tests`)

- [ ] `dry_run_resolves_filename_collision_with_suffix` — 같은 분에 같은 slug 두 entry → 두번째가 `__2` suffix.
- [ ] `dry_run_marks_forbidden_files_for_skip` — `.env` 가 changelog_files 에 있는 entry → `will_skip=true` + `forbidden_files` 비어있지 않음.
- [ ] `execute_skips_forbidden_entries_unless_user_overrides` — 사용자가 will_skip 을 false 로 토글한 경우는 그대로 write (단 forbidden_files 는 frontmatter 의 files_touched 에서 제거).
- [ ] `execute_truncates_body_at_64kb_with_tag` — 100KB ai_summary → body 64KB + `tags: [body-truncated]`.

> 검증: `cargo test --lib oculpm::migrate_from_sqlite` — 본 PR 종료 시 15/15 PASS 목표.

---

## 8. DoD

- [ ] 15개 단위 테스트 통과 (`cargo test --lib oculpm::migrate_from_sqlite`).
- [ ] `dry_run` 이 plan 만 만들고 디스크 변경 X (`dry_run_does_not_touch_disk` 보장).
- [ ] `execute` 가 backup_dir + manifest.json 을 먼저 만든 후에만 write (PR2 rollback 의 SSOT).
- [ ] cache 자동 reindex 가 마지막 단계에 호출되어 Today 가 새 entries 즉시 표시.
- [ ] `MigrationPlan` / `MigrationReport` 가 specta export — bindings.ts 에 노출.

---

## 9. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`hhmm_of` 위치** — `paths::WorkdayResolver` 에 메서드 추가 vs 본 모듈 inline. 다른 곳도 쓸 가능성 (수동 entry workflow) 있으니 `paths` 권장.
2. **resolver TZ 가 SQLite 시점과 다를 때** — entry.created_at 은 unix epoch (TZ-agnostic). resolver 가 현재 config 의 TZ 로 해석 → 사용자가 다른 TZ 였다면 frontmatter `created_at` 가 살짝 어긋남. 모달 step 1 에 "현재 TZ: Asia/Seoul. 과거 entry 가 다른 TZ 였다면 ±1 hour 오차" 경고 1회 (페이즈 §5 함정 표).
3. **`changelog_files.diff_patch` 의 처리** — frontmatter 의 files_touched 에 op 만 넣고 patch 는 버림 (W5 의 journal 형식이 patch 를 안 들고 다님). 사용자가 git history 로 확인 가능. 모달 step 1 에 "diff 본문은 마이그레이션 후 git 으로 확인" 안내.
4. **`pinned` 처리** — `changelog_entries.pinned == 1` 이면 frontmatter `tags` 에 `pinned` 추가. Today UI 의 PinnedCard 가 이미 존재하지만 W3 TimelineView 로 옮긴 후엔 별 UI 없음 → 단순 tag 보존.
5. **resolver 의 hhmm 가 24h 의 정확성** — `paths::WorkdayResolver` 가 `day_starts_at = "03:00"` 인 사용자에게 `hhmm = "02:55"` 인 entry 를 같은 workday 로 그룹핑. OK. 단 같은 workday 안의 hhmm 정렬은 sortable string 보장 필요 (workday 가 다르면 다른 폴더이므로 정렬 충돌 없음).

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR2 의 rollback 은 본 PR 의 `manifest.json` + `backup_dir` 구조 그대로 사용.
- PR3 의 커맨드는 본 PR 의 `dry_run` / `execute` 시그니처 그대로 호출 + 진행률 channel wire-up.
- PR4 의 MigrationModal 은 `MigrationPlan.by_workday[].entries[].will_skip` 토글 + `forbidden_files` 강조.
- PR7 의 안전장치 (`MigrationReport.success_count > 0` + `reportTimestamp` db 저장) 의 저장 위치는 PR3 의 커맨드 응답 또는 `oculpm_migrations` SQLite 테이블 신설 — 본 PR 에선 결정 보류.
