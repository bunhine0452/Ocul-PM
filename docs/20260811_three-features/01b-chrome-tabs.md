# 01b — 크롬식 탭 (Phase 1b)

> [01-multi-window.md](01-multi-window.md) 의 후속 · 2026-08-12 사용자 결정 · 목표 릴리스 v2.9.0

## 0. 결정

| # | 질문 | 결정 |
|---|---|---|
| 1 | 탭 모델 | **창 안에 탭 (Chrome 그대로)** — 창도 여러 개, 창마다 탭도 여러 개 |
| 2 | 드래그 범위 | **1차: 순서 변경 + 창 밖으로 떼어내기.** 다른 창에 합치기는 2차 |
| 3 | 시작 화면 (2026-08-12 추가) | 프로젝트 메인 화면을 **시작 탭**으로 — `+` 는 시작 탭을 열고, 거기서 프로젝트를 고르면 **그 자리에서** 프로젝트 탭이 된다. "런처 전용 창" 은 없어진다 |

## 1. 불변식 재작성

Phase 1 의 I1~I3 이 한 단계씩 내려간다.

| | Phase 1 | Phase 1b |
|---|---|---|
| **I1** | 프로젝트당 창 하나 | **프로젝트당 탭 하나 — 전역 유일.** 이미 어딘가 열려 있으면 그 창을 포커스하고 그 탭을 활성화한다 |
| **I2** | 런처는 셸을 마운트하지 않는다 | 그대로 |
| **I3** | 창의 프로젝트는 URL 이 정하고 안 바뀐다 | **프로젝트 탭의 프로젝트는 탭의 수명 동안 안 바뀐다.** 시작 탭 → 프로젝트 탭 승격만 한 방향으로 허용된다 |

I2 는 "런처는 셸을 마운트하지 않는다" 였는데, 런처 창 자체가 사라지면서 **"시작 탭은 `WorkspaceProvider` 를 마운트하지 않는다"** 로 내려갔다. 시작 탭에는 프로젝트가 없으므로 워크스페이스 상태라는 개념 자체가 없다.

I1 이 "창"에서 "탭"으로 내려가도 **D2(프로젝트당 watcher 하나)는 그대로 성립한다** — `OculpmManager.projects` 는 여전히 refcount 가 없고, 전역 유일성이 그걸 계속 보장한다. Phase 1 에서 한 프로젝트별 localStorage 분리(T3)도 그대로 유효하다: 키가 창이 아니라 **프로젝트**에 묶여 있어서, 프로젝트가 창을 옮겨 다녀도 상태가 따라간다.

## 2. 창 = 프로젝트 집합

라벨이 `project-<id>` 에서 **`win-<n>`** 으로 바뀐다 (`n` 은 프로세스 수명 동안 단조 증가). `tauri.conf.json` 이 만드는 첫 창 `main` 도 **특별하지 않다** — 시작 탭 하나를 문 평범한 탭 창이고, setup 에서 `adopt_first_window` 로 레지스트리에 편입된다. 창이 어떤 프로젝트를 물고 있는지는 더 이상 라벨에서 읽을 수 없으므로 **백엔드가 레지스트리를 소유**한다:

```rust
WindowTabs {
    windows: HashMap<String /*label*/, WindowState>,
    last_focused: Option<String>,   // 새 탭이 어느 창에 붙을지 결정
    next_window: u32, next_tab: u32,
}
WindowState { order: Vec<Tab>, active: Option<u32 /*tab id*/> }
Tab { id: u32, project_id: Option<u32> }   // None = 시작 탭
```

탭 id 는 **프로젝트 id 와 별개의 네임스페이스**다 — 시작 탭에는 프로젝트가 없고, 같은 프로젝트가 탭을 옮겨도 탭 신원은 유지돼야 하기 때문이다.

백엔드가 SSOT 인 이유 셋:

1. **전역 유일성(I1)** — 두 창이 같은 프로젝트를 물지 않게 하려면 창을 가로지르는 심판이 필요하다. 프런트는 자기 창만 안다.
2. **PTY·watcher 정리** — 창을 닫을 때 "이 창의 탭 전부"를 알아야 한다. 프런트 `beforeunload` 는 강제 종료에서 안 돈다 (Phase 1 T4 와 같은 이유).
3. **떼어내기** — 새 창을 만들면서 탭을 옮기는 건 창 생성 권한이 있는 Rust 만 할 수 있다.

프런트는 `WindowTabsChanged` 이벤트로 미러링만 한다.

### 2.1 커맨드

```
open_project_tab(project_id, window)  이미 열려 있음 → 그 창 포커스 + 탭 활성화 (I1)
                                      아니면 지정/마지막 포커스 창에 추가, 없으면 새 창
new_start_tab(window)                 `+` — 시작 탭
set_tab_project(tab_id, project_id)   시작 탭 → 프로젝트 탭 제자리 승격
close_tab(tab_id)                     창의 마지막 탭이면 창도 닫는다
activate_tab(tab_id)
reorder_tabs(window, order)           tab id 순서
detach_tab(tab_id, x, y)              화면 좌표에 새 창
get_window_tabs(window)               { tabs: [{tab_id, project_id, name, root}], active }
list_open_project_ids()               시작 화면 "열림" 배지
```

**휴면 창 재사용** — 웹뷰는 살아 있는데 레지스트리에 없는 창(앱 시작 직후의 `main`, 상주 모드에서 숨겨 둔 마지막 창)을 새 창보다 먼저 쓴다. 안 그러면 숨은 웹뷰가 영원히 남고 매번 새 라벨이 발급된다.

`window: None` 이 **새 창이 아니라 마지막 포커스 창**인 이유: 1차에는 "다른 창에 합치기"가 없다. 런처가 매번 새 창을 열면 사용자가 탭으로 모을 방법이 없어진다. 반대 방향(합쳐진 걸 떼어내기)은 1차에 있으므로, 기본값을 "합치기"로 두면 부족한 기능을 아무도 필요로 하지 않는다.

## 3. 프런트 — 탭 전부를 마운트한 채 숨긴다

```
TabbedWindow (창 1개)
 ├─ TabStrip                          ← 드래그 순서 변경 · 떼어내기 · + · ×
 └─ for each tab:
      <div class="tabpane" hidden={!active}>
        <WorkspaceProvider projectId={pid}>   ← 탭마다 하나
          <ProjectTab active={pid === activeId} />
        </WorkspaceProvider>
      </div>
```

한 번이라도 연 탭은 **언마운트하지 않는다** — Chrome 과 같고, watcher·PTY·AI 응답이 계속 돈다. 아직 한 번도 활성이 아니었던 탭은 마운트를 미룬다(창을 열자마자 N 개 프로젝트의 init·watcher·자동색인이 동시에 터지지 않게 — Chrome 의 지연 탭 복원과 같은 절충). 대신 창 단위로 하나여야 하는 것들이 N 번 발화하지 않도록 `active` 로 게이트한다:

| 대상 | 왜 |
|---|---|
| `useGlobalShortcuts` | ⌘1~⌘0 이 N 번 발화한다 |
| `NAV_BUS.openEntity` / `openProjectSwitcher` | 창 전역 CustomEvent — 모든 탭이 반응한다 |
| `CommandPalette` · `SettingsOverlay` | 활성 탭의 워크스페이스 컨텍스트가 필요해서 탭 안에 산다 |
| 터미널 xterm | `display:none` 에서는 fit 이 0 칼럼 — 이미 `TerminalInstanceImpl` 의 `ResizeObserver` 가 0→N 점프를 처리한다 (신규 작업 없음) |
| 트레이 딥링크 | URL 은 창 수명 내내 남는다 — **창이 한 번만** 배달하고 소비 후 비운다. 탭마다 넘기면 나중에 연 탭도 같은 목적지로 점프한다 |

`WorkspaceContext` 의 Tauri 이벤트 리스너는 이미 `project_id === currentProjectId` 로 거르므로 손댈 게 없다.

창 단위로 한 번만 있으면 되는 것(`BootSplash` · `UpdateBanner` · `EmbeddingModelBanner`)은 탭 루프 **밖**으로 올린다.

### 3.1 설정은 창을 가로질러 맞춘다

창이 여럿이고 트레이 팝오버는 앱 시작 때 한 번 만들어져 세션 내내 살아 있다. `SettingsProvider` 는 마운트 때 한 번만 읽으므로, 한 창에서 테마·언어를 바꿔도 나머지 창과 상단바는 예전 값을 계속 그린다 (**실제로 보고된 증상**). 백엔드가 `settings_set`/`settings_set_many` 직후 `SettingsChanged` 를 쏘고, 모든 `SettingsProvider` 가 듣고 다시 읽는다.

## 4. 드래그

### 4.1 순서 변경

포인터 x 로 삽입 인덱스를 계산한다 (`tabDropIndex` 순수 함수 — 단위 테스트 대상). 놓으면 `reorder_project_tabs`.

### 4.2 떼어내기

스트립의 세로 범위를 `DETACH_THRESHOLD_PX` 이상 벗어나면 "떼어내기" 모드로 전환하고, `pointerup` 에서 `detach_project_tab(pid, screenX, screenY)` 를 부른다. `PointerEvent.screenX/Y` 는 CSS 픽셀 화면 좌표라 Tauri 의 `LogicalPosition` 과 단위가 맞는다.

떼어낸 탭은 새 창에서 **다시 마운트**된다 — 스크롤 위치 같은 DOM 상태는 잃지만, 화면·필터·터미널 탭 구성은 프로젝트별 localStorage 에 있고 **PTY 세션은 Rust 에 살아 있어** 스크롤백까지 재부착된다 (`PtyAttach`). sid 접두사가 `p<projectId>-` 로 **프로젝트** 기준이라 창을 옮겨도 유효하다 — 이건 Phase 1 T4 의 우연한 이득이 아니라 그때 프로젝트 기준으로 고른 결과다.

### 4.3 그 밖의 탭 조작

| 조작 | 동작 |
|---|---|
| `⌘T` | 새 시작 탭 |
| `⌃Tab` / `⌃⇧Tab` · `⌘⌥→` / `⌘⌥←` | 다음/이전 탭 (⌘번호는 화면 전환이 이미 쓴다 — 겹치면 안 된다) |
| `←` `→` (탭에 포커스) | 이웃 탭 (WAI-ARIA tablist) |
| `Delete` / `Backspace` (탭에 포커스) | 탭 닫기 — × 어포던스의 키보드 등가물 |
| 가운데 클릭 | 탭 닫기 |
| 빈 스트립 더블클릭 | 새 탭 |
| `+` 우클릭 | 아직 안 열린 프로젝트 지름길 (시작 탭을 거치지 않고 바로) |
| 탭 활동 점 | 그 프로젝트에 세션이 도는 중 — **백그라운드 탭에서는 이게 유일한 신호** |

`⌘W` 는 건드리지 않는다 — macOS 기본 메뉴가 먼저 잡아 "창 닫기"로 간다. 탭 닫기로 바꾸려면 앱 메뉴를 직접 구성해야 하는데(Edit 메뉴까지 재구성 필요) 이번 범위 밖이다.

### 4.4 1차 범위 밖

- 다른 창의 스트립에 드롭해서 합치기 (Rust 화면좌표 히트테스트 필요)
- 고스트 탭 미리보기 (Chrome 의 반투명 탭)
- 앱 재시작 시 탭 세션 복원

## 5. macOS 크롬

스트립이 창 최상단을 차지하므로 신호등(traffic lights)과 겹친다. Chrome/Safari 처럼 스트립 왼쪽에 `TRAFFIC_LIGHT_INSET` 만큼 비우고, 스트립의 빈 공간은 `data-tauri-drag-region` 으로 창 드래그를 받는다. 대신 사이드바의 `macTopInset` 은 0 이 된다 — 신호등 자리를 이제 스트립이 책임진다.

## 6. 테스트

| 대상 | 검증 |
|---|---|
| 레지스트리 (Rust) | 전역 유일 · 마지막 탭 닫으면 창도 닫힘 · 떼어내기가 원본에서 제거 · 재정렬이 미지의 id 를 무시 |
| `tabDropIndex` (TS) | 경계·역방향·자기 자리 |
| `parseWindowRoute` | `?win=win-2` · 딥링크 파라미터 · 쓰레기 폴백 |
| 활성 게이트 | 비활성 탭이 ⌘번호·NAV_BUS 에 반응하지 않음 |

## 7. 수동 검증

1. 창 하나에 프로젝트 3개를 탭으로 열고 전환 — 각 탭의 화면·필터가 유지된다
2. 백그라운드 탭의 터미널이 계속 돈다 (`sleep 30 && echo done` 후 전환)
3. 탭을 끌어 순서를 바꾼다
4. 탭을 창 밖으로 끌어 새 창을 만든다 — 그 탭의 터미널 스크롤백이 살아 있다
5. 마지막 탭을 닫으면 창이 닫힌다
6. 시작 탭에서 이미 열린 프로젝트를 클릭 — 새 탭이 아니라 그 탭이 활성화된다 (I1)
7. 창이 둘일 때 하나를 닫아도 앱이 안 죽는다 (Phase 1 R1 회귀)
8. 트레이에서 프로젝트 A 의 일지 클릭 — A 의 탭이 있는 창만 반응하고 그 탭이 활성화된다
9. 시작 탭에서 프로젝트를 고르면 **그 탭이** 그 프로젝트가 된다 (새 탭이 안 생긴다)
10. 앱에서 테마를 바꾸면 **다른 창과 상단바(트레이 팝오버)도** 즉시 따라간다
11. 상단바에서 프로젝트를 고르고 "앱 열기" — 그 프로젝트 탭이 열린다
