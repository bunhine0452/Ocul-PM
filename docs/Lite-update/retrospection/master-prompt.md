# Lite-W6 인계 프롬프트 (Master Prompt for Continuation)

> 본 문서의 위상: 사용자의 AI 세션이 단절되었을 때, *다음 세션의 어떤 AI* 든 본 문서 한 장만 읽으면 Lite-W6 작업을 이어받을 수 있도록 구성된 *self-contained briefing*.
>
> 이 문서를 *그대로 복붙해서 새 AI 세션에 붙여 넣으면* 충분. 본문 안에 *어떤 파일을 먼저 읽고, 어떤 invariant 를 지키고, 어떤 결정 규칙을 따를지* 가 명시되어 있다.
>
> 작성일: 2026-05-28
> 마지막 갱신: (Lite-W6 진행 중 각 PR 머지 시점에 갱신)
> 현재 위치: **Phase A 진입 전** (PR0 회귀 보호망 작성 직전)

---

## 0. 새 AI 세션의 *최초 1 분 행동*

> *간단 진입* 만 원한다면 `quick-start.md` 를 먼저 본다 (50줄). 본 문서는 *깊은 가이드*.
> 사용자가 보낼 명령은 `cheat-sheet.md` 에 사전 정리됨.

다음 순서를 *그대로* 따라라. 다른 행동 X.

```
1. 본 파일 (master-prompt.md) 끝까지 읽기.
2. docs/Lite-update/README.md 읽기.
3. docs/Lite-update/07-implementation-checklist.md §0 (잠금 결정 19개) 확인.
4. docs/Lite-update/retrospection/_dogfooding-retrospective.md §3 + §11 확인.
5. docs/Lite-update/retrospection/cheat-sheet.md 일독 — 사용자가 어떤 한 줄 명령을 보낼지 미리 학습.
6. git status + git log --oneline -10 으로 *어디까지 진행됐는지* 파악.
7. 위 6단계로 *Phase / PR 위치* 가 명확하면 사용자에게 §9 의 보고 양식으로 보고하고 사용자 확인 (`이어가` 등) 을 기다린다.
8. 위 6단계로도 위치 파악이 안 되면 사용자에게:
   "Lite-W6 의 현재 진행 위치가 모호합니다. master-prompt.md 의 §5.1 을
    갱신해 주실 수 있을까요?" 라고 묻는다. 추측으로 작업 시작 X.
```

---

## 1. 무슨 프로젝트인가 (10 줄)

- **이름**: Ocul-PM (구 ai-pm. 본 라운드에서 통일.)
- **정체성**: 외부 코딩 에이전트 (Claude Code / Cursor / antigravity / Gemini CLI) 가 코드를 쓰는 동안, 사용자는 본 앱에서 **기록 · 관리 · 검증** 만 한다.
- **기술 스택**: Tauri 2.x + React 19 + TypeScript + Rust + SQLite (+ sqlite-vec, fastembed-rs, tree-sitter).
- **핵심 디렉토리**: `.oculpm/` — `index/` (watcher 가 본 사실, ndjson) + `journal/` (외부 LLM 이 쓴 narrative, markdown + YAML frontmatter).
- **현재 단계**: W1~W5 모두 ✅. 본 라운드 **Lite-W6** 는 1.0 출시를 위한 *축소 + 안정화*.
- **사용자 발화 핵심**: *"필요없는 로직을 걷어내며 코드를 삭제할 때 로직이 깨지지 않도록 주의한다."*
- **사용자 (PM)**: 1 명. 개인 도구. 클라우드 동기화 / 팀 공유 / 멀티 머신 가정 없음.
- **앱 dogfood 상태**: 본 ai-pm 프로젝트 자체에는 `.oculpm/config.toml` 의 `agents.active = []` 로 *어댑터 미활성*. 외부 프로젝트 (`black-corp-tycoon`, `storygame`) 에서 antigravity 위주로 dogfood.
- **언어**: 사용자-페이싱 카피 / 문서 *한국어 우선*. 기술 용어 / 단축키 / 코드는 영문.
- **결정 권한**: 사용자가 *"네 최선의 판단에 맡길게"* (2026-05-28) 로 19개 결정 위임. 해당 결정은 `07-implementation-checklist.md` §0 에 잠금. *추가* 결정 발생 시 사용자에게 확인.

---

## 2. Lite-W6 의 *지배 명령*

```
삭제 (Cut):
  - SQLite Changelog 시스템 전체
  - 자체 CodeEditor (legacy 폴더로 이동, 빌드 제외, 영구 보존)
  - Problems 탭 (placeholder, 동작 안 함)
  - Session 추정 UI (SessionCard / DiffVsNarrative / EmptyTodayV3)
  - Git Panel 의 메인 진입 (legacy 이동, mini chip 만 남김)

신설 (Rebuild):
  - LocalDiffView — 변경 파일 부분 reindex + 로컬 diff (D5)
  - FileTree 변경 하이라이트
  - AI 오버레이 (⌘\) + 분리 윈도우 (⌘⇧\)
  - Terminal 메인 도크 — 3 모드 (main-only / split / terminal-only)
  - Git mini chip (TitleBar)
  - Project Switcher (⌘P)

정체성 (Identity):
  - 사이드바 5-IA → 3-IA (Today / Plan / Settings)
  - 사이드바 의존 ↓ · 레이아웃 유연 ↑
  - 외부 LLM 의 *세션 경계 추정* 영구 포기 → AGENTS.md 의 프롬프트로 LLM 신뢰

배포 (Release):
  - macOS dmg + Windows msi (직접 다운로드, 자동 업데이트는 1.1)
  - 코드 서명: Apple Developer ID 권장, Windows 1.0 미서명 허용
  - GitHub Releases 의 v1.0.0 태그
```

---

## 3. *필수* invariant (절대 깨지면 안 됨)

각 invariant 은 [`../07-implementation-checklist.md`](../07-implementation-checklist.md) PR0 의 회귀 테스트로 잠겨 있다 (또는 잠길 예정). PR 머지 전 *반드시* 확인.

1. **Watcher → `.oculpm/index/<workday>/file_changes.ndjson`** 의 append-only 작성.
2. **`events.oculpmIndexLineAppended` / `oculpmJournalAdded` / `oculpmJournalUpdated`** 이벤트 정상 emit.
3. **Frontmatter parser** — 9 픽스처 통과 + `Default::default()` 의 fail-soft.
4. **`.oculpm/index/.lock`** 단일 인스턴스 보호.
5. **Workday boundary 처리** — 자정 회전 + `[workday]` config 의 timezone.
6. **Planner CRUD** — `commands::planner::*` 의 통합 테스트.
7. **Project lifecycle** — create / rename / delete / select.
8. **Settings LLM provider/model** — Keyring + DB 저장 / 복원.
9. **Workspace persist (`aipm:workspace:v1`)** — 단일 키 영속화 + 자동 마이그레이션.
10. **MigrationModal** — v0.x DB 로부터 journal 으로의 이주가 *idempotent*.
11. **Journal entry 파일 열기** — `oculpmApi.openEntryInEditor` 만 사용. plugin-opener 직접 호출 금지 (재발 패턴, MEMORY 참조).
12. **synthetic session_id 형식** — `<workday>-mNN` (수동 entries). IndexWriter 가 첫 8자가 workday 숫자임을 강제.

코드를 *삭제* 할 때 이 12 invariant 중 하나라도 *간접* 영향이 의심되면 멈추고 사용자에게 보고.

---

## 4. SSOT 문서 인덱스

본 라운드의 *모든* 결정은 다음 문서에서 추적된다. 각 문서의 *책임 영역* 명시:

| 파일 | 책임 |
|---|---|
| `docs/Lite-update/README.md` | 진입점 + doc map + 진행 상태. |
| `docs/Lite-update/00-master-plan.md` | **마스터 SSOT.** 9 결정 (D1~D9) + 4 Phase 일정 + 성공 지표. |
| `docs/Lite-update/01-w6-reassessment.md` | "W6 그대로 가야 하나?" 의 답. (결정 ✅) |
| `docs/Lite-update/02-removal-plan.md` | 삭제 5 PR (PR0~PR5) 의 의존 그래프 + DoD. |
| `docs/Lite-update/03-feature-revisions.md` | 재구축 4 요소 (FileTree / AI / Terminal / Git) 의 새 위치. |
| `docs/Lite-update/04-ui-ux-redesign.md` | 3-IA + 플렉서블 도크 + 단축키. |
| `docs/Lite-update/05-index-comparison.md` | LocalDiffView 의 정확한 설계 (D5). |
| `docs/Lite-update/06-release-1.0-plan.md` | 번들 / 서명 / GitHub Releases / README. |
| `docs/Lite-update/07-implementation-checklist.md` | **PR DoD SSOT.** §0 의 결정 19개 잠금. |
| `docs/Lite-update/retrospection/_dogfooding-retrospective.md` | W3~W5 회고 (재구성). Critical 이슈 4 + High 6 의 출처. |
| `docs/Lite-update/retrospection/master-prompt.md` | 본 문서. *깊은 가이드*. |
| `docs/Lite-update/retrospection/quick-start.md` | 50줄 진입표 — paste-and-go 용. 본 문서 부담 시 먼저 붙여넣음. |
| `docs/Lite-update/retrospection/cheat-sheet.md` | 사용자 → AI 한 줄 명령 사전. `이어가` / `상태` / `PR<N> 시작해` 등. |

이전 라운드의 자료 (참조용):
| 파일 | 책임 |
|---|---|
| `docs/refactor/MASTER-GUIDE.md` | W1~W5 의 청사진. *역사 자료*, 갱신 X. |
| `docs/major_update/oculpm/00-spec.md` | `.oculpm/` 명세 SSOT. *변경 시 schema_version bump 필요*. |
| `docs/major_update/oculpm/01-backend.md` ~ `03-rollout.md` | W1~W6 의 백엔드/프론트엔드/롤아웃. *역사 자료*. |
| `docs/major_update/oculpm/phases/W6-stabilize-dogfood.md` | 원안 W6. Lite-W6 가 대체. *역사 자료*, 갱신 X. |
| `docs/major_update/oculpm/phases/_dogfooding-w4.md` | W4 14 발견의 1차 자료. *역사 자료*, 갱신 X. |

---

## 5. 진행 상태 추적 (갱신 영역)

> 이 §은 *Lite-W6 진행 중 매 PR 머지 시점에* 갱신. 어떤 PR 이 어디까지 갔는지를 기록.

### 5.1 현재 위치 (2026-05-29)

- **Phase A**: ✅ PR0 완료 / ✅ PR1 완료 (no-op + 회귀 lock — §5.3 참조)
- **Phase B**: ✅ PR2 ~ ✅ PR5 **모두 완료** — Phase B 종료
- **Phase C**: 🚧 PR6 (6.1 1.1 로 연기 / 6.2~6.4 완료 / 6.5 미진입) / ✅ PR7 (Part 1 + Part 2 모두 완료) / ✅ PR8 (Part 1~3 **모두 완료**) / ✅ PR9 완료
- **Phase D**: 🚧 PR10 Part 1 완료 (foundations) / PR10 Part 2~ (axe-core / 키 nav 감사 / 카피 통일) 미진입 / ☐ PR11~PR12 미진입
- **추가**: ✅ PR-0c 완료 (clippy 48 errors → 0). `cargo clippy --all-targets -- -D warnings` 가 이제부터 진짜 lock.

진행 중 작업: *없음*. **Phase D 진입**. PR10 의 polish 가 sub-part 로 분해 진행 중 — Part 1 (토큰 + reduced-motion + 의미 색 보정) 완료. 다음 후보: **PR10 Part 2 (axe-core 설치 + 키 nav 감사)** 또는 **PR11 (성능 + 통합 테스트)** 또는 **PR12 (빌드/서명/릴리스)** 직진. axe-core 는 외부 dep 추가 → 사용자 confirm 필요 (§6 rule 6).

### 5.2 머지 로그

| 일자 | PR | 머지 커밋 | 비고 |
|---|---|---|---|
| 2026-05-29 | PR0 | `a494d7a` | 회귀 보호망 — 5 commits: retrospection 인계 묶음 (`28e96bb`) + AGENTS 템플릿 5 강화 (`fc65daf`) + vitest infra (`b0d2d8a`) + Rust 7 invariant safety net (`aa4e99a`) + vitest 3 시나리오 stub (`c0132e1`) + lint ALLOWLIST 보정 (`a494d7a`). `pre-cut-PR0` annotated tag 부여. |
| 2026-05-29 | PR-0c | `71ad3b1` | clippy 48 errors → 0. 14 files 변경 / -58 net lines. 핵심 변경: ① `cargo clippy --fix` 로 28건 (useless_conversion 17 / needless_question_mark / unnecessary_map_or / unnecessary_cast / unnecessary_parens / for_kv_map / needless_borrow / 미사용 import 4 / unused mut 등) 자동 정리, ② `std::mem::transmute` 에 명시 타입 부여 (`db.rs:71`), ③ dead test helper `insert_session` (sync) + `_suppress_unused` 삭제 (`cache.rs`, await 누락 의심은 실제로 dead code 였음 — 호출자 0), ④ `let...else → ?` 1건 (`indexer.rs:412`), ⑤ `LlmError::MissingApiKey` 삭제 (구성·매치 모두 0), ⑥ `EMBEDDING_DIM` / `LlmProvider::name()` 에 `#[allow(dead_code)]` (의미 있는 API surface, 보존), ⑦ `#[allow(clippy::too_many_arguments)]` 12개 (refactor 가 PR-0c 범위 밖, `tauri::command` signature 는 IPC 계약이라 변경 불가). 5종 green 모두 통과. |
| 2026-05-29 | PR1 | `a1ca643` | no-op + 회귀 lock. SSOT 문서가 가정한 5개 flag 가 *코드베이스에 한 번도 구현된 적 없음* 확인 (`git log -S` 결과 Lite-update 문서 commit `a83060a` 외 0건). `src/__tests__/no_feature_flags.test.ts` 신설 — `KEYS` / `DEFAULTS` 에 `feature*` prefix 등장 시 fail. 07-checklist PR1 4 항목 ☑ 완료. 코드 변경 0건 / 신규 테스트 1개 (2 assertions). |
| 2026-05-29 | PR2 | `c9cba4a` | Problems 탭 삭제. `pre-cut-PR2` annotated tag 부여. 5 files 변경: ① `BottomDrawer.tsx` 의 TABS entry / render block / `Database` icon import / 주석 정리, ② `WorkspaceContext.tsx` 의 union 축소 (`"terminal" \| "git"`) + `migrateBottomDrawerTab` 신설 + `loadFromStorage` 에서 호출, ③ `CodeWorkbench.tsx` 주석 2건 정리, ④ `lite_w6_safety_net.test.ts` 의 SC2 `.todo` → 3 real assertions (problems→terminal / 유효값 보존 / unknown→terminal default), ⑤ `check-no-localstorage.mjs` ALLOWLIST 에 테스트 파일 추가. `grep Problems` 결과 0. 5종 green. |
| 2026-05-29 | PR3 | `4fce590` | Session 추정 UI 제거 — Phase B 의 가장 큰 frontend cut. `pre-cut-PR3` annotated tag 부여. 11 files 변경 (-~700 lines): 3 파일 삭제 + TimelineView flat list 재작성 + JournalEntryDetail compare 탭 제거 + TodayScreen state/probe 단순화 + CommandPalette compareLatest 제거 + 백엔드 doc comment 갱신. `oculpmApi` 모듈 보존. 5종 green. |
| 2026-05-29 | PR4 | `0a88224` | SQLite Changelog 시스템 삭제 — Phase B 최대 backend+frontend cut. `pre-cut-PR4` annotated tag. 18 files / **net -2033 lines** (-2118/+85). frontend 4 + backend 1 파일 삭제, daily_brief 단순화, TodayScreen legacy 뷰 제거, AiWorkbench save-to-changelog 제거. MigrationModal flow 그대로 보존. DROP TABLE 마이그레이션은 1.1 로 연기. 5종 green. |
| 2026-05-29 | PR5 | `af2d6af` | CodeEditor / GitPanel legacy 이동 — Phase B 종료. `pre-cut-PR5` tag. 15 files. 2 파일 이동 to `src/legacy/`, tsconfig + vitest exclude 추가, CodeWorkbench → `OpenInExternalEditor` placeholder (PR8 정식), BottomDrawer Terminal 단독 (TABS / git tab / GitPanel import / Placeholder helper 제거), `BottomDrawerTab` union → `"terminal"` single-member, `CodeSubTab` 에서 `"git"` 제거 + load 마이그레이션 + mapLegacyTab fallback, App.tsx CODE_SUB_NAV + CommandPalette code-git + GitBranch icon 정리. 백엔드 `git_head_status_brief` 커맨드 + `GitHeadStatusBrief` DTO + `head_status_brief` helper 신설 (PR7 UI consumer 대기). 5종 green. tauri build 산출물 측정은 CI/1.0 출시 직전 보류. |
| 2026-05-29 | PR6 (6.2 only) | `2b24f7b` | LocalDiffView 백엔드 foundation. 사용자 선택: backend-only + flag X. 6 files (+318/-13). `git::diff_patch` 헬퍼 복원 (PR4 에서 삭제) + `commands/diff.rs` 신설 — `reindex_paths` (`LocalDiffReindexReport` DTO, chunk+AST+embeddings 풀 파이프라인, per-path skip reasons) + `compute_diff` (`DiffResult` + `DiffSource::Git/SnapshotsUnavailable`, git-only). DTO 명명 충돌 (`ReindexReport` vs `oculpm/spec.rs:659`) → `LocalDiffReindexReport` 로 rename. PR6.1 (file_snapshots + Watcher snapshot) 은 1.1 로 연기 (zstd dep + watcher invariant 회귀 위험). PR6.3~6.5 (UI) 후속 PR. 신규 SQL/dep/flag 0. 5종 green. |
| 2026-05-29 | PR7 (Part 1) | `0343a3c` | 3-IA collapse + TitleBar GitBranchChip. 9 files. ActiveView union 을 today/plan/code 로 narrowing + `migrateActiveView`, App.tsx PRIMARY_NAV 3 슬롯, ⌘1/⌘2/⌘3 매핑, CommandPalette view-overview 제거 + Code → ⌘3, GitBranchChip.tsx 신설 (branch + uncommitted +N badge + (no git)/(error)/loading states + visibilitychange refresh), TitleBar 가 GitBranchChip 마운트. vitest migrateActiveView 4 신규. Code 화면은 PR8/PR9 까지 보존. 5종 green. |
| 2026-05-29 | PR10 (Part 1) | `b4f9377` | Phase D 진입 — design tokens + reduced-motion + uncommitted 의미 색 보정. `pre-cut-PR10-part1` annotated tag. 3 files (+45/-8). PR10 의 full DoD (axe-core + 키 nav 감사 + 카피 통일) 가 *과한* 작업이라 sub-part 로 분해, Part 1 = foundations. ① `App.css` 의 `@layer base` 에 `--accent-recent-change` + `--accent-uncommitted` 토큰 정의 — light (`#d4a843` / `#c4922f` 양쪽 amber) + dark (`#e6c570` / `#dba94b` chroma-shifted) 양쪽. 의미: 둘 다 amber-leaning 으로 "notice, please look here" — destructive 토큰은 실제 에러 상태 전용으로 보존. ② `App.css` 에 WCAG SC 2.3.3 (Animation from Interactions) 의 `@media (prefers-reduced-motion: reduce)` 글로벌 룰 추가 — `*::before` / `*::after` 포함 모든 셀렉터의 animation/transition duration 을 1ms 로 collapse + `scroll-behavior: auto`. `animation: none` 대신 1ms 채택 — tw-animate-css / shadcn dialogs 가 keyframe lifecycle 완료 후 cleanup 가능. ③ `GitBranchChip` 의 "+N uncommitted" 배지가 `text-destructive` → `--accent-uncommitted` (인라인 스타일) 로 교정. aria-label / tooltip 카피 동일. uncommitted 는 notice 지 error 아님. ④ `FileExplorer` 의 per-file recent-change dot + ancestor folder soft dot (`bg-primary/50` → opacity-60 + `--accent-recent-change`) + active-row override (`bg-primary` 대신 `currentColor` — primary 배경 안에서 자연 invert). 5종 green (vitest 43/3 / cargo 238/1 / clippy / typecheck / lint 모두 PR6.4 와 동일). **연기 (sub-PR 또는 1.1)**: axe-core 설치 (외부 dep, 사용자 confirm 필요), full 키보드 nav 감사 (포커스 ring + 모든 모달 ESC + 탭 순서), 한국어 카피 통일 (grep 100+ 문자열), mismatch 배지 3중 (session-mismatch UI 가 PR3 에서 retire — 현재 FileTree A/M/D 가 가장 가까운 surface, 이미 color + text 충족). |
| 2026-05-29 | PR6.4 | `9f87b0b` | FileTree dot click → Diff handoff. `pre-cut-PR6.4` annotated tag. 6 files (+144/-5). PR6.3 의 LocalDiffView surface 가 ⌘B + Files/Diff segmented control 또는 CommandPalette 로만 진입 가능했던 한계 해결. spec §2.4 #2 ("FileTree 의 변경 하이라이트 dot 클릭 → 좌측 ⌘B 패널에 자동 마운트 + 해당 파일 선택") 충족. ① `WorkspaceContext` 에 휘발성 `diffTarget: string \| null` (영속화 X — 핸드오프 = single event, sticky state X). `openDiffFor(path)` 가 `sidePanelOpen=true` + `sidePanelMode="diff"` + `diffTarget=path` 를 한 번에 atomic set. `consumeDiffTarget(): string \| null` 이 pending path return + 같은 setState 안에서 null clear (single-shot). `persistToStorage` + `loadFromStorage` 가 diffTarget 을 영속 blob 에서 exclude. ② `FileExplorer` 에 optional `onChangedFileClick` prop 추가 — 제공 시 `recentChanges[path]` 매칭 파일 클릭 / Enter / Space 가 default `onSelectFile` 대신 발화. prop omit 시 plain selection mode 로 fallback (테스트/임베드 호환). ③ `SidePanel` 이 `openDiffFor` context method 를 FileExplorer 의 `onChangedFileClick` 로 plumb. ④ `LocalDiffView` 가 mount-time `consumeDiffTarget()` useEffect 신설 — 핸드오프 target 이 "default to newest" 분기보다 우선, 단 consumed 후 사용자가 list 의 다른 파일 클릭 시 정상 picker 로 복귀. ⑤ vitest 신규 3 assertions — `renderHook` 으로 실제 `<WorkspaceProvider>` 마운트 후 `openDiffFor` → 상태 composite 확인, `consumeDiffTarget` 첫 호출 = return+clear / 두 번째 = null, 무-target 호출 = null + setState churn 없음. ⑥ `src/__tests__/setup.ts` 에 `vi.mock("@tauri-apps/api/event")` 셋업 추가 — `WorkspaceProvider` 의 on-mount `events.oculpm*.listen` 이 Tauri 런타임 밖 (jsdom) 에서 `transformCallback of undefined` 로 throw 했던 회귀 차단. no-op subscriber 라 context 렌더 테스트 전반에 재활용 가능. vitest **43 pass + 3 todo** (was 40+3). cargo test 238 + 1 ignored. clippy clean. **PR6.5 (side-by-side ≥1024px + collapse + 읽음/안읽음 + "AI 에게 설명")** 은 polish, 1.1 안전 후보. |
| 2026-05-29 | PR9 | `e78e998` | Workspace-level AI overlay + detached window. `pre-cut-PR9` annotated tag. 9 files (+282/-49, 신규 1 = `src/components/AiOverlay.tsx`). ① backend `commands::window::open_ai_window` 신설 — idempotent `WebviewWindowBuilder` for `ai_detached` with `?window=ai`. 이미 존재 시 `get_webview_window().unminimize/show/set_focus` 로 "summon" 의미 보존 + 720×640 default, min 420×360. `tauri-plugin-window-state` 가 이미 App builder 에 init 됨 → position/size 자동 복원. `Manager` trait import 추가. `lib.rs` invoke_handler 등록. ② NEW `src/components/AiOverlay.tsx` — centered Sheet-style overlay (max-w 720, h calc(100vh-80px), 32px margin) + ESC/outside-click/✕/⌘\ 닫힘. 헤더 "↗ 분리" 버튼이 `commands.openAiWindow` 호출 + 자체 닫힘 (idempotent backend → 반복 클릭 = 기존 윈도우 raise). body 가 기존 `AiWorkbench` 호스팅 (Chat + Quick Edit props 호환). ③ `App.tsx` root 에 `<AiOverlay activeProjectId activeFile>` 마운트 + `?window=ai` 분기 (Terminal 패턴 답습 — `?window=terminal` 와 twin) → detached 윈도우는 chrome-less `AiWorkbench` 만 viewport 전면 표시. ④ `useGlobalShortcuts` ⌘\ = `toggleAiOverlay` (Today/Plan/Code 모두에서 호출), ⌘⇧\ = `setAiOverlayOpen(false) + commands.openAiWindow` (dynamic import 로 bindings 지연 로드). 매핑 헤더 갱신. `CommandPalette` 액션 그룹에 "AI 패널 토글" (⌘\) + "AI 패널 분리 윈도우로 열기" (⌘⇧\) 2 items 추가 (`commands` import 추가). ⑤ `CodeWorkbench` — 우측 inline `AiWorkbench` mount + 1-col resize handle + local `aiWidth` state 전부 제거. Code view = 메인 콘텐츠 pane 만. `codeSubTab === "ai"` 시 `setAiOverlayOpen(true)` 로 redirect (사용자가 ⌘5/sub-nav 클릭해도 overlay 가 열림). ⑥ `WorkspaceContext` — `aiWorkbenchOpen` field 삭제 / `aiOverlayOpen: boolean` (default `false`) 신설 + `toggleAiOverlay` / `setAiOverlayOpen` 콜백 + `migrateAiOverlayOpen` (non-`true` → `false`) export. `loadFromStorage` 가 legacy `aiWorkbenchOpen` 삭제 + `parsed.aiOverlayOpen` 만 살림 — stale persisted `true` 가 launch 시 자동 open 시키는 것 방지 (discovery via ⌘\, not surprise). ⑦ `lite_w6_safety_net.test.ts` `migrateAiOverlayOpen` 2 assertions (true/false preserve / 비-boolean → false). vitest **40 pass + 3 todo** (was 38+3). cargo test 238 + 1 ignored. clippy clean. **연기**: ① 오버레이↔detached 윈도우 mutual exclusion enforcement (둘 다 동시 가능, ⌘\ 가 detached 윈도우 인지 못함 — `window:created`/`window:destroyed` 이벤트 브릿지 + 휘발성 `aiWindowDetached` flag 가 닫는다, 1.0 dogfood 비-load-bearing), ② ChatPanel cross-instance 라이브 streaming 동기화 (히스토리는 SQLite 라 read 일관성 OK). |
| 2026-05-29 | PR6.3 | `3fa97e6` | LocalDiffView + SidePanel Files/Diff toggle. `pre-cut-PR6.3` annotated tag. 5 files (+514/-17, 신규 1 = `src/features/diff/LocalDiffView.tsx`). ① 신규 `LocalDiffView.tsx` — 헤더에 "부분 reindex" (`commands.reindexPaths` 의 deduped `recentChanges` paths set 호출 + toast `indexed/elapsed_ms/embeddings_updated` 보고) + ghost "비우기". 중간: `recentChanges` 역순 (newest first) 파일 리스트 (dot + A/M/D 배지 — FileExplorer 어휘 동일). 하단: 선택 변경 시 cancel-safe `commands.computeDiff(projectId, path, 64KB)` fetch + 색상화된 unified diff (header / hunk / addition / deletion / context). `SnapshotsUnavailable` 분기는 "1.1 file_snapshots fallback" 안내. ② `classifyDiffLines(patch) -> DiffLine[]` pure-fn export (DiffLine/DiffLineKind 타입 동행) — 색상 분기 단위 테스트 가능. ③ `WorkspaceContext` 에 `SidePanelMode = "files" \| "diff"` + `sidePanelMode` 영속화 (default `"files"`) + `migrateSidePanelMode` (member 아닌 값 → `"files"`) + `setSidePanelMode` 콜백 + `loadFromStorage` 의 sanity. 사용자의 마지막 surface 가 ⌘B 닫음/앱 재시작 후에도 보존. ④ `SidePanel` 헤더의 "Files" 정적 라벨 → `role="tablist"` Files/Diff segmented control + body 가 mode 에 따라 `<LocalDiffView>` 또는 `<FileExplorer>` 마운트 + indexed-count/Re-index/"비우기" footer 가 Diff mode 시 hidden (LocalDiffView 가 자체 헤더 가짐, redundant CTA 제거). ⑤ `CommandPalette` 액션 그룹에 "변경된 파일 diff 보기" item — mode `"diff"` set + open. **FileTree dot click 핸드오프는 PR6.4**, side-by-side / 읽음 / "AI 에게 설명" 은 **PR6.5**. ⑥ vitest `migrateSidePanelMode` 2 + `classifyDiffLines` 3 = 5 신규. **38 pass + 3 todo** (was 33+3). cargo test 238 + 1 ignored. clippy clean. 신규 dep 0 (react-diff-viewer 등 외부 라이브러리 도입 X — `compute_diff` 의 unified-diff 텍스트를 직접 색상화). |
| 2026-05-29 | PR8 (Part 3) | `ebf2cff` | keyboard a11y + clear-changes + 50k perf bench. `pre-cut-PR8-part3` annotated tag. 5 files (+475/-51). ① `FileExplorer.tsx` 가 진짜 `role="tree"` 로 승격 — 각 행 `role="treeitem"` + `aria-expanded` / `aria-level` / `aria-selected` + roving `tabIndex` (`focusedPath` 의 행은 0, 나머지는 -1). 신규 pure helper `flattenVisibleNodes(tree, expanded) -> FlatNode[]` (`{path, name, isDir, depth, parentPath}` DFS) + `nextFocusedPath(visible, current, key, expanded, onExpand?, onCollapse?)` (↑↓ clamp / → collapsed→expand·expanded→child / ← expanded→collapse·child→parent / Home·End). useEffect 가 `el.focus({preventScroll: false}) + scrollIntoView({block:"nearest"})` 로 키 nav 시 행을 시야에 유지. Enter/Space 가 폴더 토글 또는 파일 select. focus 상태 ring 스타일 추가. ② `WorkspaceContext.clearRecentChanges()` 신설 — buffer 비어 있으면 no-op (setState churn 방지). ③ `SidePanel` footer 의 indexed-count row 아래 ghost-button + ✕ icon `{N}개 변경 비우기` 추가 (recentChanges 비어 있으면 hide). ④ `commands::project_tree::tests::perf_bench_50k_files` 신규 `#[ignore]` — 100 dirs × 500 files 합 50k 생성 후 `build_project_tree` 측정. 로컬 release 빌드 **112ms** (SLO 500ms 의 22%) 확인. 실행: `cargo test --manifest-path src-tauri/Cargo.toml --release project_tree::tests::perf_bench_50k_files -- --ignored --nocapture`. ⑤ `lite_w6_safety_net.test.ts` 의 PR8 Part 3 block — `flattenVisibleNodes` 3 + `nextFocusedPath` 8 + clearRecentChanges semantics 1 = 12 신규 assertions. vitest **33 pass + 3 todo** (was 21+3). cargo test 238 default + 1 ignored perf. 5종 green. **PR8 종료** — Phase C 의 FileTree 영역 전체 완료. **PR9 (AI overlay)** + **PR6.3 (LocalDiffView UI)** 이 Phase C 의 남은 frontend. |
| 2026-05-29 | PR8 (Part 2) | `e116682` | Workspace-level SidePanel (⌘B) + external editor launch. `pre-cut-PR8-part2` annotated tag. 12 files 변경 (+563/-233, 신규 2 = `src-tauri/src/commands/external_editor.rs` + `src/components/SidePanel.tsx`). ① backend `commands::external_editor::open_in_editor(project_root, rel_path, editor_cmd) -> Result<()>` — `substitute_path` (`"%path"` 우선 / `%path` / 미존재 시 append) + shell-quote (embedded `"` 는 `\"` 로 escape) + spawn detached via `sh -c` (Unix) or `cmd /C` (Windows). Empty/missing project_root 는 친절한 에러. 5 unit tests (quoted / bare / no-placeholder / embedded-quote / extra-arg). `commands/mod.rs` + `lib.rs` 등록. ② `WorkspaceContext` 에 `sidePanelOpen` (default `false`) + `sidePanelWidth` (default `260`) 영속화 — `SIDE_PANEL_MIN_WIDTH=200` / `_MAX_=500` / `_DEFAULT_=260` + `migrateSidePanelWidth` (clamp + round + non-number→default). `toggleSidePanel` / `setSidePanelOpen` / `setSidePanelWidth` 콜백 + context value exposure. `loadFromStorage` 가 corrupted shape 을 sanitise. ③ `settings.externalEditorCommand: string` 신설 (default `code "%path"`) — KEYS / DEFAULTS / KEY_TO_FIELD / Settings interface 모두 업데이트. `SettingsPanel.AppearanceTab` 의 top 에 "External editor" Section 추가 (`%path` 설명 + Cursor/Sublime 예시 + macOS GUI 앱 PATH 미상속 caveat). ④ NEW `src/components/SidePanel.tsx` — `useWorkspace()` + tree loader (`commands.listProjectTree` cancel-safe) + FileExplorer 호스팅 + 헤더 close (`ChevronLeft`) + indexing/re-index footer (channel onmessage progress) + 우측 edge resize handle (mousedown → window mousemove → `setSidePanelWidth` clamp 적용). ⑤ `App.tsx` Workspace 가 IA strip ↔ activeView pane 사이에 SidePanel conditional mount (sidePanelOpen 시). recentChanges → lookup Map 파생을 Workspace 수준으로 lift. `reloadProjectFiles` prop pass-through 정리. ⑥ `CodeWorkbench` 완전 리팩터 (-141 lines net) — inline `FileTree` wrapper 전체 삭제 + 새 SidePanel 이 책임 인계. `codeSubTab === "files"` && `!sidePanelOpen` 일 때 ⌘B 자동 토글 (사용자가 닫혀있는 채 빈 Code 화면 보지 않도록). `OpenInExternalEditor` 가 `commands.openInEditor` 호출 + `settings.externalEditorCommand` 사용 + launching state + toast 실패 알림 + 명령 미리보기 표시. ⑦ `useGlobalShortcuts` ⌘B = `toggleSidePanel` + 매핑 헤더 갱신. ⑧ `CommandPalette` 액션 그룹에 "파일 탐색기 토글" (⌘B, alias "side panel files file tree") item 추가. ⑨ `lite_w6_safety_net.test.ts` 의 PR8 Part 2 block 신규 — `migrateSidePanelWidth` 5 assertions (in-range / under-min / over-max / non-finite default / 비-integer rounding). vitest 21 pass + 3 todo (was 16+3). cargo test 238 incl. 5 external_editor (was 233). 5종 green. **Browser-level dogfood (⌘B 토글 / 리사이즈 / 외부 에디터 실행) 는 PR7 Part 2 패턴대로 Phase D 사용자 검증 영역**. **PR8 Part 3 (a11y ↑↓←→ + "변경 표시 비우기" + 50k 파일 성능)** 후속. |
| 2026-05-29 | PR8 (Part 1) | `8da2707` | tree-backed FileExplorer + recentChanges buffer. `pre-cut-PR8-part1` annotated tag. 7 files (+704/-115, 신규 1). ① backend `commands::project_tree::list_project_tree(project_id, opts) -> ProjectTreeNode` 신설 — `ignore::WalkBuilder` 로 `.gitignore` respect + `.git/` / `.oculpm/` 강제 exclude + dirs-before-files alphabetical sort + `opts.max_depth` 캡. `ProjectTreeNode { name, relative_path, is_dir, children }` (size/mtime 는 specta BigInt 금지로 후속 PR). `lib.rs` invoke_handler + `commands/mod.rs` 등록. 5 unit tests (oculpm/git 제외 / .gitignore propagation / sort order / nested relative_path / max_depth). ② `FileExplorer.tsx` 재작성 — `tree: ProjectTreeNode \| null` props, controlled `expanded` + `onToggleExpand`, optional `recentChanges: Record<string, ChangeOp>` → 파일 dot + A/M/D 배지 + ancestor 디렉토리 soft dot. 검색어 입력 시 매칭 ancestor 트리 자동 펼침 (영속 expanded 와는 별도 transient set). ③ `WorkspaceContext.tsx` 에 `ChangeOp = "A"\|"M"\|"D"` + `RecentChange { path, op, ts }` + `recentChanges: RecentChange[]` 영속화 (`RECENT_CHANGES_CAP = 1000`) + `pushRecentChange` (dedupe by path, FIFO trim, 최신 op 우선) + `mapFileOpToChangeOp` (create→A / delete→D / update·rename·correct→M) + `events.oculpmFileChanged` 리스너 신설 + `setProject` 시 switched 면 recentChanges/fileExplorerExpanded 둘 다 리셋 + `loadFromStorage` 의 sanity 가 corrupted shape 을 drop. `fileExplorerExpanded` 는 기존 필드라 별도 마이그레이션 불요. ④ `CodeWorkbench.tsx` 가 `commands.listProjectTree(projectId, null)` 호출 (projectId 변경 시 cancel-safe), expanded 위임 (`toggleExpand` 콜백), FIFO 배열 → `useMemo` 로 `Record` 파생. FileTree wrapper 도 props 갱신 (`tree`, `indexedCount = projectFiles.length`, `recentChanges`, `expanded`, `onToggleExpand`). re-index 후 `reloadTree()` 도 추가. footer 의 "N files indexed" 는 그대로 — indexed list 와 tree 는 두 데이터 소스 유지. ⑤ `lite_w6_safety_net.test.ts` 의 SC3 todo 가 PR8 Part 1 의 pure-fn block 으로 대체됨 (lift); 5 신규 assertions (empty append / dedupe ordering / FIFO trim at cap / FileOp 4 mappings). vitest 16 pass + 3 todo (was 12+3). cargo test 233 (215 lib + 7 agents + 5 lite_w6_safety_net + 6 oculpm_migration, project_tree::tests 5 신규). 5종 green. **PR8 Part 2 (⌘B 사이드 패널 + open_in_editor + Settings prefs)** + **Part 3 (a11y / 비우기 / 성능)** 후속. |
| 2026-05-29 | PR7 (Part 2) | `a398c6d` | Terminal 을 Workspace-level dock 으로 승격 + ⌘J/⌘⇧J 재정의. 9 files (BottomDrawer.tsx 삭제 포함). ① `WorkspaceContext` 에 `LayoutMode = "main-only" \| "split" \| "terminal-only"` + `splitRatio` 추가, `bottomDrawerOpen` / `bottomDrawerTab` / `BottomDrawerTab` 모두 제거, `migrateLayoutMode(rawLayoutMode, legacyBottomDrawerOpen)` + `migrateSplitRatio` 신설 (clamp 0.1~0.9, NaN/문자열은 default 0.6) + `loadFromStorage` 에서 호출 + legacy 필드 `delete`, ② NEW `src/components/TerminalDock.tsx` — TerminalPanel 을 항상 mount (PTY 세션 보존을 위해 CSS `display:none` 으로만 숨김) + top-edge horizontal resize handle (mousemove → setSplitRatio) + 헤더의 풀스크린/복원/닫기 버튼, ③ App.tsx 의 Workspace `<main>` 을 vertical flex 로 재구성 — activeView pane (flexBasis = `${splitRatio * 100}%`) 위에 TerminalDock, terminal-only 시 activeView pane `display:none`, ④ `src/features/code/CodeWorkbench.tsx` 의 local `BottomDrawer` mount 제거 + `codeSubTab === "terminal"` 핸들러를 `layoutMode = "split"` 으로 갱신 + 헤더 ASCII 다이어그램 갱신, ⑤ `src/features/code/BottomDrawer.tsx` **파일 삭제** (Code-only 였던 Terminal 진입이 Workspace-level 로 옮겨갔으므로 dead), ⑥ `useGlobalShortcuts.ts` ⌘J 가 split↔main-only 사이클 + Shift 동시 누름 시 terminal-only 토글 + 매핑 헤더 갱신, ⑦ GitBranchChip 의 모든 상태 (정상/no git/error) 가 클릭 시 `setLayoutMode("split")` + refresh 호출 + tooltip 에 "클릭으로 Terminal 열기" 표시 (git status 자동 실행은 PTY 세션별 다양성으로 보류), ⑧ `lite_w6_safety_net.test.ts` 의 SC2 (BottomDrawerTab 마이그레이션) 를 `.todo` 로 retire + PR7 Part 2 의 `migrateLayoutMode` (legacy true→split / false→main / 현 멤버 보존 / 미지정→main) + `migrateSplitRatio` (clamp/default/non-number→default) 새 7 assertions 신설 — vitest 12 pass (was 10) + 3 todo. 5종 green. | 3-IA 의 첫 단계 — IA collapse + TitleBar GitBranchChip. 본 라운드는 Code 화면을 의도적으로 *보존* (PR8/PR9 가 Files/AI/Terminal 흡수할 때까지 dogfood 회귀 최소화). 7 files. ① `WorkspaceContext.ActiveView` union 을 `"today" \| "plan" \| "code"` 로 narrowing (overview / changelog 제거). `migrateActiveView` 헬퍼 신설 + `loadFromStorage` 호출, `mapLegacyTab` 의 overview / settings / diagnostics → today, ② `App.tsx` PRIMARY_NAV 3 슬롯 (Today / Plan / Code), Overview 케이스 + import 제거, LayoutDashboard unused import 정리, ③ `useGlobalShortcuts` ⌘1=Today / ⌘2=Plan / ⌘3=Code 매핑 + ⌘4/⌘5 polyfill no-op + 주석 갱신, ④ `CommandPalette` view-overview 항목 제거 + Code 단축키 ⌘3 재할당 + LayoutDashboard import 정리, ⑤ NEW `src/components/GitBranchChip.tsx` — `gitHeadStatusBrief` 호출 + branch + uncommitted `+N` (destructive accent) + (no git) / (git error) / loading 상태 + visibilitychange 리프레시 + 수동 refresh on click, ⑥ `TitleBar` 가 `projectId` prop 받아 GitBranchChip 마운트, ⑦ `lite_w6_safety_net.test.ts` 에 `migrateActiveView` 4 assertions 신규 (overview→today / changelog→today / union member 보존 / unknown→today). vitest 10 pass (was 6) + 2 todo. 5종 green. **PR7 Part 2 (layoutMode + TerminalDock + ⌘B split + Git chip click → split)** 는 PR8/PR9 와 함께 후속. | LocalDiffView 백엔드 foundation — Phase C 첫 PR. 사용자 선택: backend-only 최소 범위 + flag 신설 X. 5 files (+330/-0). ① `git::diff_patch` 헬퍼 복원 (PR4 에서 changelog 정리 시 삭제됐던 함수, unified-diff + truncation), ② `src-tauri/src/commands/diff.rs` 신설 — `reindex_paths` (`LocalDiffReindexReport` DTO + per-path skip reasons / 부분 reindex 가 chunk + AST + embeddings 풀-파이프라인 / `index_project` per-file 본문과 손수 sync), `compute_diff` (`DiffResult` + `DiffSource::Git/SnapshotsUnavailable` / git-only / 비-git 은 명시 enum 으로 분기 → 1.1 file_snapshots fallback 대기), ③ `commands/mod.rs` + `lib.rs` 등록. **PR6.1 (마이그레이션 010 file_snapshots + Watcher snapshot 작성) 은 1.1 로 연기** — 신규 `zstd` cargo dep (§6 rule 6 confirm) + Watcher invariant 회귀 위험을 1.0 출시 일정과 trade. **PR6.3~6.5 (LocalDiffView UI + entry + UX) 후속 PR**. ⚠ DTO 명명 충돌 발견 (`ReindexReport` 가 `oculpm/spec.rs:659` 에 이미 존재) → 내 struct 를 `LocalDiffReindexReport` 로 rename 해 specta export 통과. 5종 green. | CodeEditor / GitPanel legacy 이동 — Phase B 종료. `pre-cut-PR5` annotated tag. 13 files 변경: ① 2 파일 이동 (`components/CodeEditor.tsx` → `legacy/`, `features/git/GitPanel.tsx` → `legacy/git/`), ② 빈 `src/features/git/` 디렉토리 제거, ③ `tsconfig.json` + `vitest.config.ts` 에 `src/legacy/**` exclude 추가, ④ `CodeWorkbench` 의 CodeEditor JSX 제거 + `OpenInExternalEditor` placeholder 신설 (PR8 정식 구현 대기), ⑤ `BottomDrawer` 에서 git 탭 + GitPanel import + Placeholder helper 제거 — TABS 단일 (Terminal), ⑥ `WorkspaceContext.BottomDrawerTab` 을 `"terminal"` single-member 로 축소 + `CodeSubTab` 에서 `"git"` 제거 + `migrateBottomDrawerTab` 갱신 + `loadFromStorage` 가 persisted `codeSubTab: "git"` → `"files"` fallback + `mapLegacyTab("git")` 도 `code/files` 매핑, ⑦ `lite_w6_safety_net.test.ts` SC2 가 새 single-member union 반영 (4 assertions), ⑧ `App.tsx` CODE_SUB_NAV 에서 git 엔트리 제거 + `GitBranch` 아이콘 import 정리, ⑨ `CommandPalette` 의 `code-git` item 제거 + `GitBranch` 아이콘 정리, ⑩ 백엔드 `git_head_status_brief` 커맨드 + `GitHeadStatusBrief` DTO + `head_status_brief` helper 신설 (TitleBar mini chip 용, PR7 의 UI consumer 대기). `lib.rs` invoke_handler 등록. 메인 UI 에서 `CodeEditor/GitPanel/features/git` 참조 grep 0 (legacy + 코멘트 제외). 5종 green. `pnpm tauri build` 산출물 측정은 CI / 1.0 출시 직전 보류. | SQLite Changelog 시스템 삭제 — Phase B 최대 backend+frontend cut. `pre-cut-PR4` annotated tag 부여. 16 files 변경 (**net -2039 lines**, -2101/+62): ① frontend 4 파일 삭제 (`features/changelog/` 전체 = -758 lines), ② backend 1 파일 삭제 (`commands/changelog.rs` = -503 lines, 8 commands), ③ `lib.rs` invoke_handler 에서 8 commands 제거, ④ `commands/mod.rs` 의 `pub mod/pub use changelog` 제거, ⑤ `db.rs` 의 5 write 메서드 + `DailyChangelogBucket` struct 제거 (-104 lines, 보존: ChangelogEntry/FileEntry struct + read 메서드 + truncate + insert helpers as test seeders), ⑥ `git.rs` 의 G1 Diff utilities 전체 삭제 (DiffFileStat / diff_stat / list_untracked / diff_patch / diff_shortstat = -244 lines), ⑦ `daily_brief` DTO 단순화 (today_entries / pinned_entries / files_touched / lines_added / lines_removed 제거 → focus_goals + completed_today 만 남김), ⑧ `App.tsx` 의 ChangelogScreen route + ⌘4 PRIMARY_NAV entry 제거, ⑨ `useGlobalShortcuts` ⌘4 = no-op (⌘5 = code 유지, PR7 재패킹 대기), ⑩ `CommandPalette` view-changelog item 제거, ⑪ `AiWorkbench` handleSaveToChangelog + 오늘 변경사항 section + onGoChangelog prop 제거 — Quick Edit 의 마지막 단계 = "프롬프트 복사", ⑫ `TodayScreen` legacy DailyBrief view 전체 제거 (332 → 148 lines, FocusCard / CompletedCard / ActivityCard / PinnedCard / RecommendationCard / CategoryChip / truncate / brief state / load callback). MigrationModal / LegacyDeleteModal / migrate_from_sqlite / delete_legacy_changelog 모두 **변경 없이 보존** — v0.x 사용자 진입 시 정상 동작. **DROP TABLE 마이그레이션은 1.1 로 연기** (사용자 confirm 필요한 신규 SQL 없음 → 안전한 보수 선택). 5종 green (vitest 6+2 todo / cargo 228 / clippy 0). | Session 추정 UI 제거 — Phase B 의 가장 큰 frontend cut. `pre-cut-PR3` annotated tag 부여. 11 files 변경 (-~700 lines): ① 3 파일 삭제 — `SessionCard.tsx`, `DiffVsNarrative.tsx`, `EmptyTodayV3.tsx`, ② `TimelineView.tsx` 재작성 — flat journal entry list (session grouping + `SessionWithSynthetic` + `listSessions` 호출 제거), ③ `JournalEntryDetail.tsx` 의 `index 비교` 탭 + `DetailTabs` + `CompareRegion` + `TabButton` 제거 → 본문 위 path label strip 만 남김, ④ `TodayScreen.tsx` 의 `compareSessionId`/`latestSessionId`/`fileChangeCount` state + `DiffVsNarrative` mount + `EmptyTodayV3` branch + `compareLatest` listener + `listSessions` probe 제거 (probe 는 `listJournalEntries` 만), ⑤ `CommandPalette.tsx` 의 `OCULPM_BUS.compareLatest` + 이중 레이어 비교 item 제거, ⑥ `EmptyToday/index.ts` 의 V3 export 제거, ⑦ `JournalEntryCard.tsx` / `ManualEntryModal.tsx` / `CategoryFilterBar.tsx` 의 SessionCard/V3 참조 정리 + 죽은 `mismatch 만` toggle 제거, ⑧ 백엔드 doc comment 갱신 (`commands/oculpm.rs:499`, `oculpm/manager.rs:994`) + `bindings.ts` 재생성. `api/oculpm.ts` 모듈 자체는 보존 (호출 사이트만 0). `filters.mismatchOnly` DTO 필드는 backend 호환 위해 보존. 5종 green. | Problems 탭 삭제. `pre-cut-PR2` annotated tag 부여. 5 files 변경: ① `BottomDrawer.tsx` 의 TABS entry / render block / `Database` icon import / 주석 정리, ② `WorkspaceContext.tsx` 의 union 축소 (`"terminal" \| "git"`) + `migrateBottomDrawerTab` 신설 + `loadFromStorage` 에서 호출, ③ `CodeWorkbench.tsx` 주석 2건 정리, ④ `lite_w6_safety_net.test.ts` 의 SC2 `.todo` → 3 real assertions (problems→terminal / 유효값 보존 / unknown→terminal default), ⑤ `check-no-localstorage.mjs` ALLOWLIST 에 테스트 파일 추가 (테스트가 localStorage seed 함). `grep Problems` 결과 0 (frontend + backend). diagnostics.rs 는 `db_health` 만 노출하므로 무관 — 변경 없음. 5종 green 모두 통과 (vitest 6 pass + 2 todo). | no-op + 회귀 lock. SSOT 문서가 가정한 5개 flag 가 *코드베이스에 한 번도 구현된 적 없음* 확인 (`git log -S` 결과 Lite-update 문서 commit `a83060a` 외 0건). `src/__tests__/no_feature_flags.test.ts` 신설 — `KEYS` / `DEFAULTS` 에 `feature*` prefix 등장 시 fail. 07-checklist PR1 4 항목 ☑ 완료. 코드 변경 0건 / 신규 테스트 1개 (2 assertions). | clippy 48 errors → 0. 14 files 변경 / -58 net lines. 핵심 변경: ① `cargo clippy --fix` 로 28건 (useless_conversion 17 / needless_question_mark / unnecessary_map_or / unnecessary_cast / unnecessary_parens / for_kv_map / needless_borrow / 미사용 import 4 / unused mut 등) 자동 정리, ② `std::mem::transmute` 에 명시 타입 부여 (`db.rs:71`), ③ dead test helper `insert_session` (sync) + `_suppress_unused` 삭제 (`cache.rs`, await 누락 의심은 실제로 dead code 였음 — 호출자 0), ④ `let...else → ?` 1건 (`indexer.rs:412`), ⑤ `LlmError::MissingApiKey` 삭제 (구성·매치 모두 0), ⑥ `EMBEDDING_DIM` / `LlmProvider::name()` 에 `#[allow(dead_code)]` (의미 있는 API surface, 보존), ⑦ `#[allow(clippy::too_many_arguments)]` 12개 (refactor 가 PR-0c 범위 밖, `tauri::command` signature 는 IPC 계약이라 변경 불가). 5종 green 모두 통과. |

### 5.3 새 발견 / 결정 변경

| 일자 | 발견/변경 | 결정 | 영향 받은 § |
|---|---|---|---|
| 2026-05-29 | **vitest 미설치** 발견 (PR0 정찰) — `package.json` 에 test script + devDeps 모두 부재. master-prompt §7 가 `pnpm test` 를 green 5종에 포함했으나 인프라 자체 부재. | PR0 안에 vitest 4 + @testing-library/react 16 + jest-dom 6 + jsdom 29 도입 + `pnpm typecheck` / `pnpm test` / `pnpm test:watch` scripts 신설. | §7 (명령) 동기화 완료 |
| 2026-05-29 | **`pnpm lint` (`lint:storage`) pre-existing fail** — MigrationModal / ChangelogScreen / ProjectMetaHeader 3 파일이 ALLOWLIST 누락. | PR0 안에서 ALLOWLIST 3개 추가 (`a494d7a`). ChangelogScreen 라인은 PR4 cut 시 자동 제거. | — |
| 2026-05-29 | **`cargo clippy --all-targets -- -D warnings` pre-existing 48 errors** — `unnecessary_cast`, `unused_must_use` (cache.rs:2018 의 `.call(...)` 의 await 누락 가능성 있음), `unnecessary_map_or` 등 *style-only*. lib 컴파일이 fail 해서 `cargo clippy --test lite_w6_safety_net` 도 함께 fail. 내 PR0 코드 자체는 위반 0. | **PR-0c 로 분리** — 1.0 출시 전 별 PR 로 일괄 fix. PR0 의 DoD 중 `cargo clippy -- -D warnings` 는 PR-0c 종료 후 재검증. PR1~PR12 진행 중에는 `cargo clippy` 의 *내 새 코드* 만 확인 (lib 가 fail 해도 진행). | §7 (clippy 권장 명령 문구 추가 권장), 07-checklist (PR0 의 clippy 항목 ⚠ → PR-0c 의존), 본 §5.1 (PR-0c 추가) |
| 2026-05-29 | **`@vitejs/plugin-react` 가 이미 devDeps 에 있음** (^4.6.0). vitest infra 도입 시 추가 의존성 절약. | 그대로 재사용. | — |
| 2026-05-29 | **PR6 의 `ReindexReport` DTO 명명 충돌** — `oculpm/spec.rs:659` 가 이미 `ReindexReport` 라는 struct 를 export 함 (oculpm sync agents 의 진단 DTO). specta export-bindings 테스트가 fail. | 신규 struct 를 `LocalDiffReindexReport` 로 rename. frontend 가 호출할 때 `oculpmApi` 의 그것과 헷갈리지 않도록 prefix 가 명시적. | — |
| 2026-05-29 | **PR4 의 마이그레이션 008 번호 충돌 + DROP TABLE 시점 결정** — PR4 spec 은 "마이그레이션 008 (신규): DROP TABLE changelog_entries; ..." 를 요구하나 008 은 이미 `008_project_overview.sql` 로 점유 (W3-PR2). 또한 자동 실행 마이그레이션이 MigrationModal 진입 *전에* 테이블을 DROP 하면 v0.x 사용자 데이터가 소실됨. | **DROP TABLE 마이그레이션 = 1.1 로 연기**. 1.0 에서는 schema 그대로 보존. MigrationModal / LegacyDeleteModal / migrate_from_sqlite / delete_legacy_changelog flow 가 사용자 confirm 후 backup-and-truncate 를 수행 — 그 자체가 deletion 의 안전한 보수 경로. 7-checklist PR4 마지막 항목 "—" 로 표기. | §5.1 (PR4 ☑), 07-checklist PR4 |
| 2026-05-29 | **PR4 의 daily_brief 변환 시 frontend legacy 뷰 전체 의존** — DTO 필드 5개 (today_entries / pinned_entries / files_touched / lines_added / lines_removed) 가 TodayScreen 의 6 helper component + RecommendationCard 의 추천 텍스트 전부를 driving. journal-only 로 같은 데이터를 재합성하는 것은 PR4 의 범위 밖 (별도 PR9 의 "AI 패널 재배치 + 행 클리어 정책" 영역). | TodayScreen 의 legacy 뷰 전체 제거 (~184 lines). 사용자가 ocul-pm 비활성화 + 과거 날짜를 보는 edge case 는 비어 있게 됨 — 어차피 dogfood-friendly 한 경로 아님. 추후 PR9 가 새 surface 를 추가하면 자연스레 덮음. | 07-checklist PR4 |
| 2026-05-29 | **PR1 의 5개 feature flag 미존재** — `feature_changelog_v2` / `feature_overview_v2` / `feature_clarify` / `feature_greenfield_wizard` / `feature_new_ia` 가 `src/`, `src-tauri/src/`, `src-tauri/migrations/`, `.oculpm/config.toml` 어디에도 없음. `git log -S` 결과 Lite-update planning commit `a83060a` 외 0건. 즉 SSOT 가 *가정한* 구현이 존재하지 않음. 또한 PR1 spec 의 "마이그레이션 012" 는 이미 `012_oculpm_journal.sql` 로 점유됨 (W3-PR2). | PR1 → **no-op + 회귀 lock**. 코드/마이그레이션 변경 0. vitest 회귀 테스트 1개 (`src/__tests__/no_feature_flags.test.ts`) 로 `settings.ts KEYS` / `DEFAULTS` 의 `feature*` prefix 0 을 잠금. 향후 누구든 flag 신설 시 즉시 fail. | §5.1 (PR1 ☑), 07-checklist PR1 4 항목 모두 ☑ 으로 업데이트 |
| 2026-05-29 | **AGENTS.md 대상 파일은 `.oculpm/agents/_template.md`** — 본 프로젝트는 dogfood 대상이 아니므로 root `AGENTS.md` 가 없음 (의도). 강화 5 항목은 `_template.md` 에 작성. | 동의. | — |
| 2026-05-29 | **frontmatter parser 의 closing fence 인식** — `---` 가 column 0 이 아니면 인식 안 됨. invariant_03 test case D 작성 시 발견 (raw string 으로 수정). | invariant_03 test 가 lock. *외부 LLM 이 frontmatter 작성 시 `---` 의 leading whitespace 금지* — `_template.md` 에 별도 명시 권장 (1.0 backlog). | — |
| 2026-05-29 | **specta 가 u64/i64 등 BigInt-범위 정수 export 금지** — PR8 Part 1 의 `ProjectTreeNode` 에 `size: Option<u64>` / `mtime: Option<i64>` 추가 시 `bindings_export_test` 가 `BigInt-style types ... forbidden ... precision loss` 패닉. spec 의 "폴더 / 파일 메타 (size, last_modified) 함께 반환" 요구는 후속 PR 로 미룸. | Part 1 의 `ProjectTreeNode` 에서 size/mtime 필드 제거. 후속 PR (Part 3 또는 PR11) 에서 필요해질 때 `f64` (size, 안전한 범위 표현) + ISO-8601 string (mtime) 으로 재도입. | 03-feature-revisions §1.2 (size/mtime 메타 deferred) |

---

## 6. 의사결정 규칙 (사용자 부재 시)

새 AI 세션에서 *사용자가 즉시 응답하지 않을 때* 의 행동 규칙.

1. **읽기 / 정찰 / 분석 / 문서 작성** — 사용자 확인 *없이* 진행 OK.
2. **새 코드 작성 / 기존 코드 수정** — 진행 전 사용자 확인 *필수*. PR 시작 알림 + 1~2줄 계획 보고.
3. **파일 삭제 / 디렉토리 삭제** — 사용자 확인 *필수* + git tag (`pre-cut-PR<N>`) 선행.
4. **데이터베이스 마이그레이션 SQL** — 사용자 확인 *필수*. idempotent (`IF EXISTS`/`IF NOT EXISTS`) 강제.
5. **`tauri.conf.json` / `Cargo.toml` / `package.json` 변경** — 사용자 확인 *필수*.
6. **외부 의존성 추가 (npm/cargo)** — 사용자 확인 *필수* + 라이선스 / 크기 / 활성 여부 사전 보고.
7. **회귀 테스트 추가** — 사용자 확인 *없이* 진행 OK. 단, *기존 테스트 수정/삭제* 는 확인 필수.
8. **문서 갱신** — `docs/Lite-update/` 안은 자유. 다른 폴더는 사용자 확인.
9. **git commit/push** — 사용자 확인 *필수*. *절대 자동 push 안 함*.
10. **`docs/Lite-update/retrospection/master-prompt.md` (본 문서) 갱신** — PR 머지 시 §5.1 / §5.2 *반드시* 갱신.

위 규칙 위반 시 사용자가 "거기서 멈춰" 라고 말할 권한 보유. 작업 되돌리기 (revert) 도 즉시 가능해야 함.

---

## 7. 자주 사용하는 명령

```bash
# 타입체크 / 린트 / 테스트 (PR 머지 전 4종 모두 green 필수)
pnpm typecheck
pnpm lint
pnpm test
cd src-tauri && cargo test && cargo clippy -- -D warnings && cd ..

# oculpm 통합 테스트 (Lite-W6 회귀 보호의 핵심)
cd src-tauri && cargo test --test oculpm_integration_* && cd ..

# 개발 모드 실행
pnpm tauri dev

# 빌드
pnpm tauri build --target aarch64-apple-darwin

# 상태 확인
git status
git log --oneline -20
git diff --stat HEAD~5..HEAD

# .oculpm 상태 정찰
ls -la .oculpm/
ls .oculpm/journal/
ls .oculpm/index/
cat .oculpm/config.toml | head -30
wc -l .oculpm/index/*/file_changes.ndjson
```

---

## 8. *해서는 안 되는* 행동 (Anti-Patterns)

다음 행동을 발견 즉시 *중단*. 사용자에게 보고:

- ❌ `.oculpm/` 의 schema_version 을 1 *외의* 값으로 잠금/변경. (1.0 은 v1 잠금)
- ❌ `tauri-plugin-opener` 직접 호출로 journal 파일 열기. → `oculpmApi.openEntryInEditor` 사용. (재발 패턴)
- ❌ `aipm:workspace:v1` 외의 *새 localStorage 키* 추가. → `WorkspaceContext` 안에서만 영속화.
- ❌ 외부 LLM 의 STDIN/STDOUT hook / clipboard 모니터링 — 1.0 의 *명시적 거절* 영역.
- ❌ `commit_changelog_entry` 같은 *제거 예정* 커맨드 신규 호출 추가.
- ❌ `src/legacy/` 의 파일을 import 해서 살림 (격리 의도 위반).
- ❌ session_id 의 첫 8자가 workday 가 아닌 형식 생성. → `<workday>-NNN` 또는 `<workday>-mNN`.
- ❌ `master-prompt.md` 의 §0~§4 / §6~§9 영역 변경. (불변 영역. §5 만 갱신.)
- ❌ 사용자 확인 없이 git commit / push.
- ❌ `feature flag` 신설. (Lite-W6 는 *플래그 정리* 라운드, *추가* 라운드 아님.)

---

## 9. 새 AI 세션 보고 양식

새 세션이 첫 응답으로 사용자에게 보고해야 할 내용:

```markdown
**Lite-W6 인계 확인** (2026-XX-XX HH:MM)

- 현재 위치: Phase X / PR<N> / (작업 중 | 미진입 | 완료)
- 12 invariant 점검: ✅ N/12 / ⚠ M (목록)
- 결정 잠금 (§0): 19/19 ✅
- 다음 액션: <한 줄 요약>
- 막힌 부분: <있다면 한 줄>

이어갈까요?
```

위 보고가 *명확하지 않으면* 사용자가 *추가 정보* 를 줄 때까지 작업 시작 X.

---

## 10. 메모리와 본 문서의 관계

`MEMORY.md` (사용자의 auto-memory) 에는 본 Lite-W6 의 *세부 결정* 이 들어있지 않다. 대신:

- `dogfooding-w4-findings-2026-05-25.md` ~ `2026-05-27.md` — dogfood 발견 (회고의 출처).
- `opener-scope-recurring.md` — invariant #11 의 *근거*.
- `oculpm-session-id-format.md` — invariant #12 의 *근거*.

새 AI 세션이 메모리를 *읽는다* 면, *MEMORY 의 메모는 SSOT 가 아님* 을 인지하고:
- **결정 SSOT**: `07-implementation-checklist.md` §0
- **회고 SSOT**: `_dogfooding-retrospective.md`
- **invariant SSOT**: 본 master-prompt.md §3

메모와 SSOT 가 충돌하면 SSOT 우선.

---

## 11. 마지막 — *세션 단절* 의 대비

본 AI 세션이 끊긴 시점은 두 가지 패턴:

### 11.1 PR 작업 *중* 끊김

- git status 가 *dirty* — 변경 중이었음.
- 새 AI 가 §0 의 5단계를 마치면 *어디까지 변경했는지* 확인 가능.
- 권장 행동: 새 AI 가 *지금까지의 diff* 를 사용자에게 보여주고, 사용자가 *유지 / 폐기 / 계속* 선택. 추측해서 이어가지 말 것.

### 11.2 PR 머지 *후* 끊김

- git status clean.
- §5.2 의 머지 로그에 PR 이 추가되어 있음.
- 새 AI 는 §5.1 의 *다음 미진입 PR* 로 자연스럽게 진행 가능.

두 패턴 모두 *§9 의 보고 양식* 으로 사용자에게 위치를 알리고, 사용자가 *go* 하면 진행. 그렇지 않으면 대기.

---

## 부록 A. 본 문서의 *서명*

- 작성자: Claude (Opus 4.7) — 2026-05-28
- 갱신 권한: §5 만 자유 갱신. 다른 § 변경은 사용자 확인.
- 보존: 1.0 출시 후 *영구* — 1.1 시작 시 후속 master-prompt 가 본 문서를 *부모* 로 인용.

---

## 부록 B. 응급 복구 한 줄 명령

세션 단절 + 코드 상태 모름 + 사용자도 모름 인 *최악의 경우*:

```bash
# 1. 마지막 머지 커밋으로 되돌림
git stash && git fetch && git checkout main && git reset --hard origin/main

# 2. .oculpm 상태 정찰
cat .oculpm/config.toml | head -30 && ls .oculpm/journal/

# 3. 본 문서 + 회고 + 체크리스트 §0 의 3 문서를 다시 읽고 §9 보고 양식으로 사용자에게 보고
```

위 명령은 *작업 중 변경* 을 폐기한다. 폐기해도 좋은지 사용자에게 *반드시* 확인.
