# W1 — Foundation

> **목표**: `.oculpm/` 디렉토리가 생기고, lock·config·atomic IO 가 동작하며, 기존 앱은 단 하나도 안 깨진다.
> **선행 조건**: 없음. 본 페이즈가 모든 후속 작업의 기반.

---

## 0. 이 페이즈가 끝나면 보이는 그림

- 사용자가 임의의 프로젝트를 열면 루트에 `.oculpm/config.toml`, `.oculpm/.lock`, `.oculpm/.schema-version` 이 생성된다.
- `.gitignore` 에 oculpm 관리 블록이 자동 추가되어 `.oculpm/index/`, `.oculpm/.lock` 이 무시된다.
- UI 에는 아직 어떤 변경도 노출되지 않는다 (Today/Overview 그대로).
- Tauri 측에서 새 커맨드 4개가 호출 가능: `oculpm_init`, `oculpm_get_status`, `oculpm_get_config`, `oculpm_set_config`.

---

## 1. PR 분해

### W1-PR1 — Cargo 의존성 + 모듈 스켈레톤

**Files**:
- `src-tauri/Cargo.toml` (update)
- `src-tauri/src/oculpm/mod.rs` (create)
- `src-tauri/src/oculpm/spec.rs` (create, empty)
- `src-tauri/src/oculpm/paths.rs` (create, empty)
- `src-tauri/src/oculpm/config.rs` (create, empty)
- `src-tauri/src/oculpm/atomic_io.rs` (create, empty)
- `src-tauri/src/oculpm/lock.rs` (create, empty)
- `src-tauri/src/oculpm/error.rs` (create, empty)
- `src-tauri/src/commands/oculpm.rs` (create, empty)
- `src-tauri/src/commands/mod.rs` (update — `pub mod oculpm; pub use oculpm::*;`)
- `src-tauri/src/lib.rs` (update — `pub mod oculpm;`)

**마이그레이션 번호**: 본 PR 자체는 마이그레이션 SQL 을 만들지 않지만, 후속 PR (`cache.rs` 의 SQLite 캐시 테이블 — W3-PR2) 에서 추가될 마이그레이션 번호는 **`012` 부터** 시작한다. main 현재 `011_project_blueprints.sql` 까지 사용 중 ([refactor-integration §1 I-1](../refactor-integration.md)).

**Cargo.toml `[dependencies]` 에 추가**:

```toml
notify = "6.1"
notify-debouncer-full = "0.3"
serde_yaml = "0.9"
gray_matter = { version = "0.2", default-features = false, features = ["yaml"] }
pulldown-cmark = { version = "0.10", default-features = false }
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.8"
slug = "0.1"
fs2 = "0.4"
toml = "0.8"
uuid = { version = "1", features = ["v4"] }
```

**DoD**:
- [ ] `cargo check` 통과.
- [ ] `cargo clippy --all-targets -- -D warnings` 통과 (빈 모듈도).
- [ ] `pnpm tauri build` 통과.
- [ ] 새 모듈 파일은 각각 `//! TODO(W1-PRx)` 주석 한 줄만.

### W1-PR2 — `spec.rs` 핵심 타입 + specta 노출

`01-backend.md §4` 의 타입들을 그대로 옮긴다. 다음 enum/struct 전체:

`EntryType`, `EntryStatus`, `Difficulty`, `FileOp`, `AgentRef`, `FileTouched`, `RelatedRef`, `JournalFrontmatter`, `JournalEntry`, `Session`, `FileChangeEvent`, `Snapshot`, `SnapshotKind`, `LayerComparison`, `Severity`, `OculpmConfig` (와 하위), `OculpmStatus`, `OculpmInitReport`, `WatcherStatus`, `MigrationPlan`, `MigrationReport`, `ReindexReport`, `AgentDetection`, `AgentSyncReport`, `IntegrityWarning`.

**각 타입에 모두**:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
```

**Tauri 이벤트 5종도 같이 정의** (`OculpmSessionStarted`, `OculpmSessionEnded`, `OculpmFileChanged`, `OculpmJournalAdded`, `OculpmJournalUpdated`, `OculpmIntegrityWarning`, `OculpmAgentDrift`) — `#[derive(tauri_specta::Event)]` 추가.

**DoD**:
- [ ] `pnpm tauri dev` 가 한 번 돌고 `src/types/` 또는 specta 의 binding 파일에 새 타입들이 export 된다.
- [ ] TypeScript 측에서 `import type { JournalEntry } from "@/bindings"` 가 에러 없이 import 된다 (사용 안 해도 OK).

### W1-PR3 — `paths.rs` (`WorkdayResolver`) + 단위 테스트

```rust
pub struct WorkdayResolver {
    pub tz: chrono_tz::Tz,
    pub day_starts_at: chrono::NaiveTime,
}

impl WorkdayResolver {
    pub fn new(tz_name: &str, day_starts_at_hhmm: &str) -> Result<Self, OculpmError>;
    pub fn workday_of(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> String;     // "20260522"
    pub fn next_boundary(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> chrono::DateTime<chrono::Utc>;
    pub fn hhmm_of(&self, instant_utc: chrono::DateTime<chrono::Utc>) -> String;        // "2055"

    pub fn project_oculpm_dir(&self, project_root: &Path) -> PathBuf;     // {root}/.oculpm
    pub fn index_dir(&self, project_root: &Path, workday: &str) -> PathBuf;
    pub fn journal_dir(&self, project_root: &Path, workday: &str, kind: EntryType) -> PathBuf;
    pub fn lock_path(&self, project_root: &Path) -> PathBuf;
    pub fn schema_version_path(&self, project_root: &Path) -> PathBuf;
    pub fn config_path(&self, project_root: &Path) -> PathBuf;
}
```

**필수 단위 테스트 (모두 작성)**:

| 케이스 | tz | day_starts_at | 입력 UTC | 기대 workday | 기대 hhmm |
|---|---|---|---|---|---|
| 한국 평일 정오 | Asia/Seoul | 00:00 | 2026-05-22T03:00:00Z | 20260522 | 1200 |
| KST 자정 직후 | Asia/Seoul | 00:00 | 2026-05-21T15:01:00Z | 20260522 | 0001 |
| KST 자정 직전 | Asia/Seoul | 00:00 | 2026-05-21T14:59:00Z | 20260521 | 2359 |
| 야간코더 03:00 시작, 02:30 | Asia/Seoul | 03:00 | 2026-05-22T17:30:00Z | 20260522 | 0230 |
| 야간코더 03:00 시작, 03:00 | Asia/Seoul | 03:00 | 2026-05-22T18:00:00Z | 20260523 | 0300 |
| UTC 기본 | UTC | 00:00 | 2026-05-22T23:59:00Z | 20260522 | 2359 |
| UTC 자정 직후 | UTC | 00:00 | 2026-05-23T00:00:00Z | 20260523 | 0000 |
| DST 시작일 (예: America/New_York 2026-03-08) | America/New_York | 00:00 | 2026-03-08T07:00:00Z | 20260308 | 0200 (skip 1h) |
| 잘못된 tz 이름 | "Asia/Seoult" | 00:00 | — | Err | — |
| 잘못된 HH:MM | "Asia/Seoul" | "25:00" | — | Err | — |
| next_boundary @ KST 23:50 (00:00 start) | Asia/Seoul | 00:00 | 2026-05-22T14:50:00Z | next_boundary = 2026-05-22T15:00:00Z | — |
| next_boundary @ KST 03:30 (03:00 start) | Asia/Seoul | 03:00 | 2026-05-22T18:30:00Z | next_boundary = 2026-05-23T18:00:00Z | — |

**DoD**:
- [ ] 12개 케이스 모두 통과.
- [ ] `chrono_tz` 가 잘 동작 (Cargo build feature 누락 없음).

### W1-PR4 — `config.rs` 기본값 + 검증

```rust
pub struct OculpmConfig {
    pub schema_version: u32,
    pub workday: WorkdayConfig,
    pub session: SessionConfig,
    pub git: GitConfig,
    pub watcher: WatcherConfig,
    pub agents: AgentsConfig,
}

impl OculpmConfig {
    pub fn default_for_new_project() -> Self;
    pub fn load(path: &Path) -> Result<Self, OculpmError>;
    pub fn save(&self, path: &Path) -> Result<(), OculpmError>;
    pub fn validate(&self) -> Result<(), OculpmError>;
}
```

**디폴트 값**: `../README.md §0.2` 의 `forbid_journal_for_paths` 셋을 그대로 박는다. 그 외는 `00-spec.md §5` 의 값.

**validate** 내용:
- `workday.timezone` 이 `chrono_tz::Tz::iter_variants()` 에 존재.
- `workday.day_starts_at` 이 `^([01]\d|2[0-3]):([0-5]\d)$` 매치.
- `session.inactivity_timeout_minutes` ≥ 1.
- `watcher.debounce_ms` 1 ~ 10000.
- `watcher.batch_max_events` ≥ 1.
- `agents.active` 의 모든 ID 가 `["claude-code", "cursor", "antigravity", "gemini-cli"]` 의 부분집합.

**라운드트립 테스트**:
```rust
let c1 = OculpmConfig::default_for_new_project();
let path = tempdir.path().join("config.toml");
c1.save(&path)?;
let c2 = OculpmConfig::load(&path)?;
assert_eq!(c1, c2);
```

**알 수 없는 키 처리**: `toml = { version = "0.8" }` 의 `Deserialize` 는 알 수 없는 키를 무시. 우리는 명시적으로 `#[serde(deny_unknown_fields)] X` — 안 함 (forward-compat 위해). 대신 `validate` 에서 warning 만.

**DoD**:
- [ ] 라운드트립 OK.
- [ ] 잘못된 tz/시간/타임아웃 에 대해 `Err` 반환.
- [ ] 한 번도 못 본 키 (`foo = 1`) 가 있어도 `load` 가 성공.

### W1-PR5 — `atomic_io.rs` + `lock.rs` + 단위 테스트

**`atomic_io.rs`**:

```rust
pub async fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), OculpmError>;
pub async fn append_ndjson(path: &Path, line: &str) -> Result<(), OculpmError>;
pub fn read_managed_block(path: &Path, block_id: &str, comment_style: CommentStyle) -> Result<Option<ManagedBlock>, OculpmError>;
pub fn write_managed_block(path: &Path, block_id: &str, new_content: &str, comment_style: CommentStyle) -> Result<ManagedBlockResult, OculpmError>;
pub fn remove_managed_block(path: &Path, block_id: &str, comment_style: CommentStyle) -> Result<(), OculpmError>;

pub enum CommentStyle { Markdown, Hash, DoubleSlash }
pub enum ManagedBlockResult { Inserted, Updated, Unchanged }
```

**관리 블록 매처 정규식** (Markdown 예):
- begin: `<!--\s*oculpm:begin\s+v(\d+)\s*-->`
- end: `<!--\s*oculpm:end\s*-->`
- 두 토큰 사이의 모든 행이 관리 영역.
- 한쪽만 있으면 `Err(OculpmError::ManagedBlockMismatch)`. 사용자가 직접 정정.

**`lock.rs`**:

```rust
pub struct LockGuard {
    path: PathBuf,
    heartbeat_task: Option<tokio::task::JoinHandle<()>>,
}

impl LockGuard {
    pub async fn acquire(path: &Path) -> Result<LockAcquisition, OculpmError>;
    pub async fn release(self) -> Result<(), OculpmError>;
}

pub enum LockAcquisition {
    Acquired(LockGuard),
    Held { by_pid: u32, heartbeat_at: String },     // 다른 인스턴스 정상 가동
    Recovered(LockGuard, ZombieInfo),               // 좀비 회수
}
```

**heartbeat**: `tokio::task::spawn` 으로 30초마다 lock 파일을 atomic rewrite (`heartbeat_at` 만 갱신). drop 시 task abort + 파일 삭제.

**필수 단위 테스트**:
- partial write 시뮬레이션: 중간에 패닉 → 다음 read 가 원본 또는 새 내용 (둘 중 하나) 만 보임 (절반 X).
- append_ndjson 동시 호출 2개: 두 줄 모두 손실 없이 추가.
- managed_block: 마커 0개 (insert), 둘 다 (update), 한쪽만 (Err), 다중 (Err — 첫 쌍만 인정하고 나머지는 경고).
- LockGuard: acquire → acquire 두 번째는 `Held` 반환.
- stale lock: heartbeat_at 을 10분 전으로 조작한 lock 파일 → acquire 는 `Recovered`.

**DoD**:
- [ ] 모든 테스트 통과.
- [ ] `lsof` 로 누수 파일핸들 없음 (수동 확인).
- [ ] tmp 파일 (`*.tmp` suffix) 가 절대 디렉토리에 남지 않음.

### W1-PR6 — 4개 커맨드: init / get_status / get_config / set_config

`src-tauri/src/commands/oculpm.rs`:

```rust
#[tauri::command]
#[specta::specta]
pub async fn oculpm_init(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmInitReport, String> {
    let project = db.get_project(project_id).await.map_err(stringify)?;
    let root = PathBuf::from(&project.root_path);
    manager.init_project(project_id, &root).await.map_err(stringify)
}

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_status(...) -> Result<OculpmStatus, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_config(...) -> Result<OculpmConfig, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(..., new_config: OculpmConfig) -> Result<(), String>;
```

**`OculpmManager::init_project` 알고리즘**:
1. lock acquire (실패 시 그대로 에러).
2. `.oculpm/` 디렉토리 mkdir (이미 있으면 skip).
3. `.schema-version` 파일 atomic write (`1`).
4. `config.toml` 없으면 default 로 write. 있으면 load + validate.
5. `.gitignore` 에 관리 블록 추가 (read_managed_block → write_managed_block).
6. `projects.json` 의 해당 project_id 엔트리 갱신 (`last_opened_at`).
7. `OculpmInitReport { created_dirs, wrote_config: bool, wrote_gitignore: bool, lock_state }` 반환.

**`oculpm_get_status` 반환**:
```rust
pub struct OculpmStatus {
    pub initialized: bool,
    pub config_valid: bool,
    pub lock_state: LockStateView,        // healthy | held_by_other | recovered
    pub current_workday: String,
    pub watcher_state: WatcherStateView,  // running | stopped | error (W1에서는 항상 stopped)
}
```

**프론트 호출 가능 검증**: `pnpm tauri dev` 에서 DevTools 콘솔로:
```js
await window.__TAURI_INTERNALS__.invoke("oculpm_init", { projectId: 1 });
await window.__TAURI_INTERNALS__.invoke("oculpm_get_status", { projectId: 1 });
```

**DoD**:
- [ ] 4개 커맨드 호출 성공.
- [ ] `OculpmInitReport` 의 모든 필드가 채워짐.
- [ ] 두 번째 init 호출은 idempotent (디렉토리 재생성 X, config 덮어쓰기 X).

### W1-PR7 — `OculpmManager` 상태 + lib.rs 부트스트랩

```rust
pub struct OculpmManager {
    app_handle: tauri::AppHandle,
    projects: tokio::sync::RwLock<HashMap<u32, Arc<ProjectRuntime>>>,
}

pub struct ProjectRuntime {
    pub project_id: u32,
    pub root: PathBuf,
    pub config: OculpmConfig,
    pub resolver: WorkdayResolver,
    pub lock: tokio::sync::Mutex<Option<LockGuard>>,
    // W2 에서 추가될 필드들 (지금은 자리만):
    pub watcher: tokio::sync::Mutex<Option<()>>,        // TODO(W2)
    pub session_actor: tokio::sync::Mutex<Option<()>>,  // TODO(W2)
}
```

**`lib.rs` 변경**:
```rust
// 기존 .invoke_handler(...) 안에 추가:
crate::commands::oculpm::oculpm_init,
crate::commands::oculpm::oculpm_get_status,
crate::commands::oculpm::oculpm_get_config,
crate::commands::oculpm::oculpm_set_config,

// 기존 .manage(...) 라인 옆에:
.manage(OculpmManager::new(app.handle().clone()))
```

**프로젝트 open hook**: `commands/project.rs` 의 `open_project` 끝에 추가:
```rust
let oculpm = app.state::<OculpmManager>();
let _ = oculpm.on_project_opened(project_id).await;   // 실패는 로그만
```

`on_project_opened` 는 W1 에서:
1. `init_project` 와 동일한 작업 (멱등).
2. `ProjectRuntime` 을 `projects` 에 등록.
3. W2 에서 워처 시작 코드가 여기에 추가됨.

**프로젝트 close hook**: 동일하게 `close_project` (있다면) 끝에 `oculpm.on_project_closed(project_id).await`.

**DoD**:
- [ ] 프로젝트를 열면 자동으로 `.oculpm/` 생성됨 (수동 호출 없이).
- [ ] 두 윈도우에서 같은 프로젝트 열기 → 두 번째 윈도우는 `OculpmStatus.lock_state = held_by_other`.

### W1-PR8 — `.gitignore` 관리 블록 자동 작성

`OculpmManager::init_project` 안에서 `.gitignore` 갱신을 호출.

**관리 블록 본문**:
```
.oculpm/index/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
```

(주: schema-version 도 ignore 대상 — 머신마다 다를 수 있음. 마이그레이션이 끝나면 자동 갱신.)

**시나리오 테스트**:
- `.gitignore` 부재 → 새로 만들고 관리 블록만 작성.
- `.gitignore` 존재, 관리 블록 없음 → 파일 끝에 빈 줄 + 관리 블록 append.
- 관리 블록 존재 + 동일 내용 → no-op.
- 관리 블록 존재 + 내용 변경 → 갱신.
- 사용자가 관리 블록 안에 직접 추가 → 다음 sync 때 덮어쓰기. (관리 블록 안은 우리 영역 — 04-frontend Settings 에서 alert)
- 관리 블록 begin/end 한쪽만 있음 → `Err`. 토스트로 사용자에게 알림.

**DoD**:
- [ ] 5개 시나리오 모두 수동 검증.
- [ ] `git status` 가 `.oculpm/index/`, `.lock` 을 표시하지 않음.
- [ ] `git status` 가 `.oculpm/config.toml`, `.oculpm/journal/` (있을 때) 를 표시함.

---

## 2. 핵심 기술 노트

### 2.1 specta 와 enum

`#[serde(rename_all = "snake_case")]` 가 `EntryType::Refactor` 를 `"refactor"` 로 직렬화한다 — 명세서와 일치. TypeScript 측에서 `"refactor"` 리터럴이 보여야 정상.

### 2.2 chrono_tz 빌드 시간

`chrono-tz` 는 모든 IANA tz 를 컴파일에 포함하기 때문에 처음 빌드 시 1~2분 길어질 수 있다. CI 캐시에 잘 들어가는지 확인.

### 2.3 atomic rename on Windows

`tokio::fs::rename` 은 Windows 에서 `MoveFile` 을 쓰는데 대상 파일이 존재하면 실패. 우리는 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` 가 필요. `tokio::fs::rename` 의 윈도우 구현이 이미 `ReplaceFile` 를 시도하므로 대체로 OK 지만, **반드시 윈도우 manual smoke test** 한 번.

### 2.4 lock 의 advisory vs mandatory

우리는 advisory (협력적). 외부 프로세스가 무시하면 못 막는다. **그 외부 프로세스는 우리 자신의 다른 인스턴스뿐** 이므로 충분. 명시적으로 README 에 적어둘 것: "ocul-pm 외부의 도구가 `.oculpm/` 에 쓰는 것은 권장되지 않습니다."

### 2.5 ndjson append 의 한계

append 는 atomic rename 으로 못 한다. 우리는 OS append 모드 (`O_APPEND`) + fsync 로 한 줄 단위의 원자성에 기댄다. **POSIX 는 `write()` 가 PIPE_BUF 이하면 atomic, 그 이상은 아님** — ndjson 라인 길이가 4096 바이트 초과하지 않도록 캡(spec §4.3 에 추가 명시 필요 — 한 라인 4 KB 캡, 초과 시 path 단축).

→ **추가 작업**: `00-spec.md §4.3` 에 "한 라인 ≤ 4096 바이트" 를 박는 작은 PR (W1-PR0 으로 처리하거나 W1-PR8 에 끼움).

---

## 3. 단위 테스트 매트릭스 (W1 전체)

| 모듈 | 테스트 수 | 핵심 |
|---|---|---|
| `paths::workday_of` | 12 | tz boundary, DST, invalid tz |
| `paths::next_boundary` | 4 | KST 00:00, KST 03:00, UTC, day-end |
| `config::load/save` | 6 | round-trip, 알 수 없는 키, 잘못된 tz, 잘못된 hhmm, 빈 active, 너무 큰 timeout |
| `atomic_io::write_atomic` | 3 | tmp 없어짐, 부분 write 후 원본 보존, large file |
| `atomic_io::append_ndjson` | 2 | 동시 호출, 4KB 경계 |
| `atomic_io::managed_block_*` | 5 | insert/update/no-op/mismatch/multiple-blocks |
| `lock::acquire/release` | 4 | acquire/Held/Recovered/heartbeat-rewrite |

총 ~36 개 테스트. CI 시간 ≤ 60초.

---

## 4. 통합/수동 QA 체크리스트 (페이즈 종료 시)

- [ ] 신규 프로젝트 만들기 → `.oculpm/config.toml` + `.lock` + `.schema-version` 생성, `.gitignore` 관리 블록 추가
- [ ] `git status` 출력에 `.oculpm/index/` 류가 없음
- [ ] `git status` 출력에 `.oculpm/config.toml` 이 있음 (사용자가 commit 여부 결정)
- [ ] 앱 종료 → `.oculpm/.lock` 사라짐
- [ ] 앱 강제 종료 (Activity Monitor) → `.lock` 남아있음. 다시 켜면 stale 회수, 정상 동작
- [ ] 두 윈도우에서 같은 프로젝트: 둘째 윈도우 read-only 모드 표시 (W4 까지는 단지 status 만)
- [ ] DevTools 에서 `invoke("oculpm_get_status", ...)` → 모든 필드 표시
- [ ] `config.toml` 을 직접 잘못된 tz 로 편집하고 앱 재시작 → 사용자에게 에러 노출 (UI 변경은 W4 까지 미루므로 콘솔/로그 OK)
- [ ] 기존 changelog/today/overview/code/chat 화면 정상 동작 (회귀 X)
- [ ] `cargo test` / `cargo clippy` 통과
- [ ] macOS + (가능하면) Windows 양쪽에서 init 동작

---

## 5. 알려진 함정

| 함정 | 대응 |
|---|---|
| `.oculpm/` 가 이미 부분적으로 존재 (예: 사용자가 직접 만들어 둠) | `init_project` 가 멱등이어야 함. 디렉토리 존재만 OK, 충돌하는 파일은 검증 후 보존 |
| `.gitignore` 가 CRLF 인 Windows | line ending 보존. `read_to_string` 후 처리 시 `\r\n` 유지 |
| `chrono_tz` 의 tz 이름이 case-sensitive (`asia/seoul` X) | validate 에서 자동 대소문자 정규화 X, 명시적 에러 |
| TOML 에서 한국어 키/값 인코딩 | UTF-8 보장 — TOML 0.8 OK |
| 락 acquire 후 패닉 | LockGuard 의 `Drop` 에서 best-effort 삭제. `Drop` 안에서 async 못 부르므로 sync syscall 로 unlink |
| heartbeat task 가 앱 종료 후에도 살아있음 | `tauri::RunEvent::Exit` 에서 모든 `ProjectRuntime` drop, heartbeat task abort |

---

## 6. Definition of Done (W1 전체)

- [ ] 모든 PR 의 DoD 가 ✅
- [ ] §4 의 수동 QA 11개 항목 ✅
- [ ] `cargo test --workspace` green
- [ ] `cargo clippy -- -D warnings` green
- [ ] `pnpm tauri build` 가 깨끗하게 성공 (macOS dmg)
- [ ] 신규 코드의 모든 public item 에 짧은 `///` doc comment (한 줄 OK)
- [ ] `docs/major_update/oculpm/00-spec.md` 와 실제 구현이 일치 (특히 ndjson 4KB 캡 동기화)

---

## 7. 다음 페이즈로 넘기는 것 (W2 의 선행 조건)

- [ ] `OculpmManager` 가 살아있고 `ProjectRuntime` 의 `watcher` / `session_actor` 필드가 비어있는 (자리만 있는) 상태로 등록 가능.
- [ ] `WorkdayResolver` 가 정상 동작.
- [ ] `atomic_io::append_ndjson` 이 동작 (W2 의 ndjson 기록에 그대로 사용).
- [ ] `LockGuard` 가 정상 동작 (W2 의 워처가 시작 시 lock 검증).
- [ ] `OculpmConfig` 의 `watcher` / `session` 섹션이 살아있고 검증된다.

이 5개가 모두 ✅ 면 W2 진입 가능. 하나라도 ❌ 면 W1 으로 hotfix.
