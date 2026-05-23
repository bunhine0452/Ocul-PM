# W2-PR3 — `watcher.rs` notify 통합

> **목표**: `notify-debouncer-full` 로 프로젝트 루트를 감시 → `should_track` 필터 → `classify` (Create/Update/Delete/Rename + blake3) → `SessionActor.send(NoteActivity)` + `IndexWriter.append_file_change` + Tauri `oculpm:file_changed` emit.
> **선행**: W2-PR1 (`IndexWriter`), W2-PR2 (`SessionActor`).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR3 + §2.1 (notify 플랫폼 차이), [`../00-spec.md`](../00-spec.md) §4.3 (ndjson 4 KB 캡), [`../01-backend.md`](../01-backend.md) §6.

---

## 1. 구조 (계획)

```rust
pub struct ProjectWatcher {
    project_id: u32,
    root: PathBuf,
    debouncer: notify_debouncer_full::Debouncer<notify::RecommendedWatcher, ...>,
    rx: tokio::sync::mpsc::UnboundedReceiver<Vec<DebouncedEvent>>,
    ignore: ignore::overrides::Override,
    gitignore: ignore::gitignore::Gitignore,
    session: Arc<SessionActor>,
    index_writer: Arc<IndexWriter>,
    app_handle: tauri::AppHandle,
}

impl ProjectWatcher {
    pub async fn start(...) -> Result<Self, OculpmError>;
    pub async fn run(self) -> ();  // tokio task
    pub async fn stop(self) -> ();
}
```

---

## 2. `should_track(path)` 알고리즘

1. `.oculpm/index/`, `.oculpm/.lock`, `.oculpm/oculpm.log` 안이면 false (자기-suppress).
2. `config.watcher.ignore` 의 glob 매치 false.
3. `respect_gitignore` 면 `gitignore::Gitignore::matched_path_or_any_parents` false.
4. 그 외 true.

추가 안전망: ndjson append 직후 0.5초 동안 같은 path 의 이벤트는 무시 (1번 규칙 외 second-line defense).

---

## 3. `classify(event)` 알고리즘

| notify kind | 매핑 |
|---|---|
| `Create(_)` | Create |
| `Modify(Data \| Metadata)` | Update |
| `Remove(_)` | Delete |
| `Modify(Name(From))` + 같은 batch `Modify(Name(To))` | Rename (rename_from 채움) |

**hash**:
- 파일 크기 ≤ 8 MB → blake3 → `"blake3:<hex>"`
- > 8 MB → hash 생략, `tags: ["large-file-hash-skipped"]`
- Delete → hash_after = `None`

**path-truncated**: rendered ndjson 라인 길이 4 KB 초과 시 `path` 를 `…<short_blake3>` 로 단축 + `tags: ["path-truncated"]` 추가. 단축 후에도 4 KB 초과면 reject + integrity_warning emit.

---

## 4. `run` 루프 골격

```rust
while let Some(batch) = self.rx.recv().await {
    for ev in batch {
        if !self.should_track(&ev.path) { continue; }
        let mut change = self.classify(&ev).await?;
        if self.is_forbidden_path(&change.path) {
            change.path = format!("**redacted/sensitive**:{}", short_hash(&change.path));
            change.hash_before = None;
            change.hash_after = None;
        }
        self.session.send(SessionCmd::NoteActivity(change.clone())).await?;
        self.index_writer.append_file_change(&change).await?;
        self.app_handle.emit("oculpm:file_changed", &change)?;
    }
}
```

---

## 5. `.oculpm/` 내부 별도 워치 (emit only)

본 PR 에서는 변경 감지 후 **emit 만** — 실제 처리는 W3/W4 가 listener 로 구독.

- `.oculpm/agents/_template.md`, `.oculpm/agents/per-agent/**` → `oculpm:agents_template_changed`
- `.oculpm/journal/**` → `oculpm:journal_path_changed`
- `.oculpm/config.toml` → `OculpmManager` 에 watcher restart 요청 (워처 안에서 자기 재시작 금지)

---

## 6. 플랫폼 함정 (페이즈 §2.1 요약)

- **macOS FSEvents**: `~/Library/Caches/` 안 프로젝트는 이벤트 누락 가능. 본 PR 에서는 사용자 경고 X — W4 settings 에서 별도 안내.
- **Linux inotify 한도**: `node_modules` 등 큰 트리 직시 watch 하면 8192 한도 초과. 대응 옵션 두 가지 (페이즈 §2.1 결정 미정):
  - (a) `ignore::WalkBuilder` 로 화이트리스트 → `RecursiveMode::NonRecursive` 디렉토리별 watch
  - (b) `RecursiveMode::Recursive` 루트 1회 + `should_track` 로 거름
  - **본 PR 의 결정**: (b) 채택 — 단순성 우선. 한도 초과는 W6 성능 측정 후 (a) 로 전환 검토. 결정 사유는 §7 실행 노트에 기록.
- **Windows ReadDirectoryChangesW**: rename 이 Move 의 2-step 으로 도착 — `notify-debouncer-full` 가 batch 로 묶어줌 (rely on default 500 ms tick).

---

## 7. 테스트 (계획)

- [ ] **기본 흐름** — tempdir 의 가짜 프로젝트에 5개 파일 수정 → 5개 이벤트가 ndjson 에 들어옴 + 5번 `oculpm:file_changed` emit
- [ ] **ignore 적용** — `node_modules/foo.js` 수정 → ndjson 변화 0, emit 0
- [ ] **forbidden path 마스킹** — `.env` 수정 → ndjson 의 `path` 가 `**redacted/sensitive**:<hash>`, hash null
- [ ] **debounce 동작** — 0.5초 안에 같은 파일 5번 수정 → debouncer 가 묶어 1개 이벤트만 ndjson 에 도착
- [ ] **rename 1개로 매핑** — `mv a.ts b.ts` → 같은 batch 에 1개 `op=rename`, `rename_from="a.ts"` 채워짐
- [ ] **자기-suppress** — `.oculpm/index/file_changes.ndjson` 직접 touch → watcher 가 이를 own change 로 인식해 이벤트 0
- [ ] **large file hash 스킵** — 10 MB 파일 생성 → ndjson 의 tags 에 `large-file-hash-skipped`, hash_after null

---

## 8. DoD

- [ ] 위 7개 테스트 통과
- [ ] 1만 파일 트리에서 단일 변경 latency p95 ≤ 1초 (수동 측정, W6 에서 재검증)
- [ ] watcher 의 stop 이 debouncer thread + recv loop 모두 정리 (leak 검증)
- [ ] `oculpm/watcher.rs` 신규 clippy lint 0건
- [ ] should_track 1번 규칙 (`.oculpm/index/`) 적용 — 자기-suppress 테스트 그린

---

## 9. 실행 노트

- (작업 중 채움)
