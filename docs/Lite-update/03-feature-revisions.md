# 03. 수정 계획 — FileTree · AI 패널 · Terminal · Git

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) D6, D7, D8 의 구체 실행.
> [`02-removal-plan.md`](./02-removal-plan.md) 의 삭제가 *공백을 만들고*, 본 문서가 *그 공백을 채운다*.

---

## 0. 4 개 요소의 새 역할 (한 줄씩)

| 요소 | 1.0 의 역할 |
|---|---|
| **FileTree** | 전체 디렉토리 표시 (.oculpm-aware ignore) + *변경 파일 하이라이트* + 외부 에디터 열기. |
| **AI 패널** | 사이드바 보조 → *오버레이 / 분리 윈도우*. 컨텍스트와 무관하게 어디서든 호출 가능. |
| **Terminal** | BottomDrawer 의 일등 시민 → *Today 와 분할 가능한 메인 도크*. 풀스크린 토글 추가. |
| **Git** | 메인 진입점 제거. *Today 헤더의 mini indicator* + *터미널의 `git` CLI* 로 대체. |

---

## 1. FileTree 재설계

### 1.1 현재 상태 (W5 기준)

`src/components/FileExplorer.tsx` (~200 lines):

- `files` props = `Array<[fileId, relPath]>`. *인덱싱된 파일만* 표시.
- 검색 input 1 개. 폴더 토글. 파일 클릭 → `onSelectFile(path)` → `setActiveFile`.
- 익스플로러 expanded 상태가 *컴포넌트 내부 state* — 페이지 전환 시 reset (영속화 안 됨).
- 변경 파일 / 신규 파일을 강조 표시하는 기능 *없음*.
- *지원 안 하는* 파일 (md, json 외 일부) 도 안 보임 — 백엔드 indexer 가 "코드 파일" 만 추출.

### 1.2 1.0 의 FileTree (변경 하이라이트 통합)

**핵심 데이터 변화**:
- `files` 의 소스를 *인덱싱된 파일 목록* 에서 *프로젝트 디렉토리 트리* 로 전환.
- 새 백엔드 커맨드 `list_project_tree(project_id, opts) -> Vec<TreeNode>`:
  - 백엔드의 `ignore` 워커 그대로 사용 (`.gitignore`, `.oculpm/`, `node_modules/` 등 제외).
  - 폴더 / 파일 메타 (size, last_modified) 함께 반환.
  - 페이징 없음 — 일반 프로젝트는 수천~수만 파일이므로 vite/tauri 측에서 *flat list + virtualization* 가능.
- 기존 `commands::list_project_files` 는 *인덱싱 진행 표시 게이지용* 으로 보존 (FileTree 의 푸터에서 "N files indexed / M total").

**변경 하이라이트**:
- WorkspaceContext 에 `recentChanges: { path: string; op: "A" | "M" | "D" }[]` 신설.
- 이벤트 구독:
  - `events.oculpmIndexLineAppended` (W2 PR4) 가 fire 될 때 `recentChanges` 에 push.
  - debounce 500ms 후 *Today* 와 *FileTree* 둘 다 갱신.
- FileTree 의 각 노드:
  - `recentChanges` 에 해당 path 가 있으면 *왼쪽에 dot 마커* + 파일명 우측에 op 배지.
  - 클릭 시 *로컬 diff 뷰어* (D5) 가 열림. 더블 클릭 시 *외부 에디터로 열기*.
- "변경 하이라이트 비우기" 액션 — 사용자가 명시적으로 "이 변경들을 다 본 것으로 표시" 클릭. 그 전까지는 *영구 표시* (24h 후 자동 fade out 옵션은 미정).

**UI 골격**:

```
┌──────────────────────────────────┐
│ [🔍 검색]                         │
├──────────────────────────────────┤
│ ▾ src                            │
│   ▾ features                     │
│     ▸ today                      │
│   ● ▾ diff   ← M 배지            │
│     ● LocalDiffView.tsx     M    │
│   ▸ contexts                     │
│ ▾ src-tauri                      │
│   ▾ src                          │
│     ▾ commands                   │
│     ● diff.rs                A   │
├──────────────────────────────────┤
│ 4,820 indexed / 12,001 total     │
│ [재인덱싱]    [4개 변경 비우기]    │
└──────────────────────────────────┘
```

**파일 변경 사항 (대표)**:
- `src/components/FileExplorer.tsx` — props 변경, 변경 하이라이트 렌더링, expanded persist 로 영속화.
- `src/contexts/WorkspaceContext.tsx` — `recentChanges`, `fileExplorerExpanded` 영속화.
- `src-tauri/src/commands/project.rs` — `list_project_tree` 신설.
- `src-tauri/src/lib.rs` — 새 커맨드 등록.

**위험**:
- 큰 프로젝트 (≥ 50k 파일) 에서 flat list 가 부담. 1.0 안에 *react-virtual* 도입.
- `recentChanges` 가 과도하게 누적되어 메모리 증가 — 사용자 명시 클리어 + 최대 1000 항목 cap.

**DoD**:
- [ ] 변경 파일에 *시각적 표시* 가 있고, 클릭하면 로컬 diff 뷰어로 진입.
- [ ] 사용자가 명시적으로 *비우기* 전엔 표시 유지.
- [ ] 50k 파일 데모 레포에서 < 500ms 마운트.
- [ ] expanded 상태가 새로고침 후에도 보존.

### 1.3 외부 에디터 열기

- "외부 에디터로 열기" = 시스템 기본 에디터 (`open`/`xdg-open`/`start`) 가 아닌, *사용자가 Settings 에서 지정한 명령*.
- 기본값: `code "%path"` (VS Code). 사용자가 Cursor 라면 `cursor "%path"`.
- 설정 위치: Settings → `Ocul-PM` 탭 → "외부 에디터 명령".
- 신규 커맨드: `commands::open_in_editor(path, editor_cmd) -> Result<()>`. 기존 `commands::open_path_in_default` 가 있다면 그 위에 *editor preference* 만 얹어서 재사용.

---

## 2. AI 패널 재배치

### 2.1 현재 상태 (W5 기준)

`src/features/code/AiWorkbench.tsx` (~444 lines):
- Code 화면의 오른쪽 사이드패널 (`aiWorkbenchOpen` true 일 때).
- *Chat* / *Quick Edit* 모드 토글.
- Provider/Model 선택. Quick Edit 의 마지막 단계 = *Changelog 저장* (→ PR4 에서 제거됨).

### 2.2 문제

- 사용자 발언: *"사이드바에 국한되기엔 이제 에디터가 사라지므로 다른 곳에 배치해도 된다고 판단됨"*.
- Code 화면 외 (Today, Plan) 에서 호출하려면 일단 ⌘5 로 진입 후 ⌘\ 를 눌러야 — *3 단 점프*.
- 단일 항상-열린 사이드패널이 항상 *너비 380px* 를 점유.

### 2.3 1.0 의 AI 패널

**위치 후보** (택1):

| 안 | 형태 | 장점 | 단점 |
|---|---|---|---|
| A | **상단 우측 토글 → 오버레이 (Sheet)** | 어디서든 ⌘\ 로 호출. 닫힐 때 0 픽셀. | 큰 화면을 잠시 가림. |
| B | **분리 윈도우 (Tauri WindowBuilder)** | 멀티 모니터 사용자 친화. *Today 와 AI 패널 동시에* 의 사용자 의도 충족. | 위치/크기 영속화 별도 구현. |
| C | **하단 도크 (Terminal 옆 탭)** | 기존 BottomDrawer 흐름과 정합. | Terminal 풀스크린 모드와 충돌. |

**권장**: **A + B 동시 지원**.
- 기본 ⌘\ → 오버레이 (A).
- ⌘⇧\ → 분리 윈도우로 *현재 오버레이 내용 그대로 옮김* (B).
- 분리 윈도우의 위치/크기는 `tauri-plugin-window-state` 가 처리.

**오버레이 디자인**:

```
┌──────────────────────────────────────────────────────────┐
│ Today · 2026-06-15                                       │
│                                                          │
│              ┌───────────────────────────────────┐       │
│              │ 🤖 AI · [Chat] [Quick Edit]       │       │
│              │ ┌─────────────────────────────┐   │       │
│              │ │  ... 본문 ...                │   │       │
│              │ └─────────────────────────────┘   │       │
│              │ Provider [▾]  Model [▾]  [↗ 분리] │       │
│              │                             [⌘\ ✕]│       │
│              └───────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

- 너비: `min(720px, viewport-w - 32px)`.
- 높이: `viewport-h - 80px`.
- 우측 상단에 *↗ 분리* 버튼 → 분리 윈도우로 옮김.
- ESC / ⌘\ / 외부 클릭 → 닫힘.

**상태**:
- `WorkspaceContext.aiOverlayOpen: boolean` 신설. 기존 `aiWorkbenchOpen` 삭제.
- 모드 (`aiWorkbenchMode`) 와 provider/model 선택은 그대로 영속화.

**파일 변경 사항 (대표)**:
- `src/features/code/AiWorkbench.tsx` → 위치만 분리, props 인터페이스는 동일.
- 신규 `src/components/AiOverlay.tsx` (오버레이 wrapper) + `src/main.tsx` 또는 `App.tsx` 의 root 에 mount.
- 신규 분리 윈도우 entry: `src/main-ai.tsx` (`?window=ai` URL 파라미터 분기 — Terminal detach 와 동일 패턴).
- `src-tauri/src/lib.rs` 에 ai window builder 추가.

**위험**:
- 두 인스턴스 (오버레이 + 분리 윈도우) 동시 활성 시 *Quick Edit 의 진행 중 상태* 가 충돌. 대응: 분리 윈도우가 열려있으면 오버레이 진입을 차단 + "분리 윈도우로 이동" 토스트.
- `ChatPanel` 내부 conversation state 영속화 (SQLite) 가 *Code 화면 의존* 으로 가정한 곳 — grep 으로 확인 후 정합.

**DoD**:
- [ ] ⌘\ 가 모든 화면에서 동작.
- [ ] 분리 윈도우가 위치/크기 영속화.
- [ ] 오버레이 ↔ 분리 윈도우 동시 활성화 차단.
- [ ] Code 화면이 *AI 패널 없이도* 정상 동작 (의존 끊김).

---

## 3. Terminal — 메인 도크 승격

### 3.1 사용자 의도 재인용

> "Ocul-PM-lite 의 최대 변경점은 터미널 환경을 제공한다는 점임. 현재 터미널 기능이 버벅거리고 하단바에 있지만 사용자가 터미널을 통해서 Claude-code 또는 cli 환경을 사용하며 today를 함께 볼 수 있도록 하고싶음. 물론 유연하게 터미널 창을 닫을수도, 터미널환경만 볼수있게 전환도 가능하도록 하고싶음."

= 세 가지 모드 토글 — *숨김 · Today 와 분할 · 풀스크린*.

### 3.2 1.0 의 Terminal 레이아웃 모드

`WorkspaceContext.layoutMode: "main-only" | "split" | "terminal-only"`:

```
1. main-only (terminal hidden)        2. split (default)                3. terminal-only
┌──────────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│                              │      │ Today / Plan / ...        │      │                          │
│   Today / Plan / ...         │      │                          │      │   Terminal               │
│                              │      │                          │      │                          │
│                              │      ├──────────────────────────┤      │                          │
│                              │      │ Terminal                 │      │                          │
│                              │      │                          │      │                          │
└──────────────────────────────┘      └──────────────────────────┘      └──────────────────────────┘
```

**단축키**:
- `⌘J` — `main-only` ↔ `split` 토글.
- `⌘⇧J` — `terminal-only` 토글 (다른 두 모드에서 진입 / 복귀).
- 사용자가 마지막으로 사용한 모드는 영속화.

**분할 모드의 비율**:
- 기본 60:40 (Today : Terminal).
- 사이의 horizontal resize handle drag 로 조절. 영속화.

**탭 (Terminal 내부)**:
- 기존 `TerminalPanel` 의 다중 세션 (탭) 기능 유지.
- 신규: *각 탭이 자체 cwd* — Claude Code 세션 / 일반 zsh / git 명령 등을 분리 사용 가능.

**버벅거림 원인 점검**:
- 사용자 발언 *"현재 터미널 기능이 버벅거리고"* — 1.0 안에 *원인 식별 + 우선 수정*. 후보:
  - xterm fit-addon resize race (W5 의 R5 와 동일).
  - WebSocket-like 메시지 채널이 다수 lines 누적 시 backpressure 없음.
  - React re-render 의 폭증 — `useEffect` 의 deps 가 불필요 갱신.
- 본 PR 의 1주 안에 *프로파일링 + 1차 수정* (재현 + 측정 + 최적 1건).

**파일 변경 사항 (대표)**:
- `src/features/terminal/TerminalPanel.tsx` — props 의존 정리, ResizeObserver debounce 강화.
- `src/contexts/WorkspaceContext.tsx` — `layoutMode`, `splitRatio` 영속화.
- `src/features/code/BottomDrawer.tsx` — 단일 Terminal 탭만 남고, *Code 화면이 아닌 곳* 에서도 사용 가능하도록 wrapper 추출 → `src/components/TerminalDock.tsx`.
- `src/hooks/useGlobalShortcuts.ts` — ⌘J / ⌘⇧J 매핑 갱신.

**위험**:
- *Today 안의 ChangelogScreen 흔적* 이 사라진 후 *split 모드의 상단 슬롯* 이 *Today 의 안* 인지 *Today / Plan 통합 IA strip 인지* 가 [`04-ui-ux-redesign.md`](./04-ui-ux-redesign.md) 의 IA 결정에 종속.

**DoD**:
- [ ] ⌘J, ⌘⇧J 3 모드 토글 동작.
- [ ] split 의 ratio 영속화.
- [ ] 한 탭에서 `claude-code "..."` 명령이 정상 동작 (사용자 dogfood 검증).
- [ ] resize 시 xterm fit-addon race 미발생 (debounce 200ms 적용).

### 3.3 Terminal *안에서* Today 를 어떻게 보는가

사용자 의도 "터미널을 통해서 ... today를 함께 볼 수 있도록" 의 정확한 해석:

- 옵션 1: 같은 윈도우에 *split 모드* (위 §3.2 의 #2).
- 옵션 2: 분리 윈도우 — 별도 모니터에 Today 를 띄움.

**1.0 안**: **옵션 1 기본 + 옵션 2 보조**. 분리 윈도우는 *Today 전체 페이지* 가 아니라 *Today 의 entries 만* 보여주는 슬림 모드 (`?window=today-slim`).

---

## 4. Git — 메인 진입 제거, mini indicator 만 유지

### 4.1 무엇을 보존

- `src-tauri/src/commands/git.rs` 의 모든 함수 보존 (legacy `GitPanel` 이 import 하므로 컴파일 가능).
- *신규* 슬림 wrapper: `commands::git::head_status_summary(project_id) -> { branch: String, uncommitted: usize, ahead: usize, behind: usize }`.

### 4.2 무엇을 노출

- TitleBar 또는 Today 헤더에 *mini chip*:

```
[● main · +4 uncommitted]
```

- 클릭 시 *터미널을 split 모드로 열고 `git status` 자동 실행* (사용자 dogfood 의도와 정합).
- 우클릭 또는 호버 → `git diff` 의 첫 5줄 미리보기 (선택 구현).

### 4.3 무엇을 안 함

- 커밋 메시지 리스트, 태그, 릴리스 노트 등 *읽기 전용 메타데이터 페이지* 는 1.0 에서 제공 안 함. legacy 폴더에 보존.

### 4.4 변경 사항

- 신규: `src/components/GitBranchChip.tsx` (~50 lines).
- TitleBar 의 우측에 배치. WorkspaceContext 의 `gitHead` 캐시 (60s TTL).
- 폴링 vs 이벤트: 1.0 안엔 *파일 워처가 `.git/HEAD` 변경 감지 시 refresh* + *60s polling fallback*. 너무 자주 fetch 하지 않음.

**DoD**:
- [ ] TitleBar 에 git chip 노출.
- [ ] 클릭 → split 모드 + `git status` 실행.
- [ ] 60s 폴링이 idle 시 CPU < 0.5% 영향.

---

## 5. 변경 사항 종합 (Impact Matrix)

| 파일 | 변경 종류 | PR |
|---|---|---|
| `src/components/FileExplorer.tsx` | 큰 폭 재작성 (props 변경, 변경 하이라이트) | PR8 |
| `src/components/AiOverlay.tsx` (신규) | 신설 | PR9 |
| `src/components/TerminalDock.tsx` (신규) | 신설 | PR7 |
| `src/components/GitBranchChip.tsx` (신규) | 신설 | PR7 |
| `src/features/code/AiWorkbench.tsx` | 위치 분리, props 정리 | PR9 |
| `src/features/terminal/TerminalPanel.tsx` | resize race fix, props 정리 | PR7 |
| `src/features/code/CodeWorkbench.tsx` | EditorPane 삭제, Tree+Diff 슬롯 | PR8 |
| `src/features/code/BottomDrawer.tsx` | *Code 화면 전용* 삭제, 일반 도크 wrapper 로 흡수 | PR7 |
| `src/contexts/WorkspaceContext.tsx` | `recentChanges`, `layoutMode`, `aiOverlayOpen` 추가 / `aiWorkbenchOpen`, `bottomDrawerTab` 정리 | PR7~PR9 |
| `src-tauri/src/commands/project.rs` | `list_project_tree` 신설 | PR8 |
| `src-tauri/src/commands/git.rs` | `head_status_summary` 신설 (기존 함수는 legacy 용으로 유지) | PR7 |
| `src/main-ai.tsx` (신규) | AI 분리 윈도우 entry | PR9 |
| `src-tauri/src/lib.rs` | window builder 등록 갱신 | PR7, PR9 |

---

## 6. 회귀 보호

| 보호 항목 | 검증 |
|---|---|
| FileTree 가 비어 있어도 (인덱싱 전) 정상 렌더 | 단위 테스트 + 빈 프로젝트 dogfood |
| FileTree 의 변경 하이라이트가 *워처 이벤트* 와 동기화 | 통합 테스트: 파일 1개 수정 → 500ms 내 dot 표시 |
| AI 오버레이가 *Today, Plan 어느 화면에서도* ⌘\ 진입 | E2E 테스트 |
| 분리 윈도우 종료 시 *오버레이* 가 다시 활성화 가능 | 수동 dogfood |
| Terminal split 의 ratio 영속화 | localStorage 마이그레이션 unit test |
| `claude-code "..."` 명령이 split 모드 안에서 정상 동작 | 수동 dogfood + 사용자 시나리오 녹화 |

---

## 7. 결정 완료 항목 (2026-05-28 잠금)

본 §의 결정은 모두 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0.4 에서 잠금.

1. **AI 패널의 RAG 컨텍스트** → **1.0 유지**. 오버레이 형태에서 citations 시각이 정상인지 PR9 의 DoD 에 포함.
2. **외부 에디터 명령 디폴트** → **Settings 에서 사용자 명시**. 첫 진입 시 placeholder `code "%path"` + 안내 토스트 1회.
3. **Terminal split 최소 비율** → **30:70** (Today 최소 30%).
4. **Git chip 클릭** → **split 모드 진입 + `git status` 자동 실행**.
