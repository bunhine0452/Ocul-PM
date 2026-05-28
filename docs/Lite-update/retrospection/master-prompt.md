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
- **Phase B**: ✅ PR2 완료 / ✅ PR3 완료 / ✅ PR4 완료 / ☐ PR5 미진입
- **Phase C**: ☐ PR6~PR9 미진입
- **Phase D**: ☐ PR10~PR12 미진입
- **추가**: ✅ PR-0c 완료 (clippy 48 errors → 0). `cargo clippy --all-targets -- -D warnings` 가 이제부터 진짜 lock.

진행 중 작업: *없음*. 다음 작업: **PR5 (CodeEditor / GitPanel legacy 이동)** — Phase B 마지막.

### 5.2 머지 로그

| 일자 | PR | 머지 커밋 | 비고 |
|---|---|---|---|
| 2026-05-29 | PR0 | `a494d7a` | 회귀 보호망 — 5 commits: retrospection 인계 묶음 (`28e96bb`) + AGENTS 템플릿 5 강화 (`fc65daf`) + vitest infra (`b0d2d8a`) + Rust 7 invariant safety net (`aa4e99a`) + vitest 3 시나리오 stub (`c0132e1`) + lint ALLOWLIST 보정 (`a494d7a`). `pre-cut-PR0` annotated tag 부여. |
| 2026-05-29 | PR-0c | `71ad3b1` | clippy 48 errors → 0. 14 files 변경 / -58 net lines. 핵심 변경: ① `cargo clippy --fix` 로 28건 (useless_conversion 17 / needless_question_mark / unnecessary_map_or / unnecessary_cast / unnecessary_parens / for_kv_map / needless_borrow / 미사용 import 4 / unused mut 등) 자동 정리, ② `std::mem::transmute` 에 명시 타입 부여 (`db.rs:71`), ③ dead test helper `insert_session` (sync) + `_suppress_unused` 삭제 (`cache.rs`, await 누락 의심은 실제로 dead code 였음 — 호출자 0), ④ `let...else → ?` 1건 (`indexer.rs:412`), ⑤ `LlmError::MissingApiKey` 삭제 (구성·매치 모두 0), ⑥ `EMBEDDING_DIM` / `LlmProvider::name()` 에 `#[allow(dead_code)]` (의미 있는 API surface, 보존), ⑦ `#[allow(clippy::too_many_arguments)]` 12개 (refactor 가 PR-0c 범위 밖, `tauri::command` signature 는 IPC 계약이라 변경 불가). 5종 green 모두 통과. |
| 2026-05-29 | PR1 | `a1ca643` | no-op + 회귀 lock. SSOT 문서가 가정한 5개 flag 가 *코드베이스에 한 번도 구현된 적 없음* 확인 (`git log -S` 결과 Lite-update 문서 commit `a83060a` 외 0건). `src/__tests__/no_feature_flags.test.ts` 신설 — `KEYS` / `DEFAULTS` 에 `feature*` prefix 등장 시 fail. 07-checklist PR1 4 항목 ☑ 완료. 코드 변경 0건 / 신규 테스트 1개 (2 assertions). |
| 2026-05-29 | PR2 | `c9cba4a` | Problems 탭 삭제. `pre-cut-PR2` annotated tag 부여. 5 files 변경: ① `BottomDrawer.tsx` 의 TABS entry / render block / `Database` icon import / 주석 정리, ② `WorkspaceContext.tsx` 의 union 축소 (`"terminal" \| "git"`) + `migrateBottomDrawerTab` 신설 + `loadFromStorage` 에서 호출, ③ `CodeWorkbench.tsx` 주석 2건 정리, ④ `lite_w6_safety_net.test.ts` 의 SC2 `.todo` → 3 real assertions (problems→terminal / 유효값 보존 / unknown→terminal default), ⑤ `check-no-localstorage.mjs` ALLOWLIST 에 테스트 파일 추가. `grep Problems` 결과 0. 5종 green. |
| 2026-05-29 | PR3 | `4fce590` | Session 추정 UI 제거 — Phase B 의 가장 큰 frontend cut. `pre-cut-PR3` annotated tag 부여. 11 files 변경 (-~700 lines): 3 파일 삭제 + TimelineView flat list 재작성 + JournalEntryDetail compare 탭 제거 + TodayScreen state/probe 단순화 + CommandPalette compareLatest 제거 + 백엔드 doc comment 갱신. `oculpmApi` 모듈 보존. 5종 green. |
| 2026-05-29 | PR4 | `0a88224` | SQLite Changelog 시스템 삭제 — Phase B 최대 backend+frontend cut. `pre-cut-PR4` annotated tag 부여. 16 files 변경 (**net -2039 lines**, -2101/+62): ① frontend 4 파일 삭제 (`features/changelog/` 전체 = -758 lines), ② backend 1 파일 삭제 (`commands/changelog.rs` = -503 lines, 8 commands), ③ `lib.rs` invoke_handler 에서 8 commands 제거, ④ `commands/mod.rs` 의 `pub mod/pub use changelog` 제거, ⑤ `db.rs` 의 5 write 메서드 + `DailyChangelogBucket` struct 제거 (-104 lines, 보존: ChangelogEntry/FileEntry struct + read 메서드 + truncate + insert helpers as test seeders), ⑥ `git.rs` 의 G1 Diff utilities 전체 삭제 (DiffFileStat / diff_stat / list_untracked / diff_patch / diff_shortstat = -244 lines), ⑦ `daily_brief` DTO 단순화 (today_entries / pinned_entries / files_touched / lines_added / lines_removed 제거 → focus_goals + completed_today 만 남김), ⑧ `App.tsx` 의 ChangelogScreen route + ⌘4 PRIMARY_NAV entry 제거, ⑨ `useGlobalShortcuts` ⌘4 = no-op (⌘5 = code 유지, PR7 재패킹 대기), ⑩ `CommandPalette` view-changelog item 제거, ⑪ `AiWorkbench` handleSaveToChangelog + 오늘 변경사항 section + onGoChangelog prop 제거 — Quick Edit 의 마지막 단계 = "프롬프트 복사", ⑫ `TodayScreen` legacy DailyBrief view 전체 제거 (332 → 148 lines, FocusCard / CompletedCard / ActivityCard / PinnedCard / RecommendationCard / CategoryChip / truncate / brief state / load callback). MigrationModal / LegacyDeleteModal / migrate_from_sqlite / delete_legacy_changelog 모두 **변경 없이 보존** — v0.x 사용자 진입 시 정상 동작. **DROP TABLE 마이그레이션은 1.1 로 연기** (사용자 confirm 필요한 신규 SQL 없음 → 안전한 보수 선택). 5종 green (vitest 6+2 todo / cargo 228 / clippy 0). | Session 추정 UI 제거 — Phase B 의 가장 큰 frontend cut. `pre-cut-PR3` annotated tag 부여. 11 files 변경 (-~700 lines): ① 3 파일 삭제 — `SessionCard.tsx`, `DiffVsNarrative.tsx`, `EmptyTodayV3.tsx`, ② `TimelineView.tsx` 재작성 — flat journal entry list (session grouping + `SessionWithSynthetic` + `listSessions` 호출 제거), ③ `JournalEntryDetail.tsx` 의 `index 비교` 탭 + `DetailTabs` + `CompareRegion` + `TabButton` 제거 → 본문 위 path label strip 만 남김, ④ `TodayScreen.tsx` 의 `compareSessionId`/`latestSessionId`/`fileChangeCount` state + `DiffVsNarrative` mount + `EmptyTodayV3` branch + `compareLatest` listener + `listSessions` probe 제거 (probe 는 `listJournalEntries` 만), ⑤ `CommandPalette.tsx` 의 `OCULPM_BUS.compareLatest` + 이중 레이어 비교 item 제거, ⑥ `EmptyToday/index.ts` 의 V3 export 제거, ⑦ `JournalEntryCard.tsx` / `ManualEntryModal.tsx` / `CategoryFilterBar.tsx` 의 SessionCard/V3 참조 정리 + 죽은 `mismatch 만` toggle 제거, ⑧ 백엔드 doc comment 갱신 (`commands/oculpm.rs:499`, `oculpm/manager.rs:994`) + `bindings.ts` 재생성. `api/oculpm.ts` 모듈 자체는 보존 (호출 사이트만 0). `filters.mismatchOnly` DTO 필드는 backend 호환 위해 보존. 5종 green. | Problems 탭 삭제. `pre-cut-PR2` annotated tag 부여. 5 files 변경: ① `BottomDrawer.tsx` 의 TABS entry / render block / `Database` icon import / 주석 정리, ② `WorkspaceContext.tsx` 의 union 축소 (`"terminal" \| "git"`) + `migrateBottomDrawerTab` 신설 + `loadFromStorage` 에서 호출, ③ `CodeWorkbench.tsx` 주석 2건 정리, ④ `lite_w6_safety_net.test.ts` 의 SC2 `.todo` → 3 real assertions (problems→terminal / 유효값 보존 / unknown→terminal default), ⑤ `check-no-localstorage.mjs` ALLOWLIST 에 테스트 파일 추가 (테스트가 localStorage seed 함). `grep Problems` 결과 0 (frontend + backend). diagnostics.rs 는 `db_health` 만 노출하므로 무관 — 변경 없음. 5종 green 모두 통과 (vitest 6 pass + 2 todo). | no-op + 회귀 lock. SSOT 문서가 가정한 5개 flag 가 *코드베이스에 한 번도 구현된 적 없음* 확인 (`git log -S` 결과 Lite-update 문서 commit `a83060a` 외 0건). `src/__tests__/no_feature_flags.test.ts` 신설 — `KEYS` / `DEFAULTS` 에 `feature*` prefix 등장 시 fail. 07-checklist PR1 4 항목 ☑ 완료. 코드 변경 0건 / 신규 테스트 1개 (2 assertions). | clippy 48 errors → 0. 14 files 변경 / -58 net lines. 핵심 변경: ① `cargo clippy --fix` 로 28건 (useless_conversion 17 / needless_question_mark / unnecessary_map_or / unnecessary_cast / unnecessary_parens / for_kv_map / needless_borrow / 미사용 import 4 / unused mut 등) 자동 정리, ② `std::mem::transmute` 에 명시 타입 부여 (`db.rs:71`), ③ dead test helper `insert_session` (sync) + `_suppress_unused` 삭제 (`cache.rs`, await 누락 의심은 실제로 dead code 였음 — 호출자 0), ④ `let...else → ?` 1건 (`indexer.rs:412`), ⑤ `LlmError::MissingApiKey` 삭제 (구성·매치 모두 0), ⑥ `EMBEDDING_DIM` / `LlmProvider::name()` 에 `#[allow(dead_code)]` (의미 있는 API surface, 보존), ⑦ `#[allow(clippy::too_many_arguments)]` 12개 (refactor 가 PR-0c 범위 밖, `tauri::command` signature 는 IPC 계약이라 변경 불가). 5종 green 모두 통과. |

### 5.3 새 발견 / 결정 변경

| 일자 | 발견/변경 | 결정 | 영향 받은 § |
|---|---|---|---|
| 2026-05-29 | **vitest 미설치** 발견 (PR0 정찰) — `package.json` 에 test script + devDeps 모두 부재. master-prompt §7 가 `pnpm test` 를 green 5종에 포함했으나 인프라 자체 부재. | PR0 안에 vitest 4 + @testing-library/react 16 + jest-dom 6 + jsdom 29 도입 + `pnpm typecheck` / `pnpm test` / `pnpm test:watch` scripts 신설. | §7 (명령) 동기화 완료 |
| 2026-05-29 | **`pnpm lint` (`lint:storage`) pre-existing fail** — MigrationModal / ChangelogScreen / ProjectMetaHeader 3 파일이 ALLOWLIST 누락. | PR0 안에서 ALLOWLIST 3개 추가 (`a494d7a`). ChangelogScreen 라인은 PR4 cut 시 자동 제거. | — |
| 2026-05-29 | **`cargo clippy --all-targets -- -D warnings` pre-existing 48 errors** — `unnecessary_cast`, `unused_must_use` (cache.rs:2018 의 `.call(...)` 의 await 누락 가능성 있음), `unnecessary_map_or` 등 *style-only*. lib 컴파일이 fail 해서 `cargo clippy --test lite_w6_safety_net` 도 함께 fail. 내 PR0 코드 자체는 위반 0. | **PR-0c 로 분리** — 1.0 출시 전 별 PR 로 일괄 fix. PR0 의 DoD 중 `cargo clippy -- -D warnings` 는 PR-0c 종료 후 재검증. PR1~PR12 진행 중에는 `cargo clippy` 의 *내 새 코드* 만 확인 (lib 가 fail 해도 진행). | §7 (clippy 권장 명령 문구 추가 권장), 07-checklist (PR0 의 clippy 항목 ⚠ → PR-0c 의존), 본 §5.1 (PR-0c 추가) |
| 2026-05-29 | **`@vitejs/plugin-react` 가 이미 devDeps 에 있음** (^4.6.0). vitest infra 도입 시 추가 의존성 절약. | 그대로 재사용. | — |
| 2026-05-29 | **PR4 의 마이그레이션 008 번호 충돌 + DROP TABLE 시점 결정** — PR4 spec 은 "마이그레이션 008 (신규): DROP TABLE changelog_entries; ..." 를 요구하나 008 은 이미 `008_project_overview.sql` 로 점유 (W3-PR2). 또한 자동 실행 마이그레이션이 MigrationModal 진입 *전에* 테이블을 DROP 하면 v0.x 사용자 데이터가 소실됨. | **DROP TABLE 마이그레이션 = 1.1 로 연기**. 1.0 에서는 schema 그대로 보존. MigrationModal / LegacyDeleteModal / migrate_from_sqlite / delete_legacy_changelog flow 가 사용자 confirm 후 backup-and-truncate 를 수행 — 그 자체가 deletion 의 안전한 보수 경로. 7-checklist PR4 마지막 항목 "—" 로 표기. | §5.1 (PR4 ☑), 07-checklist PR4 |
| 2026-05-29 | **PR4 의 daily_brief 변환 시 frontend legacy 뷰 전체 의존** — DTO 필드 5개 (today_entries / pinned_entries / files_touched / lines_added / lines_removed) 가 TodayScreen 의 6 helper component + RecommendationCard 의 추천 텍스트 전부를 driving. journal-only 로 같은 데이터를 재합성하는 것은 PR4 의 범위 밖 (별도 PR9 의 "AI 패널 재배치 + 행 클리어 정책" 영역). | TodayScreen 의 legacy 뷰 전체 제거 (~184 lines). 사용자가 ocul-pm 비활성화 + 과거 날짜를 보는 edge case 는 비어 있게 됨 — 어차피 dogfood-friendly 한 경로 아님. 추후 PR9 가 새 surface 를 추가하면 자연스레 덮음. | 07-checklist PR4 |
| 2026-05-29 | **PR1 의 5개 feature flag 미존재** — `feature_changelog_v2` / `feature_overview_v2` / `feature_clarify` / `feature_greenfield_wizard` / `feature_new_ia` 가 `src/`, `src-tauri/src/`, `src-tauri/migrations/`, `.oculpm/config.toml` 어디에도 없음. `git log -S` 결과 Lite-update planning commit `a83060a` 외 0건. 즉 SSOT 가 *가정한* 구현이 존재하지 않음. 또한 PR1 spec 의 "마이그레이션 012" 는 이미 `012_oculpm_journal.sql` 로 점유됨 (W3-PR2). | PR1 → **no-op + 회귀 lock**. 코드/마이그레이션 변경 0. vitest 회귀 테스트 1개 (`src/__tests__/no_feature_flags.test.ts`) 로 `settings.ts KEYS` / `DEFAULTS` 의 `feature*` prefix 0 을 잠금. 향후 누구든 flag 신설 시 즉시 fail. | §5.1 (PR1 ☑), 07-checklist PR1 4 항목 모두 ☑ 으로 업데이트 |
| 2026-05-29 | **AGENTS.md 대상 파일은 `.oculpm/agents/_template.md`** — 본 프로젝트는 dogfood 대상이 아니므로 root `AGENTS.md` 가 없음 (의도). 강화 5 항목은 `_template.md` 에 작성. | 동의. | — |
| 2026-05-29 | **frontmatter parser 의 closing fence 인식** — `---` 가 column 0 이 아니면 인식 안 됨. invariant_03 test case D 작성 시 발견 (raw string 으로 수정). | invariant_03 test 가 lock. *외부 LLM 이 frontmatter 작성 시 `---` 의 leading whitespace 금지* — `_template.md` 에 별도 명시 권장 (1.0 backlog). | — |

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
