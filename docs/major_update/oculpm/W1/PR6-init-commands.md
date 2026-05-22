# W1-PR6 — 4개 커맨드: init / get_status / get_config / set_config

> **목표**: 첫 사용자 노출 가능한 Tauri 커맨드 4개. invoke 가능하고 round-trip 가능.
> **선행**: W1-PR1~PR5 ✅
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR6.

---

## 1. 커맨드 시그니처 (정확히)

```rust
#[tauri::command]
#[specta::specta]
pub async fn oculpm_init(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmInitReport, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_status(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmStatus, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_get_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<OculpmConfig, String>;

#[tauri::command]
#[specta::specta]
pub async fn oculpm_set_config(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    new_config: OculpmConfig,
) -> Result<(), String>;
```

`State<'_, OculpmManager>` 가 컴파일되려면 W1-PR7 에서 `app.manage(OculpmManager::new(...))` 가 되어야 함 → PR6 와 PR7 는 사실상 한 묶음. PR6 의 코드 안에 `OculpmManager` 구조체 minimal 정의 (W1-PR7 에서 본격 확장).

---

## 2. `OculpmManager::init_project` 의 본 PR 동작

1. lock acquire (재진입 시 동일 PID 면 OK, 다른 PID 면 Held)
2. `.oculpm/` mkdir
3. `.schema-version` atomic write `1`
4. `config.toml` 없으면 default 로 write, 있으면 load + validate
5. `.gitignore` 관리 블록 — W1-PR8 에서 추가. 본 PR 은 자리만.
6. `OculpmInitReport` 반환

멱등성: 두 번 호출해도 같은 결과. config.toml 덮어쓰기 X.

---

## 3. lib.rs 의 collect_commands! 갱신

```rust
crate::commands::oculpm_init,
crate::commands::oculpm_get_status,
crate::commands::oculpm_get_config,
crate::commands::oculpm_set_config,
```

(이미 W1-PR2 에서 collect_events! 도 추가됨)

---

## 4. DoD

- [ ] 4개 커맨드 invoke 성공 (DevTools 콘솔에서)
- [ ] `OculpmInitReport` 의 모든 필드가 채워짐
- [ ] 두 번째 init 호출은 idempotent (config.toml mtime 유지)
- [ ] set_config 가 validate 실패 시 `Err` 반환 (config.toml 변경 안 됨)
- [ ] specta 가 4개 커맨드 + OculpmInitReport / OculpmStatus / OculpmConfig 를 TypeScript 로 export

---

## 5. 실행 노트
- (작업 중 채움)
