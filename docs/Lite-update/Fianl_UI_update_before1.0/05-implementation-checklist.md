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
| ☐ | Toolbar + section-title + `.card.set-section` 시각 정렬 |
| ☐ | 외부 에디터 명령 input 신설 (디폴트 `code "%path"`) |
| ☐ | 다크/라이트 scope-chip 동작 (ThemeContext 와 동기화) |
| ☐ | API 키 row 의 keyring 상태 chip |
| ☐ | 데이터 폴더 열기 / 인덱스 재구축 / WorkspaceContext 초기화 액션 |
| ☐ | About 섹션 (버전 / 빌드 해시) |
| ☐ | axe-core 0 violations |

---

## 4. Phase D — Cleanup (2~3 일)

### PR-UI 7 — Code Workbench 잔재 제거 + Flag off

**주의**: 이 PR 머지는 *복귀 불가능*. 머지 전 2 일 dogfood 게이트 필수.

| 체크 | 항목 |
|---|---|
| ☐ | 2 일 dogfood 종료 + *치명적 회귀 0 건* 사인-오프 |
| ☐ | `src/legacy/` 디렉토리 생성 + 다음 파일 이동: |
| ☐ | &nbsp;&nbsp;`CodeWorkbench.tsx`, `AiWorkbench.tsx`, `TerminalDock.tsx`, `SidePanel.tsx` |
| ☐ | &nbsp;&nbsp;옛 `FileExplorer.tsx` (DiffScreen 이 사용하는 부분 분리 후) |
| ☐ | &nbsp;&nbsp;Code Graph 관련 파일 → `src/legacy/code/Graph/` |
| ☐ | `tsconfig.json` 의 `exclude` 에 `src/legacy/**` 추가 |
| ☐ | `WorkspaceContext.tsx` schema v3 *write 활성화* + v2→v3 마이그레이션 함수 적용 |
| ☐ | 기존 v2 키 (`codeSubTab`, `bottomDrawerTab`, `layoutMode`, `splitRatio`, `sidePanelOpen`) 제거 |
| ☐ | `useGlobalShortcuts.ts` 에서 ⌘B/⌘J/⌘⇧J/⌘⇧\\ 핸들러 제거 |
| ☐ | `App.tsx` 의 옛 `Workspace`, `PRIMARY_NAV`, `CODE_SUB_NAV` 제거 |
| ☐ | `ui_v2` flag 의 *모든 분기 코드 제거* — flag 변수 자체 삭제 |
| ☐ | grep `CodeWorkbench\\|AiWorkbench\\|TerminalDock\\|SidePanel\\|codeSubTab\\|bottomDrawerTab\\|layoutMode\\|splitRatio\\|sidePanelOpen` → **0** (legacy 제외) |
| ☐ | grep `ui_v2` → **0** |
| ☐ | grep `dark:` (Tailwind variant) → **0** |
| ☐ | grep `theme.extend.colors` 의 사용처 → **0** (config 본문에서) |
| ☐ | grep `classList.toggle\\("dark"\\)` → **0** |
| ☐ | `pnpm typecheck` / `pnpm test` / `pnpm lint` green |
| ☐ | `cargo test` green |
| ☐ | 시각 회귀 스냅샷 16 장 검수 (목업과 일치) |
| ☐ | `pre-cut-PR-UI7` annotated git tag (rollback 보존) |

이 PR 머지 후 **Lite-W6 PR12 (배포 번들링) 진입** 가능.

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
| 5 — 도구 4 + Planner | 🟡 코드 완료 (커밋 대기) | — |
| 6 — Settings | ⬜ pending | — |
| 7 — Cleanup + Flag off | ⬜ pending | — |

각 PR 머지 시 본 표의 상태 (`⬜` → `✅`) + 해시를 갱신.
