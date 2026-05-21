# `.oculpm/` 전환에 따른 정리 대상 — 분석

> 참조: [`00-spec.md`](./00-spec.md), [`phases/W5-migration-overview.md`](./phases/W5-migration-overview.md), [`phases/W6-stabilize-dogfood.md`](./phases/W6-stabilize-dogfood.md)
> 작성일: 2026-05-22 · 대상 코드: 본 ai-pm 레포 현재 main

---

## 0. 분류 체계

| 카테고리 | 의미 | 시점 |
|---|---|---|
| **DELETE** | `.oculpm/` 으로 100% 대체. 신규 데이터 안 들어가고, 기존 데이터는 마이그레이션으로 옮긴 뒤 즉시 제거 가능 | **W5 중**, 마이그레이션 검증 직후 같은 PR 묶음에서 제거 |
| **DEPRECATE** | 기능은 살아있지만 UI 에서 안 보이고, 1.0 까지는 read-only 로만. **1.1 (다음 라운드) 에서 진짜 삭제** | W5 종료 시 사용자 노출 차단, **1.1** 에서 코드 제거 |
| **REPLACE** | 화면/모듈의 껍데기는 유지, 내용은 전면 교체 | W3 또는 W5 |
| **KEEP** | `.oculpm/` 과 직교한 다른 관심사. 손대지 말 것 | — |
| **GRAY** | 공유 자원이라 잘못 건드리면 다른 기능까지 깨짐. 분리 후 결정 | W3 이전에 분리 PR |

각 항목의 "위험도" 는: **낮음** (다른 화면에 영향 없음) / **중간** (UI 회귀 가능) / **높음** (데이터/공유 인프라).

---

## 1. DELETE — `.oculpm/` 으로 완전 대체

### 1.1 `commit_changelog_entry` 커맨드 + Save-to-Changelog 워크플로우

- **경로**: `src-tauri/src/commands/changelog.rs::commit_changelog_entry` (494줄짜리 파일의 약 250줄)
- **프론트 결합**: `src/features/code/AiWorkbench.tsx::handleSaveToChangelog` (`AiWorkbench.tsx:258`)
- **무엇이 대체**: 외부 LLM 어댑터가 `.oculpm/journal/.../HHMM_<type>_<slug>.md` 를 직접 작성. 사용자가 버튼을 누를 일 자체가 없어짐.
- **위험도**: **중간** — AiWorkbench 의 "오늘 변경사항" 패널과 결합돼 있어서 함께 들어내야 함 (다음 항목과 묶기).
- **삭제 시점**: W5-PR8 (회귀 점검 PR) 안에 묶어 제거.

### 1.2 `detect_file_changes` / `list_file_changes` 커맨드 + "오늘 변경사항" 패널

- **백엔드 경로**: `src-tauri/src/commands/project.rs:415` (`detect_file_changes`), `:509` (`list_file_changes`).
- **프론트 경로**: `AiWorkbench.tsx:182` (`listFileChanges`), `AiWorkbench.tsx:252` (`handleScan` → `detectFileChanges`).
- **무엇이 대체**:
  - 자동 감지: W2 의 `notify` 기반 워처 + `index/<today>/file_changes.ndjson`.
  - UI 비교: DiffVsNarrative (`02-frontend.md §7`).
- **왜 죽는가**: 지금은 사용자가 "Scan" 버튼을 눌러야 백엔드가 디렉토리를 전수 hash 비교해서 file_changes 테이블을 갱신하는 **수동 폴링** 방식. 워처가 들어오면 폴링이 무의미.
- **위험도**: **중간** — `db::clean_duplicate_file_changes`, `db::get_file_hash`, `db::refresh_file_hash` 같은 헬퍼들이 이 흐름 전용이라 함께 제거. 단, `db::upsert_file` 은 **indexer 와 공유** (§5.1 참조) — 함부로 못 지움.
- **삭제 시점**: W2-PR3 (워처 도입 PR) 에서 detect_file_changes 를 "no-op" 으로 만들고, W5-PR8 에서 완전 제거.

### 1.3 SQLite `file_changes` 테이블

- **마이그레이션 경로**: `src-tauri/migrations/006_file_changes.sql`
- **대체**: `index/<workday>/file_changes.ndjson` (append-only, per-workday).
- **위험도**: **낮음** — 외부 결합 없음. `changelog_files` 와 다른 테이블 (혼동 주의).
- **삭제 시점**: W5-PR7 ("구 데이터 삭제") 의 truncate 대상에 포함.

### 1.4 `daily_brief` 커맨드 + `DailyBrief` 타입

- **경로**: `src-tauri/src/commands/overview.rs:418-530`
- **프론트 결합**: `TodayScreen.tsx:45` (`commands.dailyBrief`)
- **무엇이 대체**: 새 Today 가 `oculpm_list_journal_entries` + `oculpm_list_sessions` + planner 의 `goal_list` 를 직접 조합. 백엔드 합성 쿼리 불필요.
- **부가 영향**:
  - `today_entries`, `files_touched`, `lines_added`, `lines_removed` 통계 → `.oculpm/index/` 의 `file_changes.ndjson` 집계로 대체.
  - `focus_goals`, `completed_today`, `pinned_entries` 는 다른 데이터 소스 (planner, journal). 새 TodayScreen 이 직접 fetch.
- **위험도**: **중간** — `TodayScreen` 의 단일 통합 데이터 소스가 사라지므로 W3-PR4 에서 신규 fetch 경로 동시 도입 필수. **새 코드와 구 코드를 같은 PR에서 swap** 하는 게 안전.
- **삭제 시점**: W3-PR4 에서 호출 제거, W5-PR8 에서 백엔드 코드 제거.
- **메모**: `DailyBrief.date_unix` 의 `i32` 제약은 specta BigInt 이슈 (`docs/2026521/Errors/2026-05-21-specta-bigint-export.md`) 에서 나온 흔적 — 어차피 죽일 코드라 더 손볼 가치 없음.

### 1.5 AiWorkbench 의 "오늘 변경사항" 패널 (UI 영역)

- **경로**: `src/features/code/AiWorkbench.tsx` 의 fileChanges/setFileChanges 관련 약 100줄
- **대체**: Today 의 SessionCard → DiffVsNarrative 가 같은 정보를 더 정확히 보여줌.
- **AiWorkbench 의 남은 역할**: Chat + QuickEdit (편집 워크플로우). 이건 KEEP.
- **위험도**: **낮음** — AiWorkbench 의 Chat/QuickEdit 코어와 충분히 분리 가능.
- **삭제 시점**: W3-PR6 (TimelineView 도입) 직후, AiWorkbench 에서 패널 코드 떼어내는 별도 PR.

### 1.6 `read_changelog` 의 LLM-읽기 헬퍼

- **경로**: `src-tauri/src/commands/changelog.rs::read_changelog`
- **무엇이 대체**: LLM 에이전트가 자기 작업 컨텍스트로 과거 결과를 참고하고 싶다면 어댑터가 `.oculpm/journal/` 의 마크다운을 직접 읽으면 됨. 별도 커맨드 불필요.
- **위험도**: **낮음** — 외부 LLM 만 호출. 프론트 결합 거의 없음.
- **삭제 시점**: W5-PR8.

---

## 2. DEPRECATE — 1.0 까지 read-only, 1.1 삭제

> 1.0 출시 후 마이그레이션이 성공한 사용자만 남은 시점에 진짜로 들어낸다. 1.0 안에서는 "구 데이터 보기" 정도로 살아있어야 사용자가 안심하고 마이그레이션함.

### 2.1 `ChangelogScreen` 화면 전체

- **경로**: `src/features/changelog/ChangelogScreen.tsx`, `EntryDetail.tsx`, `DiffModal.tsx`, `util.tsx`
- **App.tsx 결합**: `App.tsx:15`, `App.tsx:573`
- **W5 동작**: 마이그레이션 직후 화면 상단에 노란 deprecated 배너 + read-only 모드. write 액션 (pin, update, delete) 모두 disable.
- **1.1 동작**: 사이드바에서 제거. 사용자가 백업 폴더의 SQLite 덤프를 원하면 별도 export 도구 제공.
- **위험도**: **낮음** (UI 만 변경).

### 2.2 changelog 관련 read 커맨드 5개

- `list_changelog`, `get_changelog_detail`, `list_changelog_by_day`, `export_changelog_markdown`, `read_changelog`
- **경로**: `src-tauri/src/commands/changelog.rs`
- **W5 동작**: 빈 결과 또는 deprecation warning 헤더와 함께 응답. 호출 가능.
- **1.1 동작**: 코드 자체 삭제.

### 2.3 changelog 관련 write 커맨드 3개

- `update_changelog`, `delete_changelog`, `pin_changelog`
- **W5 동작**: 모두 `Err("Changelog 시스템은 더 이상 쓰기를 지원하지 않습니다. .oculpm/journal/ 을 사용하세요.")` 반환.
- **1.1 동작**: 코드 삭제.

### 2.4 SQLite `changelog_entries`, `changelog_files` 테이블

- **W5 동작**: read-only 보존.
- **1.1 동작**: drop 마이그레이션 (`010_drop_legacy_changelog.sql`).
- **단**: 사용자가 `oculpm_delete_legacy_changelog` 를 명시적으로 호출한 경우 W5 안에서도 truncate. 그래도 테이블 자체는 1.1 까지 남김 (다른 코드의 SELECT 가 깨지지 않도록).

### 2.5 `external_tool` 컬럼 (changelog_entries 안의 단일 컬럼)

- **무엇이 대체**: `.oculpm/journal/` frontmatter 의 `agent.id`.
- **마이그레이션**: W5 의 변환 코드가 `external_tool` → `agent.id` 로 옮김.
- **삭제 시점**: 2.4 와 함께 1.1 의 drop 마이그레이션.

---

## 3. REPLACE — 껍데기 유지, 내용 전면 교체

### 3.1 `TodayScreen.tsx`

- **현재** (`src/features/today/TodayScreen.tsx`, 100여 줄): `daily_brief` 한 번 fetch → 4 영역 표시기.
- **W3 이후**: TimelineView + CategoryFilterBar + DetailPane + EmptyToday + Empty 3변형 + 키보드 단축키.
- **이름 보존 이유**: App.tsx 의 import 경로를 안 깨고 점진적으로 이전.
- **메모**: 현재 TodayScreen 의 "어제 보기" (dayOffset) 기능은 새 화면이 더 풍부하게 (workday 선택기) 흡수. 데이터 추가 fetch 만 필요.

### 3.2 `OverviewScreen.tsx`

- **현재**: 프로젝트 메타 (stack, identity, generated overview).
- **W5 이후**: 4 위젯 (ActivityHeatmap, DifficultyMix, AgentBreakdown, UnfinishedChecklist) + RecentSessions 표.
- **현재 화면이 보여주던 "프로젝트 메타" 처리**: **확정 — 옵션 A**. 새 Overview 헤더 박스에 1줄 요약 + 더보기 토글로 통합. (W5-PR5 명세에 박힘.)
- **`generate_project_overview` 등 커맨드**: KEEP. 단지 표시 위치만 바뀜.

---

## 4. KEEP — 손대지 말 것 (확실히 다른 관심사)

| 영역 | 경로 | 이유 |
|---|---|---|
| **Planner** | `commands/planner.rs`, `features/planner/*` | Goal/Subtask 시스템은 작업 관리, journal 은 작업 기록. 별개 차원. 새 Today 가 `focus_goals` 를 fetch 해서 한 줄로 표시. |
| **Conversations / Chat** | `commands/conversation.rs`, `commands/llm.rs::chat*`, `features/chat/ChatPanel.tsx` | LLM 채팅. ocul-pm 과 직교. |
| **AI 편집 워크플로우** | `commands/project.rs::{generate_edit_prompt, generate_edit_prompt_with_answers, clarify_edit_intent}`, `features/code/{ClarifyDialog,AiWorkbench의 QuickEdit 부분}` | 코드 편집 보조. journal 작성과 다른 흐름. |
| **Project Overview 생성** | `commands/overview.rs::{get_project_overview, generate_project_overview, refresh_project_overview_if_stale, update_project_overview}` | 프로젝트 정체성/스택 분석. **`daily_brief` 만 죽고 나머지는 산다**. |
| **Indexer / Semantic Search** | `indexer.rs`, `commands/project.rs::{index_project, clear_project_index, search_chunks, get_dependency_graph, get_file_symbols, list_project_files, read_project_file, write_project_file}`, `ast.rs`, `embedding.rs` | AI 의미 검색용 chunk 인덱싱. 우리 워처와 완전 별개. |
| **Terminal (PTY)** | `commands/terminal.rs`, `features/terminal/TerminalPanel.tsx` | 별개. |
| **Settings / Secrets** | `commands/config.rs`, `secrets.rs`, `features/settings/SettingsPanel.tsx` | 별개. |
| **Git / GitHub** | `git.rs`, `github.rs`, `commands/git.rs`, `features/git/GitPanel.tsx` | 별개. |
| **CommandPalette, ModelSelector, FileExplorer, CodeEditor, Markdown, TitleBar** | `src/components/*` | UI 공통. 단지 새 명령/타입 추가로 확장. |
| **Diagnostics** | `commands/diagnostics.rs` (9줄, `db_health` 하나) | 유지. |

---

## 5. GRAY AREA — 공유 자원, 분리 후 결정

### 5.1 ⚠ SQLite `files` 테이블 + `db::upsert_file`, `get_file_hash`, `refresh_file_hash`

- **두 곳에서 쓴다**:
  - **indexer (`project.rs::index_project`)**: 의미 검색 chunk 생성 시 "이 파일이 마지막 인덱싱 이후 바뀌었나?" 판단용. `hash` 비교로 skip.
  - **detect_file_changes (`project.rs::detect_file_changes`)**: 사용자가 Scan 누를 때 file_changes 테이블 갱신용.
- **그러므로**:
  - **테이블 자체는 유지**. indexer 가 계속 사용.
  - **`refresh_file_hash` (commit_changelog_entry 가 마지막에 호출)** 는 detect_file_changes 흐름 전용이므로 그 흐름과 함께 삭제 가능.
  - **`delete_file_changes_for_paths`** 는 file_changes 테이블이 사라지면 의미 없음 — 같이 삭제.
  - **`upsert_file`, `get_file_hash`** 는 indexer 가 쓰니까 유지.
- **위험도**: **높음** — 잘못 지우면 indexer 깨짐.
- **권장 분리 PR (W2-PR0)**:
  1. `db::{refresh_file_hash, delete_file_changes_for_paths, clean_duplicate_file_changes}` 를 `db::legacy_changelog` 모듈로 이동 (그냥 분류 의도 표시).
  2. indexer 가 쓰는 `upsert_file`/`get_file_hash` 는 `db::index` 모듈로.
  3. 이러면 W5 의 삭제 PR 이 안전하게 `db::legacy_changelog` 만 통째로 들어낼 수 있음.

### 5.2 ⚠ AiWorkbench 의 코어 vs 패널

- **AiWorkbench 안에 두 가지가 섞임**:
  - Chat + QuickEdit 모드 토글, provider/model 셀렉터 → **KEEP**.
  - "오늘 변경사항" 스캔 + Save-to-Changelog 패널 → **DELETE** (§1.5).
- **권장 분리**: W3-PR6 직전에 AiWorkbench 를 두 파일로 쪼개는 별도 정리 PR.
  - `AiWorkbench.tsx` → AI 코어만 유지.
  - 패널 부분은 새 컴포넌트 (예: `TodayChangesPanel.tsx`) 로 임시 분리 → 다음 PR 에서 통째로 삭제.

### 5.3 ⚠ `record_conversation_action` / `list_conversation_actions`

- **경로**: `commands/conversation.rs`
- **목적**: 사용자가 채팅 답변에 어떤 액션 (코드 적용, 무시 등) 을 취했는지 기록.
- **`.oculpm/` 과 겹치나?**: 부분적. journal entry 가 "어떤 채팅에서 비롯됐는지" 를 `related` frontmatter 로 연결할 수 있다면, conversation_actions 의 일부 가치를 흡수.
- **현재 결정**: **KEEP** (1.0). 1.1 에서 통합 여부 재검토. 우선 건드리지 않음.

### 5.4 ⚠ `commands/git.rs::git_status, git_log, git_log_range, git_remotes, git_tags`

- **journal 의 `files_touched` 와 의미 중복?**: 약간 — git diff 도 변경 파일을 안다.
- **그러나 다른 차원**:
  - git = 커밋 기준의 영구 기록.
  - journal = 세션 기준의 작업 narrative.
- **결정**: **KEEP**. GitPanel 의 가치는 유지 (브랜치/태그/원격 보기). journal 과 git 을 묶는 건 1.1 의 향후 작업.

---

## 6. 삭제 / 정리 순서 (PR 단위)

페이즈와 매핑한 단일 시퀀스:

```
W1
  └─ (정리 작업 없음 — 새 인프라만 추가)

W2-PR0  [정리]  db 모듈 분리: db::legacy_changelog, db::index (§5.1)
W2-PR3  [기능]  워처 도입 — 동시에 detect_file_changes 를 deprecation 경고 추가
                (실제 동작은 유지, 로그에 "deprecated, use .oculpm/" 만)

W3-PR0  [정리]  AiWorkbench 쪼개기: TodayChangesPanel.tsx 로 패널 분리 (§5.2)
W3-PR4  [기능]  새 Today 가 .oculpm/ 소스를 fetch. 동시에 daily_brief 호출 제거.
                daily_brief 자체는 살아있지만 호출자가 사라짐.

W4
  └─ (정리 작업 없음 — 어댑터/비교 기능 추가)

W5-PR1~7  [기능]  마이그레이션 실행 가능
W5-PR8    [정리]  대대적 정리 (DELETE 카테고리 전체):
   - commit_changelog_entry, detect_file_changes, list_file_changes 백엔드 제거
   - daily_brief, DailyBrief 제거
   - file_changes 테이블 truncate (사용자가 oculpm_delete_legacy_changelog 호출 시)
   - read_changelog 제거
   - TodayChangesPanel 컴포넌트 통째 삭제
   - db::legacy_changelog::{refresh_file_hash, delete_file_changes_for_paths, clean_duplicate_file_changes} 제거

W5-PR9    [정리]  DEPRECATE 카테고리 진입:
   - ChangelogScreen 상단 노란 배너 + write 액션 disable
   - changelog read 커맨드들에 deprecation 헤더
   - changelog write 커맨드 3개 에러 반환으로 변경

W6
  └─ (정리 작업 없음 — 안정화)

1.1 (다음 라운드)  DEPRECATE 카테고리 완전 제거:
   - ChangelogScreen + entry/diff/util 4 파일 삭제
   - changelog read/write 커맨드 8개 코드 삭제
   - migration 010_drop_legacy_changelog.sql
   - external_tool 컬럼 삭제
```

---

## 7. 위험도가 가장 높은 3개 — 추가 안전장치

### 7.1 §5.1 의 `files` 테이블 공유

- **대비**: W2-PR0 분리 PR 의 단위 테스트에서 indexer 라운드트립 1개 추가. 회귀 즉시 발견.
- **추가 보호**: W6-PR6 의 통합 테스트에 "index_project → search_chunks 응답" 시나리오.

### 7.2 §1.4 의 daily_brief 교체 시 데이터 공백

- **대비**: W3-PR4 에서 같은 PR 안에 신규 fetch 코드와 구 fetch 제거를 함께. **두 PR 로 쪼개지 말 것** — 중간 시점에 Today 가 빈 화면이 됨.

### 7.3 §2.4 의 SQLite 테이블 보존

- **대비**: drop 마이그레이션은 1.1 까지 절대 금지. 1.0 안에서는 truncate 까지만 (사용자 명시 컨펌).
- **추가 보호**: `010_drop_legacy_changelog.sql` 의 첫 줄에 "이 파일은 1.1 의 PR 에서만 추가될 수 있음" 주석.

---

## 8. 한 화면 요약 — 무엇을 언제 지우는가

```
┌─────────────────────────────────────────────────────────────────────┐
│  W2  │ db 모듈 분리 (정리)                                          │
│      │ + detect_file_changes 에 deprecation 경고                     │
├─────────────────────────────────────────────────────────────────────┤
│  W3  │ AiWorkbench 패널 분리 (정리)                                  │
│      │ + Today 가 daily_brief 호출 중단                              │
├─────────────────────────────────────────────────────────────────────┤
│  W5  │ ★ 대대적 삭제: commit_changelog_entry, detect/list_file_      │
│      │   changes, daily_brief, file_changes 테이블, AiWorkbench 패널 │
│      │ + ChangelogScreen 은 read-only 배너 (DEPRECATE)               │
├─────────────────────────────────────────────────────────────────────┤
│  1.1 │ ChangelogScreen 화면 자체 제거                                │
│      │ changelog_entries / changelog_files 테이블 drop               │
│      │ changelog 관련 8 커맨드 코드 삭제                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. 결정 이력

| 항목 | 결정 | 일자 |
|---|---|---|
| §3.2 — 프로젝트 메타 위치 | **A** — Overview 헤더 박스에 1줄 요약 + 더보기 토글. W5-PR5 에 반영됨. | 2026-05-22 |
