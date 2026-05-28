# 02. 삭제 계획 — Changelog · CodeEditor · Problems · Session UI

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) D1, D2, D3, D4 의 구체 실행.
> 위험 전제: *"필요없는 로직을 걷어내며 코드를 삭제할 때 로직이 깨지지 않도록 주의한다."*

---

## 0. 삭제의 원칙

1. **위에서 아래로 (UI → command → DB)** — 사용자가 클릭할 수 있는 표면부터 잘라낸다. DB 스키마 삭제는 *모든 호출자 제거 확인 후* 최후.
2. **각 PR 은 빌드/타입체크/통합 테스트가 모두 green 인 상태로 머지**. "중간에 잠시 깨진다" 는 허용 안 됨.
3. **삭제 직전 git commit + tag** — 회귀 발생 시 즉시 cherry-pick 으로 되살릴 수 있도록 `pre-cut-PR<N>` 태그.
4. **삭제할 import 가 *동일 파일 내* 에 다른 용도로 남아있을 가능성** 을 grep 으로 검증 후 삭제.
5. **`feature_*` 플래그가 있던 항목은 플래그를 먼저 OFF → 1주 dogfood → 코드 삭제**. 비상 롤백 여지 확보.

---

## 1. 의존 그래프 — 무엇을 먼저 잘라야 안 깨지는가

```
                                    ┌────────────────┐
                                    │ DB migration   │
                                    │ 007 changelog  │
                                    └───────┬────────┘
                                            ▲
                          ┌─────────────────┴────────────────┐
                          │                                  │
                   ┌──────┴───────┐                ┌─────────┴────────┐
                   │ db.rs        │                │ commands/        │
                   │ ChangelogEntry│                │ changelog.rs     │
                   │ ChangelogFile │                │ (8 commands)     │
                   └──────┬───────┘                └─────────┬────────┘
                          │                                  │
                          │                          ┌───────┴────────┐
                          │                          │ MigrationModal │ ─── 이미 W5 에서 추가됨.
                          │                          │ (read-side만   │     마이그레이션 후엔 read-side 도 불필요.
                          │                          │  의존)         │
                          │                          └───────┬────────┘
                          │                                  │
                          │                       ┌──────────┴─────────┐
                          │                       │ ChangelogScreen     │
                          │                       │ EntryDetail / Diff  │
                          │                       │ AiWorkbench.saveTo  │
                          │                       │ CommandPalette item │
                          │                       │ App.tsx route       │
                          │                       └─────────────────────┘
                          │
                ┌─────────┴──────────┐
                │ overview.rs        │  ── 일부가 changelog 데이터를 join.
                │ daily_brief 합성   │     journal-only 로 재작성 필요 (이미 W5 에서 진행).
                └────────────────────┘
```

```
                          ┌──────────────────┐
                          │ SessionCard      │
                          │ DiffVsNarrative  │
                          │ EmptyTodayV3     │
                          │ JournalEntryDet  │
                          │ CommandPalette   │
                          │   "compare"      │
                          └────────┬─────────┘
                                   │
                          ┌────────┴─────────┐
                          │ TimelineView     │  ── session grouping logic 제거 후 flat list.
                          └────────┬─────────┘
                                   │
                          ┌────────┴─────────┐
                          │ oculpmApi        │
                          │ .compareLayers   │  ── command 호출만 막고 backend module 은 유지.
                          │ .listSessions    │     index/ndjson 작성과 무관.
                          └──────────────────┘
```

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ CodeEditor.tsx   │  │ Problems 탭       │  │ GitPanel         │
│ (단일 진입점)     │  │ (BottomDrawer)   │  │ (BottomDrawer)   │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                     │
   ┌─────┴─────┐         ┌─────┴─────┐         ┌─────┴─────┐
   │ CodeWork  │         │ Workspace │         │ commands/ │
   │ bench:    │         │ Context:  │         │ git.rs    │
   │ editor    │         │ bottom    │         │ (read-only│
   │ pane      │         │ Drawer    │         │  지원 유지)│
   └───────────┘         │ Tab union │         └───────────┘
                         └───────────┘
```

---

## 2. PR 단위 분해

### PR0 (Phase A) — 회귀 보호망 (선행 조건)

> 모든 삭제 PR 의 *선행*. 머지 전엔 다른 삭제 PR 을 시작하지 않는다.

**목표**: [`00-master-plan.md`](./00-master-plan.md) §2 의 7 invariant 가 자동 검증.

**Files (new)**:
- `src-tauri/tests/lite_w6_safety_net.rs`
- `src/__tests__/regression/today-renders-without-sqlite-changelog.test.tsx` *(vitest)*
- `scripts/check-lite-cut-invariants.sh` *(grep 기반 invariant: "Session" 문자열이 UI 모듈에 남아있지 않음 등)*

**Tests**:
1. *seed `.oculpm/journal/` only, empty SQLite* → Today 화면이 entries 렌더링 ✅
2. *Watcher → ndjson 작성* 의 기존 시나리오 (W2 의 통합 테스트) 그대로 ✅
3. *Frontmatter parser* — 기존 픽스처 (W3 PR3 의 9 케이스) 전부 통과 ✅
4. *Planner CRUD* — goal 생성/수정/완료/삭제 ✅
5. *Project lifecycle* — create / rename / delete / select ✅
6. *Settings* — provider/model 저장 후 재진입 시 복원 ✅
7. *Workspace persist* — `aipm:workspace:v1` 로드 / 저장 / 마이그레이션 ✅

**DoD**:
- [ ] 7 invariant 모두 통합 테스트로 자동 검증.
- [ ] `pnpm test` 와 `cargo test` 둘 다 green.
- [ ] CI 에 새 시나리오 포함.

### PR1 (Phase A) — Feature flag 정리

기존 `feature_changelog_v2`, `feature_overview_v2`, `feature_clarify`, `feature_greenfield_wizard`, `feature_new_ia` 5개 플래그 중:

- `feature_changelog_v2` → **OFF 강제** (UI 에서 사라질 것이므로). 코드 분기는 PR4 에서 제거.
- 나머지 4개 → 코드에서 *항상 true* 로 간주하도록 분기 제거 (1.0 의 *기본* 동작).

**파일**:
- `src-tauri/src/db.rs` (settings table 의 default row)
- `src-tauri/src/commands/config.rs`
- 각 화면의 `if (flag) { ... }` 분기 정리

**DoD**:
- [ ] `settings` 테이블에서 `feature_*` 키 cleanup 마이그레이션 012.
- [ ] 플래그 reference grep 결과 0.

---

### PR2 (Phase B) — Problems 탭 삭제

**대상**:
- `src/features/code/BottomDrawer.tsx`: `TABS` 배열에서 `problems` 제거, placeholder 본문 삭제.
- `src/contexts/WorkspaceContext.tsx`: `BottomDrawerTab` union 에서 `"problems"` 제거 + 영속화된 값이 `"problems"` 일 때 `"terminal"` 로 fallback 하는 마이그레이션 함수 한 줄.
- `src-tauri/src/commands/diagnostics.rs` 가 *오직* Problems 탭을 위해 노출되는 함수가 있다면 삭제 (현재 LSP 통합 미구현이므로 노출 함수 없음).

**위험**:
- 사용자가 `bottomDrawerTab: "problems"` 로 저장된 상태에서 1.0 으로 업그레이드 → fallback 함수가 처리.

**DoD**:
- [ ] `Problems` 문자열 grep 0 (백엔드 module 명 제외).
- [ ] Workspace 마이그레이션 함수에 unit test.
- [ ] 회귀 테스트 — ⌘J 후 BottomDrawer 가 2 탭 (Terminal, Git) 으로 정상 동작.

---

### PR3 (Phase B) — Session 추정 UI 제거

> "어디까지가 1 세션인가" 문제의 표면을 0 으로 축소. 백엔드 invariant 는 유지.

**대상 (UI 제거)**:
- `src/features/oculpm/SessionCard.tsx` — 컴포넌트 + 사용처 (TimelineView) 제거.
- `src/features/oculpm/DiffVsNarrative.tsx` — 전체 파일 삭제.
- `src/features/oculpm/EmptyToday/EmptyTodayV3.tsx` (compare 진입점이 V3 의 핵심) — 삭제. V1 + V2 만 남김.
- `src/features/oculpm/TimelineView.tsx` — *session grouping* 로직 제거, journal entries 의 flat list 로 단순화. 시간 헤더만 (예: "오후 / 오전 / 어제 보기").
- `src/features/oculpm/JournalEntryDetail.tsx` — "Compare with Index" 액션 제거.
- `src/components/CommandPalette.tsx` — `OCULPM_BUS.compareLatest` + 관련 item 제거. `OCULPM_BUS.manualEntry` 는 유지.
- `src/features/today/TodayScreen.tsx` — `compareSessionId`, `latestSessionId` state 제거. `DiffVsNarrative` 모달 제거.

**대상 (backend — 호출 차단만, 모듈 보존)**:
- `oculpmApi.compareLayers` / `listSessions` 의 *호출 사이트* 제거.
- `src-tauri/src/oculpm/session.rs` 자체는 ndjson 작성에 사용되므로 *유지*.
- `commands::oculpm_get_status` 의 응답에서 `latest_session_id` 같은 필드는 *남기되* UI 에서 안 읽으면 됨.

**용어 정리**:
- 사용자 노출 텍스트의 "세션" 단어 0 개. (단축키 hint, 토스트, 빈 상태 카피)
- 로그 / 디버그 / log 파일은 `session_id` 유지 (개발자용).

**위험**:
- `JournalEntrySummary.session_id` 가 fallback 없이 *null* 인 케이스가 어딘가에서 사용 — grep 으로 확인.
- 외부 LLM 이 작성한 frontmatter 에 `session_id` 가 들어있을 수 있음 → 그 필드는 *읽되 표시 안 함*.

**DoD**:
- [ ] UI 트리에 *"세션"* / *"session"* 문자열 0 (CSS 모듈 명만 허용).
- [ ] Today 화면이 *flat* journal entry 리스트로 렌더링.
- [ ] CommandPalette 의 ocul-pm 그룹에 *manual entry* 1 개 액션만 남음.
- [ ] Watcher → ndjson 의 자동 테스트 통과 (백엔드 session module 의 동작 보존).

---

### PR4 (Phase B) — SQLite Changelog 시스템 삭제

> 가장 큰 PR. 8개 commands + 1개 migration + 4개 UI 모듈 + 5개 호출 사이트 동시 제거.

**전제**: MigrationModal 이 *모든 사용자 데이터* 를 journal/ 로 옮긴 상태. dogfood 환경에서 1주 이상 사용해서 *최근 entries 가 journal 에만 존재* 함을 확인.

**대상 (frontend)**:
- `src/features/changelog/ChangelogScreen.tsx`, `EntryDetail.tsx`, `DiffModal.tsx`, `util.tsx` → 전체 삭제.
- `src/App.tsx` 의 `ChangelogScreen` import + `activeView === "changelog"` 분기 제거. (D6 의 3-IA 와 함께 처리 → PR7.)
- `src/components/CommandPalette.tsx` 의 `view-changelog` item 제거.
- `src/contexts/WorkspaceContext.tsx` 의 `ActiveView` union 에서 `"changelog"` 제거 (PR7 에서 union 자체 변경).
- `src/features/code/AiWorkbench.tsx` 의 `handleSaveToChangelog` + 관련 state + `onGoChangelog` prop 모두 제거. Quick Edit 의 마지막 단계가 "프롬프트 복사" 로 종료.
- `src/hooks/useGlobalShortcuts.ts` ⌘4 매핑 제거 (PR7 의 3-IA 와 함께).

**대상 (backend)**:
- `src-tauri/src/commands/changelog.rs` → 전체 삭제 (8 commands).
- `src-tauri/src/commands/mod.rs` 에서 `pub mod changelog;` `pub use changelog::*;` 제거.
- `src-tauri/src/db.rs` 의 `ChangelogEntry`, `ChangelogFileEntry`, `DailyChangelogBucket` struct + 관련 query 함수 (~20개) 삭제. struct 가 *journal API* 의 응답 타입을 *겸용* 하는 경우, journal 전용 타입을 신설 후 분리.
- `commands/overview.rs` 의 `daily_brief` 합성 → journal 만 읽도록 단순화. (이미 W5 에서 일부 진행)
- `commands/oculpm.rs` 의 마이그레이션 명령 (`migrate_legacy_changelog` 등) → *유지* (사용자가 v0.x DB 를 가지고 1.0 으로 업그레이드할 수 있도록).
- `MigrationModal` 의 *진입 자체* 는 보존하되, MigrationModal 이 *legacy 데이터를 *읽기만* 한다는 것을 보장. SQL 의 SELECT 만 살아남고 INSERT/UPDATE/DELETE 는 없음.
- DB 마이그레이션 008 (신규): `DROP TABLE IF EXISTS changelog_entries; DROP TABLE IF EXISTS changelog_files; ALTER TABLE file_changes DROP COLUMN entry_id;` — 단, file_changes 의 entry_id 가 journal 인덱스를 가리킨다면 별도 처리.

**위험**:
- `daily_brief` 같은 합성 함수가 changelog 와 journal 양쪽을 *동시에* 읽었다면, 제거 후 *journal 만으로 동일 결과* 가 나오는지 단위 테스트.
- `file_changes` 테이블의 데이터는 *watcher 가 계속 쓰는 sink* — DROP 하면 안 됨. `entry_id` 컬럼만 제거.
- `commands::commit_changelog_entry` 의 부수효과로 `file_changes` 의 행을 *지우는* 로직이 있었음 (AiWorkbench 의 saveToChangelog 후 행 클리어). 이 동작이 *AiWorkbench 의 "오늘 변경사항" 표시* 와 결합되어 있었으므로, *PR9 (AI 패널 재배치) 와 함께 행 클리어 정책을 재정의*. 1.0 안: 사용자가 명시적으로 "이 변경을 다 본 것으로 표시" 클릭 시에만 클리어.

**DoD**:
- [ ] `changelog_entries`, `changelog_files` 가 grep 0 (마이그레이션 모달의 SELECT 만 허용).
- [ ] `commit_changelog_entry`, `list_changelog_by_day`, `get_changelog_detail` 등 8 commands 가 코드베이스에서 사라짐.
- [ ] 마이그레이션 008 이 idempotent (`IF EXISTS`).
- [ ] *기존 사용자가 v0.x DB 로 1.0 진입 → MigrationModal 만 한 번 보여줌 → journal/ 로 이주 → SQLite Changelog 영역은 그 다음 진입부터 invisible.* 의 골든 패스 통과.

---

### PR5 (Phase B) — CodeEditor / GitPanel 의 legacy 이동

**대상 (이동)**:
- `src/components/CodeEditor.tsx` → `src/legacy/CodeEditor.tsx`.
- `src/features/git/GitPanel.tsx` → `src/legacy/git/GitPanel.tsx`.

**대상 (제거 — 호출 사이트)**:
- `src/features/code/CodeWorkbench.tsx`:
  - `CodeEditor` import + `<CodeEditor ... />` JSX 제거.
  - `EditorPlaceholder` 를 *read-only viewer* 또는 *"외부 에디터에서 열기" 버튼* 으로 대체.
- `src/features/code/BottomDrawer.tsx`:
  - `GitPanel` import + `tab === "git"` 분기 제거.
  - `TABS` 배열에서 `git` 제거. (Problems 도 PR2 에서 제거됐으니, BottomDrawer 가 *Terminal 단독 탭* 으로 단순화.)
- `src/contexts/WorkspaceContext.tsx`:
  - `BottomDrawerTab` union 에서 `"git"` 제거 → `"terminal"` 단일 옵션. union 자체가 무의미해지면 타입 alias 제거.
- `src/components/CommandPalette.tsx`:
  - `code-git` item 제거.
- `src/hooks/useGlobalShortcuts.ts`: 영향 없음 (Git 전용 단축키 없었음).

**대상 (백엔드 — 부분 보존)**:
- `src-tauri/src/commands/git.rs` 의 *full* API 는 유지 (legacy 의 GitPanel 이 살아있어서 import 시 컴파일이 되어야 함).
- *Today 헤더의 mini git indicator* (브랜치명 + uncommitted 카운트) 만 새 진입점으로 신설 — `commands::git::head_and_status_brief` 같은 슬림 wrapper.

**위험**:
- `vite.config.ts` 의 `paths` alias 에 `@/legacy/*` 추가 필요. 없으면 import 실패.
- `tsconfig.json` 의 include 범위 확인 — `src/legacy/` 가 빌드에 *포함되지 않도록* `"exclude": ["src/legacy/**"]` 추가.
- `src/legacy/` 안의 파일은 *type check 도 안 함* → 해당 파일에서 다른 코드를 import 하면 unused-import 경고가 사라져버림. 의도된 격리.

**DoD**:
- [ ] `pnpm tauri build` 산출물 크기 측정 — Editor 빌드 제외분만큼 감소했는지 확인.
- [ ] `src/legacy/` 가 tsconfig 의 `exclude` 에 들어감.
- [ ] 메인 UI 에서 *코드 편집* 진입점 0 (외부 에디터로 열기 버튼만).
- [ ] `git status` / `git log` 호출 사이트 grep 결과 — `src/` 내에서 *Today 헤더* 만 남음.

---

## 3. 회귀 보호 (PR별)

각 삭제 PR 의 머지 *전에* 다음을 확인. PR 본문 체크리스트로 강제.

### 공통
- [ ] `pnpm typecheck` 0 error.
- [ ] `cargo check` 0 error.
- [ ] `cargo clippy -- -D warnings` 0 error.
- [ ] `pnpm test` 모두 green.
- [ ] `cargo test` 모두 green.
- [ ] `cargo test --test oculpm_integration_*` 모두 green.

### PR2 (Problems)
- [ ] Workspace 영속화 마이그레이션 unit test ≥ 3 케이스 (기존 "problems", "git", "terminal" 셋 모두).

### PR3 (Session UI)
- [ ] Today 화면이 seed 된 *200개* journal entry 로 렌더링 — virtualization 없이 < 200ms.
- [ ] CommandPalette 의 ocul-pm 그룹 item 수 = 1 (manual entry).
- [ ] 사용자 텍스트 grep — "세션", "Session" 단어 0 (백엔드 module 명, CSS 클래스명, 코멘트 제외).

### PR4 (Changelog)
- [ ] `commands::commit_changelog_entry` 호출 사이트 grep 0.
- [ ] `daily_brief` 의 결과가 journal only 로도 동일 — 골든 픽스처 2개.
- [ ] *v0.x DB → 1.0 진입* 시나리오 1회 수동 dogfood. MigrationModal 이 정상 진입 + 이주 + 다음 진입에서 invisible.

### PR5 (CodeEditor / GitPanel)
- [ ] 메인 UI 에서 모달/스크린/패널의 진입점 grep — `CodeEditor`, `GitPanel` 명 0.
- [ ] `src/legacy/` 의 코드를 *실수로 import* 하지 않도록 ESLint custom rule (또는 grep 스크립트) 추가.

---

## 4. 잘라낸 자리에 무엇이 들어오는가

PR2 ~ PR5 가 끝나면 다음과 같은 *공백* 이 생긴다. Phase C (PR6 ~ PR9) 가 채운다.

| 비워진 자리 | 채우는 PR | 채우는 것 |
|---|---|---|
| BottomDrawer 의 Git/Problems 탭 | PR7 | 단일 Terminal (풀스크린/도크 토글) |
| CodeWorkbench 의 EditorPane | PR8 | FileTree 의 *변경 하이라이트* + "외부 에디터로 열기" |
| 사이드바의 ⌘4 Changelog | PR7 | 3-IA 의 *세 번째 슬롯* (Today / Plan / ???) |
| AiWorkbench 의 "변경사항 저장" | PR9 | "변경된 파일 보기" → 로컬 diff 뷰어 |
| Today 의 DiffVsNarrative 진입점 | PR6 | 로컬 diff 뷰어의 *Today 안 entry point* |

---

## 5. 결정 완료 항목 (2026-05-28 잠금)

본 §의 결정은 모두 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0.3 에서 잠금.

1. **`changelog_entries` DROP 시점** → **PR4 와 동시** (마이그레이션 008).
2. **`src/legacy/` 보존 기간** → **영구**.
3. **Git Today indicator** → **텍스트 chip** (`● main · +4 uncommitted` 형식).
4. **MigrationModal 노출 정책** → **자동 1회 진입 + Settings 재진입** (현재 정책 유지).
