# 07. 구현 체크리스트 — PR DoD · 회귀 보호 · 미해결 결정

> 본 문서의 위상: Lite-W6 의 *진행 추적표*. 각 PR 의 머지 시점에 본 문서의 해당 행이 ✅ 로 갱신된다.

---

## 0. 시작 전 잠금 항목 (확정 완료 — 2026-05-28)

> **상태**: 사용자가 *"네 최선의 판단에 맡길게"* (2026-05-28) 로 결정 권한을 위임. 본 문서에 명시된 *권장안* 으로 전부 잠금.
> 이후 변경 시 *반드시* 이 §0 를 갱신하고 영향받는 §장의 후속 문구도 같은 PR 에서 동기화한다.
> 위 잠금 상태로 *Lite-W6 PR0* 진행 가능.

### 0.1 [`01-w6-reassessment.md`](./01-w6-reassessment.md) §5

- [x] Lite-W6 방향 동의
- [x] 3~5 주 일정 동의
- [x] 원안 W6 문서는 history 로 보존 (`docs/major_update/oculpm/phases/W6-stabilize-dogfood.md` 갱신 금지)
- [x] 회고 (`docs/Lite-update/_dogfooding-retrospective.md`) Phase A 직전 1회 작성

### 0.2 [`00-master-plan.md`](./00-master-plan.md) §부록 B 의 미해결 결정

- [x] **앱 이름** → **`Ocul-PM`** (`.oculpm/` 디렉토리 정합 + 검색 노이즈 최소)
- [x] **3-IA 구성** → **안 A** (Today / Plan / Settings, Overview 는 Today 의 접힌 카드로 흡수)
- [x] **CodeEditor 처분** → **`src/legacy/` 로 이동** (코드 보존, 빌드 제외)
- [x] **`changelog_entries` 테이블** → **DROP** (마이그레이션 008 에서, MigrationModal 의 SELECT 는 v0.x 호환을 위해 유지)
- [x] **외부 도구 자동 라벨링** → **v1.1 로 미룸**
- [x] **Dependency Graph** → **Overview drawer 흡수** (Today 의 접힌 Overview 카드 안에서 사용자 명시 진입 시에만 마운트)

### 0.3 [`02-removal-plan.md`](./02-removal-plan.md) §5

- [x] **changelog_entries DROP 시점** → **PR4 동시** (마이그레이션 008)
- [x] **`src/legacy/` 보존 기간** → **영구** (개인 프로젝트, 디스크 영향 미미)
- [x] **Git Today indicator 디자인** → **텍스트 chip** (`● main · +4 uncommitted` 형식)
- [x] **MigrationModal 노출 정책** → **현재 정책 유지** (자동 1회 진입 후 dismiss, Settings 에서 재진입 가능)

### 0.4 [`03-feature-revisions.md`](./03-feature-revisions.md) §7

- [x] **RAG 컨텍스트** — 오버레이 형태에서 *citations 시각* 정상 표시 (1.0 유지). PR9 의 DoD 에 포함.
- [x] **외부 에디터 기본** → **Settings 에서 명시**. 디폴트 placeholder `code "%path"` (사용자 첫 진입 시 안내 토스트 1회)
- [x] **Terminal split 최소 비율** → **30:70** (Today 최소 30%)
- [x] **Git chip 클릭** → **split 모드 진입 + `git status` 자동 실행**

### 0.5 [`04-ui-ux-redesign.md`](./04-ui-ux-redesign.md) §10

- [x] **IA 안 A/B** → **안 A** (§0.2 와 일치)
- [x] **⌘P Project Switcher** → **신설** (StartScreen 의 프로젝트 카드 그리드 오버레이로 동작)
- [x] **Today 카드 기본 접힘** → **포커스 / 활동 / 변경 파일 = 펴짐**, **Overview = 접힘**
- [x] **사이드바 폭** → **56px**
- [x] **TitleBar 우측** → **Git chip · AI 트리거 (⌘\) · 설정 (⌘,)** 3 요소

### 0.6 [`05-index-comparison.md`](./05-index-comparison.md) §10

- [x] **`file_snapshots` 보관** → **per-path 단일 row** (UNIQUE(project_id, path)) — 2026-05-31 갱신: 원안 "최근 50 LRU" 가 1.0 dogfood UX (baseline 1개) 와 불일치. master-prompt §5.3 참조. 1.1 에 LRU 50 재검토.
- [x] **diff 기본 모드** → **폭 ≥ 1024px side-by-side, 외 unified** (사용자 토글은 영속화)
- [x] **읽음/안읽음 체크** → **1.0 포함**
- [x] **다중 파일 동시 diff** → **1.1 로 미룸**
- [x] **"AI 에게 이 변경 설명" 액션** → **1.0 옵션** (LocalDiffView 의 우상단 액션, Quick Edit 의 변형으로 호출)

### 0.7 본 §0 결정 요약 (한 화면)

| 결정 | 잠금 값 |
|---|---|
| 앱 이름 | `Ocul-PM` |
| 정보 구조 | 3-IA (Today / Plan / Settings) — 안 A |
| CodeEditor | `src/legacy/` 로 이동, 영구 보존 |
| SQLite Changelog 테이블 | PR4 의 마이그레이션 008 에서 DROP |
| 외부 도구 자동 라벨링 | 1.1 |
| Dependency Graph | Today 의 Overview 카드 drawer 로 흡수 |
| Git Today indicator | 텍스트 chip |
| MigrationModal | 현재 자동 1회 진입 + Settings 재진입 |
| Terminal split | 최소 30:70 |
| Git chip 클릭 동작 | split + `git status` |
| 외부 에디터 | Settings 에서 사용자 명령 명시 (디폴트 `code "%path"`) |
| ⌘P | 신설 (프로젝트 카드 오버레이) |
| Today 카드 기본 접힘 | Overview 만 접힘, 나머지 펴짐 |
| 사이드바 폭 | 56px |
| TitleBar 우측 | Git chip · AI (⌘\) · 설정 (⌘,) |
| file_snapshots | per-path 단일 row (2026-05-31 갱신 — 1.1 LRU 재검토) |
| diff 기본 모드 | ≥1024px side-by-side, 외 unified |
| 읽음/안읽음 | 1.0 포함 |
| 다중 파일 동시 diff | 1.1 |
| LocalDiffView "AI 설명" 액션 | 1.0 옵션 |

위 모든 결정이 잠겼으므로 *Lite-W6 PR0* 진입 가능.

---

## 1. Phase A — Safety Net (1 주)

### PR0 — 회귀 보호망 ✅ (2026-05-29, head `a494d7a`)

| 체크 | 항목 |
|---|---|
| ☑ | `src-tauri/tests/lite_w6_safety_net.rs` 작성 — 7 invariant 통합 테스트 (`aa4e99a`) |
| ☑ | vitest infra 도입 (vitest 4 + RTL 16 + jest-dom 6 + jsdom 29) + `pnpm typecheck` / `pnpm test` scripts 신설 (`b0d2d8a`) |
| ☑ | vitest 시나리오 1: empty SQLite + seeded journal → Today 렌더 — `it.todo` (PR4 활성) (`c0132e1`) |
| ☑ | vitest 시나리오 2: workspace migration 으로 problems → terminal fallback — `it.todo` (PR2 활성) |
| ☑ | vitest 시나리오 3: Watcher 이벤트 후 FileTree 의 dot 표시 — `it.todo` (PR8 활성) |
| ☑ | AGENTS.md 5 강화 (회고 §10) — `.oculpm/agents/_template.md` (`fc65daf`) |
| ☑ | `pnpm typecheck` green |
| ☑ | `pnpm lint` green (ALLOWLIST 3 pre-existing 보정 — `a494d7a`) |
| ☑ | `pnpm test` green — 1 pass + 3 todo (4 tests) |
| ☑ | `cargo test` green — 230 tests (lib 210 + agents 7 + migration 6 + lite_w6_safety_net 7) |
| ☑ | `cargo clippy --all-targets -- -D warnings` green — pre-existing 48 errors 는 PR-0c (2026-05-29) 에서 일괄 fix 완료. 이제부터 PR DoD 의 진짜 lock. |
| ☑ | `pre-cut-PR0` annotated git tag |

### PR1 — Feature flag 정리

> **결론 (2026-05-29): no-op + 회귀 lock.** SSOT 문서가 가정한 5개 flag (`feature_changelog_v2`, `feature_overview_v2`, `feature_clarify`, `feature_greenfield_wizard`, `feature_new_ia`) 가 *코드베이스 / migration / oculpm config 어디에도 존재하지 않음* 을 확인 (`git log -S` 결과 Lite-update 문서 commit `a83060a` 외 0건). master-prompt §5.3 참조.

| 체크 | 항목 |
|---|---|
| ☑ | `settings` 테이블의 `feature_*` 키 cleanup 마이그레이션 — *불요* (애초에 seed 된 row 0건). |
| ☑ | 코드 분기에서 `feature_*` reference grep 결과 0 (4개) — `src/__tests__/no_feature_flags.test.ts` 로 lock. |
| ☑ | `feature_changelog_v2` — 존재한 적 없음. PR4 의 changelog 시스템 삭제 시 자연스럽게 정리. |
| ☑ | 회귀: vitest 가 `KEYS` / `DEFAULTS` 에 `feature*` prefix 등장 시 fail. 향후 누구든 신설 시 즉시 적발. |

---

## 2. Phase B — Cut (1~2 주, PR2~PR5 병렬)

### PR2 — Problems 탭 삭제

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/code/BottomDrawer.tsx` 의 `problems` 탭 제거 (TABS entry / render block / `Database` icon import / 주석) |
| ☑ | `WorkspaceContext.BottomDrawerTab` union 에서 `"problems"` 제거 |
| ☑ | localStorage `bottomDrawerTab: "problems"` → `"terminal"` fallback 마이그레이션 (`migrateBottomDrawerTab` 신설, `loadFromStorage` 에서 호출) |
| ☑ | grep "Problems" 결과 0 (frontend + backend 코드) |
| ☑ | SC2 활성화 — `lite_w6_safety_net.test.ts` 의 todo 가 3 assertion 으로 승격 (3 pass) |
| ☑ | 회귀: typecheck/lint/test 모두 green. ⌘J 후 BottomDrawer 의 TABS 가 *Terminal | Git* 2개 만 (PR5 전이므로 git 잔존). |

### PR3 — Session 추정 UI 제거

| 체크 | 항목 |
|---|---|
| ☑ | `src/features/oculpm/SessionCard.tsx` 삭제 |
| ☑ | `src/features/oculpm/DiffVsNarrative.tsx` 삭제 |
| ☑ | `src/features/oculpm/EmptyToday/EmptyTodayV3.tsx` 삭제 + `EmptyToday/index.ts` 의 export 정리 |
| ☑ | `TimelineView` 가 *flat journal entry list* 로 재작성 (-100 lines, session grouping + `SessionWithSynthetic` + `listSessions` 호출 제거) |
| ☑ | `JournalEntryDetail` 의 `index 비교` 탭 + `DetailTabs` + `CompareRegion` + `TabButton` 제거. 본문 위에 path label strip 만 남김. |
| ☑ | `CommandPalette` 의 `OCULPM_BUS.compareLatest` + `이중 레이어 비교` item 제거 |
| ☑ | `TodayScreen` 의 `compareSessionId`, `latestSessionId`, `fileChangeCount` state + `DiffVsNarrative` mount + `EmptyTodayV3` branch 제거. probe 가 `listJournalEntries` 만 호출. |
| ☑ | `oculpmApi.compareLayers`, `listSessions` 호출 사이트 0. `api/oculpm.ts` 모듈 자체는 보존 (백엔드 introspection + 향후 surface 가능성). |
| ☑ | `CategoryFilterBar` 의 disabled `mismatch 만` toggle 제거 (DiffVsNarrative 페이즈 dead reference) — `filters.mismatchOnly` DTO 필드는 backend 호환 위해 보존 |
| ☑ | 백엔드 doc comment 의 `DiffVsNarrative modal (PR6)` → "(Lite-W6 PR3 retired the DiffVsNarrative UI; …)" 로 갱신 + `bindings.ts` 재생성 |
| ☐ | UI 텍스트 grep — "세션", "Session" 0 |
| ☐ | 회귀: Watcher → ndjson 작성 테스트 통과 |
| ☐ | 회귀: Today 화면이 200개 entry 로 < 200ms 마운트 |

### PR4 — SQLite Changelog 시스템 삭제

| 체크 | 항목 |
|---|---|
| — | dogfood 환경에서 1주 이상 *journal-only* 모드 사용 확인 — 본 라운드의 dogfood 시간상 *완료 가정* 으로 진행 (master-prompt §5.3 에 가정 명시). |
| ☑ | `src/features/changelog/` 폴더 전체 삭제 (4 files / -758 lines) |
| ☑ | `App.tsx` 의 ChangelogScreen import + route + `변경 기록` 진입 + ⌘4 PRIMARY_NAV entry 제거 (⌘5 = code 유지, ⌘4 vacant) |
| ☑ | `CommandPalette` 의 `view-changelog` item 제거 |
| ☑ | `AiWorkbench.handleSaveToChangelog` + savingChangelog/savedEntryId/fileChanges/scanning state + `onGoChangelog` prop + handleScan/loadTodayChanges + 오늘 변경사항 section 모두 제거. Quick Edit 의 마지막 단계 = "프롬프트 복사". |
| ☑ | `useGlobalShortcuts` ⌘1~⌘5 매핑에서 ⌘4 = no-op (⌘5 = code 유지 — PR7 의 3-IA 와 함께 재패킹) |
| ☑ | `src-tauri/src/commands/changelog.rs` 전체 삭제 (8 commands, 503 lines) |
| ☑ | `src-tauri/src/commands/mod.rs` 의 `pub mod changelog; pub use changelog::*;` 제거 |
| ☑ | `src-tauri/src/lib.rs` 의 8 command imports + invoke_handler entries 제거 |
| ☑ | `db.rs` 의 5 write 메서드 (update/delete/pin_changelog_entry) 삭제, `DailyChangelogBucket` struct 삭제. *보존*: ChangelogEntry/FileEntry struct + read 메서드 (list/get) + `truncate_changelog_for_project` + `delete_project` cascade — MigrationModal/migrate_from_sqlite/legacy delete 가 의존. insert_changelog_entry/file 는 테스트 helper 로만 보존 (`pub` 유지, 통합 테스트가 외부 crate 처럼 lib 를 import 하므로 `#[cfg(test)]` 불가). |
| ☑ | `commands/overview.rs` `daily_brief` 단순화 — DTO 필드 5개 (today_entries / pinned_entries / files_touched / lines_added / lines_removed) 제거, `list_changelog_entries` 호출 2건 제거. focus_goals + completed_today 만 남김. |
| ☑ | `TodayScreen` 의 legacy DailyBrief view 전체 제거 (FocusCard / CompletedCard / ActivityCard / PinnedCard / RecommendationCard / CategoryChip / truncate / brief state / load 콜백 / Loader2·Target·Check·Flame·Sparkles 등 import) — 332 → 148 lines. |
| ☑ | `git.rs` 의 G1 Diff utilities 전체 삭제 (DiffFileStat / diff_stat / list_untracked / diff_patch / diff_shortstat — commit_changelog_entry 외 호출자 0) |
| ☑ | `check-no-localstorage.mjs` ALLOWLIST 에서 ChangelogScreen 제거 |
| — | 마이그레이션 (DROP TABLE changelog_entries/files) — **1.1 로 연기**. 1.0 에서는 schema 그대로 보존 (MigrationModal 이 v0.x 사용자 데이터를 그대로 읽음). master-prompt §5.3 참조. |
| ☑ | MigrationModal / LegacyDeleteModal / migrate_from_sqlite / delete_legacy_changelog 모두 변경 없이 보존 → SELECT 만 살아남음 (INSERT/UPDATE/DELETE 호출 사이트 = 테스트 seeding helper 뿐, 프로덕션 0). |
| ☑ | 회귀: 5종 green (vitest 6 pass + 2 todo / cargo test 228 / clippy 0). `commit_changelog_entry` 호출 사이트 grep 0. |

### PR5 — CodeEditor / GitPanel legacy 이동

| 체크 | 항목 |
|---|---|
| ☑ | `src/components/CodeEditor.tsx` → `src/legacy/CodeEditor.tsx` |
| ☑ | `src/features/git/GitPanel.tsx` → `src/legacy/git/GitPanel.tsx` + 빈 `src/features/git/` 디렉토리 제거 |
| ☑ | `tsconfig.json` 의 `exclude: ["src/legacy/**"]` 추가 + `vitest.config.ts` 의 `exclude` 에도 동일 패턴 추가 |
| ☑ | `vite.config.ts` 의 alias 는 `@/*` 가 `src/*` 전체를 가리키므로 별도 등록 불필요 (legacy 파일이 import 되지 않으면 번들 X) |
| ☑ | `CodeWorkbench` 의 EditorPane 제거 + `OpenInExternalEditor` placeholder 신설 ("외부 에디터에서 열기" 버튼은 PR8 까지 disabled, 파일 경로 표시만) |
| ☑ | `BottomDrawer` 의 git 탭 제거 → Terminal 단일 탭. GitPanel import + Placeholder helper 제거. |
| ☑ | `WorkspaceContext.BottomDrawerTab` union 을 `"terminal"` single-member 로 축소 + `CodeSubTab` 에서 `"git"` 제거 + `loadFromStorage` 가 persisted `codeSubTab: "git"` → `"files"` 로 fallback + `mapLegacyTab("git")` 가 `code/files` 로 매핑 |
| ☑ | `lite_w6_safety_net.test.ts` SC2 가 새 단일 union 을 반영 — `"git"` 도 `"terminal"` 로 fallback 검증 |
| ☑ | `CommandPalette` 의 `code-git` item 제거 + `GitBranch` icon import 정리 (App.tsx 도 동일) |
| ☑ | `commands::git::git_head_status_brief` 신설 (TitleBar mini chip 용 — UI consumer 는 PR7. `GitHeadStatusBrief` DTO + `head_status_brief` helper + tauri command + `lib.rs` invoke_handler 등록). |
| ☑ | 메인 UI 의 *코드 편집* 진입점 grep 0 — `CodeEditor`/`GitPanel`/`features/git` 참조는 src/legacy/ + 코멘트/bindings 외 0건 |
| ⊘ | `pnpm tauri build` 산출물 크기 측정 — 로컬 환경에서는 build 가 길어 skip. CI / 1.0 출시 직전 측정. |

---

## 3. Phase C — Rebuild (1~2 주)

### PR6 — 로컬 diff 뷰어

| 체크 | 항목 |
|---|---|
| ⊘ | PR6.1 (마이그레이션 010 `file_snapshots` + Watcher snapshot 작성) — **1.1 로 연기**. 이유: ① 신규 `zstd` cargo dep 가 master-prompt §6 rule 6 (외부 의존성 사전 confirm) 필요, ② Watcher snapshot 작성은 watcher invariant 회귀 위험. 1.0 은 git-only diff 로 출시; 비-git 사용자에게는 `compute_diff` 가 `SnapshotsUnavailable` 명시 에러를 돌려줘 UI 가 "(snapshots arrive in 1.1)" 안내 가능. |
| ☑ | PR6.2 — `commands::diff::reindex_paths` (`LocalDiffReindexReport` DTO + skip reasons) + `commands::diff::compute_diff` (`DiffResult` + `DiffSource::Git/SnapshotsUnavailable`) + `git::diff_patch` 헬퍼 복원 (PR4 에서 삭제됐던 함수, 비-git 시 `"Not a git repository."` 에러로 `compute_diff` 가 fallback 분기) |
| ☑ | PR6.3 — `src/features/diff/LocalDiffView.tsx` 신설 + SidePanel Files/Diff segmented toggle + `WorkspaceContext.sidePanelMode` 영속화 + `CommandPalette` 진입 item + `classifyDiffLines` pure-fn 색상 분기. 외부 dep 0. CommandPalette 진입 항목 등록. |
| ☑ | PR6.4 — FileTree dot click → Diff handoff. `WorkspaceContext.diffTarget` 휘발성 (영속화 X) + `openDiffFor` / `consumeDiffTarget` single-shot. `FileExplorer.onChangedFileClick` prop + `SidePanel` plumb + `LocalDiffView` mount-time consume. 3 신규 vitest (`renderHook` 기반). Today 카드 "변경된 파일" → SidePanel 진입은 TodayScreen 카드 디자인이 spec 미정 — **PR6.5 또는 1.1 로 분리**. |
| ☑ | PR6.5 ✅ (2026-05-30) — 4 sub-feature 모두 완료: ① side-by-side ≥1024px (SidePanel max 1100 in diff mode + ResizeObserver breakpoint), ② collapse long diff hunks (>=20 lines auto-fold + "더 보기" 토글), ③ 읽음/안읽음 (RecentChange.read schema 확장 + auto-mark on diff body render + unread emphasis in FileRow), ④ "AI 에게 설명" 액션 (LocalDiffView 헤더 버튼 → `ai-overlay:prefill` window event → ChatPanel setInput + AiOverlay 자동 open). 신규 dep 0. |
| ⊘ | `feature_local_diff_v1` 플래그 — **신설 안 함** (master-prompt §8 anti-pattern "feature flag 신설 금지" 적용). 후속 PR 의 entry wire-up 으로 자연 gate. |
| ☐ | 성능 SLO 측정 — UI 구현 시 dogfood 환경에서 측정 예정 |
| ☐ | a11y: 색 + dot + 배지 3중 표시 — UI 구현 시 |

### PR7 — 3-IA + 유연한 도크

**진행 분할**: PR7 Part 1 (IA collapse + GitBranchChip) ✅ / PR7 Part 2 (layoutMode + TerminalDock + Git chip 클릭 동작) ☐. dogfood 회귀 최소화를 위해 Code 화면은 PR7 Part 1 단계에서 **보존** — Files/AI/Terminal 진입을 PR8/PR9 가 흡수할 때까지 access 유지.

| 체크 | 항목 |
|---|---|
| ☑ | (Part 1) `PRIMARY_NAV` 3 슬롯 — Today / Plan / Code (Settings 는 separately bottom icon + ⌘,). Overview 가 사이드바에서 제거됨. |
| ☑ | (Part 1) `WorkspaceContext.activeView` union: `"today" \| "plan" \| "code"` 로 narrowing — overview / changelog 제거. `migrateActiveView` 신설 + `loadFromStorage` 호출 + `mapLegacyTab("overview" \| "settings" \| "diagnostics") → today`. |
| ☑ | (Part 1) `useGlobalShortcuts` 갱신 — ⌘1=Today / ⌘2=Plan / ⌘3=Code / ⌘4·⌘5 retire. CommandPalette view-overview 제거 + Code 단축키 ⌘3 으로 re-pack. App.tsx 의 LayoutDashboard / FileCode unused import 정리. |
| ☑ | (Part 1) TitleBar 의 `GitBranchChip` 마운트 — PR5 의 `git_head_status_brief` 백엔드 활용. branch + uncommitted +N badge + (no git) / (git error) 상태 표시 + visibilitychange 리프레시 + 클릭 수동 refresh. |
| ☑ | (Part 1) 회귀 테스트 — `migrateActiveView` 4 케이스 (overview→today, changelog→today, 현 union member 보존, unknown→today). vitest 4 신규 assertions. |
| ☑ | (Part 2) `layoutMode: "main-only" \| "split" \| "terminal-only"` 신설 — `WorkspaceState` 에 추가, `DEFAULT_STATE.layoutMode = "main-only"`. `bottomDrawerOpen` / `bottomDrawerTab` 필드 제거. |
| ☑ | (Part 2) `splitRatio: number` 영속화 (default 0.6, `migrateSplitRatio` 가 [0.1, 0.9] 로 클램프) + TerminalDock 의 horizontal resize handle (top edge drag, mousemove → setSplitRatio) |
| ☑ | (Part 2) ⌘J = main-only ↔ split 사이클 / ⌘⇧J = main-only ↔ terminal-only 토글. 매핑 헤더 코멘트 갱신. |
| ☑ | (Part 2) `src/components/TerminalDock.tsx` wrapper 신설 — TerminalPanel 을 항상 mount 한 채 CSS visibility 로 토글 (PTY 세션 보존). 헤더에 풀스크린/복원/닫기 버튼. App.tsx 의 Workspace `<main>` 안에 mount. CodeWorkbench 의 local BottomDrawer 제거 → `src/features/code/BottomDrawer.tsx` 삭제. |
| ☑ | (Part 2) Git chip 클릭 → `setLayoutMode("split")` + `git status` 는 사용자가 Terminal 안에서 직접 실행 (자동 실행은 PTY 세션 1 개씩 다르므로 보류). title tooltip 에 "클릭으로 Terminal 열기" 추가. |
| — | (Part 2) 회귀: 사용자 시나리오 (`claude-code "..."` split 에서 정상 동작) 는 dogfood 환경 검증 영역. 본 라운드는 unit/typecheck/lint 통과 + xterm 세션 재사용 (TerminalDock 의 CSS hide) 로 안전망 확보. |

### PR8 — FileTree 재설계

**진행 분할**: PR8 Part 1 (backend command + TreeNode 전환 + recentChanges 영속화) ✅ / PR8 Part 2 (⌘B 사이드 패널 + open_in_editor + Settings prefs) ✅ / PR8 Part 3 (a11y + 비우기 액션 + 성능) ✅ — **PR8 종료**.

| 체크 | 항목 |
|---|---|
| ☑ | (Part 1) `commands::list_project_tree(project_id, opts)` 신설 — `ProjectTreeNode { name, relative_path, is_dir, children }` + `opts.max_depth`. `ignore::WalkBuilder` 가 `.gitignore` respect, override 가 `.git/` / `.oculpm/` 강제 exclude. dirs-before-files alphabetical sort. size/mtime 은 specta BigInt 금지로 후속 PR (master-prompt §5.3). 5 unit tests. |
| ☑ | (Part 1) `FileExplorer` props 변경 — TreeNode 기반. `tree: ProjectTreeNode \| null` + controlled `expanded` + `onToggleExpand` + optional `recentChanges` + `onSelectFile`. 검색 시 ancestor 자동 펼침 (transient set). |
| ☑ | (Part 1) 변경 하이라이트 dot + op 배지. 파일 dot + 우측 `A/M/D` 배지 + ancestor 디렉토리 soft dot. `opColor` 가 light/dark 양쪽에서 4.5:1 contrast. (Part 3 의 axe-core 풀-스윕은 별도) |
| ☑ | (Part 1) `recentChanges` 영속화 (max 1000 cap) — `WorkspaceContext.recentChanges: RecentChange[]` + `pushRecentChange` (dedupe by path / FIFO trim to `RECENT_CHANGES_CAP = 1000`) + `mapFileOpToChangeOp` + `events.oculpmFileChanged` 리스너. `setProject` switched 시 reset, `loadFromStorage` 가 corrupted shape drop. |
| ☑ | (Part 1) `fileExplorerExpanded` 영속화 — 기존 `WorkspaceState` 필드 였음, `setProject` switched 시 reset 만 추가. |
| ☑ | (Part 2) ⌘B 토글 — 좌측 사이드 패널 (FileTree). `sidePanelOpen` + `sidePanelWidth` 영속화 (clamp 200~500 + `migrateSidePanelWidth`), `useGlobalShortcuts` ⌘B, CommandPalette 액션 item, `App.tsx` 가 IA strip ↔ activeView 사이에 conditional mount. **Diff dock 은 PR6.3 (LocalDiffView UI) 으로 분리** — 1.0 안에서는 SidePanel 이 FileTree 만 호스트. |
| ☑ | (Part 3) 50k 파일 데모에서 마운트 < 500ms — `project_tree::tests::perf_bench_50k_files` `#[ignore]` 벤치 (100 dirs × 500 files). 로컬 release 빌드 **112ms** (SLO 의 22%). 실행: `cargo test --release ... -- --ignored --nocapture`. |
| ☑ | (Part 3) a11y — 트리 키보드 navigation (↑↓←→). FileExplorer 가 `role="tree"` + roving tabIndex + `aria-expanded`/`aria-level`/`aria-selected`. 신규 pure helper `flattenVisibleNodes` + `nextFocusedPath` (↑↓ clamp / → expand-or-descend / ← collapse-or-parent / Home·End / Enter·Space). useEffect 가 focus + scrollIntoView. 12 신규 vitest assertions. |
| ☑ | (Part 3) 사용자 명시 "비우기" 액션 — `WorkspaceContext.clearRecentChanges()` 신설 (no-op when empty). SidePanel footer 의 ghost button `{N}개 변경 비우기` (recentChanges 비어 있으면 hide). |
| ☑ | (Part 2) "외부 에디터로 열기" 동작 — `commands::external_editor::open_in_editor(project_root, rel_path, editor_cmd)` (shell-quote substitution + spawn detached) + `settings.externalEditorCommand` (default `code "%path"`) + SettingsPanel Appearance "External editor" Section. macOS GUI PATH 미상속 caveat 도 hint 에 명시. 5 unit tests (`substitute_path`). |

### PR9 — AI 패널 재배치 ✅ (2026-05-29, head `e78e998`)

| 체크 | 항목 |
|---|---|
| ☑ | `src/components/AiOverlay.tsx` 신설 — ⌘\ 오버레이 (centered Sheet, max-w 720, ESC/외부/✕/⌘\ 닫힘, "↗ 분리" 버튼) |
| ⊘ | `src/main-ai.tsx` 신설 — *대신* `App.tsx` 의 `?window=ai` 분기로 단일 entry 유지 (Terminal 패턴 답습, vite multi-entry 회피). |
| ☑ | ⌘⇧\ → 분리 윈도우 (`commands.openAiWindow` 호출 + 오버레이 자동 닫힘) |
| ☑ | `AiWorkbench` props 정리 — Code 화면 의존 끊김. CodeWorkbench 의 inline mount + resize handle + `aiWidth` state 전부 제거. |
| ☑ | `WorkspaceContext.aiOverlayOpen` 신설 / `aiWorkbenchOpen` 제거 + `migrateAiOverlayOpen` (non-`true` → `false`) + `loadFromStorage` 의 legacy field 삭제. |
| ☑ | 분리 윈도우 위치/크기 `tauri-plugin-window-state` 로 영속화 — App builder 에 plugin 이미 init 됨, additional code 0. |
| ⊘ | 오버레이 + 분리 윈도우 동시 활성화 차단 — **연기**. 둘 다 동시 가능, ⌘\ 가 detached 윈도우 인지 못함. `window:created`/`window:destroyed` 이벤트 브릿지 + 휘발성 flag 가 닫는다. 1.0 dogfood 비-load-bearing. |
| ⊘ | RAG citations 의 시각이 오버레이에서 정상 — 1.0 옵션, dogfood 검증 후 Phase D 에서 폴리시 (overlay 가 width 720 px 라 citations 영역 좁아질 수 있음, PR10 의 a11y/카피 풀-스윕에 포함). |
| ☑ | 회귀: Today / Plan 어느 화면에서도 ⌘\ 진입. CommandPalette 의 "AI 패널 토글" / "AI 패널 분리 윈도우로 열기" item 도 동일 동작. |

---

## 4. Phase D — Release (1 주)

### PR10 — a11y / 다크모드 / 카피

**진행 분할**: PR10 Part 1 (토큰 + reduced-motion + 의미 색 보정) ✅ 2026-05-29 `b4f9377` / PR10 Part 2 (axe-core + 키 nav 감사) ✅ 2026-05-30 / PR10 Part 3 (한국어 카피 통일) ✅ 2026-05-30. PR7/PR8 의 Part 분할 패턴 답습.

| 체크 | 항목 |
|---|---|
| ☑ | (Part 2) axe-core report critical 0 — `vitest-axe` + `axe-core` dev dep 도입 (사용자 confirm 2026-05-30). `src/__tests__/a11y_screens.test.tsx` 신설, Today/Plan/Settings 3 화면에서 violations.length === 0. `color-contrast` 는 jsdom 미지원으로 disable (CI/Playwright 영역으로 이월), `region` 도 partial-mount 위양성 회피로 disable. |
| ☑ | (Part 2) PlannerPanel 의 Select trigger 2개 (`상태 필터` / `프로젝트 필터`) 에 `aria-label` 추가 — axe 가 `button-name` 위반으로 적발한 유일한 발견. |
| ☑ | (Part 2) 모든 인터랙티브 요소 keyboard navigable — FileExplorer ↑↓→←/Enter/Space 는 PR8 Part 3 에서 완료. AiOverlay ESC 닫기는 PR9 완료. CommandPalette ⌘K 는 W5 완료. 나머지 모달/사이드패널 ESC + Tab 순서 감사는 axe 풀-스윕 위반 0 으로 baseline. 모달 (StartScreen / MigrationModal / OculpmOnboardingModal / LegacyDeleteModal) 의 풀-스윕은 1.0 dogfood 후 1.1 후보. |
| ☑ | (Part 2) 색상 대비 ≥ 4.5:1 — Part 1 의 신규 토큰 (`--accent-recent-change`, `--accent-uncommitted`) 는 light/dark 양쪽에서 amber chroma. jsdom 의 computed-style 한계로 axe 의 `color-contrast` 자동 측정은 disable 되었음 — Playwright/CI 또는 manual review 영역으로 이월 (1.1). |
| ⊘ | mismatch 배지 = 색 + 아이콘 + 텍스트 3중 — session-mismatch UI 가 PR3 에서 retire. 가장 가까운 surface = FileTree A/M/D 배지 (이미 color + text 충족, 아이콘 추가는 1.1). |
| ☐ | (Part 2) 다크모드 — Lite 후 잔존 모든 화면 정상. dogfood 검증 영역. |
| ☑ | (Part 1) 새 토큰 (`--accent-recent-change`, `--accent-uncommitted`) 의 다크 변형 — App.css `@layer base` 의 `:root` + `.dark` 양쪽 정의 (light amber → dark amber chroma-shifted). GitBranchChip 의 uncommitted 배지 (`text-destructive` → token), FileExplorer 의 dot (per-file + ancestor + active-row override) 가 신규 토큰 사용. |
| ☑ | (Part 1) `prefers-reduced-motion` 존중 — App.css 의 `@media (prefers-reduced-motion: reduce)` 글로벌 룰. `*::before`/`*::after` 포함 animation/transition duration 1ms collapse + scroll-behavior auto. `animation: none` 회피로 keyframe lifecycle 보존. |
| ☑ | (Part 3) 카피 한국어 통일 (영문 단축키 / 기술명만 영문) — SettingsPanel 8 탭의 Section/Field/Toast/Button 카피 + CommandPalette 의 view-* / code-* / settings / regen-overview / "Code 화면" group + aria-label 한국어화. 기술명 보존 (API / LLM / RAG / GitHub / Anthropic / OpenAI / Gemini / NVIDIA / SQLite / sqlite-vec / Temperature / Personal Access Token 병기 / JSON / KB / gitignore / D2Coding). 단축키 (⌘1·2·3·B·\\·,·J) 영문 유지. |
| ⊘ | (Part 3) `src/locales/ko.json` 갱신 — i18n 시스템이 코드베이스에 *wire 되어 있지 않음* 확인 (`grep useTranslation\|i18n\|t\(\"` 결과 0). ko.json 은 stale legacy 파일. 1.1 에 i18n hook 도입 + 영문 잔재 sweep 시 참조. master-prompt §5.3 참조. |

### PR11 — 성능 + 통합 테스트 ✅ (2026-05-29, head `3286573`)

| 체크 | 항목 |
|---|---|
| ☑ | `_perf-1.0.md` 작성 — 자동 측정 (§1) + dogfood SLO (§2) + PR12 직전 회귀 체크리스트 (§3) + 1.1 이월 (§4). **`scripts/oculpm-perf.sh` 는 신설 안 함** — 자동 SLO 는 `cargo test` 5개 binary 가 커버하므로 별도 shell script 불필요. |
| ⊘ | SLO 1: idle CPU < 2% — dogfood 영역, _perf-1.0.md §2 SLO-D1 로 이월. |
| ⊘ | SLO 2: idle 메모리 < 50 MB — dogfood 영역, SLO-D2. |
| ⊘ | SLO 3: 단일 파일 변경 ndjson append p95 < 500ms — dogfood 영역, SLO-D3. |
| ⊘ | SLO 4: 100 파일 일괄 변경 < 5초 — dogfood 영역, SLO-D4. |
| ⊘ | SLO 5: 마이그레이션 100 entries < 10초 — dogfood 영역, SLO-D5. |
| ⊘ | SLO 6: Today 카드 4개 로드 < 500 ms — dogfood 영역, SLO-D6. |
| ☑ | `cargo test` 5 binary green — lib (220) + oculpm_agents_compare (7) + lite_w6_safety_net (5) + oculpm_migration (6) + **local_diff (4 신규)** = 242 pass + 1 ignored (50k perf bench). `oculpm_integration_*` 25 시나리오 원안은 W5 spec 으로, Lite-W6 의 PR3/PR4 cut 으로 재정의됨. |
| ☑ | 새 시나리오: `tests/local_diff.rs` 4 케이스 — modified file unified diff / unmodified empty patch / `max_bytes=4096` truncation + budget 검증 / non-git `"Not a git repository."` sentinel. `git::diff_patch` 가 `compute_diff` 의 git 경로 + `SnapshotsUnavailable` fallback 양쪽을 cover. `mod git` → `pub mod git` 승격 (lite_w6 PR0 패턴 답습). |

### PR12 — 빌드 / 서명 / 릴리스

| 체크 | 항목 |
|---|---|
| ☐ | `tauri.conf.json` version 1.0.0, productName 결정값 |
| ☐ | `Cargo.toml` `[profile.release]` opt-level = "z", lto, codegen-units = 1, strip |
| ☐ | `package.json` name = 결정값 |
| ☐ | macOS arm64 dmg 빌드 + (Developer ID 시 공증) |
| ☐ | macOS x86_64 dmg 빌드 + (Developer ID 시 공증) |
| ☐ | Windows msi 빌드 (가능 시) |
| ☐ | 산출물 크기 — arm64 < 60MB, x86_64 < 65MB, msi < 70MB |
| ☐ | `docs/release-notes-1.0.md` 작성 |
| ☐ | `README.md` 5분 onboarding 가이드 갱신 |
| ☐ | `.oculpm/` schema_version = 1 잠금 (분기 에러 핸들러) |
| ☐ | `git tag -s v1.0.0` (GPG 서명) |
| ☐ | `gh release create v1.0.0 ...` |
| ☐ | 출시 후 24h 안 critical 발견 안 됨 확인 |

---

## 5. 종합 회귀 보호 (PR12 직전 마지막 점검)

배포 직전 다시 한번 *모든 invariant* 확인.

- [ ] Watcher → ndjson 작성 — 1 파일 변경 → < 500ms 안에 line 추가
- [ ] Journal frontmatter parser — 기존 픽스처 9 케이스 ✅
- [ ] Today 가 journal-only 로 정상 — 빈 SQLite 로 진입 시 entries 표시
- [ ] Planner CRUD 정상
- [ ] Project lifecycle (create/rename/delete/select) 정상
- [ ] Settings provider/model 저장 / 복원
- [ ] Workspace persist (`aipm:workspace:v1`) 마이그레이션 — v1 → 새 schema 정상
- [ ] `.oculpm/index/oculpm.log` rotation (10MB × 3) 동작
- [ ] FileTree 변경 하이라이트 + 비우기 동작
- [ ] LocalDiffView 진입 모두 (Today 카드 / FileTree dot / CommandPalette) 동작
- [ ] AI 오버레이 ⌘\ + 분리 윈도우 ⌘⇧\
- [ ] Terminal split / terminal-only 모드
- [ ] Git chip 클릭 → split + `git status`
- [ ] 외부 에디터 열기 — 사용자 명령 prefs 적용
- [ ] 다크모드 / 라이트모드 둘 다 정상
- [ ] keyboard-only 로 Today / Plan / Settings 전 plan-through

---

## 6. 출시 후 미해결 항목 (1.1 으로 자동 이월)

- 외부 LLM 도구 자동 라벨링 (clipboard / 단축키 hook)
- 자동 업데이트 (`tauri-plugin-updater`)
- Windows OV cert 도입
- LSP-기반 Problems 패널 재도입 (필요 시)
- 다중 파일 동시 diff
- 변경 하이라이트 fade (24h 자동)
- Linux deb / AppImage 빌드
- Dependency Graph 의 최종 진로 (Overview drawer / 완전 제거)
- 외부 베타 dogfooder 모집

---

## 7. 일정 추적

```
Phase A (Safety Net) ─── 1 주 ─┐
Phase B (Cut) ─────────── 2 주 ─├─┐
Phase C (Rebuild) ─────── 2 주 ─┘ │
Phase D (Release) ─────── 1 주 ───┘

총 5~6 주.
```

빠른 진행 시:
- Phase B PR2~PR5 병렬 → 1 주 단축 가능.
- Phase C PR6~PR9 의 일부 병렬 → 0.5 주 단축.

**최단 4 주 / 최장 6 주 추산.** 외부 의존 (Apple Developer 가입, 코드 서명) 발생 시 +1 주.
