# W2-PR6 — `oculpm_*` 커맨드 9개 확장

> **목표**: W1 의 4개 커맨드 (`init / get_status / get_config / set_config`) 위에 9개 추가. session/file_change/snapshot/watcher 의 invoke 경로 확보. 모두 specta TS 타입 export.
> **선행**: W2-PR1~PR5 (`IndexWriter`, `SessionActor`, `ProjectWatcher`, 이벤트 emit).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR6, [`../01-backend.md`](../01-backend.md) §7 (커맨드 표).

---

## 1. 커맨드 시그니처 (계획)

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
- `oculpm_start_session_manual`: 이미 Active 이면 기존 Session 반환 (멱등). Idle 이면 새로 시작.
- `oculpm_end_session_manual`: 인자 `session_id` 가 현재 Active 와 다르면 `Err("session_id mismatch")` — 동시성 race 보호. 일치하면 manual finalize.
- `oculpm_list_sessions`: `workday = None` 이면 오늘. 명시 workday 미존재 → 빈 Vec.
- `oculpm_get_file_changes`: `session_id = None` 이면 workday 전체. 있으면 해당 session_id 필터.
- `oculpm_get_index_snapshot`: snapshot 파일 미존재 → `Err("snapshot not captured")`. 정상 read 시 deserialize.
- `oculpm_watcher_{start,stop}`: 이미 같은 상태면 멱등 Ok. start 가 lock `HeldByOther` 이면 `Err("read-only mode")`.
- `oculpm_watcher_status`: 모든 상태에서 호출 가능 — initialized 아니면 `WatcherStateView::Stopped` + 카운터 0.

---

## 4. 테스트 (계획)

- [ ] **9개 invoke 성공** — 각 커맨드 한 번씩 정상 호출 → `Ok` 또는 명확한 `Err` (커맨드 단위 happy-path)
- [ ] **specta TS 타입** — `bindings.ts` 의 `commands.oculpm*` 9개가 export, 인자/리턴 타입 일치
- [ ] **start/end manual 멱등** — Active 중에 `start_manual` 두 번 → 같은 session 반환
- [ ] **end manual mismatch** — `Active(session_A)` 상태에서 `end_manual("session_B")` → `Err`
- [ ] **list_sessions 빈 workday** — 미존재 workday → `Ok(vec![])`
- [ ] **watcher start 후 status running** — start → status.state == `Running` + `last_event_at` 갱신 (테스트에서 1개 파일 변경 후 확인)
- [ ] **watcher stop 후 status stopped** — stop → status.state == `Stopped`, in-memory 카운터는 보존하되 다음 start 시 reset

---

## 5. DoD

- [ ] 9개 커맨드 invoke 성공 (위 7개 테스트 + 수동 DevTools 호출)
- [ ] 9개 커맨드 모두 specta TS 타입 export — `bindings.ts` 갱신 검증
- [ ] `lib.rs` 의 `collect_commands![...]` 에 9개 추가
- [ ] `oculpm_watcher_status` 가 initialized 안 된 project_id 에 대해 `NotInitialized` 가 아니라 default `Stopped` 반환 (UI 가 안전하게 호출)
- [ ] `commands/oculpm.rs` 신규 clippy lint 0건
- [ ] error 경로의 `String` 메시지가 사용자/개발자 친화적 (예: `"session_id mismatch: active=...; requested=..."`)

---

## 6. 실행 노트

- (작업 중 채움)
