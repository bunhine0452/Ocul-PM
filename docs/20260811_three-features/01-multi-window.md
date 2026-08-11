# 01 — 멀티 프로젝트 창

> [00-master-plan.md](00-master-plan.md) Phase 1 · 예상 ~5일 · 목표 릴리스 v2.9.0

## 1. 모델

메인 창(`main`)은 **런처 전용**이 됩니다. 프로젝트 셸을 다시는 띄우지 않습니다.

```
        [main]  런처                    [project-3]              [project-7]
        ┌──────────────────┐            ┌──────────────────┐     ┌──────────────────┐
        │ StartScreen      │            │ Sidebar│ ShellV2 │     │ Sidebar│ ShellV2 │
        │  · ai-pm     ────┼──── 새 창 ─▶│  ai-pm          │     │  saju            │
        │  · saju      ────┼─────────────┼──────────────────┼────▶│                  │
        │  · landing       │            │ 독립 터미널·상태  │     │ 독립 터미널·상태  │
        │ + 프로젝트 추가   │            └──────────────────┘     └──────────────────┘
        └──────────────────┘
             ▲
             └── 창을 닫아도 앱은 안 죽는다 (열린 프로젝트 창이 있으면)
```

**불변식 3개:**

- **I1** — 프로젝트 하나당 창 하나. 이미 열려 있으면 새로 만들지 않고 포커스한다.
- **I2** — 런처는 절대 `ShellV2` 를 마운트하지 않는다. `currentProjectId` 는 런처 창에서 영원히 `null`.
- **I3** — 창의 프로젝트는 URL 이 결정하며 런타임에 바뀌지 않는다. "프로젝트 전환"은 곧 "다른 창을 포커스"다.

I3 가 핵심입니다. 지금은 한 창 안에서 `setProject()` 로 프로젝트를 갈아끼우는데, 이걸 없애면 창 하나의 상태 수명이 창의 수명과 같아지고 격리 문제 절반이 사라집니다.

## 2. 진입점 — 이미 있는 전례를 그대로 쓴다

`main.tsx:26-28` 이 이미 쿼리 파라미터로 진입점을 분기합니다:

```ts
const isTrayWindow = new URLSearchParams(window.location.search).has("tray");
```

여기에 `project` 를 추가합니다. 세 갈래가 됩니다:

| URL | 라벨 | 마운트 |
|---|---|---|
| `index.html?tray=1` | `tray` | `TrayApp` (기존, 무변경) |
| `index.html?project=<id>` | `project-<id>` | `SettingsProvider` → `WorkspaceProvider(projectId)` → `ProjectWindow` |
| `index.html` | `main` | `SettingsProvider` → `LauncherWindow` |

런처는 **`WorkspaceProvider` 를 마운트하지 않습니다.** 런처에 필요한 건 프로젝트 목록과 설정뿐이고, 워크스페이스 상태(현재 화면·터미널 탭·필터)는 프로젝트 창의 개념이기 때문입니다. 이러면 R3(localStorage 충돌)의 절반이 구조적으로 사라집니다 — 런처는 아예 쓰기를 안 합니다.

## 3. 함정 5개 — 여기가 진짜 작업이다

### T1 — capability 누락 (R2) · **최우선**

`src-tauri/capabilities/default.json:5`:

```json
"windows": ["main", "tray"],
```

새 라벨은 여기 없어서 **모든 IPC 가 조용히 실패**합니다. 창은 정상적으로 뜨고 React 도 렌더되는데 `commands.*` 가 전부 permission denied 로 죽어서 빈 화면만 나옵니다. 원인 추적이 매우 어려운 실패 모드입니다.

스키마 확인 완료 — `windows` 는 글롭을 지원합니다 (`gen/schemas/macOS-schema.json`: *"Can be a glob pattern"*):

```json
"windows": ["main", "tray", "project-*"],
```

### T2 — "메인 창 닫기 = 앱 종료" (R1) · **가장 위험**

`src-tauri/src/tray.rs:498-505`:

```rust
pub fn handle_main_close_requested(app: &AppHandle) -> bool {
    let keep = ...setting_on(&db, SETTING_KEEP_RUNNING, false)...;
    if !keep {
        app.exit(0);          // ← 런처 닫으면 프로젝트 창이 전부 죽는다
        return false;
    }
    ...
}
```

지금은 창이 사실상 하나라 "메인 닫기 = 종료"가 맞는 계약이었습니다. 런처 모델에서는 **사용자가 런처를 치우려고 닫았을 뿐인데 작업 중인 프로젝트 창 3개가 같이 죽습니다.**

새 규칙:

```
런처 닫기 요청
  ├─ 열린 project-* 창이 있다  → 런처만 숨김 (앱 유지)
  └─ 없다
       ├─ 상주 설정 ON   → 숨김 (기존)
       └─ 상주 설정 OFF  → app.exit(0) (기존 계약 유지)
```

그리고 **마지막 프로젝트 창이 닫힐 때**도 대칭 처리가 필요합니다: 런처가 숨겨져 있고 상주 설정이 꺼져 있으면 종료, 아니면 런처를 다시 보여줍니다. 이 판정을 안 넣으면 "창이 하나도 없는데 프로세스는 살아 있는" 유령 상태가 됩니다 — 트레이 팝오버 창이 숨겨진 채 살아 있어서 Tauri 의 "마지막 창 닫힘 → 종료"가 자연 발화하지 않습니다 (`tray.rs:500-503` 주석이 이미 이 사실을 기록하고 있습니다).

### T3 — localStorage 단일 키 (R3)

`WorkspaceContext.tsx:274`:

```ts
const STORAGE_KEY = "aipm:workspace:v1";
```

`loadFromStorage()` (L437) 와 `persistToStorage()` (L496) 가 모듈 레벨 함수로 이 상수를 직접 참조합니다. 창 두 개가 같은 origin 이라 localStorage 를 공유하고, 300ms 디바운스 저장(L545-552)이 서로를 계속 덮어씁니다. 결과: 창 B 에서 터미널 탭을 만들면 창 A 의 탭이 사라집니다.

**해결** — 키를 프로젝트별로 쪼개고 두 함수를 프로젝트 id 를 받도록 바꿉니다:

```ts
const storageKeyFor = (projectId: number) => `aipm:workspace:v2:p${projectId}`;
function loadFromStorage(projectId: number): WorkspaceState { … }
function persistToStorage(projectId: number, state: WorkspaceState) { … }
```

`WorkspaceProvider` 가 `projectId` 를 prop 으로 받아 `useState(() => loadFromStorage(projectId))` 로 초기화합니다.

**마이그레이션** — 기존 `aipm:workspace:v1` 레코드에는 마지막으로 열었던 `currentProjectId` 가 들어 있습니다. 그 값을 읽어 `…v2:p<그 id>` 로 1회 이관하고 v1 키를 삭제합니다. `currentProjectId` 가 `null` 이면 그냥 버립니다 (런처 상태라 이관할 게 없음).

`WORKSPACE_SCHEMA_VERSION` 을 **3 → 4** 로 bump 합니다. 필드 추가가 아니라 키 분할이므로 breaking 이고, `WorkspaceContext.tsx:216-228` 의 History 주석 규칙상 bump 대상입니다.

세 필드 `currentProjectId` / `currentProjectName` / `currentProjectRoot` 는 이제 창이 URL 로 확정하므로 영속 대상에서 뺍니다 (`persistToStorage` 의 구조분해 제외 목록에 추가). 저장했다가 다시 읽으면 URL 과 어긋날 수 있는 중복 진실입니다.

**`resetWorkspace`** (L607) 는 지금 "대시보드로 돌아가기"에 쓰입니다. I3 하에서는 프로젝트 전환이 사라지므로 호출처가 없어집니다 — 제거하거나 "이 창의 상태 초기화"로 의미를 바꿉니다.

### T4 — 전역 PtyState 와 sid 충돌 (R4)

`commands/terminal.rs:80`:

```rust
pub struct PtyState { pub sessions: Arc<Mutex<HashMap<String, PtySession>>> }
```

sid 는 프런트가 만듭니다 — `TerminalScreenV2.tsx:49`:

```ts
return Math.random().toString(36).slice(2, 10);   // 8자 base36
```

문제 두 개:

1. **충돌** — 8자 base36(≈36⁸)이라 확률은 낮지만, 창별 시드가 없어 이론상 두 창이 같은 sid 를 뽑을 수 있습니다. 그러면 한 창의 입력이 다른 창의 셸로 갑니다. 창 라벨을 접두사로 붙이면 (`p3-a1b2c3d4`) 구조적으로 불가능해집니다 — 비용 0의 보험입니다.
2. **누수** — 창을 닫아도 PTY 가 안 죽습니다. 현재는 창 닫기 = 앱 종료라 프로세스와 함께 사라졌지만, 이제는 좀비 셸이 남습니다. 창의 `CloseRequested` 훅에서 `p<id>-` 접두사를 가진 세션을 전량 `kill` 합니다. 프런트의 `beforeunload` 에 맡기면 강제 종료 시 새므로 **Rust 쪽에서** 처리합니다.

### T5 — 트레이 딥링크가 `"main"` 하드코딩

`tray.rs:508` (`handle_main_close_requested`) · `tray.rs:526` (`show_main`) 이 `get_webview_window("main")` 을 직접 부릅니다.

`TrayNavigate` 는 이미 `project_id` 를 들고 있습니다 (`tray.rs:52-57`):

```rust
pub struct TrayNavigate {
    pub view: String,
    pub project_id: Option<u32>,
    pub entry_path: Option<String>,
}
```

`tray_open_main` (L596) 은 지금 항상 메인을 띄우고 이벤트를 전역 emit 합니다. 새 라우팅:

```
project_id 가 있다 → 해당 project-<id> 창을 (없으면 만들어서) 포커스 → 그 창에만 emit
project_id 가 없다 → 런처를 포커스
```

전역 emit 을 창 지정 emit 으로 바꾸지 않으면, 트레이에서 프로젝트 A 의 일지를 클릭했을 때 열려 있는 **모든** 창이 그 일지로 점프합니다.

## 4. 백엔드 설계

### 4.1 신규 커맨드 (`commands/window.rs`)

```rust
open_project_window(app, project_id: u32) -> Result<(), String>
   // 있으면 show + unminimize + set_focus, 없으면 build.
   // 라벨 project-<id>, URL index.html?project=<id>
   // macOS 는 main 과 동일하게 TitleBarStyle::Overlay 적용

list_open_project_windows(app) -> Result<Vec<u32>, String>
   // 런처가 "열림" 배지를 그리기 위해. 창 열기/닫기 시 이벤트로도 통지
```

이벤트 `ProjectWindowsChanged { open: Vec<u32> }` 를 `collect_events![]` 에 추가해 런처가 실시간으로 배지를 갱신합니다.

### 4.2 정리해야 할 죽은 코드

`commands/window.rs:20` 의 `open_terminal_window` 는 **등록돼 있고**(`lib.rs:262`) **bindings 에도 나가 있는데**(`bindings.ts:169`) 프런트에서 아무도 호출하지 않습니다. 게다가 호출하면 깨집니다:

- 라벨 `terminal_detached` 가 capability 목록에 없음 (T1 과 같은 실패)
- URL `/?window=terminal` 을 `main.tsx` 가 처리하지 않아 앱 셸이 통째로 다시 뜸

이번 라운드에서 **삭제**합니다. 남겨두면 다음 사람이 "멀티 창 지원이 이미 있네"로 오독합니다.

### 4.3 lib.rs 조정

`lib.rs:410-414` 의 macOS 타이틀바 처리는 `"main"` 만 대상입니다. 새 창은 `open_project_window` 안에서 빌드 직후 같은 처리를 합니다.

`lib.rs:441-450` 의 `CloseRequested` 훅은 main 전용이라 그대로 두고, 프로젝트 창용 훅은 `open_project_window` 안에서 붙입니다 (T4 의 PTY 정리 + T2 의 마지막 창 판정).

`shutdown_all_blocking` (`lib.rs:519`) 은 `ExitRequested` 에 걸려 있어 그대로 유효합니다.

## 5. 프런트 설계

### 5.1 `App.tsx` 분해 (563줄 → 3파일)

현재 `App.tsx` 는 런처 관심사와 프로젝트 셸 관심사가 섞여 있습니다:

| 현재 위치 | 관심사 | 이동처 |
|---|---|---|
| L207-260 (`refreshProjects` / `handleAddProject` / `startIndex`) | 프로젝트 CRUD·인덱싱 | `LauncherWindow.tsx` |
| L262-300 (rename/delete 다이얼로그 상태) | 프로젝트 CRUD | `LauncherWindow.tsx` |
| L108-180 (`.oculpm` init + watcher + 템플릿 업그레이드 토스트) | 프로젝트 셸 | `ProjectWindow.tsx` |
| L182-201 (자동 인덱싱) | 프로젝트 셸 | `ProjectWindow.tsx` |
| `GreenfieldWizard` | 런처 | `LauncherWindow.tsx` |
| `UpdateBanner` / `EmbeddingModelBanner` / `SettingsOverlay` | 공용 | 양쪽에서 각각 마운트 |

`handleSelectProject` (L302) 는 `setProject(...)` 대신 `commands.openProjectWindow(p.id)` 를 부릅니다. `handleBackToDashboard` (L308) 는 사라집니다.

### 5.2 단축키·팔레트

`useGlobalShortcuts` (`hooks/useGlobalShortcuts.ts`) 는 두 창에서 다르게 동작해야 합니다:

- 런처: `⌘K`(팔레트) · `⌘,`(설정) 만. `⌘1~⌘0` · `⌘\` 는 마운트된 셸이 없으니 무시 — 이미 `App.tsx:88-96` 의 `navFromShortcut` 가 같은 판단을 하고 있으므로 그 로직이 런처 쪽으로 옮겨가는 셈입니다.
- 프로젝트 창: 전부 동작 (현행 유지).

`⌘P` 프로젝트 전환은 의미가 바뀝니다. 지금은 사이드바 팝오버에서 제자리 전환(`Sidebar.tsx:201`)인데, I3 하에서는 **다른 창으로 포커스 이동 또는 새 창 열기**입니다. 팝오버 UI 는 그대로 두고 클릭 핸들러만 `openProjectWindow` 로 바꿉니다 — 이미 열린 프로젝트에는 "열림" 표시를 붙입니다.

`CommandPalette` 의 `onSelectProject` (`App.tsx:340`) 도 같습니다.

### 5.3 신규 UI

- 런처의 프로젝트 카드에 **"열림" 배지** — `ProjectWindowsChanged` 이벤트 구독
- 프로젝트 창 사이드바 하단에 **"런처 열기"** — 현재 `onOpenProjectSwitcher` 자리
- 프로젝트 창 제목 = 프로젝트 이름 (macOS 창 전환기·Mission Control 에서 구분되도록)

## 6. 테스트

기존 vitest 스위트가 `WorkspaceProvider` 를 기본 상태로 마운트하는 것에 의존합니다. `scripts/check-no-localstorage.mjs` 의 allowlist 에 있는 테스트 6개가 전부 `aipm:workspace:v1` 을 직접 seed/clear 합니다:

```
__tests__/lite_w6_safety_net.test.ts
__tests__/a11y_screens.test.tsx
__tests__/journal_v2.test.tsx
__tests__/diff_v2.test.tsx
__tests__/tools_v2.test.tsx
__tests__/workday_rollover.test.tsx
```

키가 바뀌므로 **6개 전부 갱신 필요**합니다. `storageKeyFor` 를 export 해서 테스트가 하드코딩 대신 그 함수를 쓰게 합니다.

신규 테스트:

| 대상 | 검증 |
|---|---|
| `storageKeyFor` | 프로젝트별 키가 서로 다름 |
| v1→v2 마이그레이션 | `currentProjectId` 있는 v1 레코드가 올바른 v2 키로 이관되고 v1 이 삭제됨. `null` 이면 폐기 |
| `WorkspaceProvider(projectId)` | 서로 다른 두 id 로 마운트하면 상태가 격리됨 |
| 창 라우팅 (`main.tsx` 분기) | `?project=3` / `?tray=1` / 무파라미터가 각각 다른 트리를 마운트 |

Rust 통합 테스트로는 창 생명주기를 직접 검증하기 어렵습니다 (Tauri 런타임 필요). T2 의 종료 판정 로직만 순수 함수로 뽑아 단위 테스트합니다:

```rust
fn should_exit_on_launcher_close(open_project_windows: usize, keep_running: bool) -> bool
```

## 7. 수동 검증 시나리오 (Phase 1 게이트)

1. 프로젝트 3개를 각각 열고 창 3개 + 런처가 뜬다
2. 각 창에서 터미널 탭을 만들고 서로 다른 디렉토리로 `cd` — 섞이지 않는다
3. 각 창에서 다른 화면(Today / 플래너 / diff)으로 이동 — 창을 오가도 유지된다
4. 창 하나를 닫는다 → 나머지 두 창의 watcher·PTY 가 살아 있다 (파일을 바꿔 Today 에 잡히는지 확인)
5. 닫은 프로젝트를 런처에서 다시 연다 → 3번의 화면 상태가 복원된다
6. **런처를 닫는다 → 앱이 죽지 않는다** (R1)
7. 마지막 프로젝트 창까지 닫는다 → 상주 설정에 따라 종료되거나 런처가 돌아온다
8. 이미 열린 프로젝트를 런처에서 다시 클릭 → 새 창이 아니라 기존 창이 포커스된다 (I1)
9. 트레이 팝오버에서 프로젝트 A 의 일지 클릭 → A 의 창만 반응한다 (T5)
