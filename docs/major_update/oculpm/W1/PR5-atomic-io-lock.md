# W1-PR5 — `atomic_io.rs` + `lock.rs` + 단위 테스트

> **목표**: temp-rename atomic write, append_ndjson, managed block patcher, lock 프로토콜 (heartbeat + stale recovery).
> **선행**: W1-PR1~PR4 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR5, [`../00-spec.md`](../00-spec.md) §6 (lock), [`../01-backend.md`](../01-backend.md) §8.

---

## 1. `atomic_io.rs` 시그니처

```rust
pub async fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), OculpmError>;
pub async fn append_ndjson(path: &Path, line: &str) -> Result<(), OculpmError>;

pub fn read_managed_block(path: &Path, block_id: &str, style: CommentStyle) -> Result<Option<ManagedBlock>, OculpmError>;
pub fn write_managed_block(path: &Path, block_id: &str, new_content: &str, style: CommentStyle) -> Result<ManagedBlockResult, OculpmError>;
pub fn remove_managed_block(path: &Path, block_id: &str, style: CommentStyle) -> Result<(), OculpmError>;
```

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

## 5. 단위 테스트

### atomic_io (10개)
- [ ] write_atomic 정상
- [ ] write_atomic 후 tmp 파일 없음
- [ ] write_atomic 도중 panic 시 원본 보존 (mock 필요시 catch_unwind)
- [ ] write_atomic 1MB 파일 OK
- [ ] append_ndjson 정상
- [ ] append_ndjson 동시 10 task → 10 줄 모두 추가
- [ ] append_ndjson 4KB 경계 (3.9KB 라인) → 1줄로 잘 들어감
- [ ] managed_block: insert / update / no-op / mismatch / multiple blocks

### lock (4개)
- [ ] acquire → release → 재 acquire OK
- [ ] 1번째 acquire 후 2번째 → `Held`
- [ ] stale lock (heartbeat 10분 전) → `Recovered`
- [ ] heartbeat 가 30초마다 갱신

---

## 6. DoD

- [ ] 14개 테스트 통과
- [ ] `lsof | grep .oculpm` 누수 없음 (수동)
- [ ] macOS + Windows (가능 시) 양쪽에서 atomic rename 동작
- [ ] error.rs variant 추가됐고 다른 모듈이 import 했을 때 깨지지 않음

---

## 7. 실행 노트
- (작업 중 채움)
