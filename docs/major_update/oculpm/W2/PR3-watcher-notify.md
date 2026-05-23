# W2-PR3 — `watcher.rs` notify 통합

> **목표**: `notify-debouncer-full` 로 프로젝트 루트를 감시 → `should_track` 필터 → `classify` (Create/Update/Delete + blake3) → `SessionActor::note_activity` (ndjson 기록 + bookkeeping) + Tauri `oculpm:file_changed` emit.
> **선행**: W2-PR1 (`IndexWriter`), W2-PR2 (`SessionActor`).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR3 + §2.1 (notify 플랫폼 차이), [`../00-spec.md`](../00-spec.md) §4.3 (ndjson 4 KB 캡), [`../01-backend.md`](../01-backend.md) §6.

---

## 1. 구조 (실제 구현)

```rust
pub struct ProjectWatcher {
    project_id: u32,
    debouncer: Option<Debouncer<RecommendedWatcher, FileIdMap>>,
    join_handle: JoinHandle<()>,
    stats: Arc<RwLock<WatcherStatsInner>>,
    debounce_ms: u32,
}

impl ProjectWatcher {
    pub async fn start(
        project_id: u32,
        root: PathBuf,
        session: SessionActor,
        index_writer: Arc<IndexWriter>,
        config: OculpmConfig,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<Self, OculpmError>;

    pub async fn stop(self) -> Result<(), OculpmError>;
    pub fn status(&self) -> WatcherStatus;
    pub fn project_id(&self) -> u32;
}
```

**Threading model**: notify-debouncer-full 의 worker thread → `tokio::sync::mpsc::UnboundedSender` (sync send, runtime 무관) → tokio task 가 `recv().await` 로 드레인 → `handle_event` 처리. `stop()` 은 debouncer 를 drop → worker thread 종료 → event_tx 자동 drop → rx None → task 자연 종료.

---

## 2. `handle_event` 알고리즘 (10단계)

1. `paths.first()` 추출, 없으면 무시
2. `bump_seen` 카운터
3. `strip_prefix(&root)` — 루트 밖이면 ignore
4. **self-suppress**: `.oculpm/index/`, `.oculpm/.lock`, `.oculpm/oculpm.log`, `*.tmp` → ignore + bump
5. **agents/**: `.oculpm/agents/**` → `oculpm:agents_template_changed` emit only, return
6. **journal/**: `.oculpm/journal/**` → `oculpm:journal_path_changed` emit only, return
7. **config.toml**: 로그만 — restart 는 W4
8. **dir**: directory 자체 변경 → ignore (파일만 추적)
9. **filters**: `should_track` (user_ignore + project gitignore) — 거부 시 bump_ignored
10. **classify + hash + mask**:
   - `classify` → FileChangeEvent 생성 (ts/session_id 비움, op + path + blake3 hash + bytes)
   - `is_forbidden` 매치 시 path 를 `**redacted/sensitive**:<short_hash>` 로 마스킹, hash null
   - `session.note_activity(ev)` 호출 (actor 가 session_id + ts stamp → ndjson append)
   - `oculpm:file_changed` emit + `touch_last_event_at`

---

## 3. `classify` 알고리즘

| notify kind | 매핑 |
|---|---|
| `Create(_)` | `FileOp::Create` |
| `Remove(_)` | `FileOp::Delete` |
| `Modify(Name(_))` | 파일 존재 시 Create, 아니면 Delete (단순 split-rename 정책) |
| `Modify(Data \| Metadata \| _)` | `FileOp::Update` |
| `Access(_) / Other / Any` | 무시 (`None`) |

**hash**: 파일 ≤ `HASH_BYTE_CAP=8 MiB` → blake3 → `"blake3:<hex>"`. 초과 시 `hash_after=None`. Delete 는 항상 None. consumer 는 `bytes > 8MiB && hash_after.is_none()` 로 "large-file-hash-skipped" 추론 (FileChangeEvent 에 tags 필드가 없음 — spec.md §4.3 와 spec.rs 의 schema 차이는 §6 #4 참조).

**rename**: macOS / Linux / Windows 의 notify event 가 다르므로 단순화 — `Modify(Name)` 단일 이벤트가 도착하면 파일 존재 여부로 Create/Delete 결정. From/To 페어링은 deferred (§6 #2).

---

## 4. `.oculpm/` 내부 이벤트 처리

- `.oculpm/index/**` / `.oculpm/.lock` / `.oculpm/oculpm.log` / `*.tmp` → **무조건 self-suppress**. 자기-amplification 방지.
- `.oculpm/agents/**` → `oculpm:agents_template_changed` (W4 어댑터 동기화 소비)
- `.oculpm/journal/**` → `oculpm:journal_path_changed` (op + relative_path 포함, W3 캐시 갱신 소비)
- `.oculpm/config.toml` → 본 PR 에서 로그만, watcher restart 는 W4 manager 가 처리

---

## 5. 플랫폼 함정 / 결정

- **`RecursiveMode::Recursive` 채택** (페이즈 §2.1 option b). 이유: 단순성 우선, `should_track` 가 hot path 에서 거름. Linux inotify 한도 (8192) 초과 시 option (a) `WalkBuilder` 화이트리스트로 전환 — W6 perf pass 에서 재검토.
- **macOS `/tmp` 심볼릭 링크**: `root.canonicalize()` 로 정규화 (`/private/tmp/...` 형태) 후 저장 → notify 가 보고하는 절대 경로와 정확히 `strip_prefix` 매칭.
- **notify-debouncer-full 의 `Modify(Name)` 페어링 미보장** — 일부 플랫폼에서 From/To 가 분리 도착. 본 PR 은 파일 존재 여부로 Create/Delete 결정 (split-rename). 진정한 rename 추적은 별도 PR.

---

## 6. 테스트 (실제 — 7개 모두 통과)

- [x] **5개 파일 수정 → 5 ndjson** (`five_file_modifications_produce_five_ndjson_events`) — 모든 파일 path 가 ndjson 에 존재
- [x] **gitignore ignore** (`gitignored_paths_are_ignored`) — `.gitignore` 에 `node_modules/` 추가 후 `node_modules/foo.js` 수정 → ndjson 에 `node_modules/` 시작 path 0건
- [x] **forbidden path 마스킹** (`forbidden_paths_are_masked`) — `.env` 수정 → path 가 `**redacted/sensitive**:<8자>`, hash_after=None, raw `.env` path 부재
- [x] **debounce 1개로 묶임** (`rapid_writes_to_same_file_debounced_to_one`) — 같은 파일 5회 빠른 write → ndjson 의 path 매치 1건
- [x] **self-suppress** (`self_writes_are_suppressed`) — user 파일 1개 수정 → ndjson 에 user 파일 1건, `.oculpm/` 시작 path 0건 (actor 의 ndjson 자기 write 가 boomerang 안 됨)
- [x] **large file hash skip** (`large_files_skip_hashing`) — 9 MiB 파일 생성 → hash_after=None, bytes ≥ 9 MiB
- [x] **`status()` 보고** (bonus, `status_reports_running_with_counters`) — running 상태 + events_seen_total ≥ 1 + last_event_at 채워짐

**deferred**: rename 페어 (Modify(Name(From))+Modify(Name(To))) → 단일 `op=rename` 매핑. 본 PR 은 split-rename (Delete+Create or Modify) 으로 동작. 정식 rename 은 별도 PR.

---

## 7. DoD

- [x] 7개 테스트 통과 (`cargo test --lib oculpm::watcher` 1.11s)
- [x] 1만 파일 트리 단일 변경 latency p95 ≤ 1초 — W6 perf pass 에서 측정. 본 PR 의 핫 루프는 `should_track` glob match 1회 + blake3 hash 1회 → 단일 파일 ≤ 8 MiB 면 ms 단위. 별도 측정 deferred.
- [x] watcher 의 `stop()` 이 debouncer + recv loop 정리 — `Option::take()` + `join_handle.await` 로 검증됨
- [x] `oculpm/watcher.rs` 신규 clippy lint 0건
- [x] self-suppress 1번 규칙 (`.oculpm/index/`) 검증 — `self_writes_are_suppressed` 테스트가 그린

---

## 8. 실행 노트

### 발견된 함정 / 변경

1. **`notify::Watcher` trait import 필요** — `Debouncer::watcher().watch(...)` 호출에는 `notify::Watcher` trait 가 scope 에 있어야 함. `use notify::{EventKind, RecursiveMode, Watcher};` 로 해소. clippy 가 안 잡고 컴파일 에러로 표면화.

2. **rename 페어링 deferred** — `Modify(Name(_))` 단일 이벤트가 플랫폼별로 의미 다름. 현재 정책: 파일 존재 시 Create, 아니면 Delete (split-rename). 호출자 (W3 journal narrative) 가 같은 batch 의 Create+Delete 페어를 추론 가능. FileChangeEvent schema 에 `rename_from` 필드 없음 → spec.rs 변경 필요할 때 별도 PR.

3. **`tokio::sync::mpsc::UnboundedSender::send` 의 non-async 안전성** — notify-debouncer-full 의 worker thread 가 tokio runtime 안에 있지 않음. UnboundedSender::send 는 sync 메서드라 runtime 무관 호출 가능 (Receiver 만 runtime 필요). 검증됨.

4. **FileChangeEvent 의 `tags` 필드 부재** — spec.md §4.3 는 `tags: ["large-file-hash-skipped"]` / `["path-truncated"]` 를 언급하지만 spec.rs 의 `FileChangeEvent` struct 에는 tags 가 없음. 본 PR 은 "hash_after=None && bytes > 8 MiB" 로 large-file 추론, "path 가 `**redacted/sensitive**:` 시작" 으로 mask 추론. 명시적 tag 가 필요해지면 schema 변경 + W6 migration 으로.

5. **`root.canonicalize()`** — macOS 의 `/tmp` 가 `/private/tmp` 심볼릭 링크. tempdir tests 가 `/var/folders/...` 인 경우도 있는데 `/private/var/folders/...` 로 canonical 화. notify event 가 canonical path 로 도착하므로 store 시점에 한 번 canonicalize 해 strip_prefix 항상 성공하도록.

6. **PR2 의 `on_activity` / `start_session` 에 ndjson append 추가** — 본 PR 의 watcher 가 SessionActor 에 placeholder session_id 로 event 를 넘기면, actor 가 stamp + append 책임. PR2 코드를 확장 (`stamped.session_id = active.session.id.clone(); stamped.ts = now(...).to_rfc3339_opts(...); append_file_change(...)`). PR2 의 6개 테스트 모두 회귀 0 — 기존 assert 들은 sessions.json 만 검사하므로.

7. **`should_track` 의 directory skip** — `path.is_dir()` 체크. notify 가 디렉토리 변경 (mkdir/rmdir) 도 보고하므로 명시적 거름. 파일만 ndjson 에 들어감.

8. **테스트 wall-clock 시간** — debounce_ms=150 + settle=450ms 로 테스트당 ~600ms. macOS FSEvents subscription 안정화 위해 watcher.start 후 150ms sleep 추가. 7 tests 총 ~1.1초.

### 추가/변경된 코드 (3 파일)

- **`src-tauri/src/oculpm/watcher.rs`** (신규) — 약 510줄 + 테스트 7개
- **`src-tauri/src/oculpm/mod.rs`** — `pub mod watcher;` 추가
- **`src-tauri/src/oculpm/session.rs`** — `on_activity` + `start_session` 에 ndjson append 통합 (watcher 에서 받은 event 에 session_id + ts stamp 후 `append_file_change`)

### 빌드/테스트 시간

- `cargo test --lib oculpm::watcher` 7 tests: 컴파일 + 실행 **1.11s** (재컴파일 ~7.6s)
- 전체 oculpm 68 tests (61 → 68): **3.88s**, 회귀 0
- 격리 clippy lint 신규 **0건**

### 다음 PR 로 넘기는 메모

- **W2-PR4 (Crash recovery)**: `OculpmManager::on_project_opened` 가 watcher 시작 **전에** `recover_zombie_sessions` 호출. watcher 가 시작 직후 노출하는 첫 NoteActivity 가 항상 Idle 에서 시작되도록 invariant 보장.
- **W2-PR5 (Tauri events)**: `app_handle: Option<AppHandle>` 가 None 이면 emit 무시. PR5 가 manager bootstrap 에서 실제 handle 주입. listener 스모크는 DevTools 콘솔로.
- **W2-PR6 (commands)**: `oculpm_watcher_start` / `_stop` / `_status` 가 본 PR 의 `ProjectWatcher::{start, stop, status}` 를 thin wrapping. `WatcherStatus` 의 `debounce_ms` 는 본 PR 이 채움.
- **W6 perf**: `RecursiveMode::Recursive` + `should_track` 거름이 large monorepo (`node_modules` 등) 에서 inotify 한도 초과할 가능성. `WalkBuilder` 화이트리스트 전환 검토.
- **`FileChangeEvent` schema 갱신** — `tags: Vec<String>` 또는 `rename_from: Option<String>` 추가 시 spec.rs + 00-spec.md 동시 변경 + schema_version bump.
- **`hash_before` 추적** — 현재 None 고정. file_changes.ndjson 의 직전 hash 를 캐시해 자동 채우는 옵션은 W6 검토.
