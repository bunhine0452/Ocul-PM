# W1-PR7 — `OculpmManager` + lib.rs 부트스트랩

> **목표**: 프로젝트 open hook 이 자동 발화 → `.oculpm/` 멱등 생성. 워처/세션 자리는 비어 있음 (W2 에서 채움).
> **선행**: W1-PR1~PR6 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR7.

---

## 1. `OculpmManager` 구조

```rust
pub struct OculpmManager {
    app_handle: tauri::AppHandle,
    projects: tokio::sync::RwLock<HashMap<u32, Arc<ProjectRuntime>>>,
}

pub struct ProjectRuntime {
    pub project_id: u32,
    pub root: PathBuf,
    pub config: OculpmConfig,
    pub resolver: WorkdayResolver,
    pub lock: tokio::sync::Mutex<Option<LockGuard>>,
    // W2 추가 예정
    pub watcher: tokio::sync::Mutex<Option<()>>,
    pub session_actor: tokio::sync::Mutex<Option<()>>,
}

impl OculpmManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self;
    pub async fn init_project(&self, project_id: u32, root: &Path) -> Result<OculpmInitReport, OculpmError>;
    pub async fn on_project_opened(&self, project_id: u32) -> Result<(), OculpmError>;
    pub async fn on_project_closed(&self, project_id: u32) -> Result<(), OculpmError>;
    pub async fn shutdown_all(&self) -> Result<(), OculpmError>;
    pub fn get_status(&self, project_id: u32) -> OculpmStatus;
    pub async fn get_config(&self, project_id: u32) -> Result<OculpmConfig, OculpmError>;
    pub async fn set_config(&self, project_id: u32, new_config: OculpmConfig) -> Result<(), OculpmError>;
}
```

---

## 2. lib.rs 변경

```rust
// setup hook 안에서
let oculpm_manager = OculpmManager::new(app.handle().clone());
app.manage(oculpm_manager);

// RunEvent hook
.on_event(|app, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        let manager = app.state::<OculpmManager>().inner().clone();
        // best-effort shutdown
        let _ = tauri::async_runtime::block_on(async { manager.shutdown_all().await });
    }
});
```

`OculpmManager` 자체는 `Clone` 이 아닐 수 있음 → `Arc<OculpmManager>` 또는 `tauri::State` 로 다루는 게 표준.

---

## 3. `commands/project.rs::open_project` 에 hook 삽입

```rust
// 기존 open_project 끝에 추가:
if let Some(manager) = app.try_state::<OculpmManager>() {
    let root_path = project.root_path.clone();
    let project_id = project.id;
    // non-fatal: 실패해도 프로젝트는 열림
    if let Err(e) = manager.on_project_opened(project_id).await {
        tracing::warn!(project_id, error = %e, "oculpm on_project_opened failed");
    }
}
```

같은 패턴으로 `delete_project` / `select_project` 같이 종료 흐름이 있다면 `on_project_closed` 호출.

---

## 4. DoD

- [ ] 프로젝트 open → `.oculpm/` 자동 생성 (수동 invoke 없이)
- [ ] 같은 프로젝트 두 번째 윈도우 open → `OculpmStatus.lock_state = HeldByOther`
- [ ] 앱 종료 시 lock 파일 삭제 (Activity Monitor 로 확인)
- [ ] 강제 종료 후 재시작 → stale lock 회수 (`heartbeat_age_seconds` 가 grace 초과)
- [ ] open_project 에서 oculpm 실패해도 기존 흐름은 정상 (warning 로그만)
- [ ] `cargo test` green, 기존 회귀 없음

---

## 5. 실행 노트
- (작업 중 채움)
