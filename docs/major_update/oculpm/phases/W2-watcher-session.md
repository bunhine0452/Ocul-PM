# W2 — Watcher + Session

> **목표**: 파일 변경이 `index/<today>/file_changes.ndjson` 에 실시간으로 떨어지고, 세션이 자동으로 시작/종료된다.
> **기간**: 1주.
> **선행 조건**: W1 의 §7 핸드오프 5개 항목 모두 ✅.

---

## 0. 이 페이즈가 끝나면 보이는 그림

- 프로젝트를 열고 임의의 파일을 수정하면 1초 안에 `index/<today>/file_changes.ndjson` 에 한 줄이 추가된다.
- 세션이 자동으로 시작되고, `inactivity_timeout_minutes` 동안 활동이 없으면 자동 종료된다.
- `sessions.json` 의 형태가 명세서와 일치.
- `snapshot_open.json` 과 (워크데이 종료 시) `snapshot_close.json` 이 작성된다.
- 강제 종료 후 재시작하면 직전 세션이 `crash_recovered` 로 마감된다.
- 워크데이 경계를 넘어가면 새 폴더가 자동 생성된다.
- UI 는 여전히 변경 없음 — 다만 DevTools 에서 Tauri 이벤트로 변경이 흘러나오는 것을 관찰할 수 있다.

---

## 1. PR 분해

### W2-PR1 — `index.rs` (writer/reader)

**Files**:
- `src-tauri/src/oculpm/index.rs` (new)

**책임**:
- `projects.json` read/write (W1 에서 자리만 있던 것)
- `sessions.json` 의 sessions 배열에 append/upsert/finalize
- `file_changes.ndjson` 의 append-only
- `snapshot_open.json` / `snapshot_close.json` write
- `merkle_root` 계산 (스냅샷 시점의 tracked file blake3 들을 정렬해 concat → blake3)

```rust
pub struct IndexWriter {
    root: PathBuf,           // 프로젝트 루트
    resolver: WorkdayResolver,
}

impl IndexWriter {
    pub async fn ensure_workday_dirs(&self, workday: &str) -> Result<(), OculpmError>;
    pub async fn upsert_session(&self, session: &Session) -> Result<(), OculpmError>;
    pub async fn finalize_session(&self, session_id: &str, end: SessionEnd) -> Result<Session, OculpmError>;
    pub async fn append_file_change(&self, ev: &FileChangeEvent) -> Result<(), OculpmError>;
    pub async fn capture_snapshot(&self, workday: &str, kind: SnapshotKind) -> Result<Snapshot, OculpmError>;
    pub async fn list_sessions(&self, workday: &str) -> Result<Vec<Session>, OculpmError>;
    pub async fn read_file_changes(&self, workday: &str, since: Option<&str>) -> Result<Vec<FileChangeEvent>, OculpmError>;
}
```

**불변식**:
- `sessions.json` 은 atomic rename 으로만 갱신. 절대 in-place X.
- `file_changes.ndjson` 은 append 만. 손상된 줄 발견 시 `.corrupted-tail` 백업 후 truncate.
- 한 ndjson 라인 ≤ 4 KB. 초과 시 path 를 `…<hash>` 로 단축 + tags 에 `path-truncated` 추가.

**테스트**:
- 100 줄 ndjson append 후 read → 순서 보존, 라인 수 일치.
- 마지막 줄 의도적 손상 (반쪽 JSON) → read 시 손상 줄만 drop + 백업 생성.
- 동시 append 10 회 (tokio task 10개) → 손실 없음.
- snapshot merkle_root: 같은 입력 → 같은 hash. 한 파일 변경 → hash 변경.

**DoD**:
- [ ] 위 4개 테스트 통과.
- [ ] `sessions.json` 의 stable ordering (started_at ASC).

### W2-PR2 — `session.rs` 상태 머신

```rust
pub struct SessionActor {
    project_id: u32,
    resolver: WorkdayResolver,
    index_writer: Arc<IndexWriter>,
    config: SessionConfig,
    app_handle: tauri::AppHandle,
    inner: Arc<tokio::sync::Mutex<SessionState>>,
    cmd_tx: tokio::sync::mpsc::UnboundedSender<SessionCmd>,
}

enum SessionState {
    Idle,
    Active {
        session: Session,
        last_activity: chrono::DateTime<chrono::Utc>,
        inactivity_handle: tokio::task::JoinHandle<()>,
        boundary_handle: tokio::task::JoinHandle<()>,
    },
    Closing,
}

enum SessionCmd {
    NoteActivity(FileChangeEvent),
    ManualStart,
    ManualEnd(String /* session_id */),
    InactivityFired,
    BoundaryFired,
    Shutdown(tokio::sync::oneshot::Sender<()>),
}
```

**상태 전이 표**:

| 현재 | 입력 | 다음 | 부수효과 |
|---|---|---|---|
| Idle | NoteActivity | Active | new session_id, snapshot_open (워크데이 첫 활동일 때만), `oculpm:session_started` emit |
| Idle | ManualStart | Active | 위와 동일 |
| Idle | InactivityFired/BoundaryFired | Idle | no-op |
| Active | NoteActivity | Active | last_activity 갱신, inactivity 타이머 reset, file_event_count++, sessions.json upsert (디바운스 5초) |
| Active | InactivityFired | Idle | finalize_session(reason=inactivity_timeout), 이벤트 emit |
| Active | BoundaryFired | Idle | finalize(reason=workday_boundary), snapshot_close, ensure_workday_dirs(내일), snapshot_open(내일) |
| Active | ManualEnd | Idle | finalize(reason=manual) |
| Active | Shutdown | Closing | finalize(reason=app_quit), respond to oneshot |
| Closing | * | Closing | drop (앱 종료 중) |

**inactivity 타이머**: `tokio::time::sleep_until(last_activity + timeout)` 을 task 로. NoteActivity 마다 task abort + 재생성. (또는 channel 로 reset 신호 — 어느 쪽이든 OK)

**boundary 타이머**: `WorkdayResolver::next_boundary` 까지 sleep.

**crash recovery**: 앱 시작 시 `OculpmManager::on_project_opened` 가 `sessions.json` 의 `ended_at == null` 세션을 발견하면:
1. `heartbeat_at` 기반으로 stale 인지 검사.
2. stale 이면 `finalize_session(reason=crash_recovered, ended_at = max(last_event_ts, heartbeat_at))`.

**테스트**:
- timeout 5초로 설정 → 활동 → 6초 wait → Idle 전이 확인.
- 활동 직후 reset → 활동 → 6초 wait 시점에 여전히 Active.
- 강제 shutdown 시뮬레이션 → next start 가 Recovered.
- workday boundary 시뮬레이션 (resolver 를 mock 해서 "5초 후 boundary") → snapshot_close + snapshot_open + 새 session 생성.

**DoD**:
- [ ] 위 4개 테스트 통과.
- [ ] 메모리 누수 없음 (task 핸들 정리).

### W2-PR3 — `watcher.rs` notify 통합

```rust
pub struct ProjectWatcher {
    project_id: u32,
    root: PathBuf,
    debouncer: notify_debouncer_full::Debouncer<notify::RecommendedWatcher, ...>,
    rx: tokio::sync::mpsc::UnboundedReceiver<Vec<DebouncedEvent>>,
    ignore: ignore::overrides::Override,
    gitignore: ignore::gitignore::Gitignore,
    session: Arc<SessionActor>,
    index_writer: Arc<IndexWriter>,
    app_handle: tauri::AppHandle,
}

impl ProjectWatcher {
    pub async fn start(...) -> Result<Self, OculpmError>;
    pub async fn run(self) -> ();  // tokio task
    pub async fn stop(self) -> ();
}
```

**`should_track(path)` 알고리즘**:
1. path 가 `.oculpm/index/`, `.oculpm/.lock`, `.oculpm/oculpm.log` 안이면 false.
2. config.watcher.ignore 의 glob 매치 false.
3. respect_gitignore 면 `gitignore::Gitignore::matched_path_or_any_parents` false.
4. 그 외 true.

**`classify(event)` 알고리즘**:
- notify event kind → `FileOp` 매핑:
  - `Create(_)` → Create
  - `Modify(Data | Metadata)` → Update
  - `Remove(_)` → Delete
  - `Modify(Name(From))` + 다음 이벤트 `Modify(Name(To))` → Rename (debouncer 가 같은 batch 에 묶어 줌)
- hash:
  - 파일 크기 ≤ 8 MB: blake3 read → hex
  - 그 초과: hash 생략, `tags: ["large-file-hash-skipped"]`
  - Delete: hash_after = null

**`run` 루프**:
```rust
while let Some(batch) = self.rx.recv().await {
    for ev in batch {
        if !self.should_track(&ev.path) { continue; }
        let mut change = self.classify(&ev).await?;
        if self.is_forbidden_path(&change.path) {
            change.path = format!("**redacted/sensitive**:{}", short_hash(&change.path));
            change.hash_before = None;
            change.hash_after = None;
        }
        self.session.send(SessionCmd::NoteActivity(change.clone())).await?;
        self.index_writer.append_file_change(&change).await?;
        self.app_handle.emit("oculpm:file_changed", &change)?;
    }
}
```

**`.oculpm/` 내부 별도 워치**:
- `.oculpm/agents/_template.md`, `.oculpm/agents/per-agent/**` 변경 → (W4 에서 사용) 어댑터 sync 트리거 emit. W2 에서는 변경 감지만 하고 emit 만 한다 (`oculpm:agents_template_changed`).
- `.oculpm/journal/**` 변경 → (W3 에서 사용) cache reindex. W2 에서는 `oculpm:journal_path_changed` emit 만.
- `.oculpm/config.toml` 변경 → 워처 재시작 큐에 추가 (워처 안에서 자기 자신 재시작 안전하지 않으므로 `OculpmManager` 가 처리).

**테스트**:
- tempdir 에 가짜 프로젝트 셋업, 5개 파일 수정 → 5개 이벤트가 ndjson 에 들어옴.
- `node_modules/foo.js` 수정 → 무시.
- `.env` 수정 → path 마스킹 + hash 없음.
- 0.5초 안에 같은 파일 5번 수정 → debounce 후 1 이벤트.

**DoD**:
- [ ] 위 4개 테스트 통과.
- [ ] 1만 파일 트리에서 단일 변경 latency p95 ≤ 1초.

### W2-PR4 — Crash recovery 통합

`OculpmManager::on_project_opened` 안에서 워처 시작 전:

```rust
async fn recover_zombie_sessions(&self, runtime: &ProjectRuntime) -> Result<(), OculpmError> {
    let today = runtime.resolver.workday_of(chrono::Utc::now());
    for workday in self.list_recent_workdays(runtime, 3).await? {
        let sessions = runtime.index_writer.list_sessions(&workday).await?;
        for s in sessions.iter().filter(|s| s.ended_at.is_none()) {
            // ended_at null = 정상 종료 안 됨
            let last_event_ts = runtime.index_writer.last_event_ts(&workday, &s.id).await?;
            runtime.index_writer.finalize_session(&s.id, SessionEnd {
                ended_at: last_event_ts.unwrap_or(s.started_at.clone()),
                ended_reason: EndedReason::CrashRecovered,
            }).await?;
        }
    }
    Ok(())
}
```

**왜 최근 3일치만?**: 사용자가 한 달 만에 프로젝트를 열어도 한 달 전 좀비를 매번 복구하는 건 낭비. 3일 한도 + 별도 "전체 검사" 커맨드 (W4 settings 에서 노출).

**테스트**:
- 가짜 sessions.json 에 ended_at null 인 세션 2개 — 한 개는 어제, 한 개는 오늘. 워처 시작 → 둘 다 `crash_recovered` 로 마감.
- ended_at null + heartbeat_at 이 미래 → `Held` 로 분류 (다른 인스턴스 중일 가능성, lock 검사로 한 번 더 확인).

**DoD**:
- [ ] 위 2개 테스트 통과.
- [ ] recovery 가 워처 시작 전에 완료됨 (race 없음).

### W2-PR5 — Tauri 이벤트 emit + 프론트 listener 스모크

**이벤트 발행** (W1-PR2 에서 정의된 이벤트 사용):
- `oculpm:session_started` — session 객체
- `oculpm:session_ended` — session 객체
- `oculpm:file_changed` — FileChangeEvent (스로틀 X — 프론트에서 처리)
- `oculpm:integrity_warning` — IntegrityWarning (스냅샷 실패 등)
- `oculpm:agents_template_changed` — `{ relative_path: string }` (W4 에서 사용)
- `oculpm:journal_path_changed` — `{ relative_path: string, op: "create" | "update" | "delete" }` (W3)

**프론트 스모크 (DevTools 콘솔)**:
```js
const { listen } = await import("@tauri-apps/api/event");
await listen("oculpm:file_changed", e => console.log("file:", e.payload));
```

**스로틀링**: file_changed 가 분당 수십~수백 이벤트 가능. **백엔드는 throttle 안 함** (모든 이벤트 전달). 프론트 측에서 1초 batch 로 누적해 UI 반영 (`02-frontend.md §11`).

**DoD**:
- [ ] DevTools 콘솔에서 5개 이벤트 모두 관찰 가능.
- [ ] 이벤트 payload 의 TS 타입이 specta 로 export 되어 있음.

### W2-PR6 — `oculpm_*` 커맨드 확장

W1 의 4개 + 다음 추가:

```rust
async fn oculpm_get_current_session(project_id: u32) -> Result<Option<Session>, String>;
async fn oculpm_start_session_manual(project_id: u32) -> Result<Session, String>;
async fn oculpm_end_session_manual(project_id: u32, session_id: String) -> Result<Session, String>;
async fn oculpm_list_sessions(project_id: u32, workday: Option<String>) -> Result<Vec<Session>, String>;
async fn oculpm_get_file_changes(project_id: u32, workday: String, session_id: Option<String>) -> Result<Vec<FileChangeEvent>, String>;
async fn oculpm_get_index_snapshot(project_id: u32, workday: String, kind: SnapshotKind) -> Result<Snapshot, String>;
async fn oculpm_watcher_start(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_stop(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_status(project_id: u32) -> Result<WatcherStatus, String>;
```

`oculpm_watcher_status` 의 `WatcherStatus`:
```rust
pub struct WatcherStatus {
    pub state: WatcherStateView,
    pub events_seen_total: u64,
    pub events_ignored_total: u64,
    pub last_event_at: Option<String>,
    pub debounce_ms: u32,
}
```

**DoD**:
- [ ] 9개 커맨드 invoke 성공.
- [ ] specta TS 타입 export.

---

## 2. 핵심 기술 노트

### 2.1 `notify` 의 플랫폼 차이

- macOS: FSEvents (recursive, low CPU).
- Linux: inotify (limited recursive — `notify-debouncer-full` 가 알아서 처리).
- Windows: ReadDirectoryChangesW.

**문제 케이스**:
- macOS 의 `~/Library/Caches/` 안에 프로젝트가 있으면 FSEvents 가 일부 이벤트를 누락. **사용자에게 권장 경로 표시** (드물지만 발생 시 사용자 가이드).
- 대형 디렉토리 (`node_modules`) 가 워치 트리에 있으면 inotify 한도 (default 8192 watches) 초과. → `ignore` 매칭이 워처 등록 전에 동작해야 함. `notify` 는 디렉토리를 다 watch 하므로, 우리는 `ignore` 의 `WalkBuilder` 로 워치할 경로 화이트리스트를 만들고, `RecommendedWatcher::watch` 를 그 화이트리스트만 호출.

**구현 노트**: 단순 `watcher.watch(root, RecursiveMode::Recursive)` 하면 안 됨. 대신:
```rust
let walker = ignore::WalkBuilder::new(&root)
    .add_custom_ignore_filename(".oculpmignore")  // 옵션
    .filter_entry(|de| !is_globally_ignored(de.path()))
    .build();
for entry in walker.filter_map(Result::ok) {
    if entry.file_type().map_or(false, |t| t.is_dir()) {
        debouncer.watcher().watch(entry.path(), RecursiveMode::NonRecursive)?;
    }
}
```
(또는 `notify` 의 root recursive + `should_track` 으로 거른다. 후자가 더 단순 — 성능 측정 후 결정. W6 에서 다시 본다.)

### 2.2 `sessions.json` 의 write 빈도

매 file_event 마다 write 하면 디스크 부담. 디바운스 전략:
- file_event_count, files_unique 만 변하는 경우 → 5초 디바운스 후 batch flush.
- 세션 시작/종료/상태 변화 → 즉시 flush.

구현은 `tokio::time::interval` 1초 tick + dirty flag.

### 2.3 시계 점프 (NTP 보정)

NTP 가 큰 폭으로 시계를 뒤로 돌리면 `next_boundary` 가 음수가 되는 등 깨질 수 있다. 방어:
- boundary timer 가 firing 직전에 다시 `next_boundary` 계산. 음수면 다음 boundary 까지 다시 sleep.
- last_activity 비교는 `chrono::Utc::now()` 와의 차이를 saturating subtract.

### 2.4 종료 hook

`Tauri::RunEvent::ExitRequested` 이벤트에서:
```rust
.on_event(|app, event| {
    if let RunEvent::ExitRequested { .. } = event {
        let manager = app.state::<OculpmManager>();
        let _ = tokio::runtime::Handle::current().block_on(manager.shutdown_all());
    }
});
```
`shutdown_all` 은 모든 `ProjectRuntime` 의 `SessionActor` 에 `Shutdown` 명령 + 워처 stop + lock release.

---

## 3. 통합/수동 QA 체크리스트

- [ ] `touch src/foo.tsx` 한 번 → ndjson 마지막 줄에 op=create or update 행 추가
- [ ] `rm src/foo.tsx` → ndjson 에 op=delete, hash_after=null
- [ ] `mv src/a.ts src/b.ts` → 같은 batch 에 op=rename, rename_from 채워짐
- [ ] `.env.local` 수정 → ndjson 의 path 가 `**redacted/sensitive**:...` 로 마스킹, hash null
- [ ] 30분 무활동 → Active → Idle 자동 (테스트는 timeout 30초 설정 후)
- [ ] 자정 직전에 파일 수정, 자정 직후에 또 수정 → 어제 session finalize + snapshot_close, 오늘 새 session + snapshot_open
- [ ] 강제 종료 후 재시작 → 직전 세션 sessions.json 의 `ended_reason: "crash_recovered"`
- [ ] 두 윈도우 동시 → 두 번째는 read-only, 워처 시작 안 함
- [ ] `node_modules`, `.git`, `dist` 안 변경은 ignore
- [ ] DevTools 콘솔에서 `oculpm:file_changed` payload 확인
- [ ] 1만 파일 짜리 데모 레포에서 평균 CPU < 2% (5분 idle 측정)

---

## 4. 알려진 함정

| 함정 | 대응 |
|---|---|
| Save 한 번에 IDE 가 같은 파일을 2번 touch (atomic write) | debouncer 가 500ms 안에 묶음. 충분. |
| Editor 의 `.swp`/`~` 임시 파일 | watcher.ignore 에 `*.swp`, `*~`, `.#*` 추가 |
| OS sleep 후 wake → 시계 점프 | §2.3 의 방어책 |
| 사용자가 시스템 tz 변경 (예: 노트북 들고 시차 이동) | config 의 tz 는 그대로. 사용자가 명시적으로 바꾸지 않는 한 KST 가 유지. 시계 점프와는 별개. |
| inotify 한도 초과 | §2.1 화이트리스트 또는 사용자에게 `sudo sysctl fs.inotify.max_user_watches=524288` 안내 |
| 파일 워처가 자기 자신 (`.oculpm/index/`) 을 감지해 무한 루프 | should_track 의 1번 규칙. + `ndjson` write 직후 0.5초 자기-suppress timestamp 비교 추가 (이중 안전) |

---

## 5. Definition of Done (W2 전체)

- [ ] 모든 PR 의 DoD ✅
- [ ] §3 의 수동 QA 11개 항목 ✅
- [ ] 통합 테스트: `tests/oculpm_watcher_session.rs` 에 5개 시나리오 작성 + green
- [ ] `cargo test --workspace` green
- [ ] 1만 파일 데모 레포 성능 측정 결과 기록 (`docs/major_update/oculpm/phases/_perf-w2.md` — 페이즈 끝에 작성)
- [ ] `00-spec.md §4` (index 스키마) 과 실제 산출물 일치

---

## 6. 다음 페이즈로 넘기는 것 (W3 의 선행 조건)

- [ ] `index/<today>/file_changes.ndjson` 이 실시간으로 채워지는 상태.
- [ ] `sessions.json` 이 `started_at`, `ended_at`, `ended_reason` 포함해 정확히 기록됨.
- [ ] `snapshot_open.json` 이 워크데이 시작 시 1회 작성됨.
- [ ] Tauri 이벤트 `oculpm:session_started/ended`, `oculpm:file_changed` 가 emit 됨.
- [ ] `oculpm_list_sessions`, `oculpm_get_file_changes` 커맨드가 동작.
- [ ] `oculpm:journal_path_changed` 이벤트가 (현재는 사용처 없이) `.oculpm/journal/**` 변경 시 emit (W3 가 이걸 받아 cache 갱신).
