# W2-PR1 — `index.rs` writer/reader

> **목표**: `.oculpm/index/<workday>/` 의 `sessions.json` · `file_changes.ndjson` · `snapshot_{open,close}.json` 4종 파일을 안전하게 read/write 하는 `IndexWriter` 구현. 모든 후속 W2 PR 의 토대.
> **선행**: W1 전체 ✅ (특히 PR3 `WorkdayResolver`, PR5 `atomic_io::{write_atomic, append_ndjson}`).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR1, [`../00-spec.md`](../00-spec.md) §4, [`../01-backend.md`](../01-backend.md) §4.

---

## 1. 시그니처 (실제 구현)

```rust
pub struct IndexWriter {
    root: PathBuf,
    resolver: WorkdayResolver,
}

impl IndexWriter {
    pub fn new(root: PathBuf, resolver: WorkdayResolver) -> Self;

    pub async fn ensure_workday_dirs(&self, workday: &str) -> Result<(), OculpmError>;

    // workday 는 session.id / ev.session_id 의 첫 8자에서 자동 추출.
    pub async fn upsert_session(&self, session: &Session) -> Result<(), OculpmError>;
    pub async fn finalize_session(&self, session_id: &str, end: SessionEnd) -> Result<Session, OculpmError>;
    pub async fn append_file_change(&self, ev: &FileChangeEvent) -> Result<(), OculpmError>;

    pub async fn capture_snapshot(&self, workday: &str, kind: SnapshotKind) -> Result<Snapshot, OculpmError>;
    pub async fn list_sessions(&self, workday: &str) -> Result<Vec<Session>, OculpmError>;
    pub async fn read_file_changes(&self, workday: &str, since: Option<&str>) -> Result<Vec<FileChangeEvent>, OculpmError>;
}
```

**워크데이 인자 처리 결정**: 가이드 시그니처가 `upsert_session`/`finalize_session`/`append_file_change` 에는 workday 인자를 안 받음. 세션 ID 포맷 (`YYYYMMDD-NNN`) 의 첫 8자를 workday 로 자동 추출 (`workday_from_id`). 포맷 위반 시 `OculpmError::InvalidSessionId`. 호출자는 인자 하나 덜 통과하면 됨.

---

## 2. 불변식 (실제 검증됨)

- `sessions.json` 은 항상 `write_atomic` (temp + rename) 로만 갱신. 절대 in-place X. ✅
- `sessions.json` 의 배열은 `started_at` ASC 로 stable sort. ✅ (`upsert_session_sorts_by_started_at_asc`)
- `file_changes.ndjson` 은 `append_ndjson` 만 (한 줄 ≤ 4 KB, embedded newline 금지). ✅
- ndjson read 중 손상된 줄 발견 시 `<filename>.corrupted-tail-<YYYYMMDDTHHMMSSZ>` 로 백업 후 손상 지점부터 truncate. 정상 줄만 반환. ✅ (`corrupted_tail_is_backed_up_and_truncated`)
- ndjson 라인 길이 초과 시 `NDJSON_LINE_CAP=4096` 으로 reject — 단축은 호출자 (W2-PR3 Watcher) 책임. ✅
- `merkle_root` = `blake3(sorted_concat(blake3_hex(tracked_file_i)))`. workday 가 같으면 같은 입력에 같은 hash. ✅ (`snapshot_merkle_root_is_deterministic`)
- 디스크 경로는 `WorkdayResolver::index_dir` 만 사용. 본 파일에 `.join("index")` / `.join(workday)` hard-code 0건. ✅

---

## 3. 디스크 레이아웃

```
.oculpm/
└── index/
    └── <workday>/                 # YYYYMMDD
        ├── sessions.json          # Vec<Session>, atomic rename
        ├── file_changes.ndjson    # append-only
        ├── snapshot_open.json     # workday 첫 활동 시
        └── snapshot_close.json    # workday boundary 도달 시 (없을 수 있음)
```

`ensure_workday_dirs` 가 `<workday>` 만 mkdir. `sessions.json` 부재 → 빈 `{ schema_version: 1, sessions: [] }` 로 취급.

---

## 4. 테스트 (실제 — 8개 모두 통과)

- [x] **append + read round-trip** (`append_and_read_roundtrip_preserves_order`) — 100 줄 append 후 순서/payload 일치
- [x] **손상 라인 복구** (`corrupted_tail_is_backed_up_and_truncated`) — 의도적 반쪽 JSON → 정상 2줄만 반환 + 정확히 1개 `.corrupted-tail-*` 백업 생성 + 메인 파일 truncate
- [x] **동시 append** (`concurrent_append_does_not_lose_lines`) — 10 tokio task × 100줄 = 1000줄 모두 보존 (multi_thread 4 worker)
- [x] **snapshot 결정성** (`snapshot_merkle_root_is_deterministic`) — 3 파일 → 같은 merkle 두 번. 한 파일 mutate → 다른 merkle. open + close 두 종류 파일 모두 디스크에 남음
- [x] **sessions.json 정렬** (`upsert_session_sorts_by_started_at_asc`) — 11:00 → 09:00 → 13:00 순서 insert 후 list 결과는 09→11→13
- [x] **finalize_session 멱등성** (`finalize_session_is_idempotent_on_ended_session`) — 1차 finalize(InactivityTimeout) 후 2차 finalize(AppQuit) → 1차 값 보존. 없는 session_id → `SessionNotFound`
- [x] **read_file_changes(since)** (`read_file_changes_since_filter`) — ts 1,5,10,15,20 → `since="...:10"` → 15, 20 만 (strictly greater)
- [x] **invalid session_id 거부** (bonus, `invalid_session_id_is_rejected`) — `"bogus"` → `InvalidSessionId`, 디렉토리 미생성

---

## 5. DoD

- [x] 8개 테스트 통과 (`cargo test --lib oculpm::index` 3.6s)
- [x] `sessions.json` 의 stable ordering 검증
- [x] `oculpm/index.rs` 신규 clippy lint 0건
- [x] `WorkdayResolver` 의 path helper 만 사용 — hard-code path 0건 (grep `"index"` / `"snapshot_"` 으로 확인)
- [x] `read_file_changes` 의 손상 복구 케이스: 백업 파일 생성 + 정상 prefix 부분 반환 + 메인 파일 truncate 까지 모두 검증

---

## 6. 실행 노트

### 발견된 함정 / 변경

1. **W1-PR5 `append_ndjson` 의 split-write 버그 발견** ⚠ — `concurrent_append_does_not_lose_lines` 가 처음에 2/1000 만 통과. 원인: `atomic_io::append_ndjson` 이 `write_all(line)` 와 `write_all(b"\n")` 를 분리해서 호출 → POSIX `O_APPEND` 의 single-`write(2)` atomicity 보장이 깨짐. 동시 호출 시 `{ev_a}{ev_b}\n\n` 같은 interleave 발생, 다음 read 의 corrupted-tail 회수가 첫 collision 이후 전체 truncate.
   - **수정**: `line + \n` 을 `Vec<u8>` 에 합쳐 단일 `write_all` 호출로 변경. PIPE_BUF (4 KB) 이하면 커널이 atomic 보장.
   - 변경 위치: `src/oculpm/atomic_io.rs::append_ndjson`. 본 PR 의 동시성 테스트가 회귀 방지.
   - 이 버그가 PR5 단위 테스트 (`append_ndjson_appends_lines`) 에 안 잡힌 이유: sequential 호출만 검증했음. PR1 의 multi-thread 테스트가 처음으로 표면화.

2. **워크데이 추출 자동화** — 가이드의 `upsert_session(&Session)` 시그니처가 workday 인자를 안 받음. 세션 ID 포맷이 `YYYYMMDD-NNN` 으로 SSOT 이므로 첫 8자를 workday 로 자동 추출하기로 결정. 형식 위반 시 `InvalidSessionId` 새 variant 추가. 호출자 (W2-PR2 SessionActor) 가 workday 를 별도로 전달할 필요 없음.

3. **`finalize_session` 의 멱등성 정책** — PR 가이드의 "둘 중 결정" 항목. 결정: **이미 ended 면 기존 record 무변경 반환 (idempotent)**. tracing::debug 로그만. 새로운 reason/ended_at 으로 덮어쓰는 건 historical truth 를 잃는 위험이 크다고 판단. 없는 session_id 는 `SessionNotFound { session_id, workday }` 로 명시적 에러.

4. **`captured_at` 의 타임존** — `chrono::Utc::now().with_timezone(&self.resolver.tz).to_rfc3339_opts(SecondsFormat::Secs, false)` 로 프로젝트 tz 기준 ISO 8601 (예: `2026-05-22T20:55:01+09:00`). 00-spec §4.4 의 예시와 정확히 일치.

5. **`compute_tree_summary` 의 `.oculpm/` 명시 제외** — `ignore::WalkBuilder::standard_filters(true)` 가 hidden 디렉토리 (`.` prefix) 를 기본 skip 하지만, 사용자가 `.gitignore` 에서 oculpm 블록을 손대거나 filter 설정을 바꿔도 안전하도록 `p.components().any(|c| c == ".oculpm")` 명시 가드 추가.

6. **`since` 필터의 string 비교 안전성** — RFC3339 timestamp 의 lexicographic compare 는 같은 offset 안에서 chronological compare 와 동일. workday 내에서는 프로젝트 tz 가 고정이므로 안전. 노트로 §`read_file_changes` doc-comment 에 명시.

7. **`SnapshotGit` 의 best-effort 수집** — `std::process::Command::new("git")` 으로 `rev-parse HEAD`, `rev-parse --abbrev-ref HEAD`, `status --porcelain` 3종 shellout. git 미설치 / non-repo 면 fields 가 빈 String / 빈 Vec. merkle_root 는 항상 계산됨.

### 추가/변경된 코드 (4 파일)

- **`src-tauri/src/oculpm/index.rs`** (신규) — 374 줄 + 테스트 8개
- **`src-tauri/src/oculpm/mod.rs`** — `pub mod index;` 추가
- **`src-tauri/src/oculpm/error.rs`** — `InvalidSessionId(String)`, `SessionNotFound { session_id, workday }` 2개 variant 추가
- **`src-tauri/src/oculpm/atomic_io.rs`** ⚠ — `append_ndjson` 의 split-write 버그 수정 (single buffer + single write_all). 회귀 코멘트 추가.

### 빌드/테스트 시간

- `cargo test --lib oculpm::index` 8 tests: 컴파일 + 실행 **3.60s**
- 전체 oculpm 54 tests (46 → 54): **3.66s**, 회귀 0
- 격리 clippy lint 신규 **0건**

### 다음 PR 로 넘기는 메모

- **W2-PR2 (SessionActor)**: `IndexWriter` 의 `upsert_session`/`finalize_session`/`append_file_change` 가 워크데이 추출까지 처리 — SessionActor 는 workday 인자를 별도로 통과할 필요 없음. `capture_snapshot` 만 workday 명시 (boundary 직전에 어제 close + 오늘 open 호출 시).
- **W2-PR3 (Watcher)**: ndjson line 4 KB 초과 시 path 단축은 Watcher 가 책임. IndexWriter 는 `NdjsonLineTooLarge` 로 reject 만. Watcher 가 reject 받으면 `oculpm:integrity_warning` emit + 짧은 path 로 retry.
- **W1 hotfix 마무리** — `append_ndjson` 수정은 W1-PR5 의 버그 fix 이므로, 마지막 W1 회고나 별도 hotfix PR 로 W1/README/PR5 doc 에 추가 노트가 들어가도 좋음. 본 PR 의 §6 #1 에 충분히 기록됨.
- **`SnapshotGit` 의 git shellout 비용** — 워크데이 boundary 마다 3회 호출. 큰 monorepo 에서 `status --porcelain` 이 1초 넘게 걸릴 수 있음. W6 성능 측정 후 캐싱 또는 `gitoxide` 도입 검토.
