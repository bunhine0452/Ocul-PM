# 백엔드 (Rust / Tauri) 구현 계획

> 참조: [`00-spec.md`](./00-spec.md) — 모든 데이터 모양은 스펙을 따른다.
> 대상 코드: `src-tauri/`

---

## 1. 신규 모듈 구조

```
src-tauri/src/
├── commands/
│   ├── mod.rs                # + pub mod oculpm;  + pub use oculpm::*;
│   └── oculpm.rs             # Tauri 커맨드 (얇은 어댑터, 실제 로직은 oculpm/ 모듈로 위임)
└── oculpm/                   # 신규 모듈 트리
    ├── mod.rs
    ├── spec.rs               # frontmatter / sessions / file_changes 타입 (serde + specta)
    ├── paths.rs              # 디렉토리 계산 (workday boundary 포함)
    ├── config.rs             # config.toml 읽기/쓰기/기본값
    ├── lock.rs               # .lock 프로토콜 (acquire / heartbeat / release / recover)
    ├── atomic_io.rs          # write_atomic, append_atomic, managed_block_update
    ├── slugify.rs            # 한글/공백 → ASCII kebab-case
    ├── frontmatter.rs        # YAML frontmatter 파싱/직렬화 (gray_matter 또는 직접 구현)
    ├── markdown.rs           # 본문 파싱 (체크박스 추출, 섹션 카운트)
    ├── journal.rs            # journal/ 읽기 (LLM 작성). 앱은 마이그레이션 외에 쓰지 않는다.
    ├── index.rs              # index/ 쓰기 (projects.json, sessions.json, snapshots, ndjson)
    ├── session.rs            # 세션 상태 머신 (Idle ↔ Active ↔ Closing)
    ├── watcher.rs            # notify 기반 파일 워처 + debounce + ignore
    ├── redact.rs             # auto_redact_patterns 적용
    ├── agents.rs             # 어댑터 sync (4종) + 감지
    ├── integrity.rs          # 앱 시작 시 검증
    ├── cache.rs              # SQLite 캐시 (journal 인덱스 read-side, 손실 가능)
    ├── migrate_from_sqlite.rs # 기존 changelog_entries → journal/*.md 일회성 변환
    ├── schema_migrate.rs     # .oculpm/ schema_version 1 → N 마이그레이션
    └── error.rs              # OculpmError (thiserror)
```

**책임 분리 원칙**:
- `commands/oculpm.rs` = Tauri 입출력 + 권한/세션 락 + 에러 변환 only. 비즈니스 로직 X.
- `oculpm/*.rs` = 순수 함수 또는 명확한 부수효과 함수. 단위 테스트 가능.
- 파일시스템 접근은 `atomic_io` 와 `lock` 을 통해서만.

---

## 2. Cargo 의존성 추가

`src-tauri/Cargo.toml` `[dependencies]` 에 추가:

```toml
notify = "6.1"                              # 파일 워처
notify-debouncer-full = "0.3"               # debounce wrapper
serde_yaml = "0.9"                          # frontmatter
gray_matter = { version = "0.2", default-features = false, features = ["yaml"] }  # 또는 직접 구현
pulldown-cmark = { version = "0.10", default-features = false }                   # 본문 헤더/체크박스 검증
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.8"
slug = "0.1"                                # 기본 slugify (한글은 별도 변환 후 투입)
fs2 = "0.4"                                 # advisory file lock (보조)
toml = "0.8"                                # config.toml
```

이미 있는 것들 (`ignore`, `walkdir`, `blake3`, `tokio-rusqlite`, `tauri-specta`, `thiserror`, `tracing`)은 재사용.

---

## 3. 신규 Tauri 커맨드 (전체 시그니처)

모두 `#[tauri::command]` + `#[specta::specta]`. 반환은 `Result<T, String>` (기존 컨벤션 준수).

### 3.1 초기화 / 설정

```rust
async fn oculpm_init(db: State<'_, Db>, project_id: u32) -> Result<OculpmInitReport, String>;
async fn oculpm_get_status(project_id: u32) -> Result<OculpmStatus, String>;
async fn oculpm_get_config(project_id: u32) -> Result<OculpmConfig, String>;
async fn oculpm_set_config(project_id: u32, config: OculpmConfig) -> Result<(), String>;
async fn oculpm_detect_agents(project_id: u32) -> Result<Vec<AgentDetection>, String>;
async fn oculpm_set_active_agents(project_id: u32, agent_ids: Vec<String>) -> Result<(), String>;
async fn oculpm_sync_agent_rules(project_id: u32) -> Result<AgentSyncReport, String>;
```

### 3.2 세션

```rust
async fn oculpm_get_current_session(project_id: u32) -> Result<Option<Session>, String>;
async fn oculpm_start_session_manual(project_id: u32) -> Result<Session, String>;
async fn oculpm_end_session_manual(project_id: u32, session_id: String) -> Result<Session, String>;
async fn oculpm_list_sessions(project_id: u32, workday: Option<String>) -> Result<Vec<Session>, String>;
```

### 3.3 Journal / Index 조회

```rust
async fn oculpm_list_journal_entries(project_id: u32, workday: Option<String>) -> Result<Vec<JournalEntrySummary>, String>;
async fn oculpm_get_journal_entry(project_id: u32, relative_path: String) -> Result<JournalEntry, String>;
async fn oculpm_set_journal_verified(project_id: u32, relative_path: String, verified: bool) -> Result<(), String>;
async fn oculpm_get_index_snapshot(project_id: u32, workday: String, kind: SnapshotKind) -> Result<Snapshot, String>;
async fn oculpm_get_file_changes(project_id: u32, workday: String, session_id: Option<String>) -> Result<Vec<FileChangeEvent>, String>;
```

### 3.4 검증 / 비교 (이중 레이어 핵심)

```rust
/// 한 세션의 journal entries 가 index 의 file_changes 와 정합하는지 비교.
async fn oculpm_compare_layers(project_id: u32, session_id: String) -> Result<LayerComparison, String>;
```

```rust
pub struct LayerComparison {
    pub session_id: String,
    pub index_files: Vec<String>,        // index 가 본 파일들
    pub journal_files: Vec<String>,      // journal frontmatter 가 주장하는 파일들
    pub only_in_index: Vec<String>,      // narrative 누락 의심
    pub only_in_journal: Vec<String>,    // narrative 환각 의심
    pub mismatch_severity: Severity,     // ok | warning | critical
}
```

### 3.5 마이그레이션

```rust
async fn oculpm_migration_dry_run(db: State<'_, Db>, project_id: u32) -> Result<MigrationPlan, String>;
async fn oculpm_migrate_from_sqlite(db: State<'_, Db>, project_id: u32) -> Result<MigrationReport, String>;
async fn oculpm_reindex_cache(db: State<'_, Db>, project_id: u32) -> Result<ReindexReport, String>;
```

### 3.6 워처 제어

```rust
async fn oculpm_watcher_start(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_stop(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_status(project_id: u32) -> Result<WatcherStatus, String>;
```

워처는 프로젝트 열림 시 자동 시작이 디폴트지만, 사용자가 일시중지/재개 가능.

### 3.7 이벤트 (Tauri Event 로 푸시)

`tauri::Manager::emit_to_window` 로 프론트에 push.

| Event 이름 | Payload |
|---|---|
| `oculpm:session_started` | `Session` |
| `oculpm:session_ended` | `Session` |
| `oculpm:file_changed` | `FileChangeEvent` |
| `oculpm:journal_added` | `JournalEntrySummary` |
| `oculpm:journal_updated` | `JournalEntrySummary` |
| `oculpm:integrity_warning` | `IntegrityWarning` |
| `oculpm:agent_drift` | `{ agent_id, expected_hash, actual_hash }` (어댑터가 외부 수정됨) |

---

## 4. 핵심 타입 (`oculpm/spec.rs`)

```rust
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryType { Bug, Feature, Error, Refactor, Chore }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryStatus { Planned, InProgress, Done, Abandoned }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty { Superhigh, High, Medium, Low, Verylow }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FileOp { Create, Update, Delete, Rename, Correct }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentRef {
    pub id: String,         // claude-code | cursor | antigravity | gemini-cli | manual
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileTouched {
    pub path: String,
    pub op: FileOp,
    pub bytes_added: Option<u32>,
    pub bytes_removed: Option<u32>,
    pub rename_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RelatedRef {
    pub r#ref: String,
    pub kind: String,   // blocks | blocked_by | followup | duplicate
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JournalFrontmatter {
    pub schema_version: u32,
    pub r#type: EntryType,
    pub slug: String,
    pub status: EntryStatus,
    pub difficulty: Option<Difficulty>,
    pub created_at: String,           // ISO 8601 (RFC 3339) with tz
    pub updated_at: Option<String>,
    pub session_id: String,
    pub agent: AgentRef,
    pub language: String,             // "ko" | "en"
    pub verified_by_user: bool,
    pub files_touched: Vec<FileTouched>,
    pub related: Vec<RelatedRef>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JournalEntry {
    pub relative_path: String,        // "20260522/Bugs/2055_bug_..md"
    pub frontmatter: JournalFrontmatter,
    pub title: String,                // 본문 첫 줄에서 추출
    pub checkbox: bool,               // [x] 여부
    pub body_markdown: String,
    pub byte_size: u64,
    pub mtime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Session { /* §00-spec.md §4.2 와 1:1 */ ... }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileChangeEvent { /* §00-spec.md §4.3 와 1:1 */ ... }

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Snapshot { /* §00-spec.md §4.4 */ ... }
```

`specta` 의 `Type` derive 로 TypeScript 측 (`src/types/oculpm.ts`) 이 자동 생성된다.

---

## 5. 워크데이 계산 (`oculpm/paths.rs`)

```rust
pub struct WorkdayResolver {
    tz: chrono_tz::Tz,
    day_starts_at: chrono::NaiveTime,  // 예: 03:00
}

impl WorkdayResolver {
    /// 주어진 UTC 시각이 어느 workday(YYYYMMDD)에 속하는지.
    pub fn workday_of(&self, instant: chrono::DateTime<chrono::Utc>) -> String { ... }

    /// 다음 workday boundary 시각.
    pub fn next_boundary(&self, instant: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc> { ... }

    /// `journal/<workday>/Bugs/` 같은 경로 계산.
    pub fn journal_dir(&self, root: &Path, workday: &str, category: EntryType) -> PathBuf { ... }
}
```

**단위 테스트 필수**: KST `00:00` / KST `03:00` / UTC 의 세 케이스에서 자정 직전/직후/경계 케이스를 모두 픽스.

---

## 6. 파일 워처 (`oculpm/watcher.rs`)

```rust
pub struct ProjectWatcher {
    project_id: u32,
    root: PathBuf,
    rx: tokio::sync::mpsc::UnboundedReceiver<DebouncedEvent>,
    ignore: ignore::overrides::Override,
    gitignore: ignore::gitignore::Gitignore,
    session_actor: SessionActor,
    index_writer: IndexWriter,
    app_handle: tauri::AppHandle,
}

impl ProjectWatcher {
    pub async fn run(mut self) {
        while let Some(events) = self.rx.recv().await {
            for ev in events {
                if !self.should_track(&ev.path) { continue; }
                let change = self.classify(ev).await;     // op, hash_before, hash_after
                self.session_actor.note_activity(&change).await;
                self.index_writer.append(&change).await?;
                self.app_handle.emit("oculpm:file_changed", &change)?;
            }
        }
    }

    fn should_track(&self, p: &Path) -> bool {
        // 1) config.watcher.ignore 매치 X
        // 2) respect_gitignore=true 면 gitignore 도 X
        // 3) .oculpm/ 자기 자신 X (단, .oculpm/agents/, .oculpm/journal/ 는 별도 워처로 트래킹)
    }
}
```

**해시 계산**: blake3, 4 MB 이상은 streaming. 8 MB 이상 파일은 hash 생략 + `op=update` 만 기록 (속도).

**.oculpm 내부 파일 감시 분리**:
- `agents/_template.md`, `agents/per-agent/**` → 어댑터 재동기화 트리거.
- `journal/**` → `cache.rs` 인덱스 갱신 트리거.
- `config.toml` → 워처 재시작 (ignore 패턴 변경 가능).
- `index/**` → 감시하지 않음 (자기 자신).

---

## 7. 세션 상태 머신 (`oculpm/session.rs`)

```
                    file_event
                  ┌─────────────────────┐
                  ▼                     │
        ┌──────────────┐   timeout      │
        │    Active    │────────────►   │
        │              │                │
        └──────┬───────┘                │
       app_quit│                        │
   manual_end  │                        │
boundary       ▼                        │
        ┌──────────────┐                │
        │   Closing    │   close ok     │
        │              ├──────────────► │
        └──────┬───────┘                │
               │                        │
               ▼                        │
        ┌──────────────┐  file_event    │
        │     Idle     ├────────────────┘
        └──────────────┘
```

**구현 디테일**:
- `SessionActor` = `tokio::task` 1개, MPSC 채널로 신호 받음.
- `note_activity(change)`: Idle → Active 전이 시 새 session_id 할당, `sessions.json` 갱신, snapshot_open 캡처.
- inactivity timer = `tokio::time::sleep` 한 번에 하나만. 새 활동마다 reset.
- workday boundary timer = `WorkdayResolver::next_boundary` 까지 sleep.
- app_quit hook: Tauri `RunEvent::ExitRequested` 에서 `SessionActor::shutdown().await`.

**불변식**: 한 프로젝트 = 한 SessionActor. 동시에 두 개 동작 불가 (lock 으로 보장).

---

## 8. Atomic IO (`oculpm/atomic_io.rs`)

```rust
pub async fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), OculpmError> {
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut f = tokio::fs::File::create(&tmp).await?;
    f.write_all(contents).await?;
    f.sync_all().await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

pub async fn append_ndjson(path: &Path, line: &str) -> Result<(), OculpmError> {
    // append 는 atomic rename 못 함. 대신 OS append 모드 + fsync.
    let mut f = tokio::fs::OpenOptions::new().append(true).create(true).open(path).await?;
    f.write_all(line.as_bytes()).await?;
    f.write_all(b"\n").await?;
    f.sync_data().await?;
    Ok(())
}

pub fn managed_block_update(
    file: &Path,
    block_id: &str,        // "oculpm"
    new_content: &str,
    comment_style: CommentStyle,  // Md, Hash, etc.
) -> Result<ManagedBlockResult, OculpmError> { ... }
```

`managed_block_update` 가 `<!-- oculpm:begin v1 --> ... <!-- oculpm:end -->` 패턴을 정확히 매치/교체. 한쪽만 있으면 `Err(MismatchedMarkers)`.

---

## 9. DB 캐시 테이블 (`oculpm/cache.rs`)

기존 DB (`db.rs`) 에 다음 테이블 추가. **언제든 통째로 drop 하고 `oculpm_reindex_cache` 로 재구축 가능**한 손실 가능 캐시.

```sql
CREATE TABLE IF NOT EXISTS oculpm_journal (
    project_id        INTEGER NOT NULL,
    relative_path     TEXT NOT NULL,         -- "20260522/Bugs/2055_bug_..md"
    workday           TEXT NOT NULL,         -- "20260522"
    type              TEXT NOT NULL,
    slug              TEXT NOT NULL,
    status            TEXT NOT NULL,
    difficulty        TEXT,
    title             TEXT NOT NULL,
    checkbox          INTEGER NOT NULL,
    session_id        TEXT NOT NULL,
    agent_id          TEXT NOT NULL,
    language          TEXT NOT NULL,
    verified_by_user  INTEGER NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT,
    file_mtime        TEXT NOT NULL,
    body_md           TEXT NOT NULL,
    body_md_hash      TEXT NOT NULL,
    PRIMARY KEY (project_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_oculpm_journal_workday ON oculpm_journal(project_id, workday);
CREATE INDEX IF NOT EXISTS idx_oculpm_journal_session ON oculpm_journal(project_id, session_id);

CREATE TABLE IF NOT EXISTS oculpm_journal_files (
    project_id     INTEGER NOT NULL,
    relative_path  TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    op             TEXT NOT NULL,
    bytes_added    INTEGER,
    bytes_removed  INTEGER,
    PRIMARY KEY (project_id, relative_path, file_path)
);

CREATE TABLE IF NOT EXISTS oculpm_journal_tags (
    project_id     INTEGER NOT NULL,
    relative_path  TEXT NOT NULL,
    tag            TEXT NOT NULL,
    PRIMARY KEY (project_id, relative_path, tag)
);

CREATE TABLE IF NOT EXISTS oculpm_sessions_cache (
    project_id        INTEGER NOT NULL,
    session_id        TEXT NOT NULL,
    workday           TEXT NOT NULL,
    started_at        TEXT NOT NULL,
    ended_at          TEXT,
    ended_reason      TEXT,
    file_event_count  INTEGER NOT NULL,
    files_unique      INTEGER NOT NULL,
    agent_label_guess TEXT,
    PRIMARY KEY (project_id, session_id)
);

CREATE TABLE IF NOT EXISTS oculpm_settings (
    project_id   INTEGER PRIMARY KEY,
    config_toml  TEXT NOT NULL,         -- 원본 그대로 (라운드트립 안전)
    updated_at   TEXT NOT NULL
);
```

**기존 `changelog_entries`, `file_changes`, `files` 테이블**: read-only 보존. 새 데이터 작성 코드는 `oculpm/` 로 라우팅. 사용자가 마이그레이션 완료 후 "구 데이터 삭제" 버튼을 누르면 그제서야 drop.

---

## 10. SQLite → `.oculpm/` 일회성 마이그레이션 (`oculpm/migrate_from_sqlite.rs`)

```rust
pub async fn migrate(db: &Db, project_id: u32) -> Result<MigrationReport, OculpmError> {
    // 0. dry-run: 카운트 + 충돌 검사. 사용자 컨펌 후 본 실행.
    // 1. lock 획득. 워처 정지.
    // 2. `.oculpm/.backup-pre-migration-<ts>/` 폴더에 기존 changelog 덤프 (json).
    // 3. for entry in db.list_all_changelog_entries(project_id):
    //      - workday = WorkdayResolver.workday_of(entry.created_at)
    //      - HHMM = local time
    //      - type = entry.category mapping (없으면 "chore")
    //      - slug = slugify(entry.user_intent or "untitled")
    //      - synth session_id = "migrated-<workday>-<N>" (그날 N번째)
    //      - frontmatter 채움 (`agent.id = "manual"`, `verified_by_user = true`)
    //      - 본문 = entry 의 summary + 파일 diff 요약
    //      - write_atomic
    // 4. sessions.json 합성: 그날의 changelog 들을 30분 단위로 클러스터링해 synthetic session 생성.
    // 5. cache 재구축 (oculpm_reindex_cache).
    // 6. lock release. 워처 재시작.
    // 7. report 반환 (성공/실패/스킵 카운트, 백업 경로).
}
```

**롤백**: 백업 폴더가 살아있으면 사용자 UI 에서 "마이그레이션 되돌리기" 가능 — `.oculpm/journal/` 의 `agent.id == "manual"` 이고 백업 시점 이후 mtime 인 파일을 식별해 삭제.

---

## 11. 어댑터 동기화 (`oculpm/agents.rs`)

```rust
pub struct AgentAdapter {
    pub id: &'static str,           // "claude-code"
    pub adapter_path: PathBuf,      // ".claude/CLAUDE.md"
    pub write_mode: WriteMode,      // ManagedBlock | Overwrite
    pub render: fn(&AgentContext) -> String,
}

pub fn known_adapters() -> Vec<AgentAdapter> {
    vec![
        AgentAdapter { id: "claude-code",  adapter_path: ".claude/CLAUDE.md".into(),       write_mode: ManagedBlock, render: render_claude_code },
        AgentAdapter { id: "cursor",       adapter_path: ".cursor/rules/ocul-pm.mdc".into(),write_mode: Overwrite,    render: render_cursor },
        AgentAdapter { id: "antigravity",  adapter_path: ".agent/rules/ocul-pm.md".into(),  write_mode: Overwrite,    render: render_antigravity },
        AgentAdapter { id: "gemini-cli",   adapter_path: "GEMINI.md".into(),                write_mode: ManagedBlock, render: render_gemini },
    ]
}

pub async fn sync_active(project_root: &Path, config: &OculpmConfig) -> Result<AgentSyncReport, OculpmError> {
    let template = load_template(project_root)?;
    let ctx = AgentContext { template, ... };
    for adapter in known_adapters() {
        if !config.agents.active.contains(&adapter.id.to_string()) {
            // 비활성: 관리 블록만 제거 (Overwrite 모드면 파일 삭제)
            remove_managed_block(...);
            continue;
        }
        let rendered = (adapter.render)(&ctx);
        match adapter.write_mode {
            ManagedBlock => managed_block_update(&adapter.adapter_path, "oculpm", &rendered, ...)?,
            Overwrite => write_atomic(&adapter.adapter_path, rendered.as_bytes()).await?,
        }
    }
}

pub async fn detect(project_root: &Path) -> Vec<AgentDetection> {
    // 각 어댑터 경로 + 인접 마커 (.cursor/, .claude/, .agent/, GEMINI.md) 의 존재로 추정.
    // confidence: present | likely | unknown.
}
```

**`agent_label_guess`** (sessions.json 의 필드) 추정 로직:
- 세션 진행 중 4개 어댑터 마커 파일의 mtime 을 추적.
- 가장 최근에 read 된 (가능하면 fanotify, 안 되면 mtime) 어댑터의 id 를 guess.
- 모호하면 `null`.

---

## 12. 통합 / 시작 시퀀스 (`lib.rs` 부트스트랩)

`src-tauri/src/lib.rs` 의 `run()` 함수에 다음 단계 추가:

```rust
let oculpm_state = OculpmManager::new(app.handle().clone());
app.manage(oculpm_state.clone());

// 기존 .invoke_handler 에 새 커맨드들 등록 (tauri-specta builder 갱신)
let (invoke_handler, register_events) = tauri_specta::Builder::<tauri::Wry>::new()
    .commands(tauri_specta::collect_commands![
        // 기존 ...
        crate::commands::oculpm::oculpm_init,
        crate::commands::oculpm::oculpm_get_status,
        // ... 19개 더
    ])
    .events(tauri_specta::collect_events![
        OculpmSessionStarted,
        OculpmSessionEnded,
        OculpmFileChanged,
        OculpmJournalAdded,
        OculpmJournalUpdated,
        OculpmIntegrityWarning,
        OculpmAgentDrift,
    ])
    ...
    .build()?;

// 프로젝트가 활성화 될 때 자동으로 워처 시작
// (project::open_project 가 호출될 때 oculpm_state.on_project_opened(id).await)
```

**프로젝트 open 트리거 흐름**:
1. `commands/project.rs::open_project(id)` 가 기존대로 동작.
2. 추가로 `OculpmManager::on_project_opened(id)` 호출.
3. `OculpmManager` 내부:
   - lock 획득 시도.
   - `.oculpm/` 디렉토리 부재 시 init (첫 사용자 onboarding).
   - integrity check.
   - 워처 시작.
   - 어댑터 sync.
   - 캐시 재구축 (mtime 비교로 증분).
4. 프로젝트 close → 역순.

---

## 13. 에러 모델 (`oculpm/error.rs`)

```rust
#[derive(Debug, thiserror::Error)]
pub enum OculpmError {
    #[error("io error at {path}: {source}")]
    Io { path: PathBuf, #[source] source: std::io::Error },

    #[error("config parse error: {0}")]
    Config(#[from] toml::de::Error),

    #[error("frontmatter parse error in {path}: {message}")]
    Frontmatter { path: PathBuf, message: String },

    #[error("lock held by pid {pid} (heartbeat {heartbeat_at})")]
    LockHeld { pid: u32, heartbeat_at: String },

    #[error("schema version {found} unsupported (expected {expected})")]
    SchemaVersion { found: u32, expected: u32 },

    #[error("managed block mismatch in {path}: only one of begin/end markers present")]
    ManagedBlockMismatch { path: PathBuf },

    #[error("redact failed in {path}: pattern {pattern} matched but write protected")]
    RedactFailed { path: PathBuf, pattern: String },

    // ...
}

impl OculpmError {
    pub fn into_user_string(self) -> String { /* 사용자 친화 메시지 */ }
}
```

커맨드 레이어는 `result.map_err(|e| e.into_user_string())` 로 변환해 String 반환.

---

## 14. 테스트 전략

### 14.1 단위 테스트 (`src-tauri/src/oculpm/*.rs` 안의 `#[cfg(test)] mod tests`)

| 모듈 | 핵심 케이스 |
|---|---|
| `paths.rs` | workday 계산 — KST 00:00/03:00, UTC, DST 전환일, 자정 직전 0.5초 |
| `slugify.rs` | "한글 제목" → "untitled-N"? 또는 transliteration? + ASCII clean |
| `frontmatter.rs` | 누락 필드/타입 미스매치/raw 본문 보존 round-trip |
| `markdown.rs` | 체크박스 추출, 섹션 검증, 코드블록 안의 가짜 헤더 무시 |
| `atomic_io.rs` | tmp 남기지 않음, partial write 후 crash 시 원본 보존 |
| `lock.rs` | stale 회수, heartbeat, race (스레드 2개에서 동시 acquire) |
| `session.rs` | 상태 전이 (Idle→Active→Closing→Idle), 타이머 리셋, boundary |
| `agents.rs` | managed_block insert/update/remove, 두 마커 한쪽만 있을 때 거부 |
| `redact.rs` | 패턴 매치 + UTF-8 경계 안전 |

### 14.2 통합 테스트 (`src-tauri/tests/oculpm_*.rs`)

- `tempdir::tempdir()` 위에 가짜 프로젝트 셋업 → `oculpm_init` → 가짜 파일 변경 → `oculpm_list_sessions`, `oculpm_compare_layers` 검증.
- 마이그레이션 시나리오: 기존 SQLite 에 10개 entry 미리 심고 `oculpm_migrate_from_sqlite` 실행 후 journal 카운트/파일 존재 확인.
- 다중 인스턴스 시뮬레이션: lock 점유 상태에서 새 인스턴스가 read-only 모드로 동작.

### 14.3 E2E (수동 체크리스트)

`docs/major_update/oculpm/03-rollout.md` 의 인수 조건 참조.

---

## 15. 로깅 / 관측

`tracing` 사용 (이미 의존성). 모듈별 target:
- `target: "oculpm::watcher"` — 이벤트 카운트, 무시된 파일.
- `target: "oculpm::session"` — 전이 로그.
- `target: "oculpm::agents"` — 어댑터 sync 결과.
- `target: "oculpm::migrate"` — 마이그레이션 진행률.

사용자 디버깅용: 설정에 `[debug] verbose = true` 추가하면 `oculpm.log` (`.oculpm/index/oculpm.log`) 에도 기록. rotate 10 MB × 3.

---

## 16. 작업 분해 체크리스트 (구현자 view)

`03-rollout.md` 의 페이즈와 매핑.

- [ ] **B-1** Cargo 의존성 추가 + `oculpm/` 모듈 빈 스켈레톤
- [ ] **B-2** `spec.rs` 타입 + specta 노출
- [ ] **B-3** `paths.rs` + 단위 테스트
- [ ] **B-4** `config.rs` 기본값 + 검증
- [ ] **B-5** `atomic_io.rs` + 단위 테스트
- [ ] **B-6** `lock.rs` + 단위 테스트
- [ ] **B-7** `frontmatter.rs` + `markdown.rs`
- [ ] **B-8** `index.rs` (write/read, snapshot, ndjson)
- [ ] **B-9** `session.rs` 상태 머신 + 타이머
- [ ] **B-10** `watcher.rs` notify 통합 + ignore
- [ ] **B-11** `cache.rs` SQLite 테이블 + 재인덱싱
- [ ] **B-12** `agents.rs` 4종 어댑터 렌더러 + sync
- [ ] **B-13** `redact.rs`
- [ ] **B-14** `integrity.rs`
- [ ] **B-15** `migrate_from_sqlite.rs` + dry-run
- [ ] **B-16** `commands/oculpm.rs` Tauri 커맨드 20+
- [ ] **B-17** `lib.rs` 부트스트랩 + project open/close hook
- [ ] **B-18** 통합 테스트 스위트
- [ ] **B-19** 로깅/관측 정리
