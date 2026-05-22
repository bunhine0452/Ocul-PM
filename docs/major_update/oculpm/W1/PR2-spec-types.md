# W1-PR2 — `spec.rs` 핵심 타입 + specta 노출

> **목표**: `01-backend.md §4` 의 모든 enum/struct 를 `oculpm/spec.rs` 에 박고 specta 가 TypeScript 로 자동 export.
> **선행**: W1-PR1 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR2, [`../01-backend.md`](../01-backend.md) §4.

---

## 1. 작성할 타입 (정확히 이 목록)

### Enums (snake_case 직렬화)
- [ ] `EntryType` — Bug, Feature, Error, Refactor, Chore
- [ ] `EntryStatus` — Planned, InProgress, Done, Abandoned
- [ ] `Difficulty` — Superhigh, High, Medium, Low, Verylow
- [ ] `FileOp` — Create, Update, Delete, Rename, Correct
- [ ] `Severity` — Ok, Warning, Critical
- [ ] `SnapshotKind` — Open, Close
- [ ] `WriteMode` — ManagedBlock, Overwrite
- [ ] `EndedReason` — InactivityTimeout, AppQuit, WorkdayBoundary, Manual, CrashRecovered
- [ ] `CommentStyle` — Markdown, Hash, DoubleSlash

### Structs
- [ ] `AgentRef { id, version }`
- [ ] `FileTouched { path, op, bytes_added?, bytes_removed?, rename_from? }`
- [ ] `RelatedRef { ref, kind }`
- [ ] `JournalFrontmatter { ... 16 필드 ... }`
- [ ] `JournalEntry { relative_path, frontmatter, title, checkbox, body_markdown, byte_size, mtime }`
- [ ] `JournalEntrySummary` (가벼운 버전 — list 응답용)
- [ ] `Session { id, started_at, ended_at?, ended_reason?, active_window_ms, file_event_count, files_unique, git_head_at_start?, git_head_at_end?, agent_label_guess?, linked_journal_entries }`
- [ ] `SessionEnd { ended_at, ended_reason }`
- [ ] `FileChangeEvent { ts, session_id, op, path, hash_before?, hash_after?, bytes }`
- [ ] `Snapshot { schema_version, captured_at, git, tree_summary }`
- [ ] `SnapshotGit`, `SnapshotTree` (Snapshot 의 부분)
- [ ] `LayerComparison { session_id, index_files, journal_files, only_in_index, only_in_journal, mismatch_severity }`
- [ ] `OculpmConfig` + 5 sub-configs (Workday, Session, Git, Watcher, Agents)
- [ ] `OculpmStatus { initialized, config_valid, lock_state, current_workday, watcher_state }`
- [ ] `OculpmInitReport { created_dirs, wrote_config, wrote_gitignore, lock_state }`
- [ ] `WatcherStatus { state, events_seen_total, events_ignored_total, last_event_at?, debounce_ms }`
- [ ] `MigrationPlan`, `MigrationWorkdayPlan`, `MigrationEntryPlan`, `MigrationConflict`, `ConflictResolution`
- [ ] `MigrationReport`, `RollbackReport`, `ReindexReport`
- [ ] `AgentDetection { id, confidence, adapter_path, mtime? }`
- [ ] `AgentSyncReport { results }`
- [ ] `IntegrityWarning { kind, path, message }`
- [ ] `LockStateView` (enum), `WatcherStateView` (enum), `ManualEntryDraft`

### Tauri 이벤트 (`#[derive(tauri_specta::Event)]`)
- [ ] `OculpmSessionStarted`, `OculpmSessionEnded`
- [ ] `OculpmFileChanged`
- [ ] `OculpmJournalAdded`, `OculpmJournalUpdated`
- [ ] `OculpmIntegrityWarning`
- [ ] `OculpmAgentDrift`
- [ ] `OculpmAgentsTemplateChanged`
- [ ] `OculpmJournalPathChanged`

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

- [ ] `cargo check` 통과
- [ ] `pnpm tauri dev` 한 번 돌고 `src/lib/bindings.ts` 가 갱신됨 (Git diff 로 확인)
- [ ] TypeScript 측에서 `import type { JournalEntry } from "@/lib/bindings"` 가 에러 없이 import 됨 (실제 사용 안 해도 OK — 한 줄 추가 후 `pnpm tsc --noEmit` 으로 검증, 검증 후 제거)
- [ ] 모든 enum 의 snake_case rename 확인 — 예: TypeScript 의 `EntryType` 이 `"refactor"` 리터럴을 포함

---

## 5. 실행 노트
- (작업 중 채움)
