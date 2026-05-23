# W2-PR4 — Crash recovery 통합

> **목표**: 앱 부팅 시 (워처 시작 직전) 최근 3 workday 의 `sessions.json` 을 스캔해 `ended_at == null` 인 zombie 세션을 `crash_recovered` 로 마감. race 없이 워처보다 먼저 완료.
> **선행**: W2-PR1 (`IndexWriter::{list_sessions, finalize_session, last_event_ts}`), W2-PR3 (워처 부팅 hook).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR4, [`../00-spec.md`](../00-spec.md) §4.2 (sessions.json), §6 (lock 의 stale recovery 와 분리).

---

## 1. 시그니처 (실제 구현)

`OculpmManager::init_project` 안에서 lock 획득 **후**, `.gitignore` 처리 **전** (step 5.5):

```rust
/// Scan the most recent `max_workdays` workday directories for zombie
/// sessions (`ended_at == null`) and finalize each as `crash_recovered`.
pub(crate) async fn recover_zombie_sessions(
    index_writer: &IndexWriter,
    max_workdays: usize,
) -> Result<u32, OculpmError> { ... }
```

호출 위치 (`manager.rs::init_project` step 5.5):
```rust
// 5.5 (W2-PR4) Crash recovery — only when we hold the lock.
if guard.is_some() {
    let index_writer = IndexWriter::new(root.to_path_buf(), resolver.clone());
    if let Err(e) = Self::recover_zombie_sessions(&index_writer, RECOVERY_WORKDAYS).await {
        tracing::warn!(
            target: "oculpm::manager",
            project_id, error = %e,
            "crash recovery failed (non-fatal) — continuing init"
        );
    }
}
```

`IndexWriter` 에 추가된 2개 메서드:

```rust
/// Reverse-scan ndjson → last event timestamp for session_id.
pub async fn last_event_ts(
    &self, workday: &str, session_id: &str,
) -> Result<Option<String>, OculpmError>;

/// All YYYYMMDD workday dirs under .oculpm/index/, descending order.
pub async fn list_workdays(&self) -> Result<Vec<String>, OculpmError>;
```

---

## 2. 왜 최근 3일치만?

사용자가 한 달 만에 프로젝트를 열어도 한 달 전 zombie 를 매번 복구하는 건 낭비. 3일 한도 + 별도 "전체 검사" 커맨드 (W4 settings 에서 노출 — 본 PR 범위 X).

상수: `pub const RECOVERY_WORKDAYS: usize = 3` (`manager.rs` 최상단).

---

## 3. lock 의 stale recovery 와의 분담

- W1-PR5 의 `LockGuard::acquire` 는 **lock 파일**의 stale heartbeat 검사 — heartbeat 가 오래된 lock 만 회수. Held 면 `LockStateView::HeldByOther` 로 read-only.
- 본 PR 의 `recover_zombie_sessions` 는 **sessions.json** 의 ended_at null 검사 — lock 이 정상 회수되었거나 새로 잡혔을 때만 호출.
- 즉 순서: `acquire` → (Acquired/Recovered 면) `recover_zombie_sessions` → `.gitignore` → stash entry → 워처 start. `Held` 면 본 PR 코드 미실행 (read-only).

**가이드 시그니처와의 차이**: 가이드는 `OculpmManager::on_project_opened` 안에 배치했으나, 현재 코드베이스에 `on_project_opened` 메서드가 없고 `init_project` 가 그 역할을 수행. 따라서 `init_project` step 5.5 에 통합. 향후 `on_project_opened` 가 분리되면 이동 가능.

**non-fatal 처리**: recovery 실패 시 `tracing::warn` 로그만 남기고 init 을 계속 진행. zombie 세션이 남아 있어도 프로젝트 사용에는 문제 없음 — 다음 init 에서 재시도.

---

## 4. 테스트 (실제 — 6개 모두 통과)

- [x] **zombie 2개 회수** (`recover_two_zombie_sessions`) — 어제 + 오늘 workday 에 ended_at null 세션 각 1개 (+ ndjson 이벤트) → recover 후 둘 다 `ended_reason="crash_recovered"`, `ended_at` = last_event_ts
- [x] **3일 한도** (`recover_respects_three_day_limit`) — 4일치 workday 에 zombie → 3개만 recover, 4일 전 zombie 는 무시
- [x] **last_event_ts 폴백** (`recover_fallback_to_started_at_when_no_events`) — ndjson 에 해당 session_id 이벤트 0건이면 `ended_at = started_at` 으로 폴백
- [x] **finalize 후 list_sessions** (`recover_then_list_shows_updated_reason`) — recover 후 list_sessions 가 갱신된 ended_reason 반환 + 이미 ended 인 세션은 미변경
- [x] **race-free** (`recover_is_synchronous_and_flushed`) — recover 가 .await 로 완료된 직후 disk 에 crash_recovered 가 플러시됨. 워처 시작 전에 순서 보장.
- [x] **list_workdays 정렬 + 필터** (`list_workdays_order_and_filtering`) — 4개 workday + non-YYYYMMDD dir → descending 정렬, non-YYYYMMDD 제외

---

## 5. DoD

- [x] 위 6개 테스트 통과
- [x] `recover_zombie_sessions` 가 워처 시작 **전에** 완료 — `init_project` 의 step 5.5 → step 6 → step 7 순서 명시 (코드 주석 + 테스트로 검증)
- [x] 3일 한도 hard-code 위치를 `pub const RECOVERY_WORKDAYS: usize = 3` 로 분리 (W4 의 "전체 검사" 가 같은 상수 참조)
- [x] `oculpm/manager.rs` 의 추가 코드 clippy lint 0건

---

## 6. 실행 노트

### 발견된 함정 / 변경

1. **`on_project_opened` 부재** — 가이드는 `on_project_opened` 내에 recovery 배치를 계획했으나, 현재 코드베이스의 프로젝트 부팅 흐름은 `init_project` 가 전담. recovery 를 `init_project` step 5.5 (lock 획득 직후, .gitignore 처리 전) 에 통합. 향후 `on_project_opened` 분리 시 이동만 하면 됨.

2. **static method 선택** — `recover_zombie_sessions` 를 인스턴스 메서드가 아닌 `pub(crate) async fn` 정적 메서드로 구현. 이유: `init_project` 에서 `ProjectEntry` 를 projects map 에 stash 하기 **전에** 호출해야 하므로, `&self` 를 통한 projects map 접근이 불필요하고 `IndexWriter` 만 받으면 충분. 테스트도 manager 없이 `IndexWriter` 만으로 단위 테스트 가능.

3. **non-fatal recovery** — 가이드에는 명시 없었으나, recovery 실패가 프로젝트 부팅을 막으면 안 됨. `tracing::warn` + 계속 진행으로 결정. zombie 가 남아 있어도 다음 부팅에서 재시도.

4. **`last_event_ts` 의 reverse scan** — ndjson 파일 전체를 메모리에 읽어 `.lines().rev()` 로 역방향 탐색. 큰 파일에서도 첫 매치에서 즉시 반환이므로 실효 비용 낮음. corrupted line 은 무시 (backup/truncation 은 `read_file_changes` 의 책임).

5. **`list_workdays` 의 fs::read_dir 사용** — `WorkdayResolver::index_dir` 로 개별 workday path 를 만드는 대신 `index/` 디렉토리를 read_dir 로 스캔. YYYYMMDD 형식 (8자리 숫자) 인 디렉토리만 필터. descending sort 로 most-recent-first.

6. **heartbeat 미래 검사 제거** — 가이드 §4 의 "heartbeat_at 이 현재보다 미래 → Held 분기" 테스트는 실제로는 lock 검사 (`LockGuard::acquire`) 가 먼저 처리. recovery 는 lock Acquired/Recovered 일 때만 실행되므로 본 PR 에서 별도 heartbeat 검사 불필요. 테스트 항목에서 제외.

### 추가/변경된 코드 (2 파일)

- **`src-tauri/src/oculpm/index.rs`** — `last_event_ts` + `list_workdays` 2개 pub method 추가 (67줄)
- **`src-tauri/src/oculpm/manager.rs`** — `RECOVERY_WORKDAYS` 상수, `recover_zombie_sessions` static method, init_project step 5.5 통합, 테스트 6개 추가 (~270줄)

### 빌드/테스트 시간

- `cargo test --lib -- oculpm::manager::tests::recover_` 6 tests: 컴파일 + 실행 **0.11s**
- 전체 oculpm 74 tests (68 → 74): **3.95s**, 회귀 0
- 격리 clippy lint 신규 **0건**

### 다음 PR 로 넘기는 메모

- **W2-PR5 (Tauri events)**: recovery 시 `oculpm:session_ended` emit 은 본 PR 에서 미구현. recovery 된 세션에 대해 emit 할지는 PR5 에서 결정 (사용자가 crash-recovered 세션을 UI 에서 볼 필요가 있는지).
- **W2-PR6 (commands)**: `oculpm_watcher_start` 가 manager 를 통해 시작할 때, recovery 는 이미 init_project 에서 완료된 상태. PR6 에서 별도 recovery 호출 불필요.
- **W4 (settings)**: "전체 검사" 커맨드가 `RECOVERY_WORKDAYS` 를 무시하고 모든 workday 를 스캔하는 옵션. `recover_zombie_sessions(&writer, usize::MAX)` 로 호출하면 됨.
