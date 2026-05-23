# W1-PR7 — `OculpmManager` + lib.rs 부트스트랩

> **목표**: 프로젝트 open hook 이 자동 발화 → `.oculpm/` 멱등 생성. 워처/세션 자리는 비어 있음 (W2 에서 채움).
> **선행**: W1-PR1~PR6 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR7.

---

## 1. `OculpmManager` 실제 구조 (PR6 + PR7)

```rust
pub struct OculpmManager {
    // AppHandle 는 보유 X — W2 의 emit 시점에 함수 인자로 전달 예정 ([PR6 §6 #1])
    projects: tokio::sync::RwLock<HashMap<u32, ProjectEntry>>,
}

struct ProjectEntry {
    root: PathBuf,
    config: OculpmConfig,
    resolver: WorkdayResolver,
    lock: Option<LockGuard>,   // None = Held by other process (read-only)
}

impl OculpmManager {
    // PR6
    pub fn new() -> Self;
    pub async fn init_project(&self, project_id: u32, root: &Path) -> Result<OculpmInitReport, OculpmError>;
    pub async fn get_status(&self, project_id: u32) -> OculpmStatus;
    pub async fn get_config(&self, project_id: u32) -> Result<OculpmConfig, OculpmError>;
    pub async fn set_config(&self, project_id: u32, new_config: OculpmConfig) -> Result<(), OculpmError>;

    // PR7 추가
    pub async fn on_project_closed(&self, project_id: u32) -> Result<(), OculpmError>;
    pub fn shutdown_all_blocking(&self);
}
```

**`on_project_opened` 미추가** — 별도 메서드 대신 `init_project` 가 곧 open hook 역할 (idempotent + 시작 시 호출). W2 에서 watcher 시작이 필요해질 때 분리 검토.

---

## 2. lib.rs 변경 — RunEvent::ExitRequested 핸들러

원안의 `.on_event(callback)` 대신 Tauri 2 의 표준 `.build().run(|app, event|)` 패턴 사용:

```rust
let app = tauri::Builder::default()
    .plugin(...)
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| { ... })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

app.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        if let Some(manager) = app_handle.try_state::<crate::oculpm::manager::OculpmManager>() {
            manager.shutdown_all_blocking();  // sync; safe in run callback
        }
    }
});
```

기존 setup hook 내의 `app.manage(OculpmManager::new())` 는 PR6 에서 이미 등록됨.

`shutdown_all_blocking` 이 sync 인 이유:
- Tauri 의 run callback 은 sync 함수, async 못 부름
- `tokio::async_runtime::block_on` 은 이미 runtime 내부에서 호출되면 panic 위험
- `RwLock::try_write` 로 best-effort, 10×50ms retry. 마지막 fallback 은 RAII (Tauri State drop 시 LockGuard::drop)

---

## 3. ❌ `commands/project.rs::open_project` 미존재 — 프론트엔드 hook 으로 우회

main 의 코드에는 `open_project` 백엔드 커맨드가 없다. 프로젝트 선택은 프론트엔드 `selectedProjectId` 상태로만 관리되고, 백엔드에서는 별도 hook 지점이 없음.

**해결책**: `App.tsx` 의 useEffect 가 `selectedProjectId` 변경을 watch 해서 `commands.oculpmInit` 을 호출.

```tsx
// src/App.tsx — 기존 useEffect(loadProjectFiles) 옆에 추가
useEffect(() => {
  if (selectedProjectId == null) return;
  void commands.oculpmInit(selectedProjectId).then((res) => {
    if (res.status === "error") {
      console.warn("[oculpm] init failed:", res.error);
    }
  });
}, [selectedProjectId]);
```

- `oculpmInit` 은 PR6 에서 idempotent 로 구현됨 → 같은 프로젝트 재선택 시 안전
- 실패는 non-fatal — 콘솔 warn 만, UI 는 정상 동작
- W3+ 의 EmptyToday V1 ("ocul-pm 으로 추적할까요?") UI 는 init 실패 + status.initialized == false 일 때만 표시

**`on_project_closed` Tauri 커맨드 미추가** — 프론트엔드가 명시적으로 close 를 호출할 흐름이 아직 없음. 현재는 ExitRequested 의 shutdown_all 만으로 충분. 향후 메모리 압박이나 워처 부하 줄이기 위해 close-on-switch 가 필요해지면 별도 PR (W2+) 에서 `oculpm_close_project` 추가.

---

## 4. DoD

- [x] 프로젝트 선택 → `.oculpm/` 자동 생성 (프론트 useEffect 가 트리거; 사용자는 수동 invoke 안 해도 됨)
- [x] 같은 프로젝트 두 번째 윈도우 open → `OculpmStatus.lock_state = HeldByOther` (PR5 의 lock 테스트 + PR6 의 manager 가 매핑 검증됨)
- [x] 앱 종료 시 lock 파일 삭제 — `shutdown_all_blocking` 이 RunEvent::ExitRequested 에서 LockGuard::drop 동기 호출. `shutdown_all_releases_every_lock` 테스트가 이 동작 검증.
- [x] 강제 종료 후 재시작 → stale lock 회수 — PR5 의 `acquire_recovered_when_stale` 테스트로 검증됨, manager 가 그 결과를 `LockStateView::Recovered` 로 노출
- [x] 프론트 init 실패해도 기존 흐름 정상 — useEffect 의 `console.warn` 만, 프로젝트는 열림
- [x] `cargo test` green — oculpm 41/41 통과, 기존 회귀 0
- [x] `pnpm tauri build` green — release dmg 28.11s 생성 (`ai-pm_0.1.0_aarch64.dmg`)
- [x] oculpm 격리 clippy lint 0건

---

## 5. 실행 노트

### 발견된 함정 / 변경

1. **백엔드 `open_project` 커맨드 미존재** ⚠ — 원안은 `commands/project.rs::open_project` 에 hook 을 삽입하는 계획이었으나, 실제 코드에는 그런 커맨드가 없음. 프로젝트 선택은 프론트엔드 `selectedProjectId` 상태로만 관리됨. → **프론트엔드 `useEffect` 로 우회** (App.tsx). 결과적으로 더 단순한 통합.

2. **Tauri 2 의 `.build().run(callback)` 패턴** — `.run(context)` 의 shortcut 으로는 RunEvent 핸들러를 추가할 수 없음. 명시적으로 `.build(context).expect().run(|app, event|)` 로 분리. lib.rs 의 마지막 5줄이 통째로 교체됨.

3. **`shutdown_all_blocking` 이 sync** — Tauri run callback 이 sync 함수이므로 async 메서드는 호출 불가. `RwLock::try_write` 로 sync best-effort, 10×50ms retry. 모든 retry 실패 시 RAII (Tauri State drop 시 LockGuard::drop) 가 안전망.

4. **`on_project_opened` 미추가** — PR1 / PR7 doc 에는 `on_project_opened` 와 `init_project` 둘 다 있었으나, 사실상 같은 의미라 `init_project` 만 유지. 미래 W2 에서 watcher start 가 추가될 때 분리 검토.

5. **`on_project_closed` 백엔드 메서드만, 커맨드는 미추가** — 프론트엔드가 명시적으로 close 를 호출할 흐름이 없음. 향후 close-on-switch 가 필요해지면 별도 PR 에서 `oculpm_close_project` Tauri 커맨드 추가 가능. 현재는 `shutdown_all_blocking` 만으로 충분.

6. **LockGuard::drop 의 sync 동작 검증** — `on_project_closed_releases_lock` 테스트가 `manager.on_project_closed(1).await` 직후 (sleep 없이) 즉시 lock 파일 부재를 assert. 이는 `LockGuard::drop` 이 동기적으로 `std::fs::remove_file` 을 호출함을 검증.

### 추가된 단위 테스트 (2개)

- [x] `on_project_closed_releases_lock` — lock 파일 즉시 삭제 (sync Drop) + 맵에서 제거 + 멱등 close
- [x] `shutdown_all_releases_every_lock` — 2 프로젝트 init → shutdown_all_blocking → 두 lock 파일 모두 삭제 + 맵 empty

### 빌드/테스트 시간
- `cargo test --lib oculpm::manager` 6 tests: 컴파일 **2.73s** (cached), 실행 **0.10s**
- 전체 oculpm 41 tests 실행: **1.08s**
- `pnpm tauri build` (release dmg): **28.11s**
- oculpm 격리 clippy: 신규 lint **0건**

### 다음 PR 로 넘기는 메모

- **W1-PR8 (.gitignore 관리 블록)**: `init_project` 의 단계 8 자리만 있음. `atomic_io::write_managed_block(.gitignore, "oculpm", content, CommentStyle::Hash)` 호출 + `report.wrote_gitignore` 갱신. PR5 의 `managed_block_insert_paths` 테스트가 이미 hash style 검증함.
- **W2 (watcher)**: `ProjectEntry` 에 `watcher: Option<OculpmWatcher>` 추가. `init_project` 의 8단계 이후에 `watcher.start()` 호출. `on_project_closed` 에서 watcher 도 stop. `shutdown_all_blocking` 자동으로 watcher 도 drop (Drop chain).
- **W2 이벤트 emit**: 현재 `OculpmManager` 는 `AppHandle` 미보유. emit 가 필요한 메서드 (예: `note_file_change`) 가 `&AppHandle` 인자를 받도록. 또는 setup 에서 manager 에 weak handle 주입.
