# 04. 삭제 · 마이그레이션 — Code Workbench · Dock · SidePanel · State

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) U7 + [`02-screen-specs.md`](./02-screen-specs.md) §9 의 구체 실행.
> Lite-W6 의 [`../02-removal-plan.md`](../02-removal-plan.md) 와 같은 *위에서 아래* 원칙을 따른다.

---

## 0. 삭제의 원칙 (Lite-W6 와 동일)

1. **UI → command → 영속 state → DB** 순. 사용자가 클릭할 수 있는 표면부터 잘라낸다.
2. **각 PR-UI 머지 시 빌드 / typecheck / 통합 테스트 green**. "잠시 깨진다" 허용 안 됨.
3. **삭제 직전 git tag** `pre-cut-PR-UI<N>`. 회귀 시 cherry-pick.
4. **`ui_v2` feature flag** 가 *부드러운 분기*. PR-UI 7 에서 영구 ON + flag 코드 제거.
5. **삭제 코드 보존**: legacy 폴더로 *이동* (영구 보존, 빌드 제외). 1.0 이후 누군가 *왜 사라졌는지* 물어볼 때의 자료.

---

## 1. 의존 그래프 — 무엇을 먼저 잘라야 안 깨지는가

### 1.1 Code Workbench 묶음

```
                           ┌──────────────────────┐
                           │ src/App.tsx          │
                           │  PRIMARY_NAV (3 IA)  │
                           │  Workspace (ui_v1)   │
                           └──────────┬───────────┘
                                      │
                          ┌───────────┴────────────┐
                          ▼                        ▼
              ┌─────────────────────┐  ┌──────────────────────┐
              │ CodeWorkbench.tsx   │  │ TerminalDock.tsx      │
              │  sub-tabs 4         │  │  split / fullscreen   │
              │  - Files (FileExp)  │  │  ⌘J / ⌘⇧J             │
              │  - AI (AiWorkbench) │  └──────────┬───────────┘
              │  - Graph (xyflow)   │             │
              │  - Terminal         │             │
              └─────┬────┬───┬───┬──┘             │
                    │    │   │   │                │
              ┌─────┘    │   │   └────────┐       │
              ▼          ▼   ▼            ▼       ▼
        ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
        │FileExp  │ │AiWBench│ │Graph     │ │TerminalP │
        │.tsx     │ │.tsx    │ │xyflow    │ │.tsx (PTY)│
        └────┬────┘ └────┬───┘ └──────────┘ └──────────┘
             │           │
             │           └─→ AiOverlay.tsx 도 사용 (공유 state)
             │
             └─→ recentChanges (WorkspaceContext)
                 ⌘B SidePanel.tsx
```

```
                           ┌──────────────────────┐
                           │ WorkspaceContext     │
                           │  v2 (Lite-W6 PR7)    │
                           │  17+ persisted keys  │
                           └──────────┬───────────┘
                                      │
              ┌────────────┬──────────┴──────────┬────────────┐
              ▼            ▼                     ▼            ▼
        codeSubTab   bottomDrawerTab        layoutMode   sidePanelOpen
        ("files"     ("terminal"            "main-only"  boolean
         |...)        |...)                  |"split"
                                             |"terminal-only")
```

→ 삭제 순서:
1. **PR-UI 1** — 신 사이드바 + Shell 이 *flag-on 일 때 마운트*. flag-off 는 기존 Workspace 유지. *공존*.
2. **PR-UI 2~6** — 신 화면들이 flag-on 에서만 보임. 기존 Code/Plan/Today 도 flag-off 로 그대로 동작.
3. **PR-UI 7** — flag 영구 ON 후:
   - `CodeWorkbench.tsx`, `AiWorkbench.tsx`, `TerminalDock.tsx`, `SidePanel.tsx`, `FileExplorer.tsx` (현 위치) → **`src/legacy/` 로 이동**, 빌드 제외.
   - `WorkspaceContext.tsx` schema v3 마이그레이션 — §3 참조.
   - `useGlobalShortcuts.ts` 의 ⌘B / ⌘J / ⌘⇧J 핸들러 제거.
   - `App.tsx` 의 `Workspace` 함수 / `PRIMARY_NAV` / `CODE_SUB_NAV` 제거.

---

## 2. PR 단위 삭제

### PR-UI 0 — Foundation (선행)

**목표**: 회귀 보호망 + 토큰 시스템 격리 + `ui_v2` flag 도입. **삭제 없음**.

**Files (new)**:
- `src/styles/tokens.css` — [`03-design-system.md`](./03-design-system.md) §1~§3 의 :root + [data-theme="dark"].
- `src/styles/base.css`, `shell.css`, `primitives.css`, `screens.css` — 빈 파일 + import 만 (PR-UI 1 부터 채움).
- `src/contexts/ThemeContext.tsx` — `data-theme` 속성 토글 + localStorage.
- `src/__tests__/ui_v2_flag.test.ts` — flag-on / off 분기 회귀.
- `src/__tests__/theme_toggle.test.ts` — data-theme 속성 round-trip.

**Files (modified)**:
- `src/App.tsx` — `ui_v2` flag 분기 wrapper. flag-off 는 기존 코드 100% 그대로.
- `src/contexts/WorkspaceContext.tsx` — schema v3 의 *읽기 호환만* (새 키 default), 쓰기는 아직 안 함.

**DoD**:
- `pnpm typecheck` / `pnpm test` / `pnpm lint` green.
- `cargo test` green (백엔드 무변경 확인).
- flag-on / off 둘 다 *현재와 동일 화면*.

### PR-UI 1 — Sidebar / Shell / Theme

**삭제 대상**: 없음 (공존).

**Files (new)**:
- `src/components/Sidebar.tsx` — 248px 사이드바. 브랜드 + 프로젝트 스위처 + main 4 + 도구 3 + 푸터 2.
- `src/components/Toolbar.tsx` — 52px 툴바 컴포넌트.
- `src/styles/shell.css`, `primitives.css` 채움.

**Files (modified)**:
- `src/App.tsx` — flag-on 분기에서 신 Shell 사용.
- `src/hooks/useGlobalShortcuts.ts` — ⌘1~⌘7 + ⌘, 등록 (flag-on 시).

**DoD**:
- 사이드바 9 슬롯 클릭 → activeView 갱신 (단, 화면 자체는 *임시 placeholder* + "PR-UI N 에서 채움" 토스트).
- 다크 토글 즉시 반영, layout shift 0.
- axe-core: 사이드바 a11y violations 0.

### PR-UI 2 — Today

**삭제 대상**: 기존 `TodayScreen.tsx` 의 *내부 구현*. wrapper export 는 유지 (flag-off 호환).

**Files (modified)**:
- `src/features/today/TodayScreen.tsx` — flag-on 시 새 hero / stat-row / grid-2 마운트. flag-off 시 기존 카드 토글 리스트.
- 신규 `src/features/today/StatCard.tsx`, `MiniEntry.tsx`, `WeekChart.tsx`, `AgentBreakdown.tsx`, `NextTasks.tsx`.
- `src-tauri/src/commands/oculpm.rs` — `get_today_brief`, `get_today_highlights` 등 backend command 추가 (백엔드 *추가* — 기존 무변경).

**DoD**:
- 4 stat card 값이 `oculpmApi.getTodayBrief` 의 반환값과 일치.
- MiniEntry 클릭 → 작업 일지 화면 focus highlight.
- vitest 시나리오: 빈 journal → empty hint + AGENTS.md 배포 안내.

### PR-UI 3 — 작업 일지

**삭제 대상**: 없음 (Lite-W6 의 `TimelineView` 를 신 `JournalScreen` 으로 교체, 기존 코드는 *flag-off 시* 마운트).

**Files (new)**:
- `src/features/oculpm/JournalScreen.tsx` — timeline + day-label + scope-chip.
- 기존 `JournalEntryCard.tsx` 는 *목업의 `.jcard` 시각* 으로 시각만 갱신 (구조 보존).

**DoD**:
- scope-chip 6 종 동작.
- focused entry route 동작.
- ⌘F in-page 검색.

### PR-UI 4 — 변경 diff

**삭제 대상**: Today 의 *변경 파일 카드* 의 *클릭 동선* (이제 사이드바에서 직접 진입).

**Files (modified)**:
- `src/features/diff/LocalDiffView.tsx` — 시각 wrapper 만 신 `DiffScreen` 으로 감쌈. 내부 git/snapshot 분기 무변경.
- 신규 `src/features/diff/DiffScreen.tsx` — Toolbar + .diff-screen 2-pane shell.
- 신규 `src/features/diff/DiffFileList.tsx`, `DiffMain.tsx`.

**DoD**:
- 기존 LocalDiffView 의 모든 회귀 테스트 green.
- 통합 / 분할 토글 영속화.
- 외부 에디터 열기 (Settings 의 명령) 동작.

### PR-UI 5 — 도구 4 화면 일괄

**삭제 대상**:
- `src/components/TerminalDock.tsx` — *flag-on 시* 마운트하지 않음.
- `src/components/SidePanel.tsx` — *flag-on 시* 마운트하지 않음.
- ⌘B / ⌘J / ⌘⇧J 단축키 — flag-on 시 비활성.

**Files (new)**:
- `src/features/search/SearchScreen.tsx` — Toolbar + .search-hero + .search-results.
- `src/features/terminal/TerminalScreen.tsx` — .term-wrap 풀스크린 (기존 `TerminalPanel.tsx` wrapping).
- `src/features/chat/AiPanelScreen.tsx` — .ai-wrap (기존 `AiOverlay.tsx` 의 thread state 공유).
- `src/features/planner/PlannerScreen.tsx` — 기존 `PlannerPanel.tsx` 의 시각만 *목업 톤* 으로 정렬.

**DoD**:
- 4 화면 모두 마운트 + Toolbar 액션 동작.
- AiOverlay (⌘\) 는 *여전히 작동* — AiPanelScreen 과 thread 공유.
- 터미널 탭 추가 / 닫기 동작.

### PR-UI 6 — Settings

**삭제 대상**: 기존 `SettingsPanel.tsx` 의 *시각* (구조 무변경).

**Files (modified)**:
- `src/features/settings/SettingsPanel.tsx` — Toolbar + section-title + .card.set-section 의 시각으로 정렬. *키 저장 / 토글 로직 무변경*.

**DoD**:
- 모든 row 의 액션이 기존과 동일.
- 다크/라이트 scope-chip 동작.
- 외부 에디터 명령 input 신설.

### PR-UI 7 — Cleanup + Flag off

**이 PR 이 *복귀 불가능 한 분기점*.** 머지 전 2 일 dogfood 게이트.

**삭제 대상** (모두 `src/legacy/` 로 이동, 빌드 제외):
- `src/features/code/CodeWorkbench.tsx`
- `src/features/code/AiWorkbench.tsx`
- `src/components/TerminalDock.tsx`
- `src/components/SidePanel.tsx`
- *기존* `src/components/FileExplorer.tsx` — (단, *DiffScreen 의 좌측 파일 패널* 이 일부 사용한다면 *그 부분만* 이전 후 legacy 이동).
- `src/App.tsx` 의 `Workspace` 함수, `PRIMARY_NAV` 옛 정의, `CODE_SUB_NAV`.

**제거되는 단축키 (flag 와 무관, 영구)**:
- ⌘B, ⌘J, ⌘⇧J, ⌘⇧\.

**제거되는 WorkspaceContext 키 (§3 의 마이그레이션)**:
- `codeSubTab`, `bottomDrawerTab`, `layoutMode`, `splitRatio`, `sidePanelOpen`.

**Flag**:
- `ui_v2` 의 분기 코드를 *모두 제거*. flag 자체 삭제.

**DoD**:
- grep `CodeWorkbench\\|AiWorkbench\\|TerminalDock\\|SidePanel\\|codeSubTab\\|bottomDrawerTab\\|layoutMode\\|splitRatio\\|sidePanelOpen` → 0 (legacy 폴더 제외).
- grep `ui_v2` → 0.
- `pnpm test` / `cargo test` green.
- 2 일 dogfood 종료 후 *치명적 회귀 0 건* 사인-오프.

---

## 3. `WorkspaceContext` schema v2 → v3 마이그레이션

```ts
// 신규 default (schema v3)
export const DEFAULTS = {
  // 변경 없는 키 (v2 그대로)
  currentProjectId: null,
  currentProjectName: null,
  currentProjectRoot: null,
  activeView: "today",
  // ...

  // 본 라운드에서 신설
  journalFilter: "all",
  diffActivePath: null,
  diffReadPaths: [],
  diffMode: "unified",
  plannerOpen: {},
  searchScope: "semantic",
  searchRecent: [],
  terminalTabs: [],
  terminalActiveId: null,
  aiActiveModel: null,
  aiThreadId: null,
  themeMode: "light",
};

// 마이그레이션 — v2 의 키를 *삭제만*. 신규 키는 위 DEFAULTS 에서 자동 채워짐.
function migrateV2toV3(v2: V2State): V3State {
  const {
    codeSubTab,
    bottomDrawerTab,
    layoutMode,
    splitRatio,
    sidePanelOpen,
    ...rest
  } = v2;
  return {
    ...DEFAULTS,
    ...rest,
    // activeView 가 v2 에서 "code" 였으면 v3 에서 "diff" 로 매핑 (가장 유사한 책임).
    activeView: v2.activeView === "code" ? "diff" : v2.activeView,
  };
}
```

**잠금**:
- `activeView: "code"` → `"diff"` 매핑은 *deterministic*. 다른 변환 없음.
- 마이그레이션 함수는 *단방향* (v3 → v2 reverse 없음).
- v3 의 신규 키는 *추가만*. 기존 키는 *이름/타입 무변경* (`activeView` union 확장은 *추가 valid value*).

**테스트**:
- `migrateV2toV3` 가 모든 v2 fixture (W5 / Lite-W6 별) 에 대해 *typecheck pass + 의도된 매핑*.
- 마이그레이션 실패 시 *기본 DEFAULTS 로 fallback* (에러 throw 금지, 사용자 경험 보호).

---

## 4. AiOverlay 의 운명

`src/components/AiOverlay.tsx` 는 **유지**. 그러나:

- *기본 진입은 AiPanelScreen (⌘7)*. ⌘\\ 단축키도 유지 (오버레이는 보조).
- AiOverlay 와 AiPanelScreen 은 *thread state 공유* — 같은 `aiThreadId` 를 본다. 사용자가 오버레이에서 보낸 메시지는 화면에 가도 보임.
- AiOverlay 의 시각은 *목업의 `.msg` 컴포넌트와 동일* — wrapper 만 화면용 / 오버레이용 분리.

이게 *Lite-W6 의 AiOverlay-only 결정* 과 *본 라운드의 AiPanel-as-IA 결정* 의 통합 답.

---

## 5. 미해결 결정 (PR-UI 진행 중 답변 필요)

> 본 §의 미해결 항목은 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 에 *이주된 후* 잠금 처리.

1. **`src/legacy/` 의 보존 기간** — Lite-W6 와 동일하게 *영구* 권장 (디스크 영향 미미). [✔ 권장]
2. **AiOverlay 의 단축키 충돌** — ⌘\\ 가 macOS 일부 IME 에서 frame 단위로 가로채임. 대체 단축키 ⌘⇧A 후보. [⚠ 검토]
3. **터미널 탭 내 ⌘1~⌘9 vs 글로벌 ⌘1~⌘7 충돌** — focus-based 우선순위 명시 필요. [⚠ 검토]
4. **다크 모드 시스템 감지 vs 사용자 토글** — 사용자가 한번 토글하면 시스템 변경 영향 *완전 무시* vs *프로젝트별 재계산*. [✔ 사용자 토글 우선 — 재실행 시까지 유지]
5. **Code Graph (xyflow)** — *완전 제거* vs *v1.1 의 Overview drawer 흡수 가능성 보존*. [⚠ 보류 — `src/legacy/code/Graph/` 로 이동]

답이 정해지는 즉시 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 에 이주.
