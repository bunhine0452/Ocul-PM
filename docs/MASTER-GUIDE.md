# AI-PM 마스터 가이드라인 (MASTER GUIDE)

> **이 문서의 위상**
> `docs/GAP-PLAN.md` (백엔드·데이터 모델·기능 갭) 와 `docs/UI-UX-REDESIGN.md` (정보 구조·화면·인터랙션) 두 문서를 하나의 *단일 소스 오브 트루스*로 통합한 최상위 가이드라인이다.
> 향후 모든 PR·이슈·논의는 이 문서를 기준으로 추적되며, 두 선행 문서는 *상세 부록*으로만 참조한다.
>
> **앱 정체성** (재확인): 코드를 직접 수정하지 않고, **개발자의 소통과 프로젝트 관리를 돕는 지능형 LLM 데스크톱 조력자(=AI PM)**.
> **핵심 가치**: 비용 효율 · 고성능 로컬 분석 · 가벼움 · 미려한 UX
>
> **작성일**: 2026-05-20
> **선행 문서**: `docs/ROADMAP.md`, `docs/GAP-PLAN.md`, `docs/UI-UX-REDESIGN.md`

---

## 목차

- [0. 한 페이지 요약 (Executive Summary)](#0-한-페이지-요약-executive-summary)
- [1. 사용자 정의 — 세 명의 페르소나](#1-사용자-정의--세-명의-페르소나)
- [2. 현재 앱 상태 진단 (Diagnostic)](#2-현재-앱-상태-진단-diagnostic)
- [3. 비전 — "AI PM" 이란 무엇인가](#3-비전--ai-pm-이란-무엇인가)
- [4. 기능 갭 G1~G4 — 백엔드 청사진](#4-기능-갭-g1g4--백엔드-청사진)
- [5. UI/UX 재설계 — 다섯 화면의 내러티브](#5-uiux-재설계--다섯-화면의-내러티브)
- [6. 교차 관심사 (Cross-cutting Concerns)](#6-교차-관심사-cross-cutting-concerns)
- [7. 통합 실행 로드맵 (Unified Roadmap)](#7-통합-실행-로드맵-unified-roadmap)
- [8. 데이터 모델 변경 종합](#8-데이터-모델-변경-종합)
- [9. 파일 영향 종합 (Impact Matrix)](#9-파일-영향-종합-impact-matrix)
- [10. 성공 지표 & 측정](#10-성공-지표--측정)
- [11. 리스크 등록부 (Risk Register)](#11-리스크-등록부-risk-register)
- [12. 열린 결정사항 (Open Decisions)](#12-열린-결정사항-open-decisions)
- [13. 용어집 (Glossary)](#13-용어집-glossary)

---

## 0. 한 페이지 요약 (Executive Summary)

현재 AI-PM은 **기능적으로는 풍부**(인덱싱·RAG·플래너·git·터미널·의존성 맵)하지만, **사용자가 "이 앱이 나의 PM이다"라고 느끼게 만드는 표면이 없다**. 세 가지 핵심 사용자 흐름 중 *코드 수정 후의 변화 흐름 기록*(UC-2의 5단계)이 사실상 비어 있고, *신규 프로젝트 진입(UC-1)*과 *모호한 의도 보정(UC-3)* 진입점도 부재하다. 동시에 UI는 9-탭 IDE-식 사이드바, 두 개의 중복 AI 패널, OS 의존적 chrome 처리, 12개로 흩어진 상태 등으로 인해 사용자에게 *통제권을 빼앗기는 인상*을 준다.

이 가이드는 그 모든 것을 다음 **4개 백엔드 갭(G1~G4)** + **7개 UI 단계(UI-1~UI-7)** 로 묶어, **6주 일정의 단일 로드맵**으로 정렬한다.

| 트랙 | 핵심 산출물 |
|---|---|
| **G1** Changelog 자동화 | 변경 감지 → diff → LLM 요약 → 일별 타임라인 영속 |
| **G2** 프로젝트 개요 | 인덱싱 후 자동 생성되는 자연어 README-급 요약 |
| **G3** 의도 명확화 | 모호한 입력 시 1~3개 clarifying question으로 정제 |
| **G4** Greenfield 위저드 | 빈 폴더에서 AI와 합의로 프로젝트 부트스트랩 |
| **UI-1** Chrome & 상태 정리 | OS별 데코, 단일 WorkspaceContext, window-state |
| **UI-2** IA 5단 재편 | Overview/Today/Plan/Changelog/Code + ⌘K Palette |
| **UI-3** Overview·Today 신설 | G2 연결 + 일일 브리프 화면 |
| **UI-4** Changelog 화면 | G1 연결 + 타임라인 + diff 디테일 |
| **UI-5** Code 워크벤치 통합 | Assist+Chat 합치고 Bottom Drawer로 정돈 |
| **UI-6** Greenfield 진입 | G4 연결 + 5-step 위저드 |
| **UI-7** Polish | 디자인 시스템·접근성·i18n 마무리 |

**최종 결과 그림**: 사용자가 앱을 열면 — "오늘 무엇을 만들 건가요"가 보이고 → AI와 이야기하면서 명확한 영어 프롬프트가 만들어지고 → 외부 LLM에서 코드를 수정한 뒤 돌아오면 → "오늘 한 일"이 자연어 changelog로 자동 정리되며 → 일주일, 한 달, 분기의 흐름이 한 화면에 누적된다.

---

## 1. 사용자 정의 — 세 명의 페르소나

### UC-1. 초기 프로젝트 사용자 (Greenfield)
- **상태**: 아이디어만 있고 코드가 없음.
- **요구**: AI와 대화하며 프로젝트 *목적/기술 스택/디렉터리/초기 마일스톤*을 합의.
- **현재 앱의 대응**: ❌ 없음. dashboard의 "+ Add Project Folder" 는 *이미 있는 폴더*만 받음.

### UC-2. 기존 프로젝트 유지보수 사용자 (Brownfield)
1. 기존 폴더 불러오기 → ✅
2. 인덱싱 후 *구조/방향성/파일 목적* 파악 → ⚠️ 부분(의존성 그래프만, 자연어 요약 없음)
3. 수정 의도를 자연어로 → 정확한 프롬프트로 가공 → ⚠️ 부분(clarifying 없음)
4. 외부 LLM 수정 후 변경 감지 → ✅
5. **차이 분석 → 오늘 changelog 누적 → 시간 흐름 추적** → ❌ 핵심 갭
6. 반복

### UC-3. 바이브 코딩 사용자 (Vibe Coder)
- **상태**: 의도를 명확히 표현하지 못하고 결과 검증도 어려움.
- **요구**: AI가 clarifying question으로 의도를 좁히고, 결과를 자연어로 재설명.
- **현재 앱의 대응**: ❌ 두 방향 모두 없음.

### 페르소나별 진입 화면 (목표 상태)
| 페르소나 | 첫 진입 | 일상 진입 |
|---|---|---|
| UC-1 | Greenfield 위저드 (StartScreen) | 위저드 완료 후 자동 Today 진입 |
| UC-2 | 프로젝트 카드 → Overview | Today (매일 아침) |
| UC-3 | 프로젝트 카드 → Today | Code의 Quick Edit (Clarify dialog 자동) |

---

## 2. 현재 앱 상태 진단 (Diagnostic)

### 2.1. 데이터/기능 측면 진단 (GAP-PLAN §1 요약)

| 유스케이스 단계 | 구현 | 상태 |
|---|---|---|
| 프로젝트 불러오기 | `select_project_folder` + `create_project` | ✅ |
| 인덱싱 + 임베딩 + AST | `index_project` (indexer.rs / ast.rs) | ✅ |
| 구조 파악 | 의존성 그래프 + 심볼 리스트 | ⚠️ 자연어 요약 부재 |
| 의도 파싱 | `generate_edit_prompt` | ⚠️ clarifying 부재 |
| 영어 프롬프트 생성 | LLM 호출 → 영어/한국어 페어 | ✅ |
| 변경 감지 | `detect_file_changes` (Blake3 해시) | ✅ |
| **Changelog 누적** | `file_changes` 테이블에 *경로/타입/해시*만 | ❌ **핵심 갭** |
| **변화 흐름 가시화** | 일별 타임라인 부재 (현 `ChangelogView`는 단순 파일 리더) | ❌ **핵심 갭** |
| Greenfield 온보딩 | 없음 | ❌ |
| 모호한 의도 보정 | 입력 그대로 LLM에 전달 | ❌ |

핵심 관찰: `file_changes.summary` 컬럼은 이미 존재하나 **한 번도 채워지지 않는다** (`db.rs:1085` 의 `insert_file_change`가 NULL로 삽입). diff 본문 자체도 저장 안 됨.

### 2.2. UI/구조 측면 진단 (UI-UX-REDESIGN §1 요약)

| 문제 | 코드 근거 | 영향 |
|---|---|---|
| 9-탭 IDE-식 사이드바 | `App.tsx:476-598` | Files/Chat/Assist/Graph/Planner/Terminal/Git/Settings/Diagnostics — PM이 자주 가는 Changelog/Overview/Today는 없음 |
| Chat + Assist 중복 | `ChatPanel.tsx:428-440`, `AssistPanel.tsx:42-50` | 같은 RAG+LLM 흐름의 두 입구 — 사용자 인지 부담 |
| `decorations: false` + `transparent: true` | `tauri.conf.json`, `App.tsx:320-324`, `App.css:170-184` | 모서리 잘림, 풀스크린 깨짐, Win 의 어색한 트래픽 라이트, GPU 합성 부작용 |
| 상태 흩어짐 | `App.tsx:42-83` (12 useState) + `ChatPanel/TerminalPanel/FileExplorer`의 자체 localStorage | 화면 전환 시 sub-state 손실, 깜빡임, "통제 불능" 인상 |
| 모달 폭증 | Rename / Delete / Settings 3종 동시 | Settings는 *탭과 모달 동시 존재* — 학습 비용 |
| PM 카피 부재 | "Manage and index code repositories with semantic search" | *코드 도구* 카피 — PM 정체성 약화 |
| Greenfield 진입 0줄 | dashboard에 빈 카드 + "Add Folder"만 | UC-1, UC-3 첫 1분 길 잃음 |
| 한/영 카피 혼재 | AssistPanel/ChatPanel/PlannerPanel 전반 | 일관성 결여 → "정돈된 느낌" 영원히 미달성 |

### 2.3. 사용자가 직접 언급한 두 불만
1. **`decorations: false` 자체에 대한 불만** — chrome 처리 방침 변경 필요 (§6.2).
2. **"UI가 말을 듣지 않는다"** — 상태 단일화 + Command Palette로 통제권 복원 (§6.1).

---

## 3. 비전 — "AI PM" 이란 무엇인가

### 3.1. PM 메타포의 구체화

**AI PM이 사용자에게 제공해야 할 5가지 행동**:
1. **개요 설명**: "이 프로젝트가 뭐 하는 앱인지" 명료하게 (= G2 / Overview).
2. **데일리 브리프**: "오늘 뭐 해야 하고 어제 뭐 했는지" 자동 정리 (= Today).
3. **의도 통역**: 모호한 한국어 → 외부 LLM이 받아들이는 정확한 영어 프롬프트 (= G3 + Quick Edit).
4. **활동 기록**: 코드가 어떻게 왜 바뀌었는지 자연어로 누적 (= G1 / Changelog).
5. **목표 추적**: 계획 → 실행 → 회고의 닫힌 루프 (= Plan ↔ Changelog 연계).

### 3.2. "PM 같다"는 인상을 만드는 미시 신호

| 신호 | 구현 위치 |
|---|---|
| 매일 아침 "오늘의 포커스 3개" 자동 추천 | Today 화면 |
| 사용자가 의도를 모호하게 말하면 *되묻는다* | G3 Clarify Dialog |
| 끝낸 일을 *기록하라고 권한다* | AssistPanel → "Changelog에 저장" |
| 일주일에 한 번 *"이번 주 회고"* 카드 | Today 화면 주간 모듈 (선택 구현) |
| 변경이 누적되어 *시각화*된다 | Changelog 타임라인 + 통계 |
| 사용자가 길을 잃으면 *⌘K*로 즉시 복귀 가능 | Command Palette |

### 3.3. 안티-비전 (의도적으로 하지 않는 것)
- **코드를 직접 자동 수정하지 않는다** — 그건 Claude Code/Cursor의 영역. AI-PM은 *그 도구들을 잘 쓰게 도와주는 메타-도구*.
- **클라우드 동기화/팀 협업 기능을 만들지 않는다** — 개인 데스크탑 PM에 집중.
- **VS Code 수준의 풀 IDE를 지향하지 않는다** — 편집은 보조적, *기획·기록·소통*이 메인.

---

## 4. 기능 갭 G1~G4 — 백엔드 청사진

### 4.1. G1. 자동 Changelog 엔트리 생성 *(P0)*

**문제**: 사용자가 외부 LLM으로 코드를 수정한 직후 "오늘 무엇이 어떻게 왜 바뀌었는지" 자연어 기록이 남지 않음. `file_changes` 테이블에는 경로/타입/해시만.

**해결 데이터 모델**: `007_changelog.sql`
```sql
CREATE TABLE IF NOT EXISTS changelog_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_intent TEXT,             -- 사용자가 최초 입력한 한국어 의도
  prompt_text TEXT,             -- generate_edit_prompt 의 영어 결과 (감사 추적)
  ai_summary TEXT NOT NULL,     -- LLM이 diff를 보고 작성한 자연어 요약 (마크다운)
  title TEXT,                   -- 한 줄 제목 (편집 가능)
  category TEXT,                -- feature/fix/refactor/docs/test/chore
  external_tool TEXT,           -- claude-code, cursor, gemini-cli 등
  files_changed INTEGER NOT NULL DEFAULT 0,
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS changelog_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES changelog_entries(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','modified','deleted','renamed')),
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  diff_patch TEXT,              -- zstd 압축 권장, 큰 파일은 head/tail truncation
  per_file_summary TEXT,        -- LLM 마이크로 요약
  old_hash TEXT,
  new_hash TEXT
);

ALTER TABLE file_changes ADD COLUMN entry_id INTEGER
  REFERENCES changelog_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_changelog_project_date
  ON changelog_entries(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_changelog_files_entry
  ON changelog_files(entry_id);
```

**신규 백엔드 커맨드** (`commands/changelog.rs`):
| 커맨드 | 입력 | 출력 | 역할 |
|---|---|---|---|
| `commit_changelog_entry` | project_id, user_intent, prompt_text, provider, model, external_tool? | ChangelogEntry | 변경 감지 → diff → per-file LLM → entry LLM → 트랜잭션 삽입 |
| `list_changelog_entries` | project_id, from?, to?, category? | Vec<ChangelogEntry> | 필터 조회 |
| `list_changelog_by_day` | project_id, days? | Vec<DailyChangelogBucket> | 타임라인용 일별 버킷 |
| `get_changelog_entry` | entry_id | (Entry, Vec<File>) | 디테일 + 파일별 diff |
| `update_changelog_entry` | entry_id, title?, category?, pinned? | Entry | 사용자 보정 |
| `delete_changelog_entry` | entry_id | () | 잘못된 entry 제거 |
| `regenerate_changelog_summary` | entry_id, provider, model | Entry | 요약만 재생성 |
| `export_changelog_markdown` | project_id, from?, to? | String | Keep-a-Changelog md export |

**Diff 추출 전략**:
1. git 저장소면 `git diff HEAD -- <path>` (git2 또는 외부 CLI).
2. 비-git이면 `file_snapshots(project_id, file_path, content_zstd, captured_at)` 보조 테이블.
3. 단일 파일 diff 64KB 초과 시 head/tail 절반씩 + `--- truncated N lines ---`.
4. 바이너리: `diff_patch=NULL`, `per_file_summary='(binary)'`.

**LLM 요약 두 단계**:
- **per-file (마이크로)**: `temperature=0.2, max_tokens=120`, diff 8KB 초과 시 첫 4KB만, provider별 동시성 제한.
- **entry-level (전체)**: per-file 요약 + 사용자 의도 + 통계를 입력으로 받아 JSON 반환:
  ```json
  { "title": "≤60자", "ai_summary": "마크다운 Why/What/How",
    "category": "feature|fix|refactor|docs|test|chore", "tags": ["..."] }
  ```

**엣지 케이스**: 빈 변경 → "변경 없음" 표시 후 entry 생성 안 함 / 의도 미입력 → diff만 보고 추정 / LLM 실패 → placeholder + 재생성 가능 / 신규 파일 → "재인덱싱 권장" 배너.

### 4.2. G2. 프로젝트 개요 자동 생성 *(P0)*

**문제**: 의존성 그래프와 심볼 리스트만 있고, "이 프로젝트가 뭐 하는 앱이고 각 디렉터리가 왜 있는지" 자연어 서술이 없음.

**데이터 모델**: `008_project_overview.sql`
```sql
CREATE TABLE IF NOT EXISTS project_overviews (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  identity TEXT,                 -- 한 줄 정체성
  stack_json TEXT,               -- {"framework":"...", "languages":[...], ...}
  overview_md TEXT,              -- 마크다운 본문
  source_signature TEXT,         -- 입력 신호 해시 (재생성 일관성)
  generated_at INTEGER,
  generated_by_model TEXT
);
```

**커맨드**:
- `generate_project_overview(project_id, provider, model)` — README/package.json/Cargo.toml/주요 entry + AST 통계(언어 분포, hub top10) → LLM → upsert
- `get_project_overview(project_id)`
- `refresh_project_overview_if_stale(project_id)` — 인덱싱 종료 훅에 연결

**신호 텍스트 상한 24KB**, 초과 시 README + entry 우선. 첫 인덱싱 후 1회 + 사용자 명시 요청 시에만 호출. 사용자가 수동 편집한 overview는 자동 재생성으로 덮어쓰지 않음 (변경 시 "Diff 보고 병합" 모달).

### 4.3. G3. Clarifying Question *(P1)*

**문제**: 모호한 입력("로그인 페이지 좀 예쁘게 해줘")을 그대로 외부 LLM에 보내 결과 품질 저하 → 재시도 비용 증가.

**흐름**:
```
사용자 입력 → LLM A (모호도 평가)
                ├─ score < 0.4 → 기존 generate_edit_prompt 직행
                └─ score ≥ 0.4 → 1~3개 질문 생성 → 사용자 답변 → LLM B (정제된 의도로 영어 프롬프트)
```

**`generate_edit_prompt` 의 분리**:
- `clarify_edit_intent(project_id, user_request, provider, model)` →
  ```json
  { "ambiguity_score": 0.78,
    "questions": [
      {"id":"q1","kind":"choice","text":"어느 페이지요?","options":["로그인","프로필"]},
      {"id":"q2","kind":"text","text":"어떤 동작을 해야 하나요?"} ],
    "auto_proceed": false }
  ```
- `generate_edit_prompt_with_answers(project_id, user_request, answers, provider, model)` → 기존 `EditPromptResult` 와 동일 형식.

**비용**: clarify 단계 입력≤500 / 출력≤300 토큰. 호출당 ~$0.001 미만.

### 4.4. G4. Greenfield 위저드 *(P2)*

**흐름**: 위치 선택 → 아이디어 인터뷰 → 스택 추천 → 스캐폴딩(외부 CLI 위임 우선: `pnpm create vite`, `cargo new`) → 첫 마일스톤 (G2 overview 자동 + Planner 시드 3~5개).

**커맨드**: `create_greenfield_project(name, root_path, blueprint_json)`.
**보조 테이블 (선택)**: `project_blueprints` — 자주 쓰는 인터뷰 답변 프리셋.

---

## 5. UI/UX 재설계 — 다섯 화면의 내러티브

### 5.1. 새 정보 구조 (IA)

좌측 사이드바를 9개 → **5개 PM-내러티브 IA**로:

| IA | 사용자 질문 | 흡수되는 기존 패널 |
|---|---|---|
| **Overview** ⌘1 | "이 프로젝트가 뭐 하는 앱인지" | DependencyGraphView |
| **Today** ⌘2 | "오늘 뭐 해야 하고 뭐 했어?" | (신설) |
| **Plan** ⌘3 | "할 일을 관리하고 싶어" | PlannerPanel |
| **Changelog** ⌘4 | "지금까지의 변화 흐름" | (신설) |
| **Code** ⌘5 | "코드를 직접 보고 만지고 싶어" | Files + Chat + Assist + Git + Terminal |

Settings/Diagnostics는 ⌘, + Settings 마지막 탭으로 강등.

### 5.2. Overview 화면

```
┌──────────────────────────────────────────────────────┐
│  ai-pm · Tauri + React + Rust · main · ⭐ 1.2k        │
├──────────────────────────────────────────────────────┤
│  📌 정체성                                             │
│  "코드를 직접 수정하지 않고, 개발자의 소통과 관리를 돕는…" │
│                                                       │
│  🧱 [Tauri 2] [React 19] [TypeScript] [Rust] [vec] …  │
│                                                       │
│  🗂  디렉터리 가이드 (편집 가능)                         │
│  ├─ src/features/chat       — M2 LLM 대화             │
│  ├─ src/features/projects   — M3 코드 검색 & 의존성    │
│  └─ src-tauri/src/commands  — Tauri IPC 커맨드        │
│                                                       │
│  🎯 진입점: src/App.tsx · src-tauri/src/lib.rs        │
│  📊 4,820 파일 · 18,392 청크 · 마지막 인덱싱 2시간 전   │
│  [재인덱싱] [의존성 맵] [개요 다시 생성]                 │
└──────────────────────────────────────────────────────┘
```

**의존성**: G2 백엔드. **인터랙션**: 디렉터리 가이드 inline 편집 / chip 클릭 시 Code 화면으로 언어 필터링 이동 / 의존성 맵은 *drawer* 형태(별도 화면 아님).

### 5.3. Today 화면 — 신설, PM 정체성의 심장

```
┌──────────────────────────────────────────────────────┐
│ Today · 2026-05-20                  [어제 ◀ ▶ 내일]   │
├─────────────────────┬────────────────────────────────┤
│ 🌅 오늘의 포커스      │ 📊 어제의 완료                  │
│ 1. [Urgent] OAuth   │ ✓ 3 goals 완료                 │
│ 2. [High] Changelog │ ✓ 12 files 변경                │
│ 3. RAG top-K 튜닝   │ ✓ 2 changelog entry            │
├─────────────────────┴────────────────────────────────┤
│ 📜 오늘의 활동                                         │
│ 15:42 ▣ [feature] 소셜 로그인 버튼 추가 · 4 files     │
│ 13:10 ▢ [fix]     RAG 검색 중복 제거    · 1 file      │
│ 11:05 ▣ [refactor] DepGraph 가상화      · 2 files     │
│                                                       │
│ 🤖 AI 추천                                            │
│ • OAuth 통합 목표 관련 파일 3개 발견.                  │
│   [→ Quick Edit으로 프롬프트 만들기]                   │
│ • 오늘 변경된 4 files의 changelog 요약 비어 있음.      │
│   [→ AI에게 요약 부탁하기]                             │
└──────────────────────────────────────────────────────┘
```

**의존성**: G1 + Planner. **신규 커맨드**: `daily_brief(project_id, date) -> DailyBrief`.
**AI 추천**: 진입 시 자동 vs 사용자 클릭 — §12 열린 결정.

### 5.4. Plan 화면

기존 PlannerPanel 유지하되:
- 3개 탭(Goals/Dashboard/Calendar) → "Goals" 메인 + 우상단 view-mode toggle.
- 좌측 180px 세컨더리 사이드바에 영구 필터 (상태/우선순위/마감).
- "+ 새 목표" CTA를 좌측 카드 + ⌘N.
- ActionProposalCard 가 Plan 화면 안에서도 노출되도록 inline AI 제안 영역.

### 5.5. Changelog 화면 — G1의 시각화 종착점

```
┌──────────────────────────────────────────────────────┐
│ Changelog [전체▾] [feature▾] [최근 30일▾]  🔍 검색     │
├──────────────┬───────────────────────────────────────┤
│ 2026-05-20   │ ◆ [feature] 소셜 로그인 버튼 추가 15:42│
│ 3 entries    │   AuthContext.tsx, LoginPage.tsx +2   │
│ +312 / -88   │   ─────────────────────────────────   │
│              │   사용자 의도:                          │
│ 2026-05-19   │   "로그인 페이지에 소셜 로그인 추가"     │
│ 5 entries    │                                       │
│ +621 / -402  │   AI 요약 (Why/What/How):              │
│              │   • Why: OAuth 통합으로 가입률 향상    │
│ ───          │   • What: Google/GitHub provider 인터페이스 │
│ 이번 주        │   • How: AuthContext에 OAuthProvider…  │
│ +1,840/-724  │                                       │
│              │   파일별 변경                          │
│              │   ▸ AuthContext.tsx  +52/-8           │
│              │   ▸ LoginPage.tsx    +38/-6           │
│              │   [원본 프롬프트] [다시 요약] [📌 고정] │
└──────────────┴───────────────────────────────────────┘
```

**인터랙션**: 파일별 변경 행 클릭 → diff modal (라인 단위) / 풀텍스트 검색 / 📌 고정은 Today 에도 영구 노출 / Export 메뉴 [md] [json].

### 5.6. Code 화면 — IDE 워크벤치 (AssistPanel+ChatPanel 통합)

```
┌──────────────────────────────────────────────────────────┐
│ Code · src/App.tsx                       [⌘P] [⌘\] [⌘J]│
├──────┬─────────────────────────────────┬─────────────────┤
│ Tree │ Tabs: App.tsx ⨯ ChatPanel.tsx ⨯ │ 🤖 AI Workbench │
│      │                                 │ ┌[Quick Edit][Chat]│
│      │ ┌─────────────────────────────┐ │ │               │
│      │ │  Editor                     │ │ │  …모드별 본문  │
│      │ │                             │ │ │               │
│      │ └─────────────────────────────┘ │ └───────────────│
├──────┴─────────────────────────────────┴─────────────────┤
│ ▾ Terminal · Git · Problems  (Bottom Drawer, ⌘J)         │
└──────────────────────────────────────────────────────────┘
```

**AI Workbench 모드**:
- **Quick Edit** = 기존 AssistPanel 3단계 + G3 Clarify 삽입.
- **Chat** = 기존 ChatPanel 자유 대화 + RAG.

**Bottom Drawer**:
- Terminal: 기존 `TerminalPanel`. **PiP 드래그 제거** (UX 안티패턴), Detach Window는 유지.
- Git: 기존 `GitPanel`. **Changelog 탭 제거** (별도 최상위 화면으로 승격).
- Problems: LSP 진단 (선택 구현).

### 5.7. Greenfield 진입 (StartScreen) — UC-1/UC-3

프로젝트 미선택 상태에서 대형 진입 카드:
```
┌────────────────────────────────────────────────┐
│       어떤 프로젝트로 시작할까요?                 │
│                                                │
│  ┌──────────────┐    ┌──────────────┐          │
│  │ 📂 기존 폴더  │    │ ✨ 새 프로젝트 │          │
│  │   불러오기    │    │   시작하기    │          │
│  └──────────────┘    └──────────────┘          │
│                                                │
│  최근: [project-a · 2h] [project-b · 어제] …    │
└────────────────────────────────────────────────┘
```

**Greenfield Wizard** (5 step, G4 의존):
1. 어떤 앱? (자유 텍스트 + 예시 chip)
2. 주 사용자?
3. 스택 3종 추천 (예: Tauri+React / Next.js / FastAPI+React)
4. 폴더 위치/이름
5. 초기 goal 3개 자동 생성 (편집 가능) → 인덱싱 → Overview → Today 진입

중간 X 누르면 `project_blueprints`에 초안 저장.

### 5.8. Quick Edit 안의 Clarify Dialog (G3)

```
사용자: "로그인 페이지 좀 예쁘게"
        ↓ (ambiguity=0.82)
┌─────────────────────────────────────┐
│ 🤔 조금 더 알려주세요                 │
│ ① "예쁘게"의 방향?                   │
│    ○ 미니멀  ○ 다채롭게  ○ 전문적   │
│ ② 영향 범위?                        │
│    ○ /login만  ○ /login + /signup   │
│   [질문 건너뛰기]   [답변하고 진행 →] │
└─────────────────────────────────────┘
        ↓ (정제된 의도)
   영어 프롬프트 생성 → 클립보드
```

### 5.9. Command Palette (⌘K)

`cmdk` 기반. 모든 화면에서:
- 자주 쓰는: "오늘 changelog 저장", "AI에게 brief 부탁", "새 목표"
- 화면 이동: Overview ⌘1, Today ⌘2, …
- 액션: 재인덱싱, 개요 재생성, 테마, Settings (⌘,)

한국어 fuzzy 매칭 ("체인지로그" → Changelog).

**"UI가 말을 듣지 않을 때 ⌘K로 즉시 탈출"** — 통제권 복원의 핵심 장치.

---

## 6. 교차 관심사 (Cross-cutting Concerns)

### 6.1. 상태 단일화 — `WorkspaceContext`

현재: `App.tsx` 12 useState + 5 useEffect로 localStorage 동기화 + 자식 패널마다 자체 localStorage.

목표 스키마:
```ts
interface WorkspaceState {
  currentProjectId: number | null;
  activeView: "overview"|"today"|"plan"|"changelog"|"code";
  // Code sub-state
  openFiles: string[];
  activeFile: string | null;
  aiWorkbenchMode: "quick-edit"|"chat";
  aiWorkbenchOpen: boolean;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: "terminal"|"git"|"problems";
  fileExplorerExpanded: Record<string, boolean>;
  // 휘발성
  indexingProjectId: number | null;
  indexProgress: IndexProgress | null;
}
```

**원칙**:
- `localStorage` 접근은 `WorkspaceContext` 안에서만 (eslint rule로 강제).
- 키 단일화: `aipm:workspace:v1` 1개 + JSON.
- 마이그레이션 함수로 기존 12개 키 자동 흡수 후 삭제.
- `ActionProposalCard`의 `localStorage` (action_${convId}_${i}) → `conversation_actions` SQLite 테이블 이전.
- TerminalPanel PiP 위치 4개 키 → PiP 자체 제거로 함께 사라짐.
- FileExplorer expanded → WorkspaceContext에 영속화 (새로고침 시 폴더 보존).

### 6.2. 윈도우 chrome 처리 — `decorations: false` 문제 해결

**결정**: OS별 분기.
| OS | decorations | transparent | TitleBar |
|---|---|---|---|
| macOS | `true` | `false` | `titleBarStyle: Overlay` + `hiddenTitle: true` (네이티브 traffic light 위에 콘텐츠 겹침) |
| Windows | `true` | `false` | 네이티브 chrome 100% — 우리 TitleBar는 제목+breadcrumb만 |
| Linux | `true` | `false` | 동일 |

**변경 사항**:
- `tauri.conf.json`: 기본을 안전 모드(데코 켜짐)로. macOS overlay 설정은 `src-tauri/src/lib.rs`의 setup에서 `WindowBuilder` 코드로 분기 적용.
- `App.css:170-184` 의 `border-radius:12px` + `WebkitMaskImage` 전부 제거. 모서리는 OS가 그림.
- `App.tsx:320-324` 의 인라인 `WebkitMaskImage` 제거.
- `TitleBar.tsx`의 수동 traffic light + JS `startDragging` 제거. `data-tauri-drag-region` 표준 채택.
- `tauri-plugin-window-state` 도입 → 위치/크기 영속화.
- `min_width: 960, min_height: 640` 강제.

**부수 효과**: React Flow, Markdown, 모달 z-index가 더 이상 mask에 잘리지 않음.

### 6.3. 비동기 작업 큐 — `TaskQueue`

각 화면이 자체 spinner를 그리는 현 상황을 통합. 우상단 글로벌 task ticker (Linear 스타일):
```ts
useTaskQueue().run("indexing", async () => { ... });
```
사용자는 "지금 무슨 일이 진행 중인지" 한 곳에서 확인. *"UI가 말을 듣는다"* 의 핵심 신호.

### 6.4. 디자인 시스템 토큰

**타이포그래피**:
| 용도 | 폰트 | 크기/굵기 |
|---|---|---|
| Display (Overview hero) | EB Garamond | 32/500 |
| Page heading | SUITE | 20/700 |
| Section heading | SUITE | 14/700 |
| Body | SUITE | 13/400 |
| Caption | SUITE | 11/500 |
| Code | D2Coding | 12/400 |

영문 단어(provider 등)에만 Inter Variable. 한글 본문에 EB Garamond 직접 금지.

**카테고리 컬러** (기존 coral primary 유지 + 추가):
```css
--cat-feature:  #5b8def;  /* blue */
--cat-fix:      #e7785b;  /* coral */
--cat-refactor: #8e7ae6;  /* purple */
--cat-docs:     #4caf81;  /* green */
--cat-chore:    #888880;  /* gray */
```

**모서리 통일**:
- 카드/모달 `rounded-2xl` (16px)
- 버튼/입력 `rounded-lg` (8px)
- chip `rounded-full`
- *임의 혼용 금지* (현재 App.tsx 안에서만 5종 혼재).

**모션**: 200ms 초과 트랜지션 금지.

### 6.5. 접근성 & i18n

**A11y**:
- 모든 아이콘 버튼 `aria-label` 강제.
- 사이드바 `<nav role="navigation">` + `<ul>`.
- `--muted-foreground` dark mode `#8e8b82` → `#a8a59c` (WCAG AA).
- `focus:outline-none` 제거 (`TitleBar.tsx:83` 등).

**i18n 준비**:
- 사용자-페이싱 카피 기본 한국어 + 기술용어/단축키 영문.
- `src/locales/ko.json` 으로 추출. 추후 영문 추가 시 `en.json` + `useTranslation()`.
- 영문/한글 혼재 상태에서 i18n 도입 금지 → 먼저 한국어 통일.

### 6.6. 카피 정렬

**금지**:
- "Manage and index code repositories with semantic search"
- "Dependency Map" / "Files Explorer" / "Project Planner"

**채택**:
- "오늘 무엇을 만들 건가요?"
- "이 코드베이스가 어떤 앱인지 살펴보세요"
- "수정 요청을 영어 프롬프트로 가공해드릴게요"
- "지난 7일 동안 만든 것"

**원칙**: 행동 동사 중심 · 사용자 시점 · 도구 이름 대신 *목적*.

---

## 7. 통합 실행 로드맵 (Unified Roadmap)

### 7.1. Phase 의존성 그래프

```
UI-1 (chrome+상태)  ────┐
                        ├──→ UI-2 (IA 5단)
                        │           │
G2 (Overview 백엔드) ──┐│            │
                       ├┴───→ UI-3 (Overview/Today)
G1 (Changelog 백엔드) ─┤
                       └────→ UI-4 (Changelog 화면)
                                    │
G3 (Clarify 백엔드) ───────────────┐│
                                   ├┴→ UI-5 (Code 워크벤치 통합)
                                   │
G4 (Greenfield 백엔드) ────────────┴→ UI-6 (Greenfield 진입)
                                    │
                                    └→ UI-7 (Polish)
```

**핵심**: **UI-1은 모든 작업의 선행 조건**. 상태가 단일화되지 않으면 이후 모든 화면 추가가 부채를 키운다.

### 7.2. 6주 통합 일정

| 주차 | 백엔드 트랙 | UI 트랙 | 마일스톤 |
|---|---|---|---|
| **W1** | G1 마이그레이션 + 데이터 모델 | UI-1: chrome+상태 단일화 | 모든 후속 작업의 기반 마련 |
| **W2** | G1 커맨드 + LLM 요약 + git diff | UI-2: IA 5단 + Command Palette | 새 사이드바 + ⌘K 작동 |
| **W3** | G2 백엔드 (overview 생성) | UI-3: Overview + Today | 첫 PM 정체성 화면 가동 |
| **W4** | G1 마이크로/엔트리 요약 안정화 | UI-4: Changelog 화면 + diff modal | 핵심 갭 종결 |
| **W5** | G3 (clarify) 분리 | UI-5: Code 워크벤치 통합 + Bottom Drawer | Assist/Chat 중복 제거 |
| **W6** | G4 (greenfield) + Planner 시드 | UI-6: StartScreen + Wizard, UI-7: Polish | Greenfield + 마무리 |

**각 주 종료 시**:
- `docs/ROADMAP.md` 의 해당 항목 ✅ 체크
- 본 가이드의 "성공 지표" 측정
- dogfood 1회 (본인 사용)

### 7.3. Phase별 상세 체크리스트

**W1 — UI-1**
- [ ] `tauri-plugin-window-state` 통합 + min size
- [ ] OS별 decorations 분기 (`lib.rs` setup)
- [ ] `App.css` border-radius/WebkitMaskImage 제거
- [ ] `App.tsx` 인라인 mask 제거
- [ ] `TitleBar.tsx` 재작성 (data-tauri-drag-region, OS 분기)
- [ ] `WorkspaceContext` 신설 + 12 useState 흡수
- [ ] localStorage 단일 키 + 마이그레이션 함수
- [ ] eslint rule: 직접 localStorage 접근 금지

**W1 병행 — G1 데이터 모델**
- [ ] `007_changelog.sql` 작성 + 검증
- [ ] `db.rs` 에 `ChangelogEntry`, `ChangelogFileEntry`, `DailyChangelogBucket` 구조체

**W2 — UI-2**
- [ ] 사이드바 9 → 5 메뉴
- [ ] Settings 모달 삭제, ⌘, 단축키만
- [ ] Diagnostics → Settings 마지막 탭
- [ ] `cmdk` 기반 Command Palette
- [ ] 단축키 매핑 (⌘1~⌘5, ⌘\, ⌘J, ⌘K, ⌘N)

**W2 병행 — G1 커맨드**
- [ ] `commands/changelog.rs` 신설
- [ ] `commit_changelog_entry` 구현 (변경 감지 → git diff → LLM 요약 → 트랜잭션 삽입)
- [ ] `list_changelog_by_day`, `get_changelog_entry`
- [ ] LLM 프롬프트 템플릿 (per-file, entry-level)
- [ ] git diff 추출 유틸 (`git.rs` 확장)

**W3 — G2 + UI-3**
- [ ] `008_project_overview.sql`
- [ ] `commands/project.rs` overview 3종 커맨드
- [ ] 인덱싱 완료 훅에 `refresh_project_overview_if_stale` 연결
- [ ] `OverviewScreen.tsx` 신설 (정체성/스택/디렉터리 가이드/진입점/통계)
- [ ] `TodayScreen.tsx` 신설 (포커스/완료/활동/AI 추천)
- [ ] `daily_brief` 커맨드 (Planner + Changelog 데이터 결합)
- [ ] 디렉터리 가이드 inline 편집 (markdown editor)

**W4 — UI-4**
- [ ] `ChangelogScreen.tsx` 신설 (좌측 날짜 버킷 + 우측 디테일)
- [ ] `EntryDetail.tsx`, `DiffModal.tsx`
- [ ] 필터/검색/Export
- [ ] AssistPanel "변경사항 저장" → Changelog 동선
- [ ] 📌 고정 → Today 연동
- [ ] e2e: "외부 수정 → 저장 → 타임라인 노출" 골든 패스

**W5 — G3 + UI-5**
- [ ] `generate_edit_prompt` 분리 → `clarify_edit_intent` + `generate_edit_prompt_with_answers`
- [ ] `CodeWorkbench.tsx` 신설 (3단 분할)
- [ ] `AiWorkbench.tsx` (Quick Edit / Chat 모드 토글)
- [ ] `BottomDrawer.tsx` (Terminal / Git / Problems)
- [ ] AssistPanel + ChatPanel 코드 흡수 후 삭제
- [ ] Terminal PiP 제거, Detach 유지
- [ ] Git Panel 의 Changelog 탭 제거
- [ ] `ClarifyDialog.tsx` 통합
- [ ] `conversation_actions` 테이블 마이그레이션 (localStorage → SQLite)

**W6 — G4 + UI-6 + UI-7**
- [ ] `create_greenfield_project` 커맨드
- [ ] `project_blueprints` 테이블 (선택)
- [ ] 외부 CLI 위임 (`pnpm create vite`, `cargo new`) + OS 별 PATH 검증
- [ ] `StartScreen.tsx`, `GreenfieldWizard.tsx`
- [ ] 초안 저장/복원
- [ ] Planner 시드 goal 자동 생성
- [ ] **Polish**: 디자인 토큰 정리, A11y 라벨, 카피 한국어 통일, `src/locales/ko.json` 추출
- [ ] 마이크로 인터랙션 (project card hover, indexing ETA, chat 빈 상태, markdown 복사 버튼 등)

### 7.4. Feature Flag 전략

각 Phase의 결과물은 `settings` 테이블의 boolean flag 뒤에서 점진 적용:
- `feature_changelog_v2` (G1+UI-4)
- `feature_overview_v2` (G2+UI-3)
- `feature_clarify` (G3)
- `feature_greenfield_wizard` (G4+UI-6)
- `feature_new_ia` (UI-2 사이드바 5단)

문제 발생 시 즉시 끄고 기존 흐름으로 폴백 가능.

---

## 8. 데이터 모델 변경 종합

### 8.1. 새 ER 다이어그램

```
projects ─┬─< project_overviews          (G2, 1:1)
          ├─< changelog_entries          (G1)
          │     └─< changelog_files      (G1)
          ├─< file_changes  (+entry_id 컬럼, G1)
          ├─< file_snapshots             (G1, 비-git 폴백)
          ├─< project_blueprints         (G4, 선택)
          ├─< conversations
          │     └─< conversation_actions (UI-5, 신규)
          ├─< files (기존)
          ├─< goals (기존)
          └─< chunks / ast_* (기존)
```

### 8.2. 마이그레이션 순서

| Ver | 파일 | Phase | 내용 |
|---|---|---|---|
| 007 | `007_changelog.sql` | W1 | changelog_entries, changelog_files, file_changes ALTER |
| 008 | `008_project_overview.sql` | W3 | project_overviews |
| 009 | `009_conversation_actions.sql` | W5 | conversation_actions (localStorage 이전) |
| 010 | `010_file_snapshots.sql` | W2 (조건) | 비-git 프로젝트 diff 폴백용 |
| 011 | `011_project_blueprints.sql` | W6 (선택) | Greenfield 초안 저장 |

전부 **비파괴적 변경** (CREATE TABLE / ADD COLUMN 만).

---

## 9. 파일 영향 종합 (Impact Matrix)

### 9.1. 신규
**백엔드**:
- `src-tauri/migrations/007_changelog.sql`
- `src-tauri/migrations/008_project_overview.sql`
- `src-tauri/migrations/009_conversation_actions.sql`
- `src-tauri/migrations/010_file_snapshots.sql` (조건부)
- `src-tauri/migrations/011_project_blueprints.sql` (선택)
- `src-tauri/src/commands/changelog.rs`
- `src-tauri/src/llm/prompts/changelog_per_file.md`
- `src-tauri/src/llm/prompts/changelog_entry.md`
- `src-tauri/src/llm/prompts/project_overview.md`
- `src-tauri/src/llm/prompts/clarify_intent.md`

**프론트엔드**:
- `src/contexts/WorkspaceContext.tsx`
- `src/contexts/TaskQueue.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/BottomDrawer.tsx`
- `src/components/AppMark.tsx`
- `src/components/icons/index.ts` (lucide re-export)
- `src/features/overview/OverviewScreen.tsx`
- `src/features/today/TodayScreen.tsx`
- `src/features/changelog/ChangelogScreen.tsx`
- `src/features/changelog/EntryDetail.tsx`
- `src/features/changelog/DiffModal.tsx`
- `src/features/code/CodeWorkbench.tsx`
- `src/features/code/AiWorkbench.tsx`
- `src/features/code/ClarifyDialog.tsx`
- `src/features/onboarding/StartScreen.tsx`
- `src/features/onboarding/GreenfieldWizard.tsx`
- `src/locales/ko.json`

### 9.2. 수정
- `src/App.tsx` — 전면 재작성 (라우터 단순화, dialog 제거, WorkspaceProvider)
- `src/App.css` — chrome CSS 정리, 컬러 토큰 추가
- `src/components/TitleBar.tsx` — OS 분기, data-tauri-drag-region
- `src/components/FileExplorer.tsx` — expanded 영속화
- `src/features/planner/PlannerPanel.tsx` — view-mode toggle, 필터 사이드바
- `src/features/settings/SettingsPanel.tsx` — Diagnostics 흡수
- `src/features/terminal/TerminalPanel.tsx` — PiP 제거, BottomDrawer 임베드
- `src/features/git/GitPanel.tsx` — Changelog 탭 제거
- `src-tauri/tauri.conf.json` — decorations true, transparent false
- `src-tauri/src/lib.rs` — macOS overlay, window-state plugin, changelog 커맨드 등록
- `src-tauri/src/db.rs` — 신규 struct + query 메서드
- `src-tauri/src/git.rs` — diff 추출 유틸
- `src-tauri/src/commands/project.rs` — `generate_edit_prompt` 분리, overview 커맨드
- `src-tauri/Cargo.toml` — `tauri-plugin-window-state`

### 9.3. 삭제
- `src/features/assist/AssistPanel.tsx` (CodeWorkbench의 Quick Edit 모드로 흡수)
- `src/features/chat/ChatPanel.tsx`의 비-workspace 분기 (L973+)
- TerminalPanel PiP 관련 코드 + 4개 localStorage 키

---

## 10. 성공 지표 & 측정

### 10.1. 기능 지표 (백엔드 갭 검증)

| 지표 | 목표 | 측정 방법 |
|---|---|---|
| Changelog 자동 생성률 (entry / detect 횟수) | > 70% | 로컬 카운터 |
| Overview 패널 일일 활성 사용자 비율 | > 50% | telemetry (opt-in) |
| Clarify 단계 발동률 | 25~40% | clarify_edit_intent 호출 비율 |
| 외부 LLM 재시도 횟수 | G3 도입 후 평균 -30% | 사용자 추정 입력 |
| Greenfield 위저드 완료율 | > 60% | 단계 진입/완료 카운터 |

### 10.2. UX 지표 (UI 재설계 검증)

| 지표 | 목표 | 측정 방법 |
|---|---|---|
| 첫 사용자 → 첫 Changelog 엔트리 시간 | < 5분 | telemetry |
| Command Palette 사용률 | > 0.2회/분 | ⌘K 호출 카운트 |
| 화면 전환 후 sub-state 복원율 | 100% | 자동 회귀 테스트 |
| 사이드바 → 작업 시작 평균 클릭 수 | < 2 | 세션 녹화 |
| 윈도우 chrome 버그 (모서리 잘림 등) | UI-1 이후 0건 | issue tracker |
| 카피 한/영 혼재 | UI-7 이후 0건 | 자동 grep 검사 |

### 10.3. 비용 지표

| 지표 | 목표 | 비고 |
|---|---|---|
| 일일 Changelog LLM 비용 | < $0.30/일 | Sonnet 4.6 기준, Haiku 사용 시 1/5 |
| Overview 재생성 주기 | 인덱싱 시 자동 + 사용자 명시 | 평균 < 5회/주 |
| Clarify 추가 비용 | $0.001/호출 | 무시 가능 |

---

## 11. 리스크 등록부 (Risk Register)

| ID | 리스크 | 영향 | 가능성 | 대응 |
|---|---|---|---|---|
| R1 | git diff 추출 시 매우 큰 파일/바이너리 처리 부담 | 중 | 중 | head/tail truncation + 바이너리 NULL + 64KB cap |
| R2 | LLM 호출 비용 누적 | 중 | 중 | feature flag로 끔 가능, 요약용 모델 별도 지정(Haiku) |
| R3 | OS별 chrome 분기 코드의 macOS-only 버그 | 높 | 낮 | Windows/Linux는 native 데코로 안전, macOS는 충분한 dogfood |
| R4 | WorkspaceContext 마이그레이션 시 기존 사용자 데이터 손실 | 높 | 낮 | 마이그레이션 함수는 *원본 키 보존 + 새 키 작성 후 1버전 뒤 삭제* |
| R5 | Bottom Drawer에 Terminal 임베드 시 xterm-fit-addon 리사이즈 race | 중 | 중 | ResizeObserver 디바운스, detach 모드 우선 권장 |
| R6 | 외부 CLI (`pnpm create vite`) 가 사용자 환경에서 실패 | 중 | 중 | PATH 검사 + 수동 명령 안내 fallback |
| R7 | Clarify 질문이 너무 자주 발동해 귀찮음 | 중 | 중 | ambiguity threshold 사용자 설정 + 건너뛰기 옵션 |
| R8 | Today AI 추천 자동 호출 시 cold-start latency | 낮 | 높 | 화면 진입 시 *캐시된 추천* 표시 + 백그라운드 갱신 |
| R9 | 사용자가 Changelog에 민감 정보 저장됨을 인지 못함 | 높 | 중 | 첫 사용 시 1회 고지 + 시크릿 패턴 마스킹 |
| R10 | i18n 분리 전에 카피 추가 → 누락 다발 | 중 | 높 | UI-7 이전에는 ko 직접 작성, UI-7에서 일괄 추출 |

---

## 12. 열린 결정사항 (Open Decisions)

작성자가 단정하지 않고 **프로젝트 오너 결정**이 필요한 사항:

1. **앱 이름 통일**: `ai-pm` vs `Ocul-PM` — 코드/문서에 둘 다 등장.
2. **macOS chrome 스타일**: Overlay(Cursor 룩) vs Hidden Title(Linear 룩).
3. **Today AI 추천 호출 빈도**: 화면 진입 시 자동 vs 사용자 클릭 시.
4. **Changelog diff 보존 기간**: 90일 자동 삭제 vs 영구 (사용자 설정).
5. **다이얼로그 vs Toast**: Rename/Delete를 풀스크린 다이얼로그 유지 vs inline rename + undo toast.
6. **Vibe Coder 모드 강화**: Quick Edit 안에 *"AI 알아서 다 해주는 One-button"* 옵션 별도?
7. **그룹핑 휴리스틱**: 사용자가 명시 저장 안 해도 "10분 내 변경 묶음" 자동 처리?
8. **외부 LLM 도구 자동 감지**: 클립보드 모니터링/단축키로 Claude Code/Cursor 사용 자동 라벨링?
9. **Changelog ↔ Planner 연동**: changelog entry를 goal/subtask에 연결 → "이 goal에 실제로 무엇이 구현됐는지" 추적 (별도 RFC 가치).
10. **다국어 요약 지원**: 현재 한국어 고정. 영어/일본어 등 사용자 설정 필요?
11. **Bottom Drawer의 Problems 탭**: LSP 통합(이미 `commands/diagnostics.rs` 존재) 결과 즉시 노출 vs Phase 후 추진.

---

## 13. 용어집 (Glossary)

| 용어 | 정의 |
|---|---|
| **AI PM** | 본 앱의 정체성. 코드를 직접 수정하지 않고 사용자의 *기획·기록·소통* 을 돕는 AI 도우미 |
| **UC-1 / UC-2 / UC-3** | Greenfield / Brownfield / Vibe Coder 페르소나 |
| **G1~G4** | 기능 갭 (Changelog/Overview/Clarify/Greenfield) |
| **UI-1~UI-7** | UI 작업 단계 (chrome/IA/Overview·Today/Changelog/Code/Greenfield/Polish) |
| **Quick Edit** | Code 워크벤치의 모드. AssistPanel의 후신. 외부 LLM용 영어 프롬프트 생성 |
| **Free Chat** | Code 워크벤치의 모드. ChatPanel의 후신. 자유 대화 + RAG |
| **Changelog Entry** | 사용자의 한 번의 수정 세션에 대응하는 자연어 요약 단위 |
| **Daily Brief** | Today 화면의 자동 생성 콘텐츠 (포커스/완료/AI 추천) |
| **Overview** | 프로젝트 1회 자동 생성되는 README-급 자연어 요약 |
| **Clarify** | 모호한 의도에 1~3개 질문으로 정제하는 단계 |
| **Command Palette** | ⌘K로 호출하는 액션/이동 fuzzy-search 인터페이스 |
| **Bottom Drawer** | Code 화면 하단의 Terminal/Git/Problems 통합 드로워 |
| **WorkspaceContext** | 앱 전역 상태의 단일 컨텍스트. localStorage 접근 유일 경로 |
| **Feature Flag** | `settings` 테이블의 boolean으로 점진 배포/롤백 제어 |
| **Source Signature** | Overview 재생성 일관성을 위한 입력 신호 해시 |

---

## 부록 A. 핵심 의사결정 요약 (1줄씩)

- 사이드바: **9 → 5**
- AI 패널: **2 → 1** (Quick Edit / Chat 모드 토글)
- chrome: **수동 mask + traffic light → OS-네이티브 분기**
- 상태: **12 useState + 5 useEffect + 흩어진 localStorage → 단일 WorkspaceContext**
- 진입점: **dashboard 빈 그리드 → StartScreen + Greenfield Wizard**
- 변경 추적: **해시만 저장 → diff + per-file 요약 + entry 요약 + 타임라인**
- 의도 처리: **그대로 LLM → Clarify 단계 삽입**
- 카피: **한/영 혼재 → 한국어 기본 + locales 분리**
- 단축키: **거의 없음 → ⌘1~⌘5, ⌘\, ⌘J, ⌘K, ⌘N, ⌘,**

---

## 부록 B. 작업 시작 전 체크리스트

본격 구현 들어가기 전 반드시 확인:

- [ ] 본 문서의 §12 "열린 결정사항" 중 W1~W2 에 영향 주는 것 (앱 이름, macOS chrome 스타일) 결정
- [ ] feature flag 메커니즘이 `settings` 테이블에 이미 존재하는지 확인 (없으면 W1에 함께 추가)
- [ ] 현재 사용 중인 LLM 모델 표준 (`AssistPanel.tsx` 의 FALLBACK_MODEL과 동일하게 유지할지)
- [ ] dogfood 환경 분리 (production DB와 다른 경로) — 마이그레이션 실패 시 복원 가능
- [ ] `tauri-plugin-window-state` 버전이 현재 Tauri 2.x와 호환되는지 (Cargo 사전 확인)
- [ ] `cmdk` 가 현재 shadcn/Tailwind v4 설정과 충돌 없는지

---

## 부록 C. 참고

- 본 문서는 `docs/GAP-PLAN.md`, `docs/UI-UX-REDESIGN.md` 의 모든 핵심 결정을 흡수하며, 두 문서는 *세부 참조용*으로 보존한다.
- `docs/ROADMAP.md` 의 M5-1 "Claude Desktop 스타일 UX" 항목은 본 가이드의 UI-1~UI-2 완료로 *자동 충족*.
- 모든 PR은 본 문서의 Phase ID(예: `[W3/G2]`, `[W4/UI-4]`)를 제목에 prefix로 다는 것을 권장.
- 본 문서가 갱신되면 `docs/ROADMAP.md` 와 의사결정이 충돌하지 않도록 같은 PR에서 동기화한다.
- 본 문서는 "살아있는 문서(living document)" — Phase 완료 시마다 §10 성공 지표 측정 결과를 부록 D로 누적 기록한다.

---

## 부록 D. Phase 회고 (Phase Retrospective, 갱신 예정)

각 Phase 종료 시 다음 양식으로 누적:

```
### Wn 회고 — YYYY-MM-DD
- 완료된 체크리스트 항목: …
- 성공 지표 측정값: …
- 발견된 새 리스크: …
- 다음 Phase에 인계할 미해결 이슈: …
- 회고 의사결정: (열린 결정사항 §12 중 어느 것이 해소됐는지)
```

> 첫 회고는 W1 종료 시점에 작성한다.
