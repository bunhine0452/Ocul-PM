# W1-PR5 — `atomic_io.rs` + `lock.rs` + 단위 테스트

> **목표**: temp-rename atomic write, append_ndjson, managed block patcher, lock 프로토콜 (heartbeat + stale recovery).
> **선행**: W1-PR1~PR4 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR5, [`../00-spec.md`](../00-spec.md) §6 (lock), [`../01-backend.md`](../01-backend.md) §8.

---

## 1. `atomic_io.rs` 시그니처 (**모두 sync 로 결정**)

```rust
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), OculpmError>;
pub fn append_ndjson(path: &Path, line: &str) -> Result<(), OculpmError>;

pub fn read_managed_block(path: &Path, block_id: &str, style: CommentStyle) -> Result<Option<ManagedBlock>, OculpmError>;
pub fn write_managed_block(path: &Path, block_id: &str, new_content: &str, style: CommentStyle) -> Result<ManagedBlockResult, OculpmError>;
pub fn remove_managed_block(path: &Path, block_id: &str, style: CommentStyle) -> Result<(), OculpmError>;

pub const NDJSON_LINE_CAP: usize = 4096;
```

**비고**: 원안에는 async 였으나 모두 sync 로 변경. 이유:
- 작업이 모두 작고 빠른 syscall (write/rename/fsync) 1~3회 — async 의 이득 미미.
- async fn 컬러링이 config/lock/watcher 까지 전염되는 비용이 더 큼.
- 단일 사용자 환경이라 lock contention 으로 인한 starvation 위험 없음.

---

## 2. 관리 블록 매처

- Markdown begin: `<!--\s*oculpm:begin\s+v(\d+)\s*-->`
- Markdown end: `<!--\s*oculpm:end\s*-->`
- Hash begin: `#\s*oculpm:begin\s+v(\d+)`
- DoubleSlash begin: `//\s*oculpm:begin\s+v(\d+)`

EOL (LF / CRLF) 은 **파일 원본 그대로 보존** — `read_to_string` 한 뒤 원본의 EOL 을 sniff 해서 write 시 동일하게 사용.

---

## 3. `lock.rs` 시그니처

```rust
pub struct LockGuard { /* private */ }

impl LockGuard {
    pub async fn acquire(path: &Path) -> Result<LockAcquisition, OculpmError>;
    pub async fn release(self) -> Result<(), OculpmError>;
}

pub enum LockAcquisition {
    Acquired(LockGuard),
    Held { by_pid: u32, heartbeat_at: String },
    Recovered(LockGuard, ZombieInfo),
}

pub struct ZombieInfo {
    pub previous_pid: u32,
    pub heartbeat_age_seconds: i64,
}
```

heartbeat: 30초 interval. `Drop` 에서 task abort + sync unlink.

stale 회수 threshold: `crash_recovery_grace_minutes` * 60 초 (디폴트 5분).

---

## 4. error.rs 에 추가할 variant

```rust
#[error("managed block mismatch in {path}: only one of begin/end markers present")]
ManagedBlockMismatch { path: PathBuf },

#[error("lock held by pid {pid} (heartbeat {heartbeat_at})")]
LockHeld { pid: u32, heartbeat_at: String },

#[error("lock heartbeat task failed")]
LockHeartbeatFailed,

#[error("json parse error in {path}: {source}")]
JsonParse { path: PathBuf, #[source] source: serde_json::Error },
```

---

## 5. 단위 테스트 (실제 14개 — 합쳐 통과)

### atomic_io (10개)
- [x] `write_atomic_creates_file` — fresh 파일 생성 + 내용 round-trip
- [x] `write_atomic_overwrites_and_leaves_no_tmp` — 덮어쓰기 + `*.tmp` 누수 없음 (디렉토리 스캔)
- [x] `write_atomic_creates_missing_parent` — 부모 디렉토리 자동 mkdir
- [x] `append_ndjson_appends_lines` — 3개 라인 순서 보존 + `\n` 구분
- [x] `append_ndjson_rejects_oversized` — 4097 byte 거부, 파일 생성 안 됨
- [x] `append_ndjson_rejects_newline` — embedded `\n` 거부
- [x] `managed_block_insert_paths` — 빈 파일 insert + 기존 파일 insert (blank line separator 검증)
- [x] `managed_block_update_and_unchanged` — 같은 content 두 번 쓰면 두 번째는 `Unchanged`
- [x] `managed_block_mismatch_orphan_marker` — begin-only / end-only 모두 `Err(ManagedBlockMismatch)`
- [x] `managed_block_read_remove_and_crlf` — **CRLF 보존 검증**, read+remove round-trip, 주변 user 라인 보존

### lock (4개)
- [x] `acquire_fresh` — fresh path → `Acquired` + release 시 lock 파일 삭제
- [x] `acquire_held_when_fresh_other_pid` — 다른 pid 의 fresh lock → `Held`, 파일 변경 X
- [x] `acquire_recovered_when_stale` — heartbeat 5분+ 전 → `Recovered` + `ZombieInfo`
- [x] `heartbeat_pulse_updates_timestamp` — pulse 후 pid/started_at 보존 + heartbeat_at 갱신

---

## 6. DoD

- [x] **14/14 테스트 통과** (atomic_io 10 + lock 4). 전체 oculpm 35/35.
- [x] `*.tmp` 누수 없음 (테스트 `write_atomic_overwrites_and_leaves_no_tmp` 가 자동 검증)
- [x] macOS atomic rename 동작 확인 (테스트 통과). Windows 는 후속 검증 — `std::fs::rename` 이 NTFS 의 ReplaceFile 의미를 따라야 (rust std 가 처리)
- [x] error.rs 5개 variant 추가 — `ManagedBlockMismatch`, `NdjsonLineTooLarge`, `NdjsonLineHasNewline`, `JsonParse`, `JsonSerialize`
- [x] config.rs::save 가 `atomic_io::write_atomic` 으로 마이그레이션 — PR4 의 "다음 PR 로 넘기는 메모" 1번 항목 완료
- [x] oculpm 격리 clippy lint 0건

---

## 7. 실행 노트

### 발견된 함정 / 변경

1. **async → sync 전환** ⚠ — 원안은 `pub async fn write_atomic(...)` 였으나 sync 로 변경. 이유는 §1 비고 참조. 결과적으로 `config.rs::save` 도 sync 유지 가능.

2. **`LockGuard` 의 `Debug` derive 누락** — `LockAcquisition::Recovered { guard, info }` 가 `#[derive(Debug)]` 면 inner 도 Debug 필요. `LockGuard` 에 `#[derive(Debug)]` 추가 (tokio JoinHandle + Notify 둘 다 Debug 구현하므로 자동).

3. **module-level `#![allow(dead_code)]`** — `lock.rs` 의 전체 internal helper 들 (LockFile, SCHEMA_VERSION, heartbeat_pulse, detect_hostname, etc.) 이 W1-PR7 의 OculpmManager 까지는 외부 caller 가 없어서 clippy 가 dead code 로 봄. 모듈 최상단에 `#![allow(dead_code)]` 박음. W1-PR7 이후 attribute 제거 가능 (단, 일부 internal helper 는 cfg(test) 외에서 caller 가 직접 없을 수도 있어 유지 검토).

4. **`begin_start.unwrap()` clippy lint** — `find_marker_range` 안에서 `if begin_start.is_none() ... else ... begin_start.unwrap()` 패턴 → clippy 가 `if let Some` 권장. `match begin_start` 로 리팩토링.

5. **`uuid` v4 사용** — `write_atomic` 의 임시 파일 이름 충돌 방지 위해 `uuid::Uuid::new_v4()`. W1-PR1 에서 dep 추가해두었음.

6. **EOL 보존 검증** — `managed_block_read_remove_and_crlf` 테스트가 CRLF 가 들어간 파일에 block 을 insert 했을 때 우리 block 의 라인 구분자도 CRLF 가 되는지를 명시 검증. spec §1.2 의 "EOL 보존" 약속을 PR 안에서 확정.

7. **heartbeat 의 interval 첫 tick 스킵** — `tokio::time::interval(30s).tick().await` 가 즉시 fire 하므로 첫 tick 은 의도적으로 버림. (lock 파일이 방금 만들어졌으므로 추가 갱신 불필요.)

### 빌드/테스트 시간
- atomic_io 10 tests: 컴파일 **7.05s**, 실행 **0.07s**
- lock 4 tests: 컴파일 (cache) **4.15s**, 실행 **1.04s** (tokio runtime + heartbeat sleep 의 영향)
- 전체 oculpm 35 tests: 실행 **1.08s**
- oculpm 격리 clippy: 신규 lint **0건**

### 다음 PR 로 넘기는 메모

- **W1-PR6 (커맨드)**: `OculpmManager` 가 `LockGuard::acquire(&resolver.lock_path(root)).await` 호출 → `Acquired` / `Recovered` 의 경우 `OculpmInitReport.lock_state` 에 매핑 + 가드를 `ProjectRuntime::lock` 에 보관. `Held` 는 read-only 모드 표시.
- **W1-PR7 (manager bootstrap)**: `app.on_event(ExitRequested)` 에서 `manager.shutdown_all()` 호출 → 모든 LockGuard 의 `release()` await. release 가 1초 timeout 으로 wedge 방지하므로 종료 매끄러움.
- **W1-PR8 (.gitignore)**: `atomic_io::write_managed_block` 의 `CommentStyle::Hash` 호출 — 본 PR 의 `managed_block_insert_paths` 테스트가 이미 hash style 검증.
- **W2 (watcher)**: `append_ndjson` 의 4 KB 캡 — path 가 그 한계 가까이 가면 path 를 hash 로 줄이는 책임은 watcher 가 짊어짐. atomic_io 자체는 strict reject.
