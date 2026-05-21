# ai-pm UI/UX 전면 재설계 (UI-UX REDESIGN)

> **이 문서의 목표**
> `docs/GAP-PLAN.md` 가 정의한 4개 갭(G1 Changelog · G2 Overview · G3 Clarify · G4 Greenfield)을 UI/UX 차원에서 실제 사용자가 *PM 서비스를 받는다고 느끼도록* 화면·인터랙션·정보 구조 전반에서 어떻게 바꿔야 하는지 구체적으로 정의한다.
>
> 동시에, 사용자가 명시적으로 불만을 제기한 두 가지 — (a) `tauri.conf.json` 의 `"decorations": false / "transparent": true` 조합으로 인한 잡다한 chrome/모서리/드래그 이슈, (b) "UI가 말을 듣지 않는다"는 통제 불능 감각 — 의 원인을 코드 레벨에서 진단하고 해결 방안을 제시한다.
>
> **작성일**: 2026-05-20
> **선행 문서**: `docs/ROADMAP.md`, `docs/GAP-PLAN.md`
> **이 문서는 코드 변경 청사진(blueprint)이며, 실제 구현은 별도 PR로 단계 적용한다.**

---

## 0. 결론 요약 (TL;DR)

1. **앱 정체성을 'IDE-like 도구'에서 'PM 워크스페이스'로 회전**한다. 현재 사이드바 9개 탭 (Files/Chat/Assist/Graph/Planner/Terminal/Git/Settings/Diagnostics) 은 IDE의 도구 모음이지, PM의 멘탈 모델이 아니다. **5개의 PM-내러티브 IA** (Overview · Today · Plan · Changelog · Code) 로 재편한다.
2. **AssistPanel + ChatPanel 통합**: 둘 다 RAG + LLM + 프롬프트 최적화를 한다. 사용자에게는 동일한 행동인데 *두 메뉴*라 혼란. "AI Conversations" 한 곳으로 합치고 그 안에서 모드 (Quick Edit / Free Chat) 만 토글.
3. **`decorations: false` 처리 방침 변경**: 현재 *수동으로 그린 macOS 트래픽 라이트 + CSS `border-radius` + `transparent: true`* 조합이 모든 OS에서 잡다한 버그(둥근 모서리 잘림, 풀스크린 깨짐, Windows에서 트래픽 라이트 어색)를 낸다. **macOS는 네이티브 traffic-light overlay + decorations 유지, Windows/Linux는 native 데코레이션 유지** 로 OS별 분기. CSS의 `border-radius: 12px` + `WebkitMaskImage` 를 제거.
4. **"UI가 말을 듣지 않는다" = 상태 흩어짐**: `App.tsx` 가 12개의 `useState` + 5개의 `useEffect`로 `localStorage` 동기화를 하고, 자식 패널마다 또 자체 `useState + localStorage`를 가진다. 화면 전환·새로고침·창 분리 때 상태가 어긋난다. → **`WorkspaceContext` 단일 store** 로 합치고 `localStorage` 접근을 1군데에서만 한다.
5. **PM 색채 강화**: 현재 카피("Manage and index code repositories with semantic search")는 *코드 도구* 카피다. **"오늘 무엇을 만들 건가요?" / "지난 7일 동안 만든 것" / "방금 한 일 기록하기"** 같은 사용자-액션 중심 카피로 전환.

---

## 1. 현재 UI/UX의 구조적 문제 (코드 기반 진단)

### 1.1. 9-탭 사이드바 — IDE의 발상, PM의 발상 아님

`src/App.tsx:476-598` — 좌측 thin sidebar에 다음 9개 버튼이 일렬로 나열:

```
Files (FolderCode)  ─┐
Chat (MessageSquare) ├ "AI/Code"가 섞임
Assist (Sparkles)   ─┘
Graph (Network)
Planner (Calendar)
Terminal (Terminal)
Git (GitBranch)
─────────────────
Settings (Settings)
Diagnostics (Database)
Dashboard 종료 (LayoutDashboard)
```

**문제**:
- Chat / Assist 는 **같은 기능(RAG → LLM → 출력)** 의 두 변형인데 두 탭으로 나뉨. 사용자는 "어디서 뭘 해야 하지"부터 망설인다 (`AssistPanel.tsx:42-50` 와 `ChatPanel.tsx:428-440` 의 상태 구조가 거의 동일하다는 점이 증거).
- Terminal, Diagnostics, Graph 는 PM이 일상에서 자주 가는 곳이 아닌데도 최상위 1-depth에 위치 — *시각적 평등성*이 사용자 우선순위 신호를 죽인다.
- **Changelog / Overview / Today 처럼 PM에게 *진짜* 중요한 진입점은 아예 없다.**
- "Dashboard 종료" 버튼(`App.tsx:589`)이 좌측 하단에 destructive 컬러로 — 자주 누르는 동작이 *위험한 종료*처럼 보임.

### 1.2. 두 개의 AI 패널, 한 개의 행동

| 항목 | ChatPanel (`features/chat/ChatPanel.tsx`) | AssistPanel (`features/assist/AssistPanel.tsx`) |
|---|---|---|
| Provider 선택 | ✅ | ✅ (중복) |
| Model 입력 | ✅ | ✅ (중복) |
| RAG 청크 검색 | ✅ (`buildContextSystem`) | ✅ (`handleSearch`) |
| LLM 호출 | ✅ 스트리밍 | ✅ 단발 |
| 프롬프트 최적화 | ✅ ("🪄 Optimize Prompt", L927) | ✅ (entire panel) |
| 결과 처리 | 대화로 누적 | 영어 프롬프트 1회 출력 + 클립보드 |
| 사용자 인지 부담 | "이 둘을 언제 골라?" | 동일 질문 |

**해결 방향**: 하나의 "AI 워크벤치"로 합치고, 그 안에 **두 가지 모드**만 둔다.
- **Quick Edit** (= 현재 AssistPanel) — *"외부 LLM에 보낼 프롬프트 1개를 만든다"*
- **Free Chat** (= 현재 ChatPanel) — *"이 코드베이스에 대해 자유롭게 묻는다"*

### 1.3. "decorations: false / transparent: true" 의 부작용

`src-tauri/tauri.conf.json`:
```json
"decorations": false,
"transparent": true,
"width": 1150,
"height": 780
```

`src/App.tsx:320-324`:
```jsx
<div
  className="h-screen ... overflow-hidden rounded-xl border border-border"
  style={{ WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
>
```

`src/App.css:170-184`:
```css
/* Tauri runs with decorations:false + transparent:true so macOS does NOT
   draw its own rounded chrome — we have to clip the document ourselves */
html, body, #root {
  background: transparent !important;
  border-radius: 12px;
  overflow: hidden;
}
```

**증상**:
- 윈도우 풀스크린/최대화 시에도 12px 둥근 모서리가 남아 *데스크탑이 모서리로 비침* → "유리 깨진 느낌".
- `WebkitMaskImage` 가 GPU 합성 경로를 강제로 가로채 일부 인터랙션(드롭다운 z-index, React Flow 캔버스 클리핑)에서 잘림 발생.
- `TitleBar.tsx:80-102` 의 수동 트래픽 라이트는 macOS-only 디자인. Windows에서는 좌측 상단에 어색한 색동 원 3개가 뜬다.
- `startDragging()` 호출(`TitleBar.tsx:24-33`)이 버튼 클릭과 race condition 발생 — 이미 *"target.closest(button)" 체크* 로 회피하지만 native chrome 이 있을 때만큼 매끄럽지 않다.
- 최대화 후 다시 줄였을 때 윈도우 위치/크기가 저장되지 않음(별도 `window-state` 플러그인 미사용) → "내가 둔 자리에 안 돌아온다"는 통제감 상실.

### 1.4. 상태 흩어짐 → "UI가 말을 듣지 않는다" 의 정체

`App.tsx` 최상단(`L42-83`) 12개 `useState`:
```ts
projects, stats, indexingId, progress, error,
renamingProject, newName, deletingProject,
health, healthError, showDiagnostics, showSettingsModal,
selectedProjectId, selectedProjectName, selectedProjectRoot,
activeTab, projectFiles, activeFile,
isTerminalPip, initialScrollLine
```

그리고 그 중 7개를 각각 별도 `useEffect`(`L97-135`)로 `localStorage`에 푸시. 동시에:
- `ChatPanel.tsx` 가 또 자체 `localStorage` 키 `action_${convId}_${i}` 를 쓴다 (L265).
- `TerminalPanel.tsx` 가 `terminalSessions / terminalActiveSessionId / terminalPipX / terminalPipY` 4개 키를 직접 read/write (L26-87).
- `FileExplorer.tsx` 는 `expandedFolders` 를 in-memory only — 새로고침 시 폴더가 다 닫힘.

**결과적 증상**:
- 프로젝트 전환 시 `activeFile` 이 이전 프로젝트의 경로로 남아 "파일이 비어 보이는 깜빡임" 발생 (`App.tsx:271-274` 에서 setActiveFile(null) 호출하지만 localStorage 동기화 useEffect 가 한 틱 뒤에 비움).
- Terminal PiP 위치가 윈도우 리사이즈 시 화면 밖으로 나가도 보정 안 됨.
- 새 탭으로 들어가도 직전에 보던 sub-state(예: PlannerPanel 의 filter)는 *사라짐*.
- ChatPanel의 ActionProposalCard `applied` 표시(`L297`)는 `localStorage` 에 영구 저장되어, 대화 삭제 후에도 키만 남는다.

**근본 원인**: 단일 source of truth 없음. 각 컴포넌트가 자신만의 진실을 들고 있고 그것을 디스크와 비동기로 동기화함.

### 1.5. 다이얼로그/모달 폭증

`App.tsx` 안에 다음 3개 fullscreen overlay가 동시 코드로 존재:
- Rename Dialog (L793-829)
- Delete Dialog (L832-857)
- Settings Modal (L860-877) — Settings 패널이 *탭으로도 있고 모달로도 있음*

**문제**: Settings에 어떻게 들어왔느냐에 따라 닫는 UX가 다르다 (탭은 "다른 탭 누르면 떠남", 모달은 "X 또는 백드롭 클릭"). 사용자 학습 비용.

### 1.6. PM 카피의 부재

```
"Manage and index code repositories with semantic search" (App.tsx:340)
"Ocul-PM" (App.tsx:337) — 동시에 "ai-pm"이 README/ROADMAP에는 사용됨 → 이름조차 일관성 없음
"Files Explorer" / "Dependency Map" / "Project Planner" — 모두 도구 이름
```

PM 도구라면 카피는 *행동 동사* 중심이어야 한다:
- "오늘 무엇을 만들었는지 정리해드릴게요"
- "이 코드베이스가 어떤 앱인지 살펴보세요"
- "수정 요청을 영어 프롬프트로 가공해드릴게요"

### 1.7. Greenfield 진입점 부재 + Onboarding 0줄

신규 사용자가 앱을 처음 열면 보는 것:
- `App.tsx:332-433` 의 dashboard — 빈 프로젝트 카드 그리드 + "+ Add Project Folder"
- 그 외엔 어떤 안내도 없음.

UC-1(Greenfield)과 UC-3(Vibe Coder) 사용자는 **첫 1분 안에 길을 잃는다**. "I just want to start something — what do I do?"에 답할 표면이 없다.

### 1.8. 영문/한글 카피 혼재

`AssistPanel.tsx`: 헤더는 "AI 코드 어시스턴트" 한글, 그 옆 배지 "Beta" 영문, 사용 안내 "어떤 부분을 수정하고 싶은지…" 한글, 그러나 placeholder 옆 라벨은 영문 "PROVIDERS / MODEL".
`ChatPanel.tsx`: "AI Code Chat" 영문 헤더, "목표 및 일정 포함" 한글 옵션.
`PlannerPanel.tsx`: "목표 관리" 전부 한글.

→ 일관성을 잡지 않으면 *디자인이 정돈된 느낌*이 영원히 나오지 않는다. 본 문서는 **사용자-페이싱 카피는 한국어 기본 + 기술 용어/단축키만 영문** 룰을 권장한다.

---

## 2. 새로운 정보 구조 (Information Architecture)

### 2.1. PM-내러티브 5단 IA

사이드바를 9개 → 5개로 압축. 각 항목은 *사용자의 자연어 질문*에 1:1 대응한다.

| 새 IA | 사용자 질문 | 통합되는 기존 패널 | 새로 필요한 것 |
|---|---|---|---|
| **Overview** | "이 프로젝트가 뭐 하는 앱인지 알려줘" | DependencyGraphView | ✅ G2 Overview 카드, Stack chips, Hero |
| **Today** | "오늘 뭐 해야 하고, 뭐 했어?" | (없음 — 신설) | ✅ G1 오늘자 changelog + 우선순위 goal + AI 추천 |
| **Plan** | "할 일을 관리하고 싶어" | PlannerPanel | (기존 그대로, 시각 통일) |
| **Changelog** | "지금까지의 변화 흐름을 보고 싶어" | (없음 — 신설) | ✅ G1 전체 타임라인 + 필터 + diff 디테일 |
| **Code** | "코드를 직접 보고 만지고 싶어" | Files + Chat + Assist + Git + Terminal | ✅ 통합 워크벤치 |

좌측 사이드바는 이 5개만 노출. **Settings/Diagnostics는 우측 상단 메뉴 또는 ⌘, 단축키로 빠짐**.

### 2.2. Code 워크벤치 내부 IA

"Code"를 클릭하면 *기존 IDE 레이아웃과 유사한 3단 분할*:

```
┌──────────────────────────────────────────────────────────────────┐
│ TitleBar                                                          │
├────────┬──────────────────────────────────┬─────────────────────┤
│        │                                  │                     │
│ Side   │   Editor + Tabs                  │  AI Workbench       │
│ Nav    │                                  │  (Conversation +    │
│        │                                  │   Quick Edit 모드)  │
│ +      │                                  │                     │
│ File   │                                  │                     │
│ Tree   │                                  │                     │
│        │                                  │                     │
├────────┴──────────────────────────────────┴─────────────────────┤
│ Bottom Drawer: Terminal · Git · Problems (collapsible)            │
└──────────────────────────────────────────────────────────────────┘
```

- **AI Workbench (우측)**는 항상 펼침/접기 가능. 펼친 상태가 default — 'PM이 옆에 앉아 있는 느낌'을 시각으로도 전달.
- **Bottom Drawer**가 Terminal/Git/Problems를 *옵션으로* 보여줌. 현재처럼 항상 영구 렌더링되어 다른 패널 위에 떠 있는 구조(`App.tsx:782` 의 persistent `<TerminalPanel>`)를 *Drawer 토글*로 정리.

### 2.3. 최상위 라우팅과 단축키

| 영역 | 단축키 | 정당화 |
|---|---|---|
| Overview | `⌘1` | 자주 가지만 의식적으로 |
| Today | `⌘2` | *데일리 스탠드업* 감각 |
| Plan | `⌘3` | — |
| Changelog | `⌘4` | — |
| Code | `⌘5` | 가장 무거운 작업 영역 |
| AI Workbench 토글 | `⌘\` | Code 화면 안에서 |
| Bottom Drawer 토글 | `⌘J` | VS Code 관습 |
| Settings | `⌘,` | macOS 관습 |
| Command Palette | `⌘K` | (신설) 모든 액션 검색 |

**Command Palette (⌘K)** 는 "UI가 말을 듣지 않는다"를 해소하는 핵심 장치다. 어떤 화면에 있든 `⌘K → "오늘 changelog 저장"` 만 치면 동작 — 사용자가 *길을 잃어도 한 단계로 탈출*할 수 있어야 한다.

---

## 3. 윈도우 chrome 재정비 — `decorations: false` 문제 해결

### 3.1. 결정: OS별 분기

| OS | decorations | transparent | TitleBar 구현 |
|---|---|---|---|
| **macOS** | `true` | `false` | `titleBarStyle: "Overlay"` + `hiddenTitle: true` (네이티브 트래픽 라이트 살리고, 위에 우리 콘텐츠가 겹치게) |
| **Windows** | `true` | `false` | 네이티브 chrome 100% 사용. 우리 TitleBar는 *제목+탭만* 표시 (트래픽 라이트 직접 그리지 않음) |
| **Linux** | `true` | `false` | Windows와 동일 |

`src-tauri/tauri.conf.json` 의 windows 배열은 *기본값을 안전 모드(데코 켜짐)*로 두고, `src-tauri/src/lib.rs` 의 setup에서 macOS 한정으로 `WindowBuilder` 의 `title_bar_style(TitleBarStyle::Overlay).hidden_title(true)` 를 적용한다.

### 3.2. CSS 클린업

`src/App.css:170-184` 의 `border-radius: 12px` + `WebkitMaskImage` 제거. `App.tsx:320-324`의 `WebkitMaskImage` 인라인 스타일도 제거. **모서리는 OS가 그리도록 양보**한다.

부수 효과로 React Flow / Markdown 코드 블록 / 모달 z-index 가 더 이상 마스크에 의해 잘리지 않음.

### 3.3. TitleBar 재설계

- macOS: 좌측 80px 공백 (네이티브 트래픽 라이트 위치 양보) + 중앙 breadcrumb + 우측 액션.
- Windows/Linux: 좌측 16px 패딩 + 중앙 breadcrumb + 우측 액션 + 시스템 그리는 우측 상단 minimize/maximize/close.
- 둘 다 `-webkit-app-region: drag` 영역은 *breadcrumb 좌우 빈 공간*에만 적용 (현재처럼 전체 영역 + JS startDragging 혼용 X).

```tsx
// TitleBar.tsx 의 새 구조 (의사 코드)
<header
  data-tauri-drag-region
  className="h-9 flex items-center px-2 select-none"
  style={{
    paddingLeft: isMac ? 80 : 12,
    paddingRight: isMac ? 12 : 140 /* 시스템 컨트롤 회피 */,
  }}
>
  <Breadcrumb />
  <Spacer />
  <ThemeToggle />
  <CommandPaletteButton />
</header>
```

`data-tauri-drag-region` (Tauri 2 표준) 으로 JS startDragging 핸들러 전부 제거 — *덜 손대고 더 잘 동작*.

### 3.4. 윈도우 크기/위치 영속화

`tauri-plugin-window-state` 도입:
```toml
# src-tauri/Cargo.toml
tauri-plugin-window-state = "2"
```
```rust
// lib.rs
.plugin(tauri_plugin_window_state::Builder::default().build())
```

"내가 둔 자리에 안 돌아온다" 문제가 사라진다. 동시에 `tauri.conf.json` 의 `width: 1150, height: 780` 은 *최초 실행* 기본값으로만 작동.

### 3.5. 최소 윈도우 크기 강제

현재 무한정 작게 줄일 수 있어 패널이 깨짐. `min_width: 960, min_height: 640` 강제.

---

## 4. 화면별 상세 리디자인

### 4.1. Overview — "이 프로젝트가 뭐 하는 앱인가요"

**G2 Overview** 가 만들어내는 자연어 요약을 *진입 화면*으로 끌어올린다.

```
┌─────────────────────────────────────────────────────────────┐
│  ai-pm  ·  Tauri + React + Rust   ·   ⭐ 1.2k   ·  main      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📌 한 줄 정체성                                              │
│  ──────────────                                              │
│  "코드를 직접 수정하지 않고, 개발자의 소통과 프로젝트 관리를     │
│   돕는 지능형 LLM 데스크톱 조력자."                            │
│                                                             │
│  🧱 기술 스택                                                 │
│  [Tauri 2] [React 19] [TypeScript] [Rust] [sqlite-vec] ...   │
│                                                             │
│  🗂  디렉터리 가이드                                          │
│  ├─ src/features/chat       — M2 LLM 대화 & 이력             │
│  ├─ src/features/projects   — M3 코드 검색 & 의존성 맵        │
│  ├─ src/features/planner    — M4 목표/일정 관리              │
│  └─ src-tauri/src/commands  — Tauri IPC 커맨드 구현체         │
│                                                             │
│  🎯 주요 진입점                                               │
│  - `src/App.tsx`        : 최상위 라우터                       │
│  - `src-tauri/src/lib.rs`: Tauri 셋업 + 커맨드 등록           │
│                                                             │
│  📊 인덱싱 상태                                               │
│  4,820 파일 · 18,392 청크 · 최종 인덱싱: 2시간 전              │
│  [재인덱싱]  [의존성 맵 열기]  [개요 다시 생성]                 │
└─────────────────────────────────────────────────────────────┘
```

**핵심 인터랙션**:
- 본문 "디렉터리 가이드"는 G2가 자동 생성. *마크다운 인라인 편집* (호버 시 ✏️) 가능 — `project_overviews.overview_md` 컬럼 직접 수정.
- "기술 스택" chip 클릭 → Code 화면으로 이동하며 해당 언어 파일만 필터.
- "의존성 맵 열기" → 현재 `DependencyGraphView` 를 *Overview 내 drawer*로 띄움 (별도 탭 아님).
- 우상단 "···" 메뉴에 [Export Overview as README] [Re-generate with model…].

**프로젝트 미선택 상태**: 기존 dashboard(`App.tsx:332`)를 이 화면이 흡수. 카드 그리드 + Greenfield 위저드 진입 + Settings 만.

### 4.2. Today — "오늘 뭐 해야 하고 뭐 했나"

이 화면은 **신설**. PM이 매일 아침 / 저녁에 보는 *데일리 페이지*.

```
┌─────────────────────────────────────────────────────────────┐
│  Today  ·  2026-05-20 (Tue)                  [어제 ◀ ▶ 내일] │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┬──────────────────────────────┐ │
│  │ 🌅 오늘의 포커스          │ 📊 어제의 완료              │ │
│  │                         │                              │ │
│  │ 1. [Urgent] OAuth 통합  │ ✓ 3 goals 완료              │ │
│  │ 2. [High] Changelog UI  │ ✓ 12 files 변경              │ │
│  │ 3. RAG top-K 튜닝       │ ✓ 2 changelog entry          │ │
│  └─────────────────────────┴──────────────────────────────┘ │
│                                                             │
│  📜 오늘의 활동                                              │
│  ─────────────                                              │
│  15:42 ▣ [feature] 소셜 로그인 버튼 추가  · 4 files · +120/-22│
│  13:10 ▢ [fix]     RAG 검색 중복 제거    · 1 file  · +3/-15  │
│  11:05 ▣ [refactor] DependencyGraph 가상화 · 2 files · +88/0│
│                                                             │
│  🤖 AI 추천                                                  │
│  ─────────                                                  │
│  • "OAuth 통합" 목표에 대해 코드베이스에서 관련 파일 3개 발견.    │
│    [→ Quick Edit 으로 프롬프트 만들기]                         │
│  • 오늘 변경된 4 files에 대해 changelog 요약이 아직 비어 있음.   │
│    [→ AI에게 요약 부탁하기]                                    │
└─────────────────────────────────────────────────────────────┘
```

**왜 이 화면이 PM 정체성에 가장 중요한가**:
- *"내가 한 일이 가시화된다"* — 매일 무엇을 했는지 직관적으로 보임.
- AI가 *오늘의 컨텍스트로 능동 제안* — 사용자가 명령하지 않아도 PM처럼 먼저 말을 거는 인상.
- 진입점이 짧다: Today에서 바로 Quick Edit / Plan / Changelog 진입 가능.

**구현 의존**: G1(Changelog) + 기존 Planner 데이터를 *날짜 윈도우*로 묶는 신규 커맨드 `daily_brief(project_id, date) -> DailyBrief` 필요. AI 추천은 `chat` 의 LLM에 *오늘 활동 + 오늘 목표 + 변경 파일* 요약을 system prompt로 주입하여 결과를 카드로 렌더.

### 4.3. Plan — 기존 PlannerPanel 시각 정돈

기능은 충분 (Goals / Dashboard / Calendar 3개 탭). 다만:

| 문제 | 해결 |
|---|---|
| 탭 3개가 *동등 시각 무게* | "Goals" 가 메인, Dashboard / Calendar 는 우상단 view-mode toggle (`[목록] [통계] [캘린더]`) |
| 새 goal 버튼이 우상단 작은 텍스트 | 좌측 "+ 새 목표" CTA 카드 + ⌘N 단축키 |
| 필터가 화면을 가로질러 깔림 | 좌측 *세컨더리 사이드바*(180px)에 영구 필터 (상태/우선순위/마감) |
| AI 제안 카드(ActionProposalCard) 가 *Chat 에서만* 나옴 | Plan 화면 안에서도 "AI에게 이번 주 plan 정리 부탁" 버튼 → 결과 카드를 *Plan 내 inline*으로 노출 |

### 4.4. Changelog — G1을 위한 신규 화면

`docs/GAP-PLAN.md §3.7` 의 타임라인 뷰를 *최상위 5개 IA 중 하나*로 승격.

```
┌────────────────────────────────────────────────────────────┐
│ Changelog       [전체 ▾] [feature ▾] [최근 30일 ▾]  🔍 검색 │
├──────────────┬─────────────────────────────────────────────┤
│ 2026-05-20   │ ◆ [feature] 소셜 로그인 버튼 추가  15:42      │
│ 3 entries    │   AuthContext.tsx, LoginPage.tsx +2 files    │
│ +312 / -88   │   ─────────────────────────────────────────  │
│              │   사용자 의도:                                │
│ 2026-05-19   │   "로그인 페이지에 소셜 로그인 버튼 추가"        │
│ 5 entries    │                                              │
│ +621 / -402  │   AI 요약 (Why/What/How):                    │
│              │   • Why: OAuth 통합으로 신규 가입률 향상       │
│ 2026-05-18   │   • What: Google/GitHub provider 인터페이스   │
│ 2 entries    │   • How: AuthContext에 OAuthProvider 추가...  │
│              │                                              │
│ ───          │   파일별 변경                                 │
│ 이번 주 통계  │   ▸ AuthContext.tsx     +52 / -8             │
│              │   ▸ LoginPage.tsx       +38 / -6             │
│ +1,840 / -724│                                              │
│              │   [원본 프롬프트 보기] [다시 요약] [📌 고정]   │
└──────────────┴─────────────────────────────────────────────┘
```

**핵심 인터랙션**:
- 좌측: 날짜 버킷 리스트 + 무한 스크롤. 위쪽에 *주간/월간 통계 카드* 고정.
- 우측: 클릭한 엔트리의 상세. 파일별 변경 행 클릭 시 **diff modal** (라인 단위 +/-).
- 우상단 "🔍 검색"은 changelog 본문 + 파일 경로 + 사용자 의도 풀텍스트 검색.
- "📌 고정"은 `changelog_entries.pinned` 플래그를 토글 → 고정된 엔트리는 *Today 화면에도 영구 노출*.
- Export 메뉴: `[Keep-a-Changelog md] [JSON] [Markdown 요약본]`.

### 4.5. Code — IDE-style 워크벤치 (AssistPanel + ChatPanel 통합)

```
┌────────────────────────────────────────────────────────────────────┐
│ Code  ·  src/App.tsx                                  [⌘P] [⌘\] [⌘J]│
├──────┬───────────────────────────────────┬─────────────────────────┤
│      │ Tabs: App.tsx ⨯  ChatPanel.tsx ⨯  │ 🤖 AI Workbench         │
│ Tree │                                   │                         │
│      │ ┌─────────────────────────────┐   │ ┌─[Quick Edit][Chat]─┐ │
│      │ │                             │   │ │                    │ │
│      │ │   Code Editor               │   │ │  …현재의 AssistPanel │ │
│      │ │   ...                       │   │ │   또는 ChatPanel    │ │
│      │ │                             │   │ │   본문 (모드별)      │ │
│      │ │                             │   │ │                    │ │
│      │ └─────────────────────────────┘   │ └────────────────────┘ │
│      │                                   │                         │
├──────┴───────────────────────────────────┴─────────────────────────┤
│ ▾ Terminal · Git · Problems  (Bottom Drawer, ⌘J로 토글)             │
└────────────────────────────────────────────────────────────────────┘
```

**AI Workbench 모드 토글**:
- **[Quick Edit]** — 현재 AssistPanel 의 3단계 흐름 (입력 → 영어 프롬프트 생성 → 변경사항 스캔). 단, **3-1 단계로 G3 Clarifying Question 단계 삽입**.
- **[Chat]** — 현재 ChatPanel 의 자유 대화 + RAG.

같은 입력창, 같은 provider/model 셀렉터, 같은 컨텍스트(현재 열린 파일/프로젝트). *모드만 다르고 환경은 동일하다* → 사용자 인지 부하 50% 감소.

**Bottom Drawer**:
- Terminal: 현재 `TerminalPanel`. 단, "PiP 드래그" 기능은 제거 (드래그 가능한 floating window는 UX 안티패턴, 사용자 위치 기억 비용 큼). 대신 "Detach to separate window" 버튼만 유지 (`App.tsx:304-318` 이미 존재).
- Git: 현재 `GitPanel`. *Changelog 탭은 제거* (별도 최상위 화면으로 승격됨).
- Problems: TypeScript / Rust 진단 결과 (LSP 통합 시).

### 4.6. Settings — 모달 제거, 탭만 유지

현재 *모달 + 탭 두 가지 진입*을 *탭 1개*로 통일. ⌘, 단축키 누르면 자동으로 Settings 탭으로 라우팅.
`App.tsx:860-877` 의 Settings Modal 코드 삭제.

### 4.7. Diagnostics — Settings 안으로 흡수

Diagnostics 는 1년에 몇 번 보지 않는 정보. 좌측 사이드바 자리를 차지할 가치 없음. Settings 의 마지막 탭으로 이동.

---

## 5. Greenfield (UC-1) 진입 UX

`docs/GAP-PLAN.md §6` 의 위저드를 *Overview 비활성 상태* (= 프로젝트 미선택) 에서 거대 진입 카드로 노출.

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│              어떤 프로젝트로 시작할까요?                       │
│                                                            │
│   ┌────────────────────┐  ┌────────────────────┐           │
│   │  📂  기존 프로젝트  │  │  ✨  새 프로젝트     │           │
│   │      불러오기       │  │      시작하기        │           │
│   │                    │  │                    │           │
│   │  이미 있는 폴더에서  │  │  AI와 함께 계획부터  │           │
│   │  바로 시작합니다     │  │  스캐폴딩까지        │           │
│   └────────────────────┘  └────────────────────┘           │
│                                                            │
│   최근 작업한 프로젝트                                       │
│   ─────────────                                            │
│   [project-a · 2시간 전]  [project-b · 어제]  ...           │
└────────────────────────────────────────────────────────────┘
```

**Greenfield Wizard 시각화** (모달, 5 step):
```
[1/5] 어떤 앱을 만들고 싶으신가요?
       (자유 텍스트 + 예시 chip 4개)
            ↓
[2/5] 주 사용자는 누구인가요?
            ↓
[3/5] 추천 스택 3개 중 선택
       [A] Tauri + React (이 앱과 동일)
       [B] Next.js + Vercel
       [C] FastAPI + React
            ↓
[4/5] 폴더 위치 + 이름
            ↓
[5/5] 초기 goal 3개 자동 생성 (편집 가능)
       → [완료] 인덱싱 + Overview 자동 생성 → Today 화면으로
```

**중간에 X를 눌러도 초안 저장** (`project_blueprints` 테이블). 다시 열면 "초안 이어서" 옵션.

---

## 6. G3 Clarifying Question UI

`AssistPanel`(앞으로는 *Quick Edit*) 의 "프롬프트 생성" 클릭 시:

```
사용자 입력: "로그인 페이지 좀 예쁘게 해줘"
                  ↓
       (G3 백엔드가 ambiguity_score=0.82 반환)
                  ↓
   ┌──────────────────────────────────────┐
   │ 🤔 조금 더 알려주세요                  │
   │                                      │
   │ ① "예쁘게"의 방향은?                   │
   │   ○ 더 미니멀하게                     │
   │   ○ 더 다채롭게 (그라데이션/일러스트)  │
   │   ○ 더 전문적으로                     │
   │                                      │
   │ ② 영향 범위는?                        │
   │   ○ /login 페이지만                   │
   │   ○ /login + /signup                  │
   │   ○ 전체 인증 화면                    │
   │                                      │
   │   [질문 건너뛰기]   [답변하고 진행 →]   │
   └──────────────────────────────────────┘
                  ↓
       (정제된 의도로 영어 프롬프트 생성)
```

**시각 원칙**:
- 카드 자체가 "AI가 잠깐 멈춰서 생각하는" 느낌 — `Loader2` spinner가 위쪽에 작게 도는 작은 indicator.
- 선택지는 라디오 + custom-text 옵션 ("기타: …").
- "건너뛰기"는 명시적 옵션 — UC-2 숙련 사용자가 매번 막힐 일 없게.

---

## 7. Command Palette (⌘K) — "UI가 말을 듣지 않을 때"

모든 화면에서 ⌘K → fuzzy-search palette.

```
┌─────────────────────────────────────┐
│ 🔍 명령 또는 검색...                  │
├─────────────────────────────────────┤
│ 자주 쓰는                            │
│   ▸ 오늘 changelog 저장              │
│   ▸ AI에게 오늘 brief 부탁           │
│   ▸ 새 목표 추가                     │
│                                     │
│ 화면 이동                            │
│   ▸ Overview                  ⌘1   │
│   ▸ Today                     ⌘2   │
│   ▸ Plan                      ⌘3   │
│   ▸ Changelog                 ⌘4   │
│   ▸ Code                      ⌘5   │
│                                     │
│ 액션                                │
│   ▸ 프로젝트 재인덱싱                 │
│   ▸ Overview 다시 생성               │
│   ▸ 테마 토글                        │
│   ▸ Settings 열기             ⌘,   │
└─────────────────────────────────────┘
```

라이브러리: `cmdk` (shadcn 호환).

**중요**: 한국어 음성 검색도 지원. "체인지로그" → "Changelog" 매칭, "오늘" → Today.

---

## 8. 상태 관리 리팩토링 — "UI가 말을 듣게 만들기"

### 8.1. `WorkspaceContext` 단일화

```tsx
// src/contexts/WorkspaceContext.tsx (신설)
interface WorkspaceState {
  // 영속화
  currentProjectId: number | null;
  activeView: "overview" | "today" | "plan" | "changelog" | "code";
  // Code 화면 sub-state
  openFiles: string[];
  activeFile: string | null;
  aiWorkbenchMode: "quick-edit" | "chat";
  aiWorkbenchOpen: boolean;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: "terminal" | "git" | "problems";
  // 휘발성
  indexingProjectId: number | null;
  indexProgress: IndexProgress | null;
}

export const WorkspaceProvider = ({ children }) => {
  const [state, setState] = useState<WorkspaceState>(() => loadFromStorage());
  // 단일 useEffect로 디스크 동기화
  useEffect(() => { persistToStorage(state); }, [state]);
  ...
};
```

원칙:
- `localStorage` 접근은 **이 파일 안에서만**. 다른 컴포넌트에서 `localStorage.getItem/setItem` 직접 호출 금지 (eslint rule로 강제).
- 영속화 키는 `aipm:workspace:v1` 단일 키 + JSON 직렬화. 12개 키 흩어짐 해결.
- 마이그레이션 함수 `migrateV0(legacy) -> WorkspaceState` 로 기존 키 자동 변환 후 삭제.

### 8.2. ChatPanel/AssistPanel 의 자체 상태 정리

- `ActionProposalCard` 의 `localStorage.setItem("action_${convId}_${i}", "applied")` (`ChatPanel.tsx:265`) → `conversation_actions(conversation_id, message_index, status)` SQLite 테이블로 이동. 대화 삭제 시 cascade.
- `TerminalPanel` 의 sessions/pip-position → `WorkspaceContext` 의 `terminal.sessions` 로 흡수. 단 PiP 자체를 제거하므로 position 4개 키는 그냥 삭제.
- `FileExplorer.expandedFolders` → `WorkspaceContext.fileExplorer.expanded` 로 영속화 (새로고침 시 폴더 트리 보존).

### 8.3. 비동기 작업 추적

현재 인덱싱/검색/LLM 호출이 *각자 알아서 spinner* 를 그린다. 통일하려면:

```ts
// 신규: src/contexts/TaskQueue.tsx
useTaskQueue().run("indexing", async () => { ... });
// → 화면 우상단의 글로벌 task ticker (Linear 스타일) 에 progress 노출
```

사용자는 "지금 무슨 일이 진행 중인지" 한 곳에서 확인 가능. *"UI가 말을 듣는다"* 의 핵심 신호 중 하나.

---

## 9. 디자인 시스템 정돈

### 9.1. 타이포그래피

현재 `App.css` 에 SUITE(국문) + Inter Variable(영문) + EB Garamond(heading) + D2Coding(mono) 4종이 로드됨. 폰트 자체는 좋으나 **사용 룰이 없어 컴포넌트마다 임의로 섞임**.

| 용도 | 폰트 | 크기 | 굵기 |
|---|---|---|---|
| Display (Overview hero) | EB Garamond | 32 | 500 |
| Page heading | SUITE | 20 | 700 |
| Section heading | SUITE | 14 | 700 |
| Body | SUITE | 13 | 400 |
| Caption | SUITE | 11 | 500 |
| Code / path / hash | D2Coding | 12 | 400 |

영문 문장이 들어가는 자리(예: provider 이름)에 한해 Inter Variable. 본문 한글에 EB Garamond 직접 적용 금지 (가독성 깨짐).

### 9.2. 색상 토큰 (App.css 기존 변수)

기존 `--primary: #cc785c` (coral) 기조 유지. PM 정체성 강화를 위해 *카테고리 컬러*만 신규 추가:

```css
--cat-feature:  #5b8def;   /* blue */
--cat-fix:      #e7785b;   /* coral (=primary) */
--cat-refactor: #8e7ae6;   /* purple */
--cat-docs:     #4caf81;   /* green */
--cat-chore:    #888880;   /* gray */
```

Changelog/Today 화면의 카테고리 chip + 좌측 컬러 바에 사용.

### 9.3. 간격/모서리

shadcn 기본값을 따르되, *모서리 일관성* 정돈:
- 카드/모달: `rounded-2xl` (16px)
- 버튼/입력: `rounded-lg` (8px)
- chip/배지: `rounded-full`
- **`rounded-xl` 와 `rounded-2xl` 의 자의적 혼용 금지** (현재 `App.tsx` 안에서만 5번 다른 값 사용됨).

### 9.4. 모션

현재 `tw-animate-css` 의 `animate-in fade-in zoom-in-95 duration-200` 가 모달 진입에만 사용 (`App.tsx:795`). 확장:
- 패널 전환: `transition-opacity duration-150`
- AI 응답 streaming: 현재 점 3개 펄스 유지
- Changelog 엔트리 신규 추가 시: `slide-in-from-top-1 duration-300`
- *과도한 모션 금지* — 200ms 초과 트랜지션은 사용자 피로

### 9.5. 아이콘

`src/components/Icons.tsx` 의 `OculIcon`(`App.tsx:336`) 같은 *프로덕트 마크*와 lucide 일반 아이콘이 한 파일에 섞임. 분리:
- `components/icons/AppMark.tsx` — 브랜드 마크
- `components/icons/index.ts` — lucide re-export

---

## 10. 마이크로 인터랙션 개선 목록

| 위치 | 현재 | 개선 |
|---|---|---|
| Project card hover (`App.tsx:374`) | `transform hover:-translate-y-0.5` | + `shadow-lg` 트랜지션 (현재 shadow-md) + 우상단 [→] 아이콘 fade-in |
| 인덱싱 progress bar (`App.tsx:622`) | 단일 바 | + ETA 표시 ("약 2분 남음"), 현재 처리 파일 경로 monospace로 |
| Re-index 버튼 | 좌측 sidebar 하단 텍스트 | 인덱싱 완료 후 7일 지나면 *상단 알림 배너*로 자동 promotion |
| Chat 빈 상태 (`ChatPanel.tsx:837`) | 💬 + 영어 안내 | 한국어 + 추천 질문 chip 3개 ("이 프로젝트 구조 설명해줘" 등) |
| Markdown 코드 블록 | 일반 highlight.js | + "복사" 버튼 우상단 + 라인 번호 토글 |
| 에러 메시지 (`App.tsx:361`) | 빨간 박스 | + 재시도 버튼 + "도움말" 링크 (해당 에러 가이드로) |
| 다이얼로그 (Rename/Delete) | 풀스크린 backdrop | 작은 toast-style overlay (덜 위협적) |
| Terminal PiP | floating draggable | **제거**, 대신 Bottom Drawer + Detach Window |

---

## 11. 접근성 & i18n

### 11.1. 접근성
- 모든 아이콘 버튼에 `aria-label` 강제 (현재 `title=` 만 있음 — 스크린리더 무시).
- 사이드바 nav를 `<nav role="navigation">` + `<ul>` 로 마크업 (현재 `<aside>` 안 raw `<button>` 나열).
- 색상 대비: `--muted-foreground: #8e8b82` (dark)이 본문 위에서 WCAG AA 미달. `#a8a59c` 로 +1 단계.
- 키보드 포커스 링: `outline-ring/50` 적용되어 있으나 일부 버튼에서 `focus:outline-none` 으로 죽임 (`TitleBar.tsx:83`). 제거.

### 11.2. i18n 준비
- 본 문서에서 정의한 한국어 카피를 `src/locales/ko.json` 으로 분리.
- 추후 영어 추가 시 `src/locales/en.json`. `useTranslation()` 훅으로 모든 카피 교체.
- *현재 ko/en 혼재된 문자열은 모두 ko로 통일* 후 i18n 분리 (혼재 상태에서 i18n 도입은 누락 다발).

---

## 12. 단계별 구현 로드맵 (UI 작업 트랙)

GAP-PLAN의 Phase 1~4 와 *교차하지만 독립적*. UI 작업은 백엔드 갭 작업과 병렬 진행 가능 (mock data 활용).

### UI-Phase 1 (1주) — chrome & 상태 기반 정리 *[선행 필수]*
- [ ] `tauri-plugin-window-state` 통합 + min size 강제
- [ ] OS별 decorations 분기 (macOS overlay, Win/Linux native)
- [ ] `App.css` 의 border-radius / WebkitMaskImage 제거
- [ ] `WorkspaceContext` 신설 + 12개 useState 통합
- [ ] localStorage 키 단일화 + 마이그레이션
- [ ] `TitleBar.tsx` 의 수동 traffic light 제거, `data-tauri-drag-region` 채택

### UI-Phase 2 (1주) — IA 5단 재편
- [ ] 사이드바 9 → 5 메뉴 (Overview/Today/Plan/Changelog/Code)
- [ ] Settings / Diagnostics 를 ⌘, 단축키 + Settings 마지막 탭으로 이동
- [ ] Settings 모달 삭제
- [ ] Command Palette (⌘K, `cmdk`) 도입
- [ ] 단축키 매핑 등록

### UI-Phase 3 (1주) — Overview & Today (G2 의존)
- [ ] Overview 화면 신설 + G2 백엔드 연결
- [ ] Today 화면 신설 + `daily_brief` 커맨드 연결
- [ ] 디렉터리 가이드 inline 편집

### UI-Phase 4 (2주) — Changelog 화면 (G1 의존)
- [ ] Changelog 최상위 화면 신설
- [ ] 좌측 날짜 버킷 + 우측 디테일
- [ ] 파일별 diff modal
- [ ] 검색/필터/Export
- [ ] AssistPanel "변경사항 저장" → Changelog 진입 동선

### UI-Phase 5 (1주) — Code 워크벤치 통합
- [ ] AssistPanel + ChatPanel → 단일 AI Workbench (Quick Edit / Chat 모드)
- [ ] Bottom Drawer (Terminal/Git/Problems)
- [ ] Terminal PiP 제거 + Detach Window 유지
- [ ] G3 Clarifying Dialog 통합

### UI-Phase 6 (1주) — Greenfield (G4 의존)
- [ ] 미선택 상태의 거대 진입 카드
- [ ] 5-step Wizard 모달
- [ ] 초안 저장/복원

### UI-Phase 7 (지속) — Polish
- [ ] 디자인 시스템 토큰 정리 (typography, color, radius)
- [ ] 마이크로 인터랙션 (§10)
- [ ] 접근성 감사 + a11y 라벨
- [ ] 카피 한국어 통일 + locales 분리

각 phase 종료마다 *실제 사용자 테스트 1회* (= 본인 dogfood 또는 1명 외부) 후 다음 phase로.

---

## 13. 영향받는 파일 (대분류)

### 신규
- `src/contexts/WorkspaceContext.tsx`
- `src/contexts/TaskQueue.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/BottomDrawer.tsx`
- `src/components/AppMark.tsx`
- `src/features/overview/OverviewScreen.tsx`
- `src/features/today/TodayScreen.tsx`
- `src/features/changelog/ChangelogScreen.tsx`
- `src/features/changelog/EntryDetail.tsx`
- `src/features/changelog/DiffModal.tsx`
- `src/features/code/CodeWorkbench.tsx`           ← AssistPanel + ChatPanel 통합 결과
- `src/features/code/AiWorkbench.tsx`             ← 우측 패널
- `src/features/onboarding/GreenfieldWizard.tsx`
- `src/features/onboarding/StartScreen.tsx`
- `src/locales/ko.json`

### 수정
- `src/App.tsx` — 전면 재작성 (라우터 단순화, dialog 제거, WorkspaceProvider 적용)
- `src/App.css` — chrome 관련 CSS 정리, 컬러 토큰 추가
- `src/components/TitleBar.tsx` — OS 분기, traffic light 제거
- `src/components/FileExplorer.tsx` — expanded 상태 영속화
- `src/features/planner/PlannerPanel.tsx` — view-mode toggle 도입
- `src/features/settings/SettingsPanel.tsx` — Diagnostics 흡수
- `src/features/terminal/TerminalPanel.tsx` — PiP 제거, BottomDrawer 임베드
- `src/features/git/GitPanel.tsx` — Changelog 탭 제거 (별도 화면으로 이전)
- `src-tauri/tauri.conf.json` — decorations true, transparent false
- `src-tauri/src/lib.rs` — macOS 한정 overlay 설정, window-state plugin
- `src-tauri/Cargo.toml` — `tauri-plugin-window-state` 추가

### 삭제
- `src/features/assist/AssistPanel.tsx` (Quick Edit 모드로 흡수)
- `src/features/chat/ChatPanel.tsx`의 비-workspace 모드 (L973+) 분기

---

## 14. 성공 지표 (UX 관점)

| 지표 | 측정 방법 | 목표 |
|---|---|---|
| 첫 사용자가 첫 Changelog 엔트리를 만들기까지 시간 | 로컬 telemetry (opt-in) | < 5분 |
| Command Palette 사용률 | 일일 ⌘K 호출 / 일일 활성 분 | > 0.2회/분 |
| 화면 전환 후 직전 sub-state 복원율 (예: PlannerPanel filter) | 자동 회귀 테스트 | 100% |
| 사이드바 클릭 → 실제 작업 시작까지 평균 클릭 수 | 사용자 세션 녹화 | < 2 clicks |
| "UI 잘 안 됨" 사용자 보고 | 본인 dogfood + 외부 1명 | UI-Phase 5 이후 0건 |
| 윈도우 chrome 관련 버그 (모서리 잘림, 드래그 fail) | issue tracker | UI-Phase 1 이후 0건 |

---

## 15. 열린 결정사항

다음은 작성자가 단정하지 않고 *사용자(=프로젝트 오너) 결정*이 필요한 사항:

1. **앱 이름** — `ai-pm`, `Ocul-PM`, 둘 다 코드/문서에 등장. 하나로 통일 필요.
2. **macOS overlay vs hidden title** — overlay 는 트래픽 라이트만 띄우고 콘텐츠가 그 아래로 흐름. 사용자가 "Cursor 같은 룩"을 원하는지 "Linear 같은 룩"을 원하는지 결정 필요.
3. **Bottom Drawer 의 Problems 탭** — LSP 통합(`commands/diagnostics.rs` 존재) 결과를 노출할 것인가, 아니면 *나중 phase로 미룰* 것인가.
4. **Today 의 "AI 추천" 자동 실행 빈도** — 화면 진입 시 매번 LLM 호출 (비용↑, 신선도↑) vs 사용자가 누를 때만 (비용↓, 신선도↓).
5. **다이얼로그 vs Toast** — Rename/Delete 같은 액션을 풀스크린 다이얼로그 유지할지, inline rename + undo toast 로 갈지.
6. **Vibe Coder 모드 더 강화** — UC-3 사용자를 위해 *"AI가 알아서 다 해주는" One-button 모드* 를 별도로 둘지 (=Quick Edit 안에서 옵션 토글).

---

## 16. 참고

- 본 문서는 `docs/ROADMAP.md` M5-1 "Claude Desktop 스타일 UX 구현" 항목을 *훨씬 구체적으로* 대체한다. M5-1 체크리스트는 본 문서의 UI-Phase 1~2 완료로 자동 충족된다.
- 본 문서의 "신규/수정 파일 목록"은 GAP-PLAN의 §14 와 합쳐 한 PR 시리즈로 관리 권장.
- 모든 UI 변경은 *기능 충실도 우선, 미적 폴리시 마지막* 순서로 머지. 미적 폴리시 PR은 UI-Phase 7 이전에 머지 금지.
