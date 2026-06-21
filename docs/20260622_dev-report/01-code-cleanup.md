# 01 — 코드 정리 (레거시 / 죽은 코드)

> 모든 항목은 적대적 grep 검증을 통과했다. "삭제 안전도"는 검증 에이전트의 `safeToDelete` 판정이다.
> `bindings.ts`(자동 생성), `dist/`(gitignore), `git::read_changelog`(살아있는 마크다운 리더) 등 오탐은 제외했다.

## 0. 핵심 인식 — 죽은 코드는 두 종류다

| 종류 | 의미 | 처리 |
|---|---|---|
| **순수 폐기물** | 후속 버전이 대체해 더는 쓰지 않는 코드 | **삭제** |
| **미완성 기능** | 백엔드/로직은 완성됐으나 UI 가 안 붙어 호출처가 0 | **재활성화 후보 — 삭제 금지** (→ `03-next-features.md`) |

특히 백엔드 "고아 커맨드"는 이 둘이 섞여 있어 **분류가 핵심**이다(§3).

---

## 1. 프런트엔드 — 즉시 삭제 가능

### 1-A. `src/legacy/**` 전체 (35개 파일, 11,827줄)

`tsconfig.json:30`(`"exclude": ["src/legacy/**"]`), `vitest.config.ts`, `scripts/check-no-localstorage.mjs:62` 모두에서 제외돼 **앱에 컴파일·번들되지 않는다.** 활성 진입점(`main.tsx`→`App.tsx`→`ShellV2.tsx`)에서 import 0건. 일부 파일은 이미 존재하지 않는 경로를 import 해서(예: `SidePanel.tsx → "./Icons"`, `CodeEditor.tsx → "../lib/bindings"`) 재포함하면 **컴파일조차 안 된다** — 방치 증거.

| 하위 영역 | 줄 수 | 대체된 곳 | 삭제 안전도 |
|---|---:|---|---|
| `legacy/oculpm/` (구 저널·타임라인) | 3,070 | `features/oculpm` + `features/today` | ✅ 안전 |
| `legacy/projects/` (SQLite 마이그레이션 UI) | 1,629 | (마이그레이션 자체는 §3 참조) | ✅ 안전 |
| `legacy/code/` (구 그래프 UI) | 1,547 | `features/graph` | ✅ 안전 |
| `legacy/planner/` (구 goals/subtasks 칸반) | 1,287 | `features/planner` (PlannerScreenV2) | ✅ 안전 |
| `legacy/overview/` (개요 화면 + 5위젯) | 935 | Today/콕핏 | ✅ 안전 |
| `legacy/diff/LocalDiffView.tsx` | 676 | `features/diff` (`diffParse.ts`로 로직 분리됨) | ✅ 안전 |
| `legacy/git/GitPanel.tsx` | 646 | (없음 — 화면 자체 제거) | ✅ 안전 |
| `legacy/today/TodayScreen.tsx` | 469 | `features/today` | ✅ 안전 |
| `legacy/{SidePanel,CodeEditor,TerminalDock}.tsx` | 1,089 | ui_v2 화면들 | ✅ 안전 (이미 깨진 import) |
| **`legacy/FileExplorer.tsx`** | 479 | — | ⚠️ **테스트 1개가 의존 → 이전 필요** |

### 1-B. ⚠️ 유일한 걸림돌: `FileExplorer.tsx` 의 순수 헬퍼 2개

`src/__tests__/lite_w6_safety_net.test.ts:23` 이 `@/legacy/FileExplorer` 에서 `flattenVisibleNodes`/`nextFocusedPath`(둘 다 React 무의존 순수 함수)를 import 해 11개 케이스로 실제 실행한다(42 passed / 3 todo). **이 테스트 파일은 `src/__tests__/` 에 있어 vitest exclude 가 안 먹는다** → 폴더를 그냥 지우면 `pnpm test` 가 깨진다.

**삭제 절차:**
1. `flattenVisibleNodes`(FileExplorer.tsx:55), `nextFocusedPath`(:88), 관련 타입(`FlatNode`/`ChangeOp`)을 `src/features/code/fileTreeNav.ts`(신규)로 이전.
2. 테스트의 import 를 `@/features/code/fileTreeNav` 로 재배선.
3. 영구-todo 스텁 3개(SC1/SC2/SC3)와 빈 describe 블록(`lite_w6_safety_net.test.ts:42-59`) 제거.
4. `src/legacy/**` 전체 삭제.

### 1-C. 비-legacy 활성 트리의 죽은 코드 (~1,800줄)

| 항목 | 경로 | 줄 수 | 근거 | 안전도 |
|---|---|---:|---|---|
| `TitleBar.tsx` + `GitBranchChip.tsx` | `src/components/` | 241 | PR-UI 7 에서 상단 크롬 제거됨, import 0 (GitBranchChip 은 TitleBar 만 씀 → 연쇄 사망) | ✅ |
| `TerminalPanel.tsx` (구 PiP 패널) | `src/features/terminal/` | 463 | `TerminalScreenV2`+`TerminalInstance` 로 대체. **legacy 로 옮겨지지 않은 채 활성 트리에 남음.** raw localStorage 사용(린트 우회) | ✅ |
| `overview/api.ts` (`fetchOverviewStats`) | `src/features/overview/` | 18 | 소비자 0. Today 는 `commands.oculpmOverviewStats` 직접 호출. 폴더째 제거 가능 | ✅ |
| `planner/hooks.ts` (`useGoals`/`useSubtasks`) | `src/features/planner/` | 42 | PlannerScreenV2 가 import 안 함. (단, `useNextTasks`가 §02 의 죽은 SQLite 경로로 일부 사용 — 02 문서 참조) | ✅ |
| 미사용 shadcn primitive 7개 (badge·card·dialog·popover·progress·select·tabs) | `src/components/ui/` | 720 | 참조가 전부 `src/legacy/` 안. 손수 짠 Tailwind UI 가 채택 안 함 | ✅ (shadcn 라이브러리로 유지할 거면 보류) |
| `src/locales/ko.json` (i18n 스캐폴드) | `src/locales/` | 111 | i18n 라이브러리 없음·`useTranslation` import 0. 한국어 하드코딩. "향후용" 플레이스홀더 | ✅ |
| `lib/theme.tsx` `ThemeProvider` (no-op) | `src/lib/` | 4 | 사용처 0. `useTheme`(같은 파일)는 살아있으니 그 export 만 제거 | ✅ |
| `lib/settings.ts` `resolveModel()` | `src/lib/` | 6 | 호출처 0. `providerModel` 로 대체됨 | ✅ |
| `lib/todayNavigate.ts` | `src/lib/` | 57 | import 6건이 전부 `src/legacy/` → legacy 삭제와 함께 제거 | ✅ |
| WorkspaceContext 죽은 조각: side-panel-width 서브시스템·`openDiffFor`/`consumeDiffTarget`·`setActiveView`/`setWorkdayKey`/`clearRecentChanges` | `src/contexts/WorkspaceContext.tsx` | ~60 | PR-UI 7 패널 제거 잔재. 활성 caller 0(legacy/테스트만). **단 영속 상태 마이그레이션 normalizer 는 유지** | ✅ (조각별) |
| `SettingsContext.setMany` | `src/contexts/SettingsContext.tsx` | 9 | 외부 호출 0 (완성된 미사용 public API) | ✅ |
| 코드-에디터 settings 그룹 + `uiDensity` | `src/lib/settings.ts`, `SettingsPanel.tsx` | ~40 | 유일 소비자가 legacy `CodeEditor.tsx`. **UI 컨트롤이 살아있으나 아무 동작 안 함(사용자 오인 유발)** → 제거 또는 실 에디터 복원 | ⚠️ 결정 |

> 주의: `diffParse.ts` 의 `DiffLineKind`/`DiffHunk` 타입은 외부 참조가 없어 보이지만 **파일 내부에서 load-bearing** 이다(삭제 금지, `export` 만 떼는 건 선택).

---

## 2. 의존성 정리

### npm (`package.json`)
| 패키지 | 판정 | 비고 |
|---|---|---|
| `@fontsource-variable/geist` | ❌ **삭제** | 어디서도 import 0 (Inter/EB Garamond 만 사용) |
| `recharts` | ❌ legacy 와 함께 삭제 | `legacy/planner/Dashboard.tsx` 에서만 |
| `date-fns` | ❌ legacy 와 함께 삭제 | `legacy/planner/CalendarView.tsx` 에서만 |
| 그 외 28개 런타임 + 17개 dev | ✅ 유지 | `highlight.js`↔`rehype-highlight` 비중복, `prettier`↔`@wasm-fmt/*` 상보적 — 검증 완료 |

### cargo (`src-tauri/Cargo.toml`)
| 크레이트 | 판정 | 비고 |
|---|---|---|
| `gray_matter` | ❌ **삭제** | frontmatter 는 `serde_yaml` 직접 사용. 사용처 0 |
| `fs2` | ❌ **삭제** | 락은 커스텀 JSON+heartbeat. 사용처 0 |
| `slug` | ⚠️ 보류 | 마이그레이션 shim(`migrate_from_sqlite.rs:842`)에서만. shim 운명에 종속(§3) |

### 에셋 / 잡동사니
- ❌ `public/tauri.svg`, `public/vite.svg`, `src/assets/react.svg` — create-tauri-app 스캐폴드 잔재. (`public/icon.svg` 는 유지)
- ❌ `.agent/rules/` — 빈 디렉토리(untracked). 단 `.agent` 문자열은 antigravity 감지 마커라 코드 참조는 별개.

---

## 3. 백엔드 — 고아 커맨드 분류 (★ 핵심 산출물)

`lib.rs` 의 `collect_commands![...]` 에 등록(=`bindings.ts` 생성)됐으나 **활성 프런트 호출처가 0**인 `#[tauri::command]` 들. 호출처가 `src/legacy/`(제외됨) 또는 `bindings.ts`(자동 생성)뿐이면 고아다.

### 3-A. ❌ 삭제 (순수 폐기물·후속 대체)
| 커맨드(군) | 파일 | 대체/사유 |
|---|---|---|
| `minimize_window`·`toggle_maximize_window`·`close_window`·`open_ai_window` | `commands/window.rs` | 미사용. `open_ai_window` 는 인-앱 AI 패널 아키텍처와 모순. (`open_devtools`·`open_terminal_window` 는 유지) |
| `get_dependency_graph` | `commands/project.rs` | 새 코드 맵(`get_code_graph`)이 대체 |
| `goal_get`·`dashboard_stats` | `commands/planner.rs` | 구 SQLite 플래너 잔재(`dashboard_stats`는 테스트 mock 만 참조) |
| `generate_edit_prompt`·`detect_file_changes`·`list_file_changes` | `commands/project.rs` | `generate_edit_prompt_with_answers`(Clarify 흐름)로 대체 |
| `list_project_files`·`list_project_tree`·`write_project_file` | `commands/project.rs`·`project_tree.rs` | UI 에 파일 브라우저/에디터 없음. `write_project_file`(쓰기 가능 고아)는 우선 제거 |
| `get_current_session`·`get_index_snapshot`·`watcher_status` (커맨드 레이어) | `commands/oculpm.rs` | 소비자 0. **manager 메서드는 내부 사용되니 유지**, 커맨드+`oculpmApi` 래퍼만 제거 |
| `oculpm_observed_agent_ids` | `commands/oculpm.rs` | agent-id 필터 드롭다운 미존재. id 는 `JournalEntrySummary`에 동봉됨 |
| `git_remotes`·`git_tags`·`git_log_range`·`read_changelog`(git)·`github_releases` | `commands/git.rs` | 릴리스는 프런트 `fetch()` 로 재구현됨. 호출처 전부 legacy `GitPanel.tsx` |

### 3-B. ⚠️ 재활성화 후보 — 삭제 금지 (UI 만 없는 완성 기능)
| 커맨드(군) | 파일 | 연결될 제안 (→ 03 문서) |
|---|---|---|
| `oculpm_compare_layers` | `commands/oculpm.rs` + `manager.rs` | **F2 정직성 감사** (index ground-truth vs 일지 narrative) |
| `oculpm_set_journal_verified`·`update_entry_meta`·`update_entry_body` | `commands/oculpm.rs` | **검토 세션 / 인라인 편집** (verified_by_user 루프 미도달) |
| `generate_seed_goals` | `commands/greenfield.rs` | **그린필드 AI 목표** (지금은 하드코딩 폴백만 씀) |
| `get_project_overview`·`generate_project_overview`·`refresh_project_overview_if_stale`·`update_project_overview` | `commands/overview.rs` | **F4 회고/인사이트** (LLM 개요 파이프라인 완성돼 있음) |
| `reindex_paths`·`resnapshot_paths` | `commands/diff.rs` | diff baseline 재설정 (live 화면이 baseline 을 안 올림 — 결정 필요) |

> `get_today_brief`/`get_today_highlights` 는 설계만 있고 **미구현**(Today 가 프런트에서 7+N 콜로 집계). → **F3/백엔드 집계 명령**으로 신규 구현 권장.

### 3-C. ⚠️ 결정: 일회성 마이그레이션 shim 은퇴
`migrate_from_sqlite.rs`(**1,911줄**) + 마이그레이션 커맨드 6개 + `007_changelog.sql` 잔재 + `slug` 크레이트는 v0.x SQLite changelog → `.oculpm` 일회성 업그레이드 경로다. **백엔드는 완전히 배선돼 있으나 UI 는 죽은 `legacy/projects/` 에만** 있어 사용자가 도달 불가. writer 는 이미 은퇴(테이블은 read-only). 통합 테스트(`tests/oculpm_migration.rs`)는 살아있다.

- **선택지 A (권장)**: 버전/행-존재 게이트 뒤로 최소 진입점만 남기고, "v0.x 에서 올라오는 사용자 없음"이 확실해지는 시점에 일괄 제거(테이블 DROP 마이그레이션 포함).
- **선택지 B**: 지금 제거 — 단 구버전 사용자 데이터 손실 위험을 감수.
- `migrate_from_sqlite.rs` 의 모듈 레벨 `#![allow(dead_code)]` 는 진짜 미사용을 가린다 → 유지하더라도 blanket allow 는 제거하고 컴파일러가 잡게 할 것.

### 3-D. ⚠️ 주의: 함부로 삭제 금지
- `oculpm_open_entry_in_editor` — 호출처가 legacy 뿐이라 고아로 보이지만, **메모리 노트(opener scope 재발 패턴)의 문서화된 사용자 선호와 충돌.** "일지 에디터로 열기" 버튼이 회귀로 사라진 것인지부터 확인 후 결정.

---

## 4. Rust 코어 죽은 코드 + 위생

| 항목 | 경로 | 처리 |
|---|---|---|
| `LlmProvider::name()` (trait + 4 impl) | `llm/mod.rs`(+4) | ❌ 삭제. 유일한 함수 레벨 `allow(dead_code)` |
| `embedding::EMBEDDING_DIM` 상수 | `embedding.rs` | ❌ 삭제(doc 주석에서만 참조) 또는 실제 길이 assert 에 사용 |
| `agents::lookup_adapter` (by-id) | `oculpm/agents/mod.rs` | ❌ 삭제. `lookup_adapter_by_path` 로 대체 |
| `agents::_absolute_for_test` | `oculpm/agents/mod.rs` | ❌ 삭제. 부르는 테스트조차 없음 |
| `OculpmError::NotImplemented` variant | `oculpm/error.rs` | ❌ 삭제(생성처 0) |
| `IndexWriter::with_emit_ctx` + emit 머신 | `oculpm/index.rs` | ⚠️ 결정: 인덱싱 중 ndjson 손상 토스트로 **배선**하거나 제거(현재 emit_ctx 항상 None → 무음) |
| 테스트 전용 `pub fn`: `PathResolver::plan_path`·`SessionActor::force_boundary_fired` | `paths.rs`·`session.rs` | `pub` 제거 / `#[cfg(test)]` 게이트 |
| 단계개발 잔재 `#![allow(dead_code)]` 17개 (W1/W2/W4/W5 PR 참조) | `oculpm/*` 다수 | ⚠️ **위생 패스**: 이미 완전 배선된 모듈(`redact.rs`·`manager.rs`·`watcher.rs` 등)의 blanket allow 제거 → 컴파일러가 진짜 잔재만 표시 |

> `redact.rs:22` 주석 "not yet consumed (W5)" 는 **사실과 다르다** — `planner/project.rs:205` 가 이미 호출 중. 문서-로트(rot)이며, 동시에 §02 의 "일지·diff 경로엔 여전히 미연결"이라는 핵심 부채를 가리킨다.

---

## 5. 정리 효과 요약

| 구분 | 규모 | 위험 |
|---|---:|---|
| 프런트 즉시 삭제 (legacy + 비-legacy) | ~13,600줄 | 낮음 (헬퍼 1회 이전 후) |
| 백엔드 삭제 (3-A 고아 커맨드 + Rust 코어) | ~1,500줄 | 낮음 |
| 마이그레이션 shim 은퇴 (3-C) | ~2,100줄 | 중 (버전 게이트 결정 필요) |
| npm 3 + cargo 2 의존성 | — | 낮음 (`pnpm install`/`cargo build` 재생성) |

**부수 효과(정성적):** legacy 11.8k줄 제거는 의미 검색·AI 컨텍스트·grep 노이즈를 크게 줄여 — 이 보고서를 만든 분석조차 "legacy 인지 아닌지" 판별에 상당 비용을 썼다. 도그푸딩 품질이 직접 개선된다.
