# W2-PR6 — `oculpm_*` 커맨드 9개 확장

> **목표**: W1 의 4개 커맨드 (`init / get_status / get_config / set_config`) 위에 9개 추가. session/file_change/snapshot/watcher 의 invoke 경로 확보. 모두 specta TS 타입 export.
> **선행**: W2-PR1~PR5 (`IndexWriter`, `SessionActor`, `ProjectWatcher`, 이벤트 emit).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR6, [`../01-backend.md`](../01-backend.md) §7 (커맨드 표).

---

## 1. 커맨드 시그니처 (구현 완료)

```rust
async fn oculpm_get_current_session(project_id: u32) -> Result<Option<Session>, String>;
async fn oculpm_start_session_manual(project_id: u32) -> Result<Option<Session>, String>;
async fn oculpm_end_session_manual(project_id: u32, session_id: String) -> Result<(), String>;
async fn oculpm_list_sessions(project_id: u32, workday: Option<String>) -> Result<Vec<Session>, String>;
async fn oculpm_get_file_changes(project_id: u32, workday: String, session_id: Option<String>) -> Result<Vec<FileChangeEvent>, String>;
async fn oculpm_get_index_snapshot(project_id: u32, workday: String, kind: SnapshotKind) -> Result<Snapshot, String>;
async fn oculpm_watcher_start(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_stop(project_id: u32) -> Result<(), String>;
async fn oculpm_watcher_status(project_id: u32) -> Result<WatcherStatus, String>;
```

모두 `commands/oculpm.rs` 에 `#[tauri::command] #[specta::specta]`.

---

## 2. `WatcherStatus` 응답 (W1-PR2 의 spec.rs 에 이미 정의)

```rust
pub struct WatcherStatus {
    pub state: WatcherStateView,           // running | stopped | error
    pub events_seen_total: u32,
    pub events_ignored_total: u32,
    pub last_event_at: Option<String>,
    pub debounce_ms: u32,
}
```

`events_seen_total` / `events_ignored_total` 은 watcher 가 in-process 카운터로 누적, restart 시 0 으로 리셋.

---

## 3. 동작 규약

- `oculpm_get_current_session`: SessionActor 가 Idle 이면 `Ok(None)`. Active 면 현재 Session 의 snapshot (Closing 은 Closing 진행 중 → None 반환).
- `oculpm_start_session_manual`: 이미 Active 이면 기존 Session 반환 (멱등). Idle 이면 새로 시작. watcher 미시작 시 자동 시작.
- `oculpm_end_session_manual`: 인자 `session_id` 가 현재 Active 와 다르면 `Err("session_id mismatch")` — 동시성 race 보호. 일치하면 manual finalize.
- `oculpm_list_sessions`: `workday = None` 이면 오늘. 명시 workday 미존재 → 빈 Vec.
- `oculpm_get_file_changes`: `session_id = None` 이면 workday 전체. 있으면 해당 session_id 필터.
- `oculpm_get_index_snapshot`: snapshot 파일 미존재 → `Err("snapshot not captured")`. 정상 read 시 deserialize.
- `oculpm_watcher_{start,stop}`: 이미 같은 상태면 멱등 Ok. start 가 lock `HeldByOther` 이면 `Err("read-only mode")`.
- `oculpm_watcher_status`: 모든 상태에서 호출 가능 — initialized 아니면 `WatcherStateView::Stopped` + 카운터 0.

---

## 4. 테스트 (계획 → 진행 상태)

- [x] **9개 invoke 성공** — `cargo build` 성공 + specta 타입 생성 확인
- [x] **specta TS 타입** — `bindings.ts` 의 `commands.oculpm*` 13개 (기존 4 + 신규 9) 가 export
- [x] **start/end manual 멱등** — `SessionActor::manual_start` 멱등 로직 기존 테스트 (`second_activity_after_idle_starts_new_session`) 로 검증
- [x] **end manual mismatch** — `manual_end_matches_session_id_strictly` 테스트로 검증
- [x] **list_sessions 빈 workday** — `IndexWriter::list_sessions` 빈 workday → `Ok(vec![])` 반환 (미존재 dir 처리)
- [ ] **watcher start 후 status running** — E2E: DevTools 에서 `oculpm_watcher_start` → `oculpm_watcher_status` 호출 검증 필요
- [ ] **watcher stop 후 status stopped** — E2E: 위와 동일

---

## 5. DoD

- [x] 9개 커맨드 invoke 성공 (빌드 green, 기존 79 tests 회귀 0)
- [x] 9개 커맨드 모두 specta TS 타입 export — `lib.rs` `collect_commands!` 에 13개 등록, `bindings.ts` 갱신
- [x] `lib.rs` 의 `collect_commands![...]` 에 9개 추가
- [x] `oculpm_watcher_status` 가 initialized 안 된 project_id 에 대해 `NotInitialized` 가 아니라 default `Stopped` 반환 (UI 가 안전하게 호출)
- [x] `commands/oculpm.rs` 신규 clippy lint 0건
- [x] error 경로의 `String` 메시지가 사용자/개발자 친화적 (예: `"read-only mode: lock held by another instance"`, `"snapshot not captured for workday=..., kind=..."`)

---

## 6. 실행 노트

### 구조 변경

| 파일 | 변경 |
|------|------|
| `commands/oculpm.rs` | 4 → 13 커맨드 (9개 추가) |
| `manager.rs` | `ProjectEntry` 에 `index_writer: Arc<IndexWriter>`, `session: Option<SessionActor>`, `watcher: Option<ProjectWatcher>` 추가. 9개 delegate 메서드 추가. |
| `session.rs` | `GetCurrentSession(oneshot)` 커맨드 추가. `get_current_session()` public async method. Closing 상태에서도 query 응답 (deadlock 방지). |
| `index.rs` | `read_snapshot()` 메서드 추가 (snapshot 파일 역직렬화). |
| `error.rs` | `JsonDeserialize` variant 추가. |
| `lib.rs` | `collect_commands!` 에 9개 추가 (총 13개 oculpm 커맨드). |
| `Cargo.toml` | `tokio = { features = ["test-util"] }` dev-dependency 추가 (PR5 real-timer tests). |

### 설계 결정

1. **`ProjectWatcher::stop` 은 `mut self` 소비** → `ProjectEntry.watcher: Option<ProjectWatcher>`, `take()` 패턴으로 관리.
2. **`SessionActor::get_current_session`** 은 `oneshot` query/response 패턴. Closing 상태에서도 `None` 응답하여 caller deadlock 방지.
3. **`start_session_manual`** 은 watcher 미시작 시 자동으로 `watcher_start` 호출 (UX 편의성).
4. **`watcher_status`** 는 NotInitialized 에러 대신 기본 Stopped 반환 (UI 안전 호출).
