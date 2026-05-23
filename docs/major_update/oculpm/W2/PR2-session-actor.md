# W2-PR2 — `session.rs` 상태 머신

> **목표**: `SessionActor` 가 file_change 활동을 받아 세션을 자동 시작/종료. inactivity_timeout + workday boundary + ManualStart/End + Shutdown 5종 입력 지원. 메모리 누수 없는 task lifecycle.
> **선행**: W2-PR1 (`IndexWriter::{upsert_session, finalize_session, capture_snapshot, ensure_workday_dirs, snapshot_exists, current_git_head}`).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR2, [`../00-spec.md`](../00-spec.md) §4.2 (sessions.json), [`../01-backend.md`](../01-backend.md) §5.

---

## 1. 구조 (실제 구현)

```rust
pub struct SessionActor {
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    project_id: u32,
}

// Boxed for variant-size balance (clippy::large_enum_variant 가이드).
enum SessionState {
    Idle,
    Active(Box<ActiveSession>),
    Closing,
}

struct ActiveSession {
    session: Session,
    active_start: DateTime<Utc>,
    last_activity: DateTime<Utc>,
    last_upsert: DateTime<Utc>,
    files_unique: HashSet<String>,
    inactivity_handle: JoinHandle<()>,
    boundary_handle: JoinHandle<()>,
    dirty: bool,
}

enum SessionCmd {
    NoteActivity(FileChangeEvent),
    ManualStart,
    ManualEnd(String /* session_id */),
    InactivityFired,
    BoundaryFired,
    Shutdown(oneshot::Sender<()>),
}
```

**API**: `SessionActor::spawn(project_id, resolver, Arc<IndexWriter>, SessionConfig, Option<AppHandle>) -> Self` + `note_activity / manual_start / manual_end / shutdown / force_boundary_fired`. `app_handle` 가 `Option` 이라 unit test 가 Tauri runtime 없이도 동작.

---

## 2. 상태 전이 표 (페이즈 §1.W2-PR2 와 동일, 실제 구현됨)

| 현재 | 입력 | 다음 | 부수효과 |
|---|---|---|---|
| Idle | NoteActivity | Active | new session_id, snapshot_open (워크데이 첫 활동일 때만), `oculpm:session_started` emit |
| Idle | ManualStart | Active | 위와 동일 (first_event 없음) |
| Idle | InactivityFired/BoundaryFired | Idle | no-op (`matches!` 가드) |
| Active | NoteActivity | Active | last_activity 갱신, inactivity timer **abort+respawn**, file_event_count++, files_unique HashSet 갱신, `dirty=true` |
| Active | InactivityFired | Idle | `finalize_session(reason=InactivityTimeout, ended_at=last_activity)`, `oculpm:session_ended` emit |
| Active | BoundaryFired | Idle | `finalize(WorkdayBoundary, ended_at=now)` → `snapshot_close(old_workday)` → `ensure_workday_dirs(new_workday)` → `snapshot_open(new_workday)` |
| Active | ManualEnd(id) | Idle (or stay Active) | id 일치 시 `finalize(Manual, now)`. 불일치 시 warn 로그 + no-op |
| Active | Shutdown | Closing | `finalize(AppQuit, now)`, oneshot respond, loop break |
| Closing | * (Shutdown 제외) | Closing | drop |

**timer abort 정책**: 모든 Active→Idle/Closing 전이는 `inactivity_handle.abort()` + `boundary_handle.abort()` 명시 호출. run 루프 종료 후 잔여 Active 상태가 있다면 (정상 경로엔 없음) belt-and-suspenders abort.

---

## 3. 타이머 + Debounce

- **inactivity**: `tokio::spawn(sleep(config.inactivity_timeout_minutes * 60s))` → `SessionCmd::InactivityFired` 송신. NoteActivity 마다 `mem::replace` + `abort()` 으로 재생성.
- **boundary**: `WorkdayResolver::next_boundary(now)` 까지 sleep. firing 직전 `Utc::now() >= fires_at` 재검사 (시계 점프 / DST 안전).
- **upsert debounce**: 상수 `UPSERT_DEBOUNCE = 5초`, `FLUSH_TICK = 250ms`. `tokio::select!` 에서 `tick.tick()` 으로 주기적 wake-up → `dirty && now - last_upsert >= 5s` 면 flush. 상태 전이 (`start_session`/`finalize_active`/`emit_*`) 는 항상 즉시 flush.

---

## 4. crash recovery 와의 분담

본 PR 의 SessionActor 는 **항상 Idle 부터 시작**. zombie sessions 처리는 W2-PR4 의 `OculpmManager::recover_zombie_sessions` 가 actor 부팅 전에 수행. 즉 SessionActor 의 초기 상태가 항상 깨끗하다는 invariant 가 W2-PR4 의 책임.

---

## 5. 테스트 (실제 — 7개 모두 통과)

- [x] **Idle → Active 첫 활동** (`idle_to_active_on_first_activity`) — first NoteActivity 후 session_id 가 `<workday>-001`, `file_event_count=1`, `files_unique=1`, `snapshot_open.json` 생성됨, Shutdown 후 ended_reason=AppQuit
- [x] **InactivityFired finalize** (`inactivity_fired_finalizes_with_timeout_reason`) — InactivityFired 직접 주입 → ended_reason=InactivityTimeout, ended_at 채워짐 (실제 60s 대기 불필요)
- [x] **두 번째 활동 → 새 세션** (`second_activity_after_idle_starts_new_session`) — Idle→Active→InactivityFired→Active 라운드 트립 후 sessions.json 에 -001 + -002 두 개. ended_reason 각각 InactivityTimeout / AppQuit
- [x] **BoundaryFired snapshot_close** (`boundary_fired_finalizes_and_captures_snapshot_close`) — `force_boundary_fired()` 후 ended_reason=WorkdayBoundary + `snapshot_close.json` 생성 검증
- [x] **Shutdown finalize + ActorClosed** (`shutdown_finalizes_with_app_quit`) — Shutdown 후 ended_reason=AppQuit, 이후 `note_activity` 가 `OculpmError::ActorClosed` 반환
- [x] **ManualEnd 엄격 매칭** (`manual_end_matches_session_id_strictly`) — 잘못된 id 는 무시, 정확한 id 만 finalize(Manual)
- [x] **Idle Shutdown no-op** (bonus, `shutdown_on_idle_is_clean_noop`) — Active 진입 없이 Shutdown 만 → sessions.json 비어있음

---

## 6. DoD

- [x] 7개 테스트 통과 (`cargo test --lib oculpm::session` 0.17s)
- [x] 메모리 누수 없음 — `abort()` 가 Active→Idle 전이의 모든 분기 (InactivityFired/BoundaryFired/ManualEnd/Shutdown) 에서 호출됨. run 루프 종료 후 fallback abort 도 있음
- [x] `Drop` / `Shutdown` 경로가 inactivity + boundary 양쪽 abort — 코드 검증됨
- [x] `oculpm/session.rs` 신규 clippy lint 0건 (large_enum_variant 는 Box 로 해소)
- [x] state mutation 은 `&mut self.state` 의 단일 mut borrow 안에서 — 동시성 race 불가능 (`mpsc` 가 단일 소비자)

---

## 7. 실행 노트

### 발견된 함정 / 변경

1. **`large_enum_variant` clippy 경고 → Box 로 해소** — `SessionState::Active` 가 ~300 byte (Session + 두 JoinHandle + HashSet + 4 DateTime) 인데 `Idle`/`Closing` 은 0 byte. clippy 가 size 차이 경고. `Active(Box<ActiveSession>)` 으로 변경. heap 할당 1회는 Active 진입 시 (드물게) 발생하므로 성능 영향 미미.

2. **upsert debounce 의 정상 경로** — NoteActivity 마다 `dirty=true` 만 마킹. `tokio::select!` 의 250ms tick 이 `maybe_flush` 호출 → 마지막 upsert 가 5초 이상 전이면 flush. 모든 상태 전이 (start_session, finalize_active) 는 즉시 flush. → 50 NoteActivity/sec 의 burst 가 디스크 write 1회 (start) + 5초마다 1회 = 분당 ~13회로 압축.

3. **`active_window_ms` 의 단순 계산** — `(end_instant - active_start).num_milliseconds()` wall-clock 차이. 진정한 "active" 시간 (idle 갭 제외) 은 inactivity_timeout 마다 누적해야 정확하지만, 단순한 첫 구현으로 시작. PR 가이드는 이 부분을 명시하지 않음. 추후 W6 perf pass 에서 정교화 가능.

4. **`auto_close_on_workday_boundary` / `auto_close_on_app_quit` 플래그 미사용** — SessionConfig 의 두 bool 플래그는 본 PR 에서 **항상 true 로 동작**. =false 인 경우의 의미가 PR 가이드에 명시 안 됨 (예: 같은 세션을 워크데이 가로질러 유지?). 결정 보류 — 설정 UI 가 노출되는 W4 에서 의미 확정 후 구현. 현재 코드는 두 플래그를 읽기만 하고 무시.

5. **`AppHandle: Option`** — unit test 에서 Tauri runtime 을 안 띄우려고 `Option<tauri::AppHandle>`. `None` 이면 emit no-op. W2-PR5 에서 production 경로에 실제 handle 주입할 때도 같은 시그니처 유지.

6. **`force_boundary_fired` 노출 이유** — boundary timer 가 `WorkdayResolver::next_boundary` 기반이라 test 에서 "5초 후 boundary" 시뮬레이션이 어려움. 가이드의 "resolver 를 mock 해서" 부분을 clock 주입 대신 cmd 채널 직접 노출로 우회. W2-PR4 의 crash recovery 가 같은 메서드를 활용 가능.

7. **`tokio::select!` + `MissedTickBehavior::Skip`** — 5초 디바운스 동안 system suspend (laptop 슬립) 후 깨어나면 tick 이 여러 번 동시에 발화하는 burst 가능. Skip 으로 우회.

### 추가/변경된 코드 (4 파일)

- **`src-tauri/src/oculpm/session.rs`** (신규) — 약 530줄 + 테스트 7개
- **`src-tauri/src/oculpm/mod.rs`** — `pub mod session;` 추가
- **`src-tauri/src/oculpm/error.rs`** — `ActorClosed` variant 추가
- **`src-tauri/src/oculpm/index.rs`** — `snapshot_exists(workday, kind)` + `current_git_head()` pub 헬퍼 추가

### 빌드/테스트 시간

- `cargo test --lib oculpm::session` 7 tests: 컴파일 + 실행 **0.17s** (재컴파일 ~3s)
- 전체 oculpm 61 tests (54 → 61): **3.63s**, 회귀 0
- 격리 clippy lint 신규 **0건**

### 다음 PR 로 넘기는 메모

- **W2-PR3 (Watcher)**: `SessionActor::note_activity(FileChangeEvent)` 가 sync send (mpsc unbounded). Watcher 의 hot loop 에서 `actor.note_activity(ev)?` 한 줄로 호출. 실패는 `ActorClosed` 만이므로 비치명적 로깅.
- **W2-PR4 (Crash recovery)**: `OculpmManager` 가 actor 부팅 전에 `recover_zombie_sessions` 호출. actor 는 항상 Idle 부터 시작 — invariant 유지 필요. `force_boundary_fired` 가 recovery 시뮬레이션에 활용 가능.
- **W2-PR5 (Tauri events)**: emit 코드는 이미 들어가 있음 (`emit_started/emit_ended` via `tauri_specta::Event::emit`). W2-PR5 는 manager bootstrap 에 AppHandle 주입 + 프론트 listener 스모크만 추가.
- **W2-PR6 (commands)**: `oculpm_get_current_session` 은 actor 의 in-memory state 조회 필요. 본 PR 에선 외부 read API 미구현 — `pub async fn current_session(&self) -> Option<Session>` 같은 helper 를 actor 채널에 `Inspect` cmd 추가하여 PR6 에서 노출. 또는 actor 가 매 변경마다 manager 의 RwLock 에 mirror 도 가능.
- **`active_window_ms` 정교화** — W6 perf pass 에서 inactivity gap 제외 누적 계산 검토.
- **flag 의미 결정** — W4 Settings UI 가 `auto_close_on_workday_boundary` / `auto_close_on_app_quit` 토글을 노출할 때 의미 확정 후 본 PR 의 unused fields 활성화.
