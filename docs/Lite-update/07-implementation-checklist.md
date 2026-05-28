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

- [x] **`file_snapshots` 보관** → **최근 50개 per path** (LRU)
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
| file_snapshots | per-path 최근 50, LRU |
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
| ☐ | `src/features/oculpm/SessionCard.tsx` 삭제 + 호출 사이트 정리 |
| ☐ | `src/features/oculpm/DiffVsNarrative.tsx` 삭제 |
| ☐ | `src/features/oculpm/EmptyToday/EmptyTodayV3.tsx` 삭제 |
| ☐ | `TimelineView` 가 *flat journal entry list* 로 재작성 |
| ☐ | `JournalEntryDetail` 의 "Compare with Index" 액션 제거 |
| ☐ | `CommandPalette` 의 `OCULPM_BUS.compareLatest` + 관련 item 제거 |
| ☐ | `TodayScreen` 의 `compareSessionId`, `latestSessionId` state 제거 |
| ☐ | `oculpmApi.compareLayers`, `listSessions` 의 *호출 사이트* 0 (모듈 자체는 보존) |
| ☐ | UI 텍스트 grep — "세션", "Session" 0 |
| ☐ | 회귀: Watcher → ndjson 작성 테스트 통과 |
| ☐ | 회귀: Today 화면이 200개 entry 로 < 200ms 마운트 |

### PR4 — SQLite Changelog 시스템 삭제

| 체크 | 항목 |
|---|---|
| ☐ | dogfood 환경에서 1주 이상 *journal-only* 모드 사용 확인 |
| ☐ | `src/features/changelog/` 폴더 전체 삭제 |
| ☐ | `App.tsx` 의 ChangelogScreen import + route 제거 |
| ☐ | `CommandPalette` 의 `view-changelog` 제거 |
| ☐ | `AiWorkbench.handleSaveToChangelog` + 관련 state 제거 |
| ☐ | `useGlobalShortcuts` ⌘4 매핑 제거 (PR7 의 3-IA 와 함께) |
| ☐ | `src-tauri/src/commands/changelog.rs` 전체 삭제 (8 commands) |
| ☐ | `src-tauri/src/commands/mod.rs` 갱신 |
| ☐ | `db.rs` 의 ChangelogEntry/File struct + query 메서드 (~20개) 삭제 |
| ☐ | `daily_brief` 가 journal-only 로 동일 결과 — 골든 픽스처 2개 통과 |
| ☐ | 마이그레이션 008 — `DROP TABLE IF EXISTS changelog_entries; DROP TABLE IF EXISTS changelog_files; ALTER TABLE file_changes DROP COLUMN entry_id;` |
| ☐ | MigrationModal 의 SELECT 만 살아남음 — INSERT/UPDATE/DELETE 0 |
| ☐ | 회귀: v0.x DB → 1.0 진입 → MigrationModal 정상 → 이주 → 다음 진입 invisible |
| ☐ | 회귀: `commit_changelog_entry` 호출 사이트 grep 0 |

### PR5 — CodeEditor / GitPanel legacy 이동

| 체크 | 항목 |
|---|---|
| ☐ | `src/components/CodeEditor.tsx` → `src/legacy/CodeEditor.tsx` |
| ☐ | `src/features/git/GitPanel.tsx` → `src/legacy/git/GitPanel.tsx` |
| ☐ | `tsconfig.json` 의 `exclude: ["src/legacy/**"]` 추가 |
| ☐ | `vite.config.ts` 의 alias `@/legacy/*` 추가 (있다면 비활성) |
| ☐ | `CodeWorkbench` 의 EditorPane 제거, "외부 에디터로 열기" 버튼 placeholder (PR8 에서 정식화) |
| ☐ | `BottomDrawer` 의 git 탭 제거 → Terminal 단일 탭 |
| ☐ | `WorkspaceContext.BottomDrawerTab` union 의 `"git"` 제거 → 타입 alias 단순화 |
| ☐ | `CommandPalette` 의 `code-git` item 제거 |
| ☐ | `commands::git::head_status_summary` 신설 (TitleBar mini chip 용) |
| ☐ | `pnpm tauri build` 산출물 크기 측정 — Editor 제외분만큼 감소 |
| ☐ | 메인 UI 의 *코드 편집* 진입점 grep 0 |

---

## 3. Phase C — Rebuild (1~2 주)

### PR6 — 로컬 diff 뷰어

| 체크 | 항목 |
|---|---|
| ☐ | PR6.1 — 마이그레이션 010 `file_snapshots` + Watcher snapshot 작성 |
| ☐ | PR6.2 — `commands::diff::reindex_paths`, `commands::diff::compute_diff` |
| ☐ | PR6.3 — `src/features/diff/LocalDiffView.tsx` |
| ☐ | PR6.4 — Today 카드 / FileTree 진입 wire-up (PR8 의존) |
| ☐ | PR6.5 — collapse / 폭 적응 / 읽음 토글 |
| ☐ | feature_local_diff_v1 플래그 ON |
| ☐ | 성능: 10 파일 부분 reindex < 5초 |
| ☐ | 성능: 64KB diff_patch < 200ms |
| ☐ | 성능: LocalDiffView 마운트 < 100ms |
| ☐ | a11y: 색 + dot + 배지 3 중 표시 |

### PR7 — 3-IA + 유연한 도크

| 체크 | 항목 |
|---|---|
| ☐ | `PRIMARY_NAV` 3 슬롯 (Today / Plan / Settings) — 사이드바 폭 56px |
| ☐ | `WorkspaceContext.activeView` union: `"today" | "plan"` 단순화 |
| ☐ | `useGlobalShortcuts` 갱신 — ⌘1 Today, ⌘2 Plan, ⌘, Settings, ⌘3~5 폐기 |
| ☐ | `layoutMode: "main-only" | "split" | "terminal-only"` 신설 |
| ☐ | `splitRatio` 영속화 + horizontal resize handle |
| ☐ | ⌘J split 토글, ⌘⇧J terminal-only 토글 |
| ☐ | `TerminalDock.tsx` wrapper 신설 — Code 화면 의존 끊김 |
| ☐ | TitleBar 의 `GitBranchChip` 마운트 |
| ☐ | Git chip 클릭 → split 모드 + `git status` 자동 실행 |
| ☐ | 회귀: 사용자 시나리오 — `claude-code "..."` split 모드에서 정상 동작 |

### PR8 — FileTree 재설계

| 체크 | 항목 |
|---|---|
| ☐ | `commands::list_project_tree(project_id, opts)` 신설 |
| ☐ | `FileExplorer` props 변경 — TreeNode 기반 |
| ☐ | 변경 하이라이트 dot + op 배지 |
| ☐ | `recentChanges` 영속화 (max 1000 cap) |
| ☐ | `fileExplorerExpanded` 영속화 |
| ☐ | ⌘B 토글 — 좌측 사이드 패널 (FileTree + Diff) |
| ☐ | 50k 파일 데모에서 마운트 < 500ms |
| ☐ | a11y — 트리 키보드 navigation (↑↓←→) |
| ☐ | 사용자 명시 "비우기" 액션 |
| ☐ | "외부 에디터로 열기" 동작 — `open_in_editor` 커맨드 + Settings 의 명령 prefs |

### PR9 — AI 패널 재배치

| 체크 | 항목 |
|---|---|
| ☐ | `src/components/AiOverlay.tsx` 신설 — ⌘\ 오버레이 |
| ☐ | `src/main-ai.tsx` 신설 — 분리 윈도우 entry |
| ☐ | ⌘⇧\ → 분리 윈도우 |
| ☐ | `AiWorkbench` props 정리 — Code 화면 의존 끊김 |
| ☐ | `WorkspaceContext.aiOverlayOpen` 신설 / `aiWorkbenchOpen` 제거 |
| ☐ | 분리 윈도우 위치/크기 `tauri-plugin-window-state` 로 영속화 |
| ☐ | 오버레이 + 분리 윈도우 동시 활성화 차단 |
| ☐ | RAG citations 의 시각이 오버레이에서 정상 |
| ☐ | 회귀: Today / Plan 어느 화면에서도 ⌘\ 진입 |

---

## 4. Phase D — Release (1 주)

### PR10 — a11y / 다크모드 / 카피

| 체크 | 항목 |
|---|---|
| ☐ | axe-core report critical 0 |
| ☐ | 모든 인터랙티브 요소 keyboard navigable |
| ☐ | 색상 대비 ≥ 4.5:1 |
| ☐ | mismatch 배지 = 색 + 아이콘 + 텍스트 3중 |
| ☐ | 다크모드 — Lite 후 잔존 모든 화면 정상 |
| ☐ | 새 토큰 (`--accent-recent-change`, `--accent-uncommitted`) 의 다크 변형 |
| ☐ | `prefers-reduced-motion` 존중 |
| ☐ | 카피 한국어 통일 (영문 단축키 / 기술명만 영문) |
| ☐ | `src/locales/ko.json` 갱신 |

### PR11 — 성능 + 통합 테스트

| 체크 | 항목 |
|---|---|
| ☐ | `scripts/oculpm-perf.sh` 실행 + 결과 `docs/Lite-update/_perf-1.0.md` |
| ☐ | SLO 1: idle CPU < 2% |
| ☐ | SLO 2: idle 메모리 < 50 MB |
| ☐ | SLO 3: 단일 파일 변경 ndjson append p95 < 500ms |
| ☐ | SLO 4: 100 파일 일괄 변경 < 5초 |
| ☐ | SLO 5: 마이그레이션 100 entries < 10초 |
| ☐ | SLO 6: Overview 페이지 로드 < 500ms (Overview 가 Today 흡수된 후 → "Today 카드 4개 로드 < 500ms" 로 재정의) |
| ☐ | `cargo test --test oculpm_integration_*` 25 시나리오 green (PR3, PR4 의 삭제 반영) |
| ☐ | 새 시나리오: LocalDiffView 의 reindex_paths + diff_patch + snapshot fallback |

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
