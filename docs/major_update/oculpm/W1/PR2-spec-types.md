# W1-PR2 — `spec.rs` 핵심 타입 + specta 노출

> **목표**: `01-backend.md §4` 의 모든 enum/struct 를 `oculpm/spec.rs` 에 박고 specta 가 TypeScript 로 자동 export.
> **선행**: W1-PR1 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR2, [`../01-backend.md`](../01-backend.md) §4.

---

## 1. 작성한 타입 (실제)

### Enums (snake_case 직렬화) — 13개
- [x] `EntryType`, `EntryStatus`, `Difficulty`, `FileOp`, `Severity`, `SnapshotKind`, `WriteMode`, `EndedReason`, `CommentStyle`, `LockStateView`, `WatcherStateView`, `DetectionConfidence`, `ConflictResolution`

### Structs — 26개
- [x] Journal: `AgentRef`, `FileTouched`, `RelatedRef`, `JournalFrontmatter`, `JournalEntry`, `JournalEntrySummary`
- [x] Sessions/index: `Session`, `SessionEnd`, `FileChangeEvent`, `SnapshotGit`, `SnapshotTree`, `Snapshot`, `LayerComparison`
- [x] Config: `WorkdayConfig`, `SessionConfig`, `GitConfig`, `WatcherConfig`, `AgentsConfig`, `OculpmConfig`
- [x] Reports: `OculpmStatus`, `OculpmInitReport`, `WatcherStatus`, `AgentDetection`, `AgentSyncResult`, `AgentSyncReport`, `IntegrityWarning`, `ManualEntryDraft`
- [x] Migration: `MigrationEntryPlan`, `MigrationWorkdayPlan`, `MigrationConflict`, `MigrationPlan`, `MigrationFailure`, `MigrationReport`, `RollbackReport`, `ReindexReport`

### Tauri 이벤트 (`#[derive(tauri_specta::Event)]`) — 9개
- [x] `OculpmSessionStarted`, `OculpmSessionEnded`
- [x] `OculpmFileChanged`
- [x] `OculpmJournalAdded`, `OculpmJournalUpdated`
- [x] `OculpmIntegrityWarning`
- [x] `OculpmAgentDrift`
- [x] `OculpmAgentsTemplateChanged`
- [x] `OculpmJournalPathChanged`

---

## 2. 공통 derive 패턴

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryType { Bug, Feature, Error, Refactor, Chore }
```

struct 는 `#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]`. 일부는 `PartialEq` 도 (테스트용).

---

## 3. lib.rs 의 collect_commands! 갱신

본 PR 은 커맨드 미추가지만, **이벤트는 등록**해야 specta 가 export:

```rust
.events(tauri_specta::collect_events![
    crate::oculpm::spec::OculpmSessionStarted,
    crate::oculpm::spec::OculpmSessionEnded,
    crate::oculpm::spec::OculpmFileChanged,
    crate::oculpm::spec::OculpmJournalAdded,
    crate::oculpm::spec::OculpmJournalUpdated,
    crate::oculpm::spec::OculpmIntegrityWarning,
    crate::oculpm::spec::OculpmAgentDrift,
    crate::oculpm::spec::OculpmAgentsTemplateChanged,
    crate::oculpm::spec::OculpmJournalPathChanged,
])
```

`Builder::new().commands(...).events(...)` 형태. 기존 코드의 builder chain 확인 필요 (`lib.rs:57` 부근).

---

## 4. DoD

- [x] `cargo check` 통과 (1.3s 증분, 신규 warning 0건)
- [x] `pnpm tauri dev` 1회 부팅 + `src/lib/bindings.ts` 갱신 확인 — mtime `1779415387` → `1779416103`
- [x] `import type { JournalEntry } from "@/lib/bindings"` 가능 — grep 으로 export 존재 확인 (별도 컴포넌트 추가 없이 OK)
- [x] enum snake_case rename 확인 — bindings 에서 `EntryType = "bug" | "feature" | "error" | "refactor" | "chore"` 등 검증

---

## 5. 실행 노트

### 발견된 함정 / 변경

1. **Specta BigInt 금지** ⚠ — 1차 작성 시 6개 `u64` 필드 사용. `pnpm tauri dev` 부팅 시 panic:
   > `Specta forbids exporting BigInt-style types (usize, isize, i64, u64, i128, u128) to avoid precision loss`

   이는 기존 `daily_brief.date_unix` 의 `i32` 워크어라운드와 동일한 이슈 (`docs/2026521/Errors/2026-05-21-specta-bigint-export.md` 참조). 6개 필드 모두 `u32` 로 변경 + 각 위치에 capping 주석:
   - `JournalEntry.byte_size` (4GB cap — 현실 무한)
   - `Session.active_window_ms` (49일 cap)
   - `FileChangeEvent.bytes` (4GB cap, 그 이상은 large-file-hash-skipped)
   - `WatcherStatus.events_seen_total`, `events_ignored_total` (4.29B cap, restart 시 0으로 리셋)
   - `MigrationPlan.estimated_bytes_written` (4GB cap)

2. **이벤트 이름 컨벤션 자동 변환** — 우리가 spec 문서에 `oculpm:session_started` 식 콜론 표기를 썼는데, tauri-specta 가 자동으로 kebab-case 로 변환해서 `oculpm-session-started` 로 export. 프론트는 `events.oculpmSessionStarted.listen(cb)` 형태로만 쓰므로 영향 없음. spec 문서의 콜론 표기는 *논리적 이름* 일 뿐, 와이어 이름은 자동.

3. **PartialEq/Eq** — enum 들과 config 류 struct 들에 `PartialEq` (+ enum 은 `Eq` 까지) 박아서 W1-PR4 의 라운드트립 테스트가 `assert_eq!` 사용 가능. Journal 류 struct 도 `PartialEq + Eq` (검증/비교 자주 사용).

4. **`r#type` / `r#ref` 회피** — `type` 과 `ref` 가 Rust 키워드라 raw identifier 대신 `serde(rename = "type")` + 필드명 `entry_type`, `serde(rename = "ref")` + 필드명 `ref_path` 패턴 사용. TypeScript 측은 `type:` / `ref:` 로 노출되어 LLM 이 작성할 frontmatter 와 정확히 일치.

### 빌드 시간
- `cargo check` (spec.rs 추가): **3.5s**
- `cargo check` (u64→u32 정정): **1.3s**
- `pnpm tauri dev` 풀 컴파일 + bindings export: **8.93s** (cargo) + 즉시 export

### 다음 PR 로 넘기는 메모

- `#![allow(dead_code)]` 가 spec.rs 전체에 박혀 있음. 후속 PR (W1-PR3+, W2+) 이 필드를 실제 사용하면 점진적으로 제거할 수 있지만, 기본은 specta 가 모든 필드를 export 하므로 컴파일러는 "unused field" 라고 판단할 수 있어 유지가 안전.
- `r#ref` 가 아닌 `ref_path` 필드명 사용 — Rust 측에서 코드 작성 시 `related.ref_path` (TS 의 `related.ref` 와 매핑).
- 이벤트 emit 시 `tauri_specta::Event::emit(&app)` 사용 가능 — W2 워처에서 처음 사용 예정.
