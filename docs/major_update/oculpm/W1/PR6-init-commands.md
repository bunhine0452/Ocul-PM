# W1-PR6 — 4개 커맨드: init / get_status / get_config / set_config

> **목표**: 첫 사용자 노출 가능한 Tauri 커맨드 4개. invoke 가능하고 round-trip 가능.
> **선행**: W1-PR1~PR5 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR6.

---

## 1. 커맨드 시그니처 (실제 구현)

```rust
#[tauri::command] #[specta::specta]
pub async fn oculpm_init(db, manager, project_id) -> Result<OculpmInitReport, String>;

#[tauri::command] #[specta::specta]
pub async fn oculpm_get_status(manager, project_id) -> Result<OculpmStatus, String>;

#[tauri::command] #[specta::specta]
pub async fn oculpm_get_config(manager, project_id) -> Result<OculpmConfig, String>;

#[tauri::command] #[specta::specta]
pub async fn oculpm_set_config(manager, project_id, new_config) -> Result<(), String>;
```

PR6 가 `OculpmManager` 까지 직접 구현 — `app.manage()` 등록도 본 PR 에서 수행 (W1-PR7 의 ProjectRuntime 확장과는 별개로 진행).

---

## 2. `OculpmManager::init_project` 구현 동작 (실제)

순서 (manager.rs):
1. **Fast path (idempotent)** — `projects.read()` 에서 이미 등록된 project_id 면 no-op report 반환 (created_dirs/wrote_config 모두 비움, lock_state 만 현재 상태)
2. config.toml 존재 시 load + validate, 없으면 `default_for_new_project()` (이미 validate 통과 보장)
3. `WorkdayResolver::new(tz, day_starts_at)` — 같은 검증 경로 재사용
4. `.oculpm/` mkdir (이미 있으면 created_dirs 비움)
5. `.schema-version` 없을 때만 atomic write `1\n`
6. config.toml 없을 때만 `default.save()` + `wrote_config = true`
7. `LockGuard::acquire(&lock_path).await` → `Acquired | Recovered | Held` 에 따라 `lock_state` 매핑 + guard 보관 (Held 면 `None` → read-only 모드)
8. `.gitignore` 관리 블록 — W1-PR8 미구현, `wrote_gitignore = false`
9. `ProjectEntry { root, config, resolver, lock }` 를 `projects.write()` 에 insert

**멱등성**: 두 번 호출해도 같은 결과. config.toml 덮어쓰기 X. heartbeat 가 살아있는 guard 는 그대로 유지.

---

## 3. lib.rs 변경

- [x] `use crate::commands::{... oculpm_init, oculpm_get_status, oculpm_get_config, oculpm_set_config}` 에 4개 추가
- [x] `collect_commands![...]` 에 4개 등록
- [x] `app.manage(crate::oculpm::manager::OculpmManager::new())` setup hook 에 추가

---

## 4. 단위 테스트 (4개 — `manager::tests`)

- [x] `init_creates_files_and_acquires_lock` — `.oculpm/`, `config.toml`, `.schema-version`, `.lock` 4개 파일 생성 + `lock_state: Healthy`
- [x] `init_is_idempotent` — 두 번째 init 의 `wrote_config: false` + `created_dirs: []`
- [x] `get_status_after_init` — init 전 `initialized: false / Uninitialized` → init 후 `initialized: true, Healthy, current_workday(YYYYMMDD), Stopped`
- [x] `set_config_persists_and_updates_resolver` — `inactivity_timeout` + `day_starts_at` 변경이 디스크 + in-memory 양쪽 반영. 잘못된 tz 로 set_config → `InvalidTimezone` 거부 + 디스크 unchanged

---

## 5. DoD

- [x] **4개 커맨드 + 4개 단위 테스트 통과** — `cargo test --lib oculpm::manager` 0.05s 실행, 4.96s 컴파일
- [x] 전체 oculpm 테스트 39/39 — 회귀 없음
- [x] `OculpmInitReport` 모든 필드 채워짐 (수동 테스트 + DevTools 가능)
- [x] 두 번째 init 호출 idempotent — `wrote_config: false`
- [x] `set_config` validate 실패 시 `Err(InvalidTimezone)` + config.toml unchanged 검증
- [x] specta — `pnpm tauri dev` 부팅 OK + `bindings.ts` 갱신:
  - `commands.oculpmInit(projectId) -> Promise<OculpmInitReport>`
  - `commands.oculpmGetStatus(projectId) -> Promise<OculpmStatus>`
  - `commands.oculpmGetConfig(projectId) -> Promise<OculpmConfig>`
  - `commands.oculpmSetConfig(projectId, newConfig) -> Promise<null>`
- [x] oculpm 격리 clippy lint 0건

---

## 6. 실행 노트

### 발견된 함정 / 변경

1. **`OculpmManager` AppHandle 미보유** — PR1 / PR7 doc 에는 `app_handle: tauri::AppHandle` 필드가 있었으나, PR6 시점에서는 emit 할 이벤트가 없고 `tauri::AppHandle<Wry>` 의 generic 처리가 tests 에서 까다로움. W2 에서 emit 이 필요해질 때 함수 시그니처 인자로 받는 방식으로 처리 예정. 이로써 tests 가 `OculpmManager::new()` 만으로 충분.

2. **`ProjectEntry` 의 `lock: Option<LockGuard>`** — `Held` 분기에서는 guard 를 받지 못하므로 None. 그 상태로 등록해두면 read-only 모드를 알리는 자연스러운 표현. `lock_state_from_guard` helper 가 `Some → Healthy`, `None → HeldByOther` 매핑.

3. **`Recovered` 의 lock_state 매핑** — manager 가 `Recovered { guard, info }` 의 `guard` 만 들고 (info 는 PR 단계에서 unused, W6 의 IntegrityWarning emit 으로 surface 예정) 보관. `lock_state: Recovered` 로 정확히 노출.

4. **set_config 의 resolver 갱신** — tz 또는 day_starts_at 변경 시 `WorkdayResolver::new` 재호출해서 in-memory 도 즉시 일관. 이후 `get_status` 가 새 tz 기준으로 workday 계산.

5. **`config.rs::load` 의 mut 변수** — `default_for_new_project` + `wrote_config = true` 분기에서 `mut wrote_config` 가 필요하나, validate 후에는 변경 안 됨. clippy 의 `unused_mut` 가 활성화될 수 있어 명시 패턴 — 현재 6 pre-existing warnings 중 일부와 동일하나 oculpm 영역은 깨끗.

### 빌드/테스트 시간
- `cargo test --lib oculpm::manager` 컴파일: **4.96s**, 실행: **0.05s**
- 전체 oculpm 39 tests 실행: **1.08s** (대부분 lock 의 tokio runtime overhead)
- `pnpm tauri dev` (re-compile + export): **~3s** (cached cargo + immediate Specta export)
- bindings.ts mtime 갱신 확인 → 4개 커맨드 + OculpmConfig 의 모든 sub-config 가 TypeScript export

### 다음 PR 로 넘기는 메모

- **W1-PR7 (manager bootstrap)**: `OculpmManager` 의 `on_project_opened(project_id)` / `on_project_closed(project_id)` 추가. `commands/project.rs::open_project` 끝에 hook 호출. `tauri::RunEvent::ExitRequested` 에서 `manager.shutdown_all()` 호출하여 모든 LockGuard release.
- **W1-PR8 (.gitignore)**: `init_project` 의 단계 8을 채움 — `atomic_io::write_managed_block(.gitignore, ...)` 호출 후 `report.wrote_gitignore` 갱신.
- **W2 (watcher)**: AppHandle 인자 통과 + `OculpmWatcher` 를 `ProjectEntry` 에 추가. 현재 `watcher_state: Stopped` 가 `Running` 으로 전환.
