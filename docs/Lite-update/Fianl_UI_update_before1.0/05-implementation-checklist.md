# 05. 구현 체크리스트 — PR-UI DoD · 회귀 보호 · 미해결 결정

> 본 문서의 위상: Final UI Update 라운드의 *진행 추적표*. 각 PR-UI 의 머지 시점에 본 문서의 해당 행이 ✅ 로 갱신된다.
> Lite-W6 의 [`../07-implementation-checklist.md`](../07-implementation-checklist.md) 와 같은 형식.

---

## 0. 시작 전 잠금 항목 (확정 완료 — 2026-05-31)

> **상태**: 본 라운드의 시각 SSOT 가 [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업이므로 *대부분의 결정은 목업 자체* 가 보유.
> 본 §0 는 *목업이 답하지 못한* / *코드 측 정책* 의 잠금만 다룬다.

### 0.1 [`01-ia-and-shell.md`](./01-ia-and-shell.md) §9

- [x] 사이드바 폭 **248px** (Lite-W6 의 56px 결정 reversal)
- [x] IA = **메인 4 + 도구 3 + 푸터 2**
- [x] 단축키 = ⌘1~⌘7 + ⌘, + 기존 ⌘K/⌘P/⌘R/⌘N/⌘F 유지
- [x] ⌘B/⌘J/⌘⇧J/⌘⇧\\ 폐기
- [x] AiOverlay (⌘\) **유지** (보조 통로)
- [x] Toolbar 52px / 백드롭 블러 18px
- [x] 프로젝트 스위처 사이드바 상단
- [x] 다크 토글 푸터 nav-item

### 0.2 [`02-screen-specs.md`](./02-screen-specs.md) §9 (WorkspaceContext 키)

- [x] schema v2 → v3 마이그레이션 *deletion-only* + neutral defaults *(write/deletion 은 PR-UI 7 — PR-UI 0 은 read-compat default 만)*
- [x] `activeView: "code"` → `"diff"` 자동 매핑 *(PR-UI 7 의 write 마이그레이션에서)*
- [x] 신규 키 **11 종** WorkspaceContext 영속 (12 종 중 `themeMode` 제외 — Decision A 로 SettingsContext 소유). read-compat default 는 PR-UI 0 에서 추가됨
- [x] **테마 = SettingsContext SSOT (Decision A, 2026-05-31)** — `themeMode` / `localStorage["oculpm-theme"]` 별도 store *없음*. SettingsContext 가 `.dark` class + `data-theme` 속성을 *동시* 적용. 영속은 SQLite (localStorage 미사용 → lint 무관)

### 0.3 [`03-design-system.md`](./03-design-system.md) §11

- [x] CSS 파일 분리 5 종 (`tokens/base/shell/primitives/screens`)
- [x] Tailwind `theme.extend.colors` **모두 삭제** (CSS variable 로 단일화)
- [x] `data-theme="dark"` 속성 토글 (class 분기 제거)
- [x] axe-core 자동 검사가 PR-UI 1 부터 DoD
- [x] `--text-3` 사용처 grep 점검 (메타 외 사용 0)
- [x] 아이콘 단일 출처 = `src/components/Icons.tsx` 가 lucide-react re-export only
- [x] 자체 SVG 정의 **0 개**

### 0.4 [`04-removal-and-migration.md`](./04-removal-and-migration.md) §5

- [x] `src/legacy/` 보존 — **영구**
- [x] AiOverlay 단축키 — **⌘\ 유지** (충돌 시 PR-UI 5 에서 ⌘⇧A 대체 검토)
- [x] 터미널 focus 시 글로벌 ⌘1~⌘7 — **글로벌 우선**, 터미널 내 탭 전환은 ⌘⌥1~9 로 대체
- [x] 다크 시스템 감지 — **첫 마운트 1 회만** (이후 사용자 토글 우선)
- [x] Code Graph — `src/legacy/code/Graph/` 로 이동, v1.1 검토

### 0.5 본 §0 결정 요약 (한 화면)

| 결정 | 잠금 값 |
|---|---|
| 시각 SSOT | [`Ocul-PM1.0/`](./Ocul-PM1.0/) 목업 |
| 사이드바 폭 | 248px (Lite-W6 §6 의 56px reversal) |
| 메인 IA | Today / 작업 일지 / 변경 diff / Planner |
| 도구 IA | 코드 검색 / 터미널 / AI 패널 |
| 푸터 | 다크 토글 / 설정 |
| 단축키 신설 | ⌘4 ~ ⌘7 |
| 단축키 폐기 | ⌘B / ⌘J / ⌘⇧J / ⌘⇧\ |
| AiOverlay | ⌘\ 유지 (보조) |
| 시각 토큰 시스템 | `--*` CSS variable (Tailwind colors 제거) |
| 다크 모드 토글 | `data-theme="dark"` 속성 (+ 레거시 `.dark` class 병행). 테마 SSOT = **SettingsContext (SQLite)**, `localStorage["oculpm-theme"]` *미사용* — Decision A |
| 시스템 다크 감지 | 첫 마운트 1 회 (SettingsContext `theme: "system"`) |
| 아이콘 | Lucide 단일, strokeWidth 1.75 기본 |
| Code Workbench | `src/legacy/` 영구 이동 (PR-UI 7) |
| WorkspaceContext schema | v2 → v3 *deletion-only* 마이그레이션 (write 는 PR-UI 7) |
| `ui_v2` feature flag | `src/lib/uiFlags.ts` (settings KEYS 레지스트리 *밖* — Decision B). PR-UI 0 도입(기본 OFF), PR-UI 7 영구 ON + 제거 |
| 시각 회귀 잠금 | 8 화면 × 2 테마 = 16 스냅샷 (PR-UI 0 베이스라인) |
| 카피 용어 사전 | [`UI-MASTER-PROMPT.md`](./UI-MASTER-PROMPT.md) §6 |

위 모든 결정이 잠겼으므로 **PR-UI 0** 진입 가능.

### 0.6 PR-UI 0 진행 중 추가 결정 (2026-05-31 잠금)

> §5 운영 흐름에 따라 PR-UI 0 작업 중 확정된 결정. 본 §0 + §0.5 표에 이미 반영됨.

- **Decision A — 테마 SSOT 는 SettingsContext.** 문서 초안의 *신규 `ThemeContext.tsx` + `localStorage["oculpm-theme"]`* 안을 *reversal*. 현 코드의 테마 상태(`light`/`dark`/`system`)는 이미 `SettingsContext` 가 SQLite 로 소유·적용 중이었음. 별도 store 신설은 *이중 상태 + lint allowlist 추가* 비용만 발생. 대신 `SettingsContext` 의 테마 적용 effect 가 레거시 `.dark` class 와 신 `data-theme` 속성을 *동시* 토글하도록 확장 (한 줄). `tokens.css` 는 `[data-theme="dark"]` 를 키로 사용하므로 그대로 호환. 영향: §9 의 `themeMode` 키는 WorkspaceContext 에 *추가하지 않음* (12 → 11 종).
- **Decision B — `ui_v2` flag 는 settings 레지스트리 밖.** `no_feature_flags.test.ts` 가 `src/lib/settings.ts` 의 `feature_*` 행을 금지하므로, flag 를 `src/lib/uiFlags.ts` 의 모듈 const (`isUiV2Enabled()`) 로 구현. settings KEYS / WorkspaceContext 어느 영속 레지스트리에도 들어가지 않아 기존 테스트 green 유지. PR-UI 7 에서 모듈째 삭제.
- **토큰 격리 방식.** 신 `--accent`(녹색)가 레거시 `src/App.css` 의 `--accent`(크림)와 *이름 충돌*. 전역 `:root` import 시 flag-off UI 가 변색됨. 따라서 PR-UI 0 은 `src/styles/*.css` 를 *생성만* 하고 전역 import 는 PR-UI 1 (ui_v2 shell 스코프)로 미룸. `src/styles/index.css` 가 5 파일 번들 진입점.

### 0.7 PR-UI 1 진행 중 추가 결정 (2026-05-31 잠금)

> §5 운영 흐름에 따라 PR-UI 1 작업 중 확정된 결정.

- **토큰 격리 = `React.lazy` 코드 스플리팅 (Decision C).** §0.6 의 "ui_v2 shell 스코프 import" 를 *어떻게* 격리할지 확정. 처음엔 `ShellV2` 안에서 `import("@/styles/index.css")` 동적 호출로 시도했으나, `ShellV2` 가 *정적* import 라 Vite 가 CSS 를 메인 번들에 병합 → flag-off 에 녹색 `--accent` 누출 (빌드로 확인: 메인 css 에 `12a06b` 1 개). **해결**: `App.tsx` 에서 `const ShellV2 = lazy(() => import(...))` + `<Suspense>`. Vite 가 `ShellV2-*.css` 를 *별도 청크* 로 분리 → flag-off 는 청크 자체를 fetch 안 함. 빌드 검증: 메인 css 녹색 `0` / 레거시 크림 `1`, ShellV2 청크 녹색 `4` + `.sidebar`/`.toolbar`/`[data-theme=dark]` 포함.
- **`uiV2View` 는 별도 영속 필드 (Decision D).** ui_v2 의 8 화면 활성 상태를 레거시 `activeView`("today"|"plan"|"code") union 에 섞지 않고 `WorkspaceContext.uiV2View` 별도 필드로. 레거시 union/write-migration 무변경 → flag-off 안전. write/deletion 통합은 PR-UI 7.
- **dogfood 토글 = `VITE_UI_V2` env (Decision E).** `isUiV2Enabled()` 가 `import.meta.env.VITE_UI_V2 === "true"` 를 읽음. `VITE_UI_V2=true pnpm tauri dev` 로 소스 재편집 없이 flag-on. 기본 OFF 유지.
- **macOS traffic-light inset.** flag-on 은 레거시 TitleBar 를 제거 (ui_v2 셸이 자체 chrome). macOS `titleBarStyle: Overlay` 의 신호등이 사이드바 브랜드와 겹치므로 `Sidebar` 에 `macTopInset`(22px drag strip) 추가.

### 0.8 PR-UI 2 진행 중 추가 결정 (2026-05-31 잠금)

- **Decision F — Today brief 는 프론트 집계, 백엔드 무변경.** 설계문서 §1 의 신규 command `get_today_brief`/`get_today_highlights` 를 *추가하지 않음*. 기존 `oculpm_list_journal_entries` 의 `JournalEntrySummary` 가 4 stat (작업 수 / 파일 수 / 에러 사이클 / 에이전트 수) + 주간 차트 + 하이라이트 데이터를 이미 보유. `useTodayBrief` 훅이 7 워크데이를 list 호출 후 프론트에서 집계. **이유**: 마스터 플랜 §10 "백엔드 무변경" 정신 + tauri-specta 재생성/Rust 빌드 회피 (시각 라운드에서 데이터 흐름 변경은 scope creep). **단, 라인 수(+/-)** 는 Summary 에 없어 오늘 entry 만 `getJournalEntry` 로 hydrate 하여 `files_touched[].bytes_added/removed` 합산 (하루 수십 건이라 가벼움). stat sub 는 "+N −N 바이트" 로 표기 (목업의 "라인" → 정확히는 byte delta).
- **`uiV2View` 직접 라우팅.** ShellV2 가 화면 라우터 — 각 화면이 *자체 Toolbar* 를 렌더 (UI-MASTER-PROMPT §7.4). Today 만 V2 구현, 나머지(PR-UI 3~6)는 라벨 placeholder.
- **'다음 할 일' 블록 = 빈 상태 + Planner 링크.** Planner subtask 의 깔끔한 프론트 바인딩이 PR-UI 5 전엔 없으므로, NextTasks 는 empty-hint + ⌘4 Planner 링크. 구조(.panel-head/.panel-body)는 목업과 동일해 PR-UI 5 에서 실데이터만 끼우면 됨.
- **trigger 명명.** 백엔드 `EntryType` 은 `bug`(not `bugfix`). 목업 CSS 클래스는 `.t-bugfix`. `triggerMeta.tsx` 가 `type → {icon,label,cls,cssVar}` 매핑으로 흡수 (bug → cls `t-bugfix`).

### 0.9 PR-UI 3 진행 중 추가 결정 (2026-05-31 잠금)

- **레거시 컴포넌트 재사용 대신 V2 신규.** 설계문서는 "`JournalEntryCard.tsx` 의 시각만 갱신 (구조 보존)" 이라 했으나, 그 카드는 *flag-off TimelineView* 가 쓰는 레거시 shadcn/Tailwind 컴포넌트라 시각만 바꾸면 flag-off 가 깨짐. 대신 `JournalCardV2.tsx` / `JournalScreenV2.tsx` 를 *신규* 로 만들고 레거시는 무변경 (PR-UI 7 에서 레거시 정리). Decision F 패턴 일관.
- **focus 핸드오프 = ShellV2 로컬 state.** Today MiniEntry → 작업 일지 ring-highlight 의 one-shot focus path 를 WorkspaceContext 가 아닌 `ShellV2` 의 `useState` 로. focus 는 영속 대상이 아니고(휘발성, diffTarget 과 동일 의미론) 핸드오프가 shell 내부에 국한되므로 context 를 안 건드림. `TodayScreenV2` 는 optional `onOpenEntry` prop 으로 받음 (없으면 단순 nav — 단위 테스트 호환).
- **⌘N ManualEntry 보류.** ManualEntryModal 은 레거시 shadcn 모달이라 ui_v2 토큰 셸에 바로 못 끼움. ui_v2 모달 패턴은 PR-UI 5/6(Settings 키 입력 모달 등)에서 정립 후 Journal ⌘N 도 연결. DoD 1 항목 보류.
- **journal card → 변경 diff 핸드오프.** 카드 클릭 시 `WorkspaceContext.diffActivePath` 에 entry path 를 park 하고 diff 화면으로 이동. PR-UI 4 의 DiffScreen 이 이 값을 pre-select 에 소비.

### 0.10 PR-UI 4 진행 중 추가 결정 (2026-06-01 잠금)

- **diff 파서 재사용 (무변경).** 설계문서 "LocalDiffView 내부 로직 무변경" 을, `DiffScreenV2` 가 `LocalDiffView.tsx` 의 *export 된 순수 함수* `classifyDiffLines`/`groupIntoHunks`/`pairDiffLines` 를 **그대로 import** 하는 방식으로 구현. LocalDiffView 컴포넌트 자체(flag-off)도 무변경(0 diff lines). → Lite-W6 PR6.x safety-net 테스트가 그 함수들을 계속 커버. 데이터 소스도 기존 `commands.computeDiff` + `recentChanges` 그대로 (백엔드 무변경, Decision F).
- **단일 파일 컴포넌트.** 설계문서의 `DiffFileList.tsx`/`DiffMain.tsx` 분리 대신 `DiffScreenV2.tsx` 한 파일에 파일목록 + DiffBody/Hunk/UnifiedRows/SplitRows 내부 컴포넌트로 구성. 화면이 작아 분리 이득이 적음.
- **diffActivePath one-shot pre-select.** PR-UI 3 이 park 한 `diffActivePath` 를 mount 시 1회 소비 후 `null` 로 clear (diffTarget 의미론과 동일). 이후 수동 선택이 되돌려지지 않음.
- **외부 에디터 = `commands.openInEditor(projectRoot, relPath, editorCmd)`.** Settings 의 `externalEditorCommand`(`useSettings`)를 editorCmd 로 전달. journal 의 `oculpmApi.openEntryInEditor`(plugin-opener 우회)와 달리 diff 는 임의 코드 파일이므로 표준 openInEditor 사용.
- **테스트 타이밍.** `diff_v2.test.tsx` 의 body-렌더 단언은 jsdom 콜드 스타트로 첫 몇 개가 1000ms findByText 기본값을 넘겨 body 대기에 `{timeout:3000}` 적용 (로직 버그 아님). `diff_v2` 는 `check-no-localstorage` allowlist 에 등록 (영속 엔벨로프 시드 — test-only).

### 0.11 PR-UI 5 진행 중 추가 결정 (2026-06-01 잠금)

- **4화면 V2 신규 + 로직 추출 (레거시 무변경).** Planner/Search/Terminal/AI 모두 ui_v2 전용 V2 컴포넌트로 신규. 레거시 `PlannerPanel`/`ChatPanel`(1566줄)/`TerminalPanel`(463줄)/`AiOverlay` 는 **0 diff lines** (flag-off 보존). 터미널 PTY 와이어링(listen `pty-data-${id}` → startPtySession → onData → writeToPty + resize/kill)과 AI 스트리밍 루프(`Channel<ChatEvent>` delta 누적 → chatStream → chatMessageAppend)는 레거시에서 *추출 재구현*. 백엔드 무변경 (Decision F).
- **검색 단일 모드.** 백엔드는 시맨틱 chunk 검색(`searchChunks`)만 제공. 목업의 scope-chip 3종(의미/심볼/정확) 중 **의미 검색만 실연동**, 심볼/정확은 `disabled` + "1.1 지원 예정" title. searchScope 영속은 유지하되 semantic 만 동작.
- **AI thread 공유 = `aiThreadId`(conversation id 문자열) + `aiActiveModel`(provider id).** AiPanelScreenV2 가 mount 시 conversation 을 resolve/create 하고 id 를 `aiThreadId` 에 park → AiOverlay 가 같은 conversation 을 읽음. 모델 칩은 provider(anthropic/openai/gemini/nim) 단위, 색은 데이터 기반(VENDOR map, §3.1 허용).
- **터미널 탭 = `terminalTabs`/`terminalActiveId` 영속.** PTY 핸들은 휘발성(탭 id = PTY session id, mount 시 spawn). 탭 전환 시 xterm 은 전부 mount 유지 + CSS display 토글로 PTY 보존. ⌘T 새 탭 / ⌘W 닫기(화면 내, stopPropagation).
- **터미널/AI 단위 테스트 한계.** xterm(canvas)·PTY·스트리밍 Channel 은 jsdom 에서 실행 불가 → 단위 테스트는 Planner/Search 만(`tools_v2.test.tsx` 9개). 터미널/AI 는 dogfood 런타임 검증. axe 0 은 Planner/Search 로 커버.

### 0.12 PR-UI 6 진행 중 추가 결정 (2026-06-03 잠금)

- **Decision G — 기록 & 보안 섹션은 정직-최소 (Option A).** 목업의 3 토글(자동 일지 작성 / 시크릿 자동 마스킹 / 익명 통계)은 깔끔한 단일-boolean 백엔드가 없음 — 자동일지=watcher 제어, 마스킹=`git.auto_redact_patterns` *리스트*, 텔레메트리=백엔드 부재. 토글로 묶으면 `.oculpm/` 파이프라인을 건드리거나(UI-MASTER-PROMPT §1) 사용자 패턴을 파괴함. → **읽기 전용 상태 칩**(마스킹: 활성 패턴 수, 자동일지: `oculpmWatcherStatus.state`)으로 표시 + **"config.toml 에서 관리 →" 링크**(`openInEditor(projectRoot, ".oculpm/config.toml", externalEditorCommand)`)로 위임. 익명 통계는 *제거*(local-first 제품은 텔레메트리 없음 — 죽은 토글은 부정직). 사용자 확인 완료(2026-06-03).
- **백엔드 무변경 (Decision F 계열).** 모든 컨트롤이 *기존* command 사용: 테마(`SettingsContext`/`useTheme`, Decision A), 외부 에디터(`settings.externalEditorCommand`), 워크데이/롤오버(per-project `oculpmGetConfig`/`oculpmSetConfig`, 400ms 디바운스 — 레거시 OculpmSettings 패턴), keyring(`secretHas`/`secretSet`/`secretDelete`), 폴더 열기(`revealItemInDir(appInfo.app_data_dir)` + 클립보드 fallback), 인덱스 재구축(`indexProject` + `Channel<IndexProgress>`), 초기화(`useWorkspace().resetWorkspace`). 신규 command·migration·specta 재생성 없음.
- **ui_v2 모달 패턴 정립 (PR-UI 3/5 미룬 항목).** API 키 입력 모달 = `.set-modal-backdrop`/`.set-modal` (token-only, `--shadow-pop`). `role="dialog"`+`aria-modal`+`aria-labelledby`, Esc/백드롭 닫기, 키는 write-only(저장값 미표시). 이 패턴이 향후 Journal ⌘N 등의 ui_v2 모달 기준. 레거시 shadcn `ManualEntryModal` 은 PR-UI 7 정리 대상으로 유지.
- **Settings 는 전역 — project 가드보다 먼저 라우팅.** ShellV2 가 `view === "settings"` 를 `projectId == null` 체크보다 *위* 에서 라우팅 → 프로젝트 미선택 상태(⌘,)에서도 진입 가능. per-project 행(워크데이/롤오버/마스킹·자동일지 상태/재구축/config.toml 링크)은 `projectId`/`projectRoot` null 시 self-disable.
- **빌드 해시 = `__BUILD_HASH__` vite define.** About(정보) 섹션의 "버전 · 해시" 용으로 `git rev-parse --short HEAD` 를 `vite.config.ts` 의 `define` 에 주입(부재 시 `"dev"`). vitest 에는 define 이 없으므로 호출부는 `typeof __BUILD_HASH__ !== "undefined"` 가드. `src/vite-env.d.ts` 에 전역 선언.
- **아이콘 추가.** `Icons.tsx` 의 lucide re-export 블록에 `ShieldCheck`/`ShieldAlert`(keyring 칩)/`Info` 추가 (§4.2 단일 출구, 자체 SVG 0).
- **레거시 무변경 + flag-off 안전.** `SettingsPanel.tsx`/`OculpmSettings.tsx`(deep 설정)는 **0 diff lines** — flag-off 는 기존 SettingsPanel, flag-on 만 `SettingsScreenV2` (PR-UI 7 에서 레거시 정리). §6 비상표의 "PR-UI 6 회귀 → flag OFF 로 기존 SettingsPanel 복귀" 보존.
- **open question (dogfood).** ShellV2 의 settings 라우팅을 project 가드 위로 옮긴 뒤 *무프로젝트* 상태의 시각 점검은 dogfood 에서 확인 필요(런타임 경로). 단위 테스트는 projectId 주입으로 커버.

### 0.13 PR-UI 7 진행 중 추가 결정 (2026-06-03 — 구현, 머지 보류)

> 사용자 결정 "구현 + 머지 보류": PR-UI 7 전체를 브랜치에 구현하고 코드 게이트를 green 으로 맞추되, *복귀 불가능* 머지는 2일 dogfood 사인-오프까지 보류. 진행 중 *문서가 예상 못한 scope 경계* 가 드러나 아래 Decision 으로 잠금.

- **Decision H — 분리창(`?window=terminal`/`?window=ai`) 제거.** Lite-W6 PR9 의 detached 윈도우(App.tsx) 제거. ui_v2 전용 터미널/AI 화면이 대체. 이로써 TerminalDock 의 유일 consumer 가 사라져 legacy 이동이 깔끔. (사용자 확인 2026-06-03.)
- **Decision I — AiWorkbench 유지(DoD 이동·grep 대상 제외).** AiWorkbench(채팅/Quick Edit 엔진)는 *유지되는* AiOverlay(⌘\, 전역 마운트)가 본문으로 host. "Code Workbench 잔재"가 아니라 *공유 AI 엔진*. 이동하면 AiOverlay 를 ChatPanel 로 재작성해야 함(라운드 §3.7 "working 코드 재작성 금지" 위반 + Quick Edit 재구현 위험). → 제자리 유지. ChatPanel/ClarifyDialog 도 AiWorkbench 의존이라 함께 유지. (사용자 확인 2026-06-03.)
- **Decision J — 시각 토큰 purge(`dark:`/`classList.toggle("dark")` → 0) 는 PR-UI 7 scope 밖, 이월.** 본 라운드(PR-UI 1~6)는 *프로젝트 진입 후의 8 화면 셸* 만 토큰 시스템으로 전환했다. **대시보드(StartScreen) · 전역 오버레이(Settings 모달 / AiOverlay / CommandPalette / rename·delete dialog / MigrationModal) · shadcn primitives(ui/button·tabs·badge) · ui_v2 에서 렌더되지 않는 레거시 컴포넌트(LocalDiffView 컴포넌트·GoalCard·JournalEntryCard·PlannerPanel·ChatPanel·TodayScreen 등)** 는 *여전히 shadcn Tailwind* (`dark:` variant + `.dark` class). 00-master-plan §10 이 onboarding/대시보드를 명시적으로 scope 밖에 둠. → `dark:` 62건·`classList.toggle("dark")` 1건(SettingsContext, Decision A 병행)은 *유지*. **ui_v2 8화면 표면 자체는 검증상 `dark:`-free** (LocalDiffView/GoalCard 의 `dark:` 는 ui_v2 미렌더 코드). 토큰 격리도 유지(빌드: 녹색 `12a06b` main css 0 / ShellV2 청크 2). 완전 purge 는 *별도 "레거시 UI 은퇴 + 대시보드·오버레이 re-skin" effort* 필요.
- **WorkspaceContext 최소 제거.** DoD 5키만 제거. `aiWorkbenchMode` 는 *유지*(Decision I 의 AiWorkbench 가 live 사용 — 죽은 키 아님). `sidePanelMode`/`sidePanelWidth`/`activeView`+`setActiveView` 도 *유지*(sidePanelWidth/Mode 는 safety-net 커버 + LocalDiffView 미사용; activeView 는 v1/v2 마이그레이션 호환 — uiV2View 가 ui_v2 라우팅). v2→v3 는 *deletion-only*, `activeView "code"→"diff"` 재매핑은 *불필요*(uiV2View 별도 필드, Decision D §0.7).
- **마이그레이션 grep 잔존.** `grep codeSubTab|layoutMode|...` 의 잔존 hit 은 (1) loadFromStorage 의 `delete parsed.<key>` *삭제문*(키를 drop 하려면 이름 필요), (2) 그 동작을 검증하는 safety-net 단위 테스트(`PR-UI 7 — schema v2 → v3` describe), (3) doc 주석뿐 — *live 사용 0*.
- **CommandPalette/GitBranchChip 재배선.** CommandPalette 는 ActiveView/CodeSubTab/sidePanel/detach 명령 제거 후 ui_v2 8화면 nav(`setUiV2View`)로 재구성. GitBranchChip(이제 dead TitleBar 전용)의 `layoutMode` 변이는 `setUiV2View("terminal")` 로 교체. (둘 다 compiled — 깨지면 안 됨.)
- **safety-net 테스트 조정.** FileExplorer import → `@/legacy/FileExplorer`(pure helper 커버 유지). `migrateLayoutMode`/`migrateSplitRatio` 제거에 따라 PR7 Part 2 describe 블록 → `migrateV2ToV3` 검증으로 교체. openDiffFor 테스트의 `sidePanelOpen` 단언 제거.
- **TitleBar/GitBranchChip/PlannerPanel/TodayScreen/TimelineView 등 dead 모듈.** App 에서 import 제거되어 *죽었으나* src/legacy 이동은 *미실시*(DoD 이동 목록 밖, 일부 entangled). 컴파일은 됨(unused export 는 noUnusedLocals 무관). 차기 "레거시 UI 은퇴" effort 대상.
- **Decision J 처리 = 별도 후속 PR (사용자 확정 2026-06-03).** 이월된 시각 토큰 purge(대시보드/오버레이 re-skin + ui_v2 미렌더 레거시 컴포넌트 legacy 이동)는 **PR-UI 8 — legacy UI 은퇴** 로 분리. PR-UI 7 은 *구조 정리(Code Workbench 제거 + flag off)* 로 확정·종결. ui_v2 8화면이 token-pure 이므로 PR-UI 7 머지로 1.0 출시 경로 자체는 열리나, 대시보드/전역 오버레이의 shadcn 다크모드 잔존은 PR-UI 8 까지 유지(사용자 노출 화면은 대부분 ui_v2 셸이므로 영향 국소적).

---

## 1. Phase A — Foundation (3~4 일)

### PR-UI 0 — 회귀 보호 + 토큰 격리 + flag

| 체크 | 항목 |
|---|---|
| ☑ | `src/styles/tokens.css` — :root + [data-theme="dark"] 정의 ([`03-design-system.md`](./03-design-system.md) §1~§3 그대로) |
| ☑ | `src/styles/base.css`, `shell.css`, `primitives.css`, `screens.css` 파일 생성 (빈 + import only) + `index.css` 번들 진입점 |
| ☑ | ~~`src/contexts/ThemeContext.tsx` 신규~~ → **Decision A**: SettingsContext 가 `data-theme` 속성 토글 (신규 context 미신설, §0.6) |
| ☑ | `src/__tests__/theme_toggle.test.ts` — `data-theme` round-trip + 시스템 감지 |
| ☑ | `src/__tests__/ui_v2_flag.test.ts` — flag-on/off 분기가 *각각 현 코드와 동일* 렌더 |
| ☑ | `src/App.tsx` 의 `ui_v2` flag 분기 (`WorkspaceShell` seam, flag-off 100% 무변경 보장) |
| ☑ | `WorkspaceContext` schema 의 *읽기 호환만* (신규 키 11 종 default 추가, write 변화 없음) |
| ☑ | `pnpm typecheck` green |
| ☑ | `pnpm test` green (56 passed \| 3 todo) |
| ☑ | `pnpm lint` green |
| ☑ | `cargo test` green (0 failed) |
| ☑ | `pre-cut-PR-UI0` annotated git tag (commit `5bb1bff`) |

**선행 조건**: Lite-W6 PR0~PR10 ✅, PR12 미진입.

### PR-UI 1 — Sidebar / Shell / Theme

| 체크 | 항목 |
|---|---|
| ☑ | `src/components/Sidebar.tsx` — 248px (목업의 `.sidebar` 그대로) + macOS traffic-light top inset |
| ☑ | `src/components/Toolbar.tsx` — 52px |
| ☑ | `src/styles/shell.css`, `primitives.css`, `base.css` 채움 (목업 styles.css 포팅) |
| ☑ | flag-on 시 신 Shell(`ShellV2`) 마운트, flag-off 시 기존 100% 유지 (`React.lazy` 분기) |
| ☑ | `useGlobalShortcuts` 에 ⌘1~⌘7 + ⌘, 등록 (flag-on `uiV2Nav` 분기) |
| ☑ | 사이드바 9 슬롯 클릭 → `uiV2View` 갱신 (화면은 임시 placeholder, PR 별 라벨) |
| ☑ | 다크 토글 즉시 반영 (SettingsContext `data-theme` — Decision A). *layout shift 0* 은 토큰만 교체로 보장 |
| ☑ | axe-core: 사이드바 a11y violations 0 (`sidebar_a11y.test.tsx`, light+dark) |
| ☐ | 시각 회귀 스냅샷 *베이스라인 등록* (16 장) — §11 상 **1.0 은 수동 비교**, dogfood 시 캡처 (보류) |

### PR-UI 7 의 *원자적* 정리 작업의 단축키 매트릭스 (사전 공개)

| 화면 | 글로벌 단축키 | 화면 내 단축키 |
|---|---|---|
| Today | ⌘1, ⌘K, ⌘P, ⌘R, ⌘N (수동 entry), ⌘, | — |
| 작업 일지 | ⌘2, ⌘K, ⌘P, ⌘N, ⌘F | j/k 이동 |
| 변경 diff | ⌘3, ⌘K, ⌘P, ⌘F | j/k 파일 이동 |
| Planner | ⌘4, ⌘K, ⌘N (새 목표) | — |
| 코드 검색 | ⌘5, ⌘K | ⌘F input focus, ⌘N reset |
| 터미널 | ⌘6, ⌘K | ⌘T 새 탭, ⌘W 닫기, ⌘⌥1~9 탭 전환 |
| AI 패널 | ⌘7, ⌘K, ⌘\ (오버레이 호출) | — |
| Settings | ⌘, | — |

위 표는 [`02-screen-specs.md`](./02-screen-specs.md) 의 화면별 §Interaction 과 lock-step.

---

## 2. Phase B — Screens (1~1.5 주, 병렬 가능)

### PR-UI 2 — Today 6-블록 대시보드

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/today/TodayScreenV2.tsx` 신규 (flag-off `TodayScreen.tsx` 무변경, ShellV2 라우터가 flag-on 시 V2 마운트) |
| ☑ | `StatCard.tsx`, `MiniEntry.tsx`, `WeekChart.tsx`, `AgentBreakdown.tsx`, `NextTasks.tsx` 신규 + `useTodayBrief.ts` / `agentColor.ts` / `triggerMeta.tsx` |
| ☑ | ~~`get_today_brief`/`get_today_highlights` 백엔드 추가~~ → **Decision F**: 백엔드 무변경, 프론트 집계 (§0.8) |
| ☑ | ~~`tauri-specta` 바인딩 재생성~~ → 불필요 (백엔드 무변경) |
| ☑ | vitest: 4 stat 값 = 집계된 backend 응답 (`today_v2.test.tsx`) |
| ☑ | vitest: 빈 journal → empty hint |
| ☑ | MiniEntry 클릭 → 작업 일지 화면 이동 (focus highlight 는 PR-UI 3 의 JournalScreen 에서) |
| ☑ | "오늘 변경 검토" primary → 변경 diff 화면 |
| ☑ | axe-core 0 violations (`today_v2.test.tsx`, with data) |

### PR-UI 3 — 작업 일지 timeline

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/oculpm/JournalScreenV2.tsx` 신규 (flag-off TimelineView/JournalEntryCard 무변경) + `useJournalDays.ts` (프론트 집계, Decision F) |
| ☑ | `JournalCardV2.tsx` 신규 — 목업 `.jcard` 톤 (레거시 `JournalEntryCard.tsx` 는 건드리지 않고 별도 V2 카드) |
| ☑ | scope-chip 6 종 + filter 영속화 (`WorkspaceContext.journalFilter`) |
| ☑ | focusPath 시 ring-highlight 1.6s + scrollIntoView (Today MiniEntry → ShellV2 one-shot 핸드오프) |
| ☑ | ⌘F in-page 검색 (title + slug + tags substring) — 화면 내 stopPropagation |
| ☐ | ~~⌘N → ManualEntry 모달~~ → **보류**: ManualEntryModal 은 레거시 shadcn 컴포넌트라 ui_v2 토큰 셸에 바로 못 끼움. PR-UI 5/6 에서 ui_v2 모달 패턴 정립 후 연결 (§0.9) |
| ☑ | axe-core 0 violations (`journal_v2.test.tsx`, with data) |

### PR-UI 4 — 변경 diff 전용 화면

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/diff/DiffScreenV2.tsx` 신규 (2-pane shell; flag-off LocalDiffView 무변경) |
| ☑ | ~~`DiffFileList.tsx`/`DiffMain.tsx` 분리~~ → 단일 `DiffScreenV2` 내부 컴포넌트(파일목록 + DiffBody/Hunk/Rows) (§0.10) |
| ☑ | 기존 `LocalDiffView.tsx` 의 순수 파서(`classifyDiffLines`/`groupIntoHunks`/`pairDiffLines`) *그대로 import* — 컴포넌트 무변경(0 diff lines), 회귀 테스트 계속 커버 |
| ☑ | 통합/분할 토글 + 영속화 (`WorkspaceContext.diffMode`) |
| ☑ | 외부 에디터 열기 (`commands.openInEditor` + Settings `externalEditorCommand`) 동작 |
| ☑ | "검토 완료" → `diffReadPaths` 갱신 (파일 목록 체크마크) |
| ☑ | 기존 회귀 테스트 모두 green (`lite_w6_safety_net` diff 파서 테스트 유지) |
| ☑ | axe-core 0 violations (`diff_v2.test.tsx`, with diff loaded) |

---

## 3. Phase C — Tools (3~4 일)

### PR-UI 5 — 도구 4 화면 일괄 + Planner

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/search/SearchScreenV2.tsx` 신규 — semantic 실연동(searchChunks). symbol/text scope-chip 은 비활성(백엔드 단일모드, 1.1 안내) (§0.11) |
| ☑ | `src/features/terminal/TerminalScreenV2.tsx` 신규 — 탭 시스템 + PTY 로직 추출(레거시 TerminalPanel 무변경) |
| ☑ | `src/features/chat/AiPanelScreenV2.tsx` 신규 — 모델 칩(provider) + chatStream 추출 + thread |
| ☑ | `src/features/planner/PlannerScreenV2.tsx` 신규 (목업 톤, 레거시 PlannerPanel 무변경) — goalList/subtaskList/subtaskToggle 실연동 |
| ☑ | AiOverlay ↔ AiPanelScreenV2 *thread 공유* — `WorkspaceContext.aiThreadId`(conversation id) + `aiActiveModel`(provider) |
| ☑ | 터미널 탭 추가/닫기/전환 (`terminalTabs`/`terminalActiveId` 영속) + ⌘T/⌘W |
| ☑ | flag-on 시 `TerminalDock.tsx`/`SidePanel.tsx` 마운트 안 함 (ShellV2 가 레거시 Workspace 자체를 대체 — PR-UI 1) |
| ☑ | ⌘B/⌘J/⌘⇧J flag-on 시 비활성 (flag-on 은 ShellV2 마운트, useGlobalShortcuts 의 uiV2Nav 분기가 ⌘1~⌘7/⌘,만; ⌘B/⌘J 핸들러는 레거시 Workspace 한정 — PR-UI 7 에서 영구 제거) |
| ☑ | axe-core 0 violations (Planner/Search `tools_v2.test.tsx`; 터미널/AI 는 xterm/스트리밍이라 런타임 검증 — dogfood) |

### PR-UI 6 — Settings 재구성

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/settings/SettingsScreenV2.tsx` 신규 (flag-off `SettingsPanel`/`OculpmSettings` 무변경) — Toolbar + section-title + `.card.set-section` 시각 정렬 (`.set-*`/`.toggle` 목업 포팅) |
| ☑ | 외부 에디터 명령 input 신설 (디폴트 `code "%path"`, `settings.externalEditorCommand`) |
| ☑ | 다크/라이트 scope-chip 동작 (`useTheme`/SettingsContext 동기화 — Decision A) |
| ☑ | API 키 row 의 keyring 상태 chip (`secretHas`) + 변경/추가 → ui_v2 키 입력 모달 (`secretSet`/`secretDelete`, §0.12) |
| ☑ | 데이터 폴더 열기 (`revealItemInDir`) / 인덱스 재구축 (`indexProject`) / WorkspaceContext 초기화 (`resetWorkspace`, 2-step confirm) |
| ☑ | About(정보) 섹션 — 버전(`appInfo.version`) / 빌드 해시(`__BUILD_HASH__` vite define) |
| ☑ | ~~기록 & 보안 토글 (자동일지/마스킹/통계)~~ → **Decision G (§0.12)**: 읽기 전용 상태 칩 + config.toml 위임 링크, 통계 제거 (깔끔한 토글 백엔드 부재) |
| ☑ | 워크데이 시작 시각 / 자정 자동 롤오버 — per-project `oculpmGetConfig`/`oculpmSetConfig` (400ms 디바운스) |
| ☑ | axe-core 0 violations (`settings_v2.test.tsx` 6개 — 섹션/테마칩/keyring/모달/마스킹칩/axe) |

---

## 4. Phase D — Cleanup (2~3 일)

### PR-UI 7 — Code Workbench 잔재 제거 + Flag off

**주의**: 이 PR 머지는 *복귀 불가능*. 머지 전 2 일 dogfood 게이트 필수.

> **상태 (2026-06-03)**: *구조 정리 코드 완료 + 게이트 green, 머지는 2일 dogfood 까지 보류* (사용자 결정 "구현 + 머지 보류"). 시각 토큰 purge 항목(`dark:`/`classList.toggle`)은 §0.13 의 scope 경계로 **이월** — 별도 effort 필요.

| 체크 | 항목 |
|---|---|
| ☑ | dogfood 종료 + 사용자 사인-오프 (2026-06-03). 발견·수정: 터미널 빈 화면(xterm open 지연 `43cf60f`) / 터미널 `[프로세스 종료됨]`(StrictMode isMounted 가드 `c08df84`) / AiOverlay "분리" 버튼 회귀(`f8202a3`) / AI 패널 마크다운·per-message 모델·NIM 키·키 가드(`c56c20d`) / AI 패널 타자기 효과(`5bf62e9`). 치명적 회귀 0. |
| ☑ | `src/legacy/` 로 이동: `CodeWorkbench`/`TerminalDock`/`SidePanel`/`FileExplorer`/`ProjectsPanel`/`DependencyGraphView`(→`code/Graph/`) |
| ☑ | ~~`AiWorkbench.tsx` 이동~~ → **Decision I (§0.13)**: 유지 (AiOverlay 가 쓰는 공유 AI 엔진 — 이동 시 AiOverlay 재작성, 라운드 원칙 위반). DoD 이동·grep 대상에서 제외 |
| ☑ | `FileExplorer.tsx` 이동 — pure helper(`flattenVisibleNodes`/`nextFocusedPath`)는 `@/legacy/FileExplorer` 경로로 safety-net 커버 유지 (실코드상 DiffScreen 은 LocalDiffView 순수파서만 사용, FileExplorer 분리 불필요) |
| ☑ | `tsconfig.json` `exclude: ["src/legacy/**"]` (이미 존재) |
| ☑ | `WorkspaceContext` schema v3 + `migrateV2ToV3` 적용 (loadFromStorage 에서 5키 deletion-only drop) |
| ☑ | 5 v2 키 제거 (`codeSubTab`/`bottomDrawerTab`/`layoutMode`/`splitRatio`/`sidePanelOpen`) + 메서드/타입(`CodeSubTab`/`LayoutMode`/`setCodeSubTab`/`openInCode`/`toggleSidePanel`/`setSidePanelOpen`) |
| ☑ | `useGlobalShortcuts.ts` ⌘B/⌘J/⌘⇧J/⌘⇧\\ 제거 (+ 죽은 레거시 ⌘1~3 nav; uiV2Nav 단일화) |
| ☑ | `App.tsx` `Workspace`/`WorkspaceShell`/`PRIMARY_NAV`/`CODE_SUB_NAV`/분리창(`?window=terminal\|ai`)/TitleBar 분기 제거 |
| ☑ | `ui_v2` flag *메커니즘* 제거 (`src/lib/uiFlags.ts` + `ui_v2_flag.test.ts` 삭제, `isUiV2Enabled`/`VITE_UI_V2`/`__setUiV2Override` 0) |
| ☑ | grep `CodeWorkbench\|TerminalDock\|SidePanel\|codeSubTab\|bottomDrawerTab\|layoutMode\|splitRatio\|sidePanelOpen` → live 사용 **0** (남은 hit = 마이그레이션 `delete parsed.*` 문 + 그 단위 테스트 + 주석. AiWorkbench 는 Decision I 로 유지) |
| ⚠ | grep `ui_v2` → flag *메커니즘* 0. 라운드 명칭 "ui_v2" 는 주석/CSS 에 잔존(영구 문서) — grep 목표는 flag 였음 |
| ☐→이월 | grep `dark:` → **0** : **Decision J (§0.13)** — ui_v2 *8화면 표면은 dark:-free*. 잔존 62건은 모두 *유지된 레거시 전역 UI*(StartScreen 대시보드 / Settings·Ai·CommandPalette·dialog 오버레이 / shadcn primitives) + *ui_v2 미렌더 레거시 컴포넌트*(LocalDiffView 컴포넌트/GoalCard/JournalEntryCard 등). 별도 effort |
| ☑ | grep `theme.extend.colors` → 0 (tailwind color extend 없음 — §0.3 에서 이미 제거됨) |
| ☐→이월 | grep `classList.toggle("dark")` → **0** : **Decision J** — Decision A 의 `.dark` 병행 적용이 유지된 레거시 shadcn UI(대시보드/오버레이)의 다크모드에 필수. 레거시 UI 은퇴 effort 까지 유지 |
| ☑ | `pnpm typecheck` / `pnpm test`(90 pass) / `pnpm lint` green |
| ☑ | `cargo test` — 백엔드 무변경 (N/A) |
| ☑ | 시각 회귀 — dogfood 수동 검수 (16 장 자동 스냅샷은 §11 상 1.0 보류) |
| ☑ | `pre-cut-PR-UI7` annotated git tag → `5bf62e9` (rollback 보존) |

이 PR 머지 후 **Lite-W6 PR12 (배포 번들링) 진입** 가능. (PR-UI 8 은 출시와 병행/후행 가능 — ui_v2 셸이 token-pure 이므로 차단 요소 아님.)

### PR-UI 8 — legacy UI 은퇴 (후속, Decision J §0.13)

> PR-UI 7 에서 *이월* 된 시각 토큰 purge. **별도 PR** (사용자 확정 2026-06-03). 사용자 결정으로 **8a(dead 이동, 기계적) → 8b(live re-skin, 디자인) 분리** 진행.

**8a — dead 레거시 클러스터 → `src/legacy/` 이동 (2026-06-04, 완료)**

| 체크 | 항목 |
|---|---|
| ☑ | dead 레거시 화면 클러스터 이동: TodayScreen · overview/**(OverviewScreen·ProjectMetaHeader·widgets) · oculpm(TimelineView·JournalEntryCard·JournalEntryDetail·CategoryFilterBar·OculpmOnboardingModal·ManualEntryModal·EmptyToday·filters) · planner(PlannerPanel·GoalCard·SubtaskList·GoalForm·CalendarView·Dashboard) · projects(MigrationModal·LegacyDeleteModal·migrationLogic) |
| ☑ | live production 코드는 이동 파일을 *하나도* import 안 함 확인(typecheck 에러 2건 = a11y 테스트뿐 → V2 커버리지로 대체). 모든 live→dead 참조는 주석/이벤트였음 |
| ☑ | `check-no-localstorage.mjs` legacy walk-제외 + 이동 파일 allowlist 정리 |
| ☑ | `dark:` **62 → 27** (35 제거). 토큰 격리 유지(녹색 main css 0). typecheck/test(88)/lint/build green |

**8b — live shadcn 표면 re-skin (2026-06-04, 완료 — Option 2 변수 remap)**

> 사용자 결정 **Option 2 (변수 remap)**: shadcn CSS 변수 *값* 을 ui_v2 토큰 팔레트로 교체 → 대시보드/오버레이가 ui_v2 녹색/macOS 톤을 입음(레이아웃은 shadcn 유지). mockup 없음 — 시각은 dogfood 로 튜닝.

| 체크 | 항목 |
|---|---|
| ☑ | `App.css` shadcn 변수 remap: `--primary`→녹색(#12a06b/#2bc488) · `--background/card/muted/secondary`→ui_v2 surface · `--destructive`→`--t-bug` · `--ring`→accent. `:root`+`[data-theme=dark]` 양쪽 |
| ☑ | `.dark` 셀렉터 전부 → `[data-theme="dark"]` (var 블록 + glassy/hljs/code-editor 규칙 45곳) + `@custom-variant dark` → `[data-theme]` |
| ☑ | `classList.toggle("dark")` 제거 (SettingsContext, data-theme 속성만) — Decision A 의 `.dark` 병행 종료 |
| ☑ | shadcn primitives(button·tabs·badge·input·select·textarea·checkbox) `dark:` 14개 strip (base 가 var 로 테마) |
| ☑ | ChatPanel(5: 우선순위 배지→`--t-*` var 클래스, prose-invert 래퍼 제거) · GreenfieldWizard(2: CLI 배지→`--primary`/`--accent-uncommitted`) · Markdown(2: prose-invert 를 useTheme 조건부, 복사버튼→토큰) |
| ☑ | `LocalDiffView` 순수 파서 → `diffParse.ts` 추출(DiffScreenV2+safety-net import 갱신), 컴포넌트(4 `dark:`)는 `src/legacy/diff/` 이동 |
| ☑ | theme_toggle 테스트의 `.dark` class 단언 4개 제거 (data-theme 단언 유지) |
| ☑ | **grep `dark:` → 0** · **grep `classList.toggle("dark")` → 0** · typecheck/test(88)/lint/build green |
| ⚠ | 시각 튜닝: shadcn `--accent`(hover) 는 dashboard=gray / in-project 오버레이=green(ui_v2 `--accent` 전역 충돌). 대비·미스매치는 dogfood 후 조정 |

---

## 5. 운영 — PR-UI 진행 중 새 결정의 흐름

본 라운드 진행 중 새 결정이 발생하면:

1. PR 안에서 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §0 (본 §) 에 *새 항목 추가*.
2. 영향 받는 후속 문서 (§00~§04) 의 *동일 PR* 에서 동기화.
3. 본 §의 *결정 요약 한 화면* (§0.5) 도 갱신.

이 3 단이 *한 PR 내* 에서 끝나지 않으면 결정은 *잠금 안 됨* — 후속 PR 에서 다른 결정이 등장하면 우선순위 충돌.

---

## 6. 비상 — 회귀 발생 시

| 단계 | 처리 |
|---|---|
| PR-UI 0~5 중 회귀 | `ui_v2` flag OFF + 해당 PR revert. 사용자 영향 0. |
| PR-UI 6 회귀 | Settings 만 영향. flag OFF 로 기존 SettingsPanel 복귀. |
| PR-UI 7 머지 후 회귀 | `pre-cut-PR-UI7` 태그로 cherry-pick / hard reset. WorkspaceContext v3 → v2 *역 마이그레이션은 없음* — 사용자 영속 state 의 신 키만 *무시*. |

PR-UI 7 머지 후 24h 안에 치명적 회귀 발생 시 *역 마이그레이션 함수* 를 hotfix 로 추가하는 것을 검토. 그 전엔 *flag-on 사용자만* 의 회귀 — Lite-W6 cleanup 코드는 이미 legacy 로 이동했으므로 *현 사용자가 본 화면 = ui_v2*.

---

## 7. 진행 상태 (2026-05-31 작성 시점)

| PR-UI | 상태 | 머지 해시 |
|---|---|---|
| 0 — Foundation | ✅ done | `5bb1bff` |
| 1 — Sidebar/Shell/Theme | ✅ done | `6b5ad48` |
| 2 — Today | ✅ done | `8dce0e8` |
| 3 — 작업 일지 | ✅ done | `c2e26a7` |
| 4 — 변경 diff | ✅ done | `bbdb6ae` |
| 5 — 도구 4 + Planner | ✅ done | `b97b430` |
| 6 — Settings | ✅ done | `b748c44` |
| 7 — Cleanup + Flag off | ✅ done | `5bf62e9` (feat `ebbf5ce` + dogfood fixes) |

각 PR 머지 시 본 표의 상태 (`⬜` → `✅`) + 해시를 갱신.
