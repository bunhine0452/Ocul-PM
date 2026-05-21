# AI-PM 유스케이스 갭 보완 계획 (GAP-PLAN)

> **목적**: README/ROADMAP에 정의된 *"코드를 직접 수정하지 않고 개발자의 소통과 프로젝트 관리를 돕는 LLM 조력자"* 라는 정체성을 실제 핵심 유스케이스 3종(① 초기 프로젝트 사용자, ② 기존 프로젝트 유지보수 사용자, ③ 바이브 코딩 사용자) 관점에서 재검증하고, 현재 구현과 사이에 존재하는 갭을 메우기 위한 상세 구현 계획을 정의한다.
>
> **위치**: 본 문서는 `docs/ROADMAP.md`의 M5 이후, 또는 M3/M4와 병렬로 추진할 수 있는 "기능 확장 트랙(Functional Expansion Track)"이며, 기존 마일스톤을 대체하지 않고 보완한다.
>
> **작성일**: 2026-05-20

---

## 0. 핵심 유스케이스 재정의

### UC-1. 초기 프로젝트 사용자 (Greenfield User)
- 아직 코드베이스가 없거나, 빈 폴더에서 시작하는 사용자.
- 무엇을 만들지에 대한 *아이디어*만 있는 상태에서, AI와 대화하며 프로젝트의 **목적/기술 스택/디렉터리 구조/초기 마일스톤**을 합의해 나가야 함.
- 첫 커밋이 만들어지기까지 AI가 옆에서 "동료 PM" 역할을 해줘야 함.

### UC-2. 기존 프로젝트 유지보수 사용자 (Brownfield User)
1. 기존 프로젝트 폴더 불러오기.
2. 파일 인덱싱 후 **프로젝트의 구조·방향성·각 파일의 목적**을 한눈에 파악 가능해야 함.
3. 수정하고 싶은 부분을 사용자가 자연어로 설명 → 시스템이 의도를 *정확하게* 파싱하여 고급 LLM(Claude Code, Cursor 등)에 전달할 **프롬프트로 가공**.
4. 사용자가 외부 LLM으로 코드를 수정한 뒤 돌아오면, 시스템이 **변경사항을 자동 감지**.
5. 기존 코드와의 차이를 분석하여 **오늘자 Changelog**에 자연어로 누적 저장 → 사용자는 시간이 흐른 뒤에도 "왜 이렇게 바뀌었는지"의 흐름을 추적할 수 있어야 함.
6. 1~5 반복.

### UC-3. 바이브 코딩 사용자 (Vibe Coder)
- LLM에 막연한 지시(예: *"이거 좀 예쁘게 해줘"*, *"버튼 추가"*)만 보낼 수 있는 사용자.
- 본인이 의도를 명확히 표현하지 못하므로, 시스템이 **clarifying question**으로 의도를 좁혀줘야 함.
- 결과물이 의도와 맞는지 검증할 능력도 부족하므로, 변경사항을 **자연어로 다시 설명**해주는 사후 피드백 루프가 필요.

---

## 1. 현재 구현 상태 매핑 및 갭 도출

| 유스케이스 단계 | 현재 구현 | 위치 | 상태 |
|---|---|---|---|
| UC-2-1 프로젝트 불러오기 | `select_project_folder` + `create_project` | `src-tauri/src/commands/project.rs`, `src/features/projects/ProjectsPanel.tsx` | ✅ 충족 |
| UC-2-2 인덱싱 | `index_project` + 임베딩 + AST 파싱 | `indexer.rs`, `ast.rs` | ✅ 충족 |
| UC-2-2 구조 파악 | 의존성 그래프 + 심볼 리스트 | `DependencyGraphView.tsx` | ⚠️ 부분 — "프로젝트 목적/방향성"의 **자연어 요약 없음** |
| UC-2-3 수정 의도 파싱 | `generate_edit_prompt` | `commands/project.rs:484` | ⚠️ 부분 — **clarifying question 루프 없음** |
| UC-2-3 영어 프롬프트 생성 | LLM 호출 → 영어 프롬프트 + 한국어 요약 | `AssistPanel.tsx` | ✅ 충족 |
| UC-2-4 변경사항 감지 | `detect_file_changes` (Blake3 해시 비교) | `commands/project.rs:378` | ✅ 충족 |
| UC-2-5 Changelog 누적 | `file_changes` 테이블에 *경로/타입/해시*만 저장 | `db.rs:1085`, `migrations/006_file_changes.sql` | ❌ **미충족 (핵심 갭)** |
| UC-2-5 변화 흐름 가시화 | 일별/주별 타임라인 뷰 없음 (현재 `ChangelogView`는 단순히 프로젝트의 `CHANGELOG.md` *파일을 읽는* 용도) | `GitPanel.tsx` 내 ChangelogView | ❌ **미충족 (핵심 갭)** |
| UC-1 신규 프로젝트 온보딩 | 기존 폴더 불러오기 전제 | — | ❌ **미충족** |
| UC-3 모호한 의도 보정 | 입력 그대로 LLM에 전달 | `AssistPanel.tsx` | ❌ **미충족** |

> **결론**: 현재 앱은 UC-2 "기존 프로젝트 유지보수" 유스케이스의 **앞 단(2-1 ~ 2-4)에는 강하나, 뒷 단(2-5: changelog 흐름 추적)이 사실상 비어 있음**. 그리고 UC-1, UC-3은 진입점 자체가 없음.

---

## 2. 갭 우선순위 및 임팩트 매트릭스

| 갭 ID | 설명 | 임팩트 | 구현 난이도 | 우선순위 |
|---|---|---|---|---|
| **G1** | 자동 Changelog 엔트리 생성 (UC-2-5) | ★★★★★ | 중 (DB 확장 + LLM 호출 + 뷰) | **P0** |
| **G2** | 프로젝트 개요 요약 패널 (UC-2-2) | ★★★★ | 중 (1회 LLM 호출 + 캐싱) | **P0** |
| **G3** | AssistPanel Clarifying Question 단계 (UC-3) | ★★★ | 낮 (대화 상태 + 1-2회 LLM 왕복) | **P1** |
| **G4** | Greenfield 프로젝트 온보딩 위저드 (UC-1) | ★★★ | 높 (신규 화면 + 템플릿 + 디렉터리 생성) | **P2** |

---

## 3. G1 — 자동 Changelog 엔트리 생성

### 3.1. 사용자 가치
- 사용자가 외부 LLM으로 코드를 수정한 직후, "오늘 무엇이 어떻게 왜 바뀌었는지" 자연어로 자동 정리되어 영구 저장됨.
- 일별·주별·월별 타임라인을 따라가며 코드베이스의 변화 흐름을 회고할 수 있음.
- Git 커밋 메시지를 안 쓰거나 못 쓰는 바이브 코딩 사용자에게는 *사실상의 작업 로그*가 됨.

### 3.2. 현재 구현의 한계
현행 `file_changes` 테이블에는 다음 컬럼이 있다 (`migrations/006_file_changes.sql`):

```sql
CREATE TABLE IF NOT EXISTS file_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','modified','deleted')),
  old_hash TEXT,
  new_hash TEXT,
  detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
  summary TEXT  -- ⚠️ 컬럼은 있으나 한 번도 채워지지 않음
);
```

- `summary` 컬럼은 이미 존재하지만 `insert_file_change` (`db.rs:1085`)에서 NULL로만 들어감.
- **diff 본문**(어떤 라인이 추가·삭제·수정됐는지)은 어디에도 저장되지 않음.
- 사용자 의도(예: "로그인 페이지에 소셜 로그인 추가")와 실제 변경된 파일들 간의 **연결 고리**가 없음. 즉, 두 달 뒤에 변경 이력을 봐도 "이 파일들이 왜 이때 같이 수정됐는지" 알 수 없음.

### 3.3. 신규 데이터 모델

#### 3.3.1. 마이그레이션 `007_changelog.sql`
```sql
-- 일별 Changelog 엔트리: 사용자의 한 번의 "수정 세션" = 한 개의 entry
CREATE TABLE IF NOT EXISTS changelog_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 사용자가 최초로 입력한 한국어 요청 (예: "로그인 페이지에 소셜 로그인 추가")
  user_intent TEXT,
  -- generate_edit_prompt 가 만들어낸 영어 프롬프트 원본 (감사 추적용)
  prompt_text TEXT,
  -- LLM이 변경된 코드를 보고 작성한 자연어 요약 (Markdown 허용)
  ai_summary TEXT NOT NULL,
  -- 변경 규모 통계
  files_changed INTEGER NOT NULL DEFAULT 0,
  lines_added   INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  -- 사용자 분류 라벨 (feature/fix/refactor/docs/chore 등)
  category TEXT,
  -- 사용자가 직접 수정 가능한 한 줄 제목 (없으면 ai_summary 첫 문장 자동 사용)
  title TEXT,
  -- 외부 LLM 도구 (claude-code, cursor, gemini-cli 등) 식별자 (선택)
  external_tool TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- 사용자가 별표로 마킹한 중요 엔트리
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_changelog_project_date
  ON changelog_entries(project_id, created_at);

-- 엔트리에 속한 개별 파일 변경 (기존 file_changes를 entry에 묶음)
CREATE TABLE IF NOT EXISTS changelog_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES changelog_entries(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','modified','deleted','renamed')),
  -- 통계
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  -- 정규화된 unified-diff (압축 저장; 너무 큰 파일은 head/tail만)
  diff_patch TEXT,
  -- 파일별 LLM 한 줄 요약 (예: "AuthContext에 OAuthProvider 인터페이스 추가")
  per_file_summary TEXT,
  old_hash TEXT,
  new_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_changelog_files_entry
  ON changelog_files(entry_id);

-- 기존 file_changes는 "raw event"로 유지하되, entry_id 외래키를 추가하여
-- 그룹핑 가능하도록 확장
ALTER TABLE file_changes ADD COLUMN entry_id INTEGER
  REFERENCES changelog_entries(id) ON DELETE SET NULL;
```

#### 3.3.2. Rust 타입 추가 (`db.rs`)
```rust
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChangelogEntry {
    pub id: u32,
    pub project_id: u32,
    pub user_intent: Option<String>,
    pub prompt_text: Option<String>,
    pub ai_summary: String,
    pub title: Option<String>,
    pub category: Option<String>,
    pub external_tool: Option<String>,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub created_at: u32,
    pub pinned: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct ChangelogFileEntry {
    pub id: u32,
    pub entry_id: u32,
    pub file_path: String,
    pub change_type: String,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub per_file_summary: Option<String>,
    pub diff_patch: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct DailyChangelogBucket {
    pub date: String,             // ISO yyyy-mm-dd (로컬 타임존 기준)
    pub entries: Vec<ChangelogEntry>,
    pub total_files: u32,
    pub total_lines_added: u32,
    pub total_lines_removed: u32,
}
```

### 3.4. 신규 백엔드 커맨드 (`commands/changelog.rs` 신설)

| 커맨드 | 입력 | 출력 | 설명 |
|---|---|---|---|
| `commit_changelog_entry` | `project_id`, `user_intent`, `prompt_text`, `provider`, `model`, `external_tool?` | `ChangelogEntry` | (1) `detect_file_changes` 호출 → (2) 변경된 파일들의 unified-diff 생성 → (3) 각 파일별 + 전체 요약 LLM 호출 → (4) entries/files/file_changes 삽입 (트랜잭션) |
| `list_changelog_entries` | `project_id`, `from?`, `to?`, `category?`, `limit?` | `Vec<ChangelogEntry>` | 기간/카테고리 필터링 |
| `list_changelog_by_day` | `project_id`, `days?` (default 30) | `Vec<DailyChangelogBucket>` | 타임라인 뷰용 일별 버킷 |
| `get_changelog_entry` | `entry_id` | `(ChangelogEntry, Vec<ChangelogFileEntry>)` | 디테일 + 파일별 diff |
| `update_changelog_entry` | `entry_id`, `title?`, `category?`, `pinned?` | `ChangelogEntry` | 사용자가 수동 보정 |
| `delete_changelog_entry` | `entry_id` | `()` | 잘못 생성된 엔트리 제거 (file_changes는 entry_id NULL로) |
| `regenerate_changelog_summary` | `entry_id`, `provider`, `model` | `ChangelogEntry` | 요약만 재생성 |
| `export_changelog_markdown` | `project_id`, `from?`, `to?` | `String` | 표준 Keep-a-Changelog 포맷으로 마크다운 export |

### 3.5. Diff 생성 전략

#### 3.5.1. 기준 콘텐츠 확보
- `detect_file_changes`는 현재 신구 *해시*만 비교하므로, 사용자가 코드를 수정하기 전 *원본 내용*에 접근할 수 없는 구조.
- 두 가지 후보:
  1. **인덱싱 시 원본 스냅샷 저장**: `file_snapshots(project_id, file_path, content_zstd, captured_at)` 테이블 추가. 인덱싱/이전 changelog 커밋 시점에 갱신.
  2. **Git 통합 우선**: 프로젝트가 git 저장소면 `git diff HEAD -- <path>`로 차이를 추출. 비-git 프로젝트만 (1) 사용.
- **권장**: (2) → (1) 폴백. 이미 `src-tauri/src/git.rs`가 있으므로 git2 또는 외부 git CLI 호출로 빠르게 구현 가능. 저장 공간/메모리 절약.

#### 3.5.2. 큰 파일 처리
- 단일 파일 diff가 64KB 초과 시: head 32KB + `--- truncated N lines ---` + tail 32KB.
- 바이너리 파일: `diff_patch = NULL`, `per_file_summary = "(binary file)"`.

### 3.6. LLM 요약 프롬프트 설계

#### 3.6.1. 파일별 마이크로 요약 (per-file)
- 각 파일의 diff를 받아 1~2문장의 "이 파일에서 무엇이 바뀌었는지"를 한국어로 출력.
- `temperature=0.2`, `max_tokens=120`. 비용 최소화.
- 변경 파일이 N개일 때 **병렬 호출**하되, provider 별 동시성 제한(예: anthropic 5)을 두어 rate-limit 회피.

#### 3.6.2. 전체 요약 (entry-level)
- 입력: 사용자 원본 의도 + 파일별 마이크로 요약 N개 + 통계 (+lines/-lines/files).
- 출력: 다음 JSON
  ```json
  {
    "title": "한 줄 제목 (≤60자)",
    "ai_summary": "마크다운 본문 (Why / What / How 섹션)",
    "category": "feature | fix | refactor | docs | test | chore",
    "tags": ["auth", "ui"]
  }
  ```
- 시스템 프롬프트는 `Keep a Changelog` 스타일과 conventional-commits 카테고리를 가이드로 제시.

#### 3.6.3. 토큰 비용 관리
- per-file 요약은 diff 본문이 8KB 초과 시 첫 4KB만 입력 (요약 품질 손실은 manageable).
- entry-level 요약은 항상 micro-summary만 받으므로 입력 크기 상한 명확 (≤ N × 200 토큰).

### 3.7. 프론트엔드 UI

#### 3.7.1. 신규 라우트/탭
- `GitPanel.tsx` 내 `GitView` 타입에 `"timeline"` 추가, 또는 사이드바에 **"Changelog"** 독립 탭 신설.
- 기존 `ChangelogView`(프로젝트의 `CHANGELOG.md` 파일을 읽는 뷰)는 `"changelog-file"` 로 명칭 정리.

#### 3.7.2. 타임라인 뷰 (`features/changelog/TimelinePanel.tsx`)
```
┌─ 2026-05-20 (오늘) ──────────────────────────  3 entries · +312 / -88
│  ▣ [feature]  소셜 로그인 버튼 추가              15:42 · 4 files
│     └ AuthContext.tsx, LoginPage.tsx, ...
│  ▢ [fix]      RAG 검색 결과 중복 제거            13:10 · 1 file
│  ▣ [refactor] DependencyGraphView 뷰포트 가상화 11:05 · 2 files
│
├─ 2026-05-19 ─────────────────────────────────  5 entries · +621 / -402
│  ...
```
- 좌측 컬러 바 = 카테고리, 별표 = pinned.
- 클릭 시 우측 패널에 `EntryDetail` 슬라이드: 한국어 요약 / 영어 프롬프트(원본) / 파일별 diff 트리.

#### 3.7.3. AssistPanel 연동
- 기존 `AssistPanel`의 "다음 단계" 안내 (현재 `AssistPanel.tsx:550~`)에 다음 추가:
  - 단계 4 → **"변경사항을 Changelog에 저장하기"** 버튼 (= `commit_changelog_entry` 호출).
  - 클릭 시 진행 모달: "변경 감지 중 → diff 생성 중 → AI 요약 중 → 저장 완료" 단계별 토스트.
- 저장 직후 타임라인 뷰로 이동(또는 작은 "→ Changelog 보기" 링크 노출).

### 3.8. 엣지 케이스
- **외부에서 수정하지 않았는데 사용자가 저장 버튼을 눌렀을 때**: `detect_file_changes`가 빈 결과 → "변경된 파일이 없습니다" 알림 후 entry 생성 안 함.
- **사용자가 의도를 입력하지 않고 곧바로 저장한 경우**: `user_intent`/`prompt_text` NULL 허용. 요약 프롬프트는 diff만 보고 추정.
- **요약 LLM 실패**: micro-summary는 NULL로 두고 entry는 "(요약 실패 — 재생성 가능)" placeholder로 저장. 추후 `regenerate_changelog_summary`로 복구.
- **동일 파일 반복 수정**: file_changes의 raw event는 시간순 누적 보존, 단 entry 단위에서는 *마지막 상태*의 diff만 저장.
- **`detect_file_changes` 중 인덱싱 미실행 신규 파일**: `change_type='created'`로 기록되지만 vector DB에는 아직 없음 → entry 저장 후 사용자에게 "재인덱싱 권장" 배너 노출.

---

## 4. G2 — 프로젝트 개요 요약 패널

### 4.1. 사용자 가치
- 코드베이스를 처음 열었을 때 "이 프로젝트가 뭐 하는 앱이고, 어떤 디렉터리에 무엇이 들어 있는지" 1분 안에 파악.
- 의존성 그래프와 달리, **자연어 서술**이라 비개발자/PM도 읽을 수 있음.

### 4.2. 데이터 모델

#### 4.2.1. 마이그레이션 `008_project_overview.sql`
```sql
CREATE TABLE IF NOT EXISTS project_overviews (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- 한 줄 정체성
  identity TEXT,
  -- 기술 스택 자동 감지 결과 (JSON: {"framework": "...", "languages": [...], ...})
  stack_json TEXT,
  -- 마크다운 본문 (디렉터리별 역할, 주요 진입점, 외부 의존성, 아키텍처 흐름)
  overview_md TEXT,
  -- 인덱싱 후 본문이 LLM에 입력된 핵심 신호 (재생성 일관성용)
  source_signature TEXT,
  generated_at INTEGER,
  generated_by_model TEXT
);
```

### 4.3. 백엔드 커맨드
| 커맨드 | 동작 |
|---|---|
| `generate_project_overview` | (1) README/package.json/Cargo.toml/주요 entry 파일들을 모아 신호 텍스트 구성 (2) AST 통계(언어별 파일 수, 의존성 hub 노드 top 10) 합산 (3) LLM에 보내 마크다운 작성 (4) `project_overviews` upsert |
| `get_project_overview` | 캐시된 overview 반환 (없으면 null) |
| `refresh_project_overview_if_stale` | 인덱싱 종료 훅 — `source_signature`가 바뀌었을 때만 (3) 재실행 |

### 4.4. UI
- `ProjectsPanel.tsx`의 최상단(또는 별도 `"Overview"` 서브탭)에 카드 노출.
- 섹션: **정체성 한 줄 · 기술 스택 chips · 디렉터리 가이드 · 주요 진입점 · 아키텍처 흐름 다이어그램 링크**.
- 우상단에 "🔄 다시 생성" 버튼 (모델 선택 가능).
- 사용자가 직접 편집 가능 (Markdown editor); 사용자 편집 후에는 `source_signature` 무효화하지 않음 — 즉 자동 재생성은 사용자 편집을 덮어쓰지 않고 별도 "Diff 보고 수동 병합" 모달을 열어줌.

### 4.5. 성능/비용
- 신호 텍스트 상한: 24KB. 초과 시 README + entry 파일 우선, 나머지는 파일명만.
- 첫 인덱싱 직후 1회 + 사용자 명시 요청 시에만 호출 → 평균 사용자당 LLM 호출 < 5회/주.

---

## 5. G3 — AssistPanel Clarifying Question 단계

### 5.1. 사용자 가치
- 바이브 코딩 사용자가 *"버튼 좀 추가해줘"* 처럼 모호하게 입력해도, 시스템이 "어느 페이지요? 어떤 동작이요?"를 1~2회 되물어 의도를 좁힘.
- 외부 LLM에 보내는 프롬프트 품질 향상 → 결과물 재시도 횟수 감소 → 실질적 토큰 절감.

### 5.2. 흐름
```
[사용자 입력] → (LLM A: 모호도 평가)
                   ├─ 모호도 낮음 → 기존 generate_edit_prompt 흐름
                   └─ 모호도 높음 → 1~3개 객관식/주관식 질문 생성
                                      ↓
                                   [사용자 답변 수집]
                                      ↓
                                  (LLM B: 정제된 의도 + 컨텍스트로 영어 프롬프트 생성)
```

### 5.3. 백엔드 변경
`generate_edit_prompt`를 두 단계로 분리:
- `clarify_edit_intent(project_id, user_request, provider, model)` → 다음 JSON 반환
  ```json
  {
    "ambiguity_score": 0.78,
    "questions": [
      { "id": "q1", "kind": "choice", "text": "어느 페이지요?", "options": ["로그인", "프로필", "설정"] },
      { "id": "q2", "kind": "text",   "text": "어떤 동작을 해야 하나요?" }
    ],
    "auto_proceed": false
  }
  ```
- `generate_edit_prompt_with_answers(project_id, user_request, answers, provider, model)` → 기존과 동일한 `EditPromptResult` 반환. `answers`를 user_request에 자연어로 합쳐서 RAG·LLM에 전달.

### 5.4. UI
- `AssistPanel.tsx`의 "프롬프트 생성하기" 버튼을 누르면 먼저 clarify 단계로 진입.
- `ambiguity_score < 0.4`이면 질문 단계 건너뜀(투명).
- 질문 UI: 컴팩트한 카드 + 라디오/체크박스/짧은 입력 + "건너뛰기" 옵션.
- 답변 후 자동으로 영어 프롬프트 생성으로 진행.

### 5.5. 비용
- clarify 단계: 입력 토큰 ≤ 500, 출력 ≤ 300 → 호출당 약 $0.001 (Sonnet 4.6 기준 미만). 사용자 경험 개선 대비 무시할 수준.

---

## 6. G4 — Greenfield 프로젝트 온보딩 위저드

### 6.1. 사용자 가치
- "처음부터" 사용자: 폴더만 정하면 AI와 대화하며 프로젝트 정체성/스택/디렉터리/초기 마일스톤이 자동으로 합의·생성됨.
- 결과적으로 G2의 `project_overviews`와 G1의 `changelog_entries` 첫 번째 엔트리가 자연스럽게 채워진 상태로 UC-2 흐름에 진입.

### 6.2. 위저드 단계
1. **위치 선택**: 빈 폴더 선택 또는 신규 폴더 이름 입력.
2. **아이디어 인터뷰**: AI가 단계별 질문 (목적/타겟 사용자/주요 기능 3가지/배포 형태).
3. **스택 추천**: 답변을 기반으로 2~3개 후보 스택 제시, 사용자 선택.
4. **스캐폴딩**: 선택된 스택의 표준 디렉터리 + 필수 설정 파일 생성 (또는 `create-vite`, `cargo new` 등 외부 CLI 호출 옵션 제공).
5. **첫 마일스톤**: G2 overview 자동 생성 + Planner에 3~5개 초기 goal 시드.

### 6.3. 백엔드 변경
- `commands/project.rs` 에 `create_greenfield_project(name, root_path, blueprint_json)` 추가.
- 스캐폴딩 로직은 **외부 CLI 위임 우선** (`pnpm create vite`, `cargo new`) — 자체 템플릿 유지 부담 회피.
- 새 테이블 `project_blueprints`(선택): 사용자가 자주 쓰는 인터뷰 답변 프리셋 저장.

### 6.4. UI
- `App.tsx`의 "프로젝트 추가" 버튼 옆에 `+ 신규 만들기` 버튼.
- 스텝퍼 형태의 모달 (`features/projects/GreenfieldWizard.tsx`).
- 마지막에 자동으로 인덱싱 → overview 생성 → 메인 화면 진입.

### 6.5. 위험 요소
- 외부 CLI 호출 권한/플랫폼 차이 (Windows `pnpm` vs macOS). → 각 OS별 PATH 검사 + 수동 명령 안내 fallback.
- 사용자가 위저드를 끝내지 못하고 중단 → "초안 저장" 기능으로 다음에 이어서 진행.

---

## 7. 통합 사용자 흐름 (After Gap Closure)

### 7.1. UC-2 (기존 프로젝트) Full Loop
```
폴더 선택 → 인덱싱 → [G2: 자동 Overview 생성] → 사용자 readout
   ↓
"X를 수정하고 싶어" 입력
   ↓
[G3: clarifying 질문 (필요 시)]
   ↓
generate_edit_prompt → 영어 프롬프트 → 클립보드 → 외부 LLM(Claude Code 등)
   ↓
사용자 복귀
   ↓
[G1: 변경 감지 → diff 생성 → AI 요약 → Changelog entry 저장]
   ↓
타임라인 뷰에서 오늘의 변경 누적 확인
   ↓
(반복)
```

### 7.2. UC-1 (Greenfield) Bootstrap
```
[G4: 위저드] → 스캐폴딩 → 인덱싱 → [G2: Overview]
   ↓
첫 changelog entry (= "프로젝트 초기 생성") 자동 기록
   ↓
이후 UC-2 흐름으로 합류
```

### 7.3. UC-3 (Vibe Coder) Safety Net
- 입력 단계: G3가 의도 보정.
- 출력 단계: G1의 한국어 자연어 요약이 "내가 뭘 한 거지?"를 사후 설명.
- 두 단계 모두 영어/기술 지식 없이도 워크플로 폐쇄 가능.

---

## 8. 구현 단계 (Phased Rollout)

### Phase 1 (2주) — G1 핵심
- [ ] 마이그레이션 `007_changelog.sql` 작성·검증
- [ ] `commands/changelog.rs` 신설: `commit_changelog_entry`, `list_changelog_by_day`, `get_changelog_entry`
- [ ] git 통합 diff 추출 유틸 (`git.rs` 확장)
- [ ] LLM 요약 프롬프트 템플릿 (`llm/prompts/changelog_*.md`)
- [ ] `features/changelog/TimelinePanel.tsx` + Entry Detail 슬라이드
- [ ] `AssistPanel.tsx` 에 "Changelog에 저장" 버튼 통합
- [ ] e2e: "외부 수정 → 저장 → 타임라인 노출" 골든 패스 검증

### Phase 2 (1주) — G2
- [ ] 마이그레이션 `008_project_overview.sql`
- [ ] `commands/project.rs` 에 overview 3종 커맨드
- [ ] 인덱싱 완료 훅에 `refresh_project_overview_if_stale` 연결
- [ ] `ProjectsPanel.tsx` Overview 카드

### Phase 3 (1주) — G3
- [ ] `generate_edit_prompt` 분리 (`clarify_edit_intent` + `generate_edit_prompt_with_answers`)
- [ ] `AssistPanel.tsx` 의 conditional clarify UI

### Phase 4 (2~3주) — G4
- [ ] Greenfield 위저드 모달
- [ ] 스택 카탈로그 + 외부 CLI 통합
- [ ] Planner 시드 goal 생성

각 Phase는 독립적으로 머지 가능하도록 feature flag (`settings.feature_changelog_v2` 등) 뒤에서 점진 배포.

---

## 9. 데이터 모델 영향 요약

```
projects ─┬─< project_overviews          (G2, 1:1)
          ├─< changelog_entries          (G1)
          │     └─< changelog_files      (G1)
          ├─< file_changes  (entry_id 추가됨, G1)
          ├─< files (기존)
          ├─< conversations (기존)
          ├─< goals (기존)
          └─< chunks / ast_* (기존)
```

마이그레이션은 누적 적용 가능하며, 기존 데이터에 대해 **파괴적 변경 없음** (ALTER ADD COLUMN, CREATE TABLE 만 사용).

---

## 10. 비기능 요구사항 (NFR) 영향

| 항목 | 영향 | 대응 |
|---|---|---|
| 콜드 스타트 | overview 캐시 1회 SELECT 추가 (≤ 5ms) | 무시 가능 |
| Changelog 저장 레이턴시 | N개 파일 × per-file LLM + 1× entry LLM | 병렬화로 직렬 시간 ≈ max(per-file) + entry. 3~5초 목표 |
| 메모리 | diff_patch 압축 저장 (zstd 권장) | 큰 diff truncation + zstd로 평균 < 4KB/file |
| 오프라인 동작 | G1/G2/G3 모두 LLM 필요 → 오프라인 시 사용 불가 | "오프라인 모드: 변경 감지만 기록, 요약은 추후" placeholder 엔트리 지원 |
| 토큰 비용 | 일 평균 5~15회 changelog × ~3K 토큰 ≈ < $0.30/일 (Sonnet 4.6 기준) | 사용자 설정으로 요약용 모델 별도 지정 (Haiku 권장) |

---

## 11. 보안 및 프라이버시

- diff_patch에 사용자 코드(잠재적 비밀 포함) 그대로 저장 → 다음 보호:
  - DB 파일은 OS-수준 권한(`~/.config/ai-pm/...`)에 위치하며 별도 암호화 옵션은 후속 과제.
  - LLM 호출 시 **시크릿 추정 패턴** (`/(api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i`) 마스킹 후 전송.
  - 사용자에게 "Changelog는 코드 본문을 로컬에 저장합니다. LLM에는 마스킹 후 전송됩니다." 첫 사용 시 1회 고지.
- 사용자가 `export_changelog_markdown` 으로 외부 공유 시 diff_patch 포함 여부 선택 가능 (기본 OFF).

---

## 12. 측정 지표 (Success Metrics)

각 갭이 의도한 가치를 실제로 전달하는지 검증하기 위한 in-app 지표 (옵트인 텔레메트리, 향후 도입 시):

| 지표 | 목표 |
|---|---|
| Changelog entry 자동 생성률 (= entry / detect_file_changes 횟수) | > 70% |
| Overview 패널 일일 활성 사용자 비율 | > 50% |
| Clarify 단계 발동률 | 25~40% (너무 낮으면 무의미, 너무 높으면 귀찮음) |
| 외부 LLM 재시도 횟수 (사용자 추정 입력) | G3 도입 후 평균 30% 감소 |
| Greenfield 위저드 완료율 | > 60% |

---

## 13. 열린 질문 (Open Questions)

1. **Diff 저장 기간**: 90일 후 자동 삭제 옵션 vs 영구 보존 — 사용자 설정으로 둘 것인가?
2. **외부 LLM 도구 자동 감지**: 클립보드 모니터링/단축키로 Claude Code/Cursor 사용 여부 자동 라벨링 가능?
3. **그룹핑 휴리스틱**: 사용자가 명시적으로 "저장" 누르지 않아도, "10분 내 변경된 파일들"을 자동 묶음 처리할까?
4. **Changelog ↔ Planner 연동**: changelog entry가 plan의 goal/subtask와 연결되면, "이 goal에 대해 실제로 무엇이 구현됐는지" 추적 가능. 별도 RFC로 다룰 가치 있음.
5. **다국어 요약**: 현재는 한국어 고정. 사용자 설정으로 영어/일본어 등 전환 필요한가?

---

## 14. 부록 — 영향받는 파일 목록 (참고)

### 신규
- `src-tauri/migrations/007_changelog.sql`
- `src-tauri/migrations/008_project_overview.sql`
- `src-tauri/src/commands/changelog.rs`
- `src-tauri/src/llm/prompts/changelog_per_file.md`
- `src-tauri/src/llm/prompts/changelog_entry.md`
- `src-tauri/src/llm/prompts/project_overview.md`
- `src/features/changelog/TimelinePanel.tsx`
- `src/features/changelog/EntryDetail.tsx`
- `src/features/projects/OverviewCard.tsx`
- `src/features/projects/GreenfieldWizard.tsx`
- `src/features/assist/ClarifyDialog.tsx`

### 수정
- `src-tauri/src/db.rs` — 신규 struct, query 메서드
- `src-tauri/src/lib.rs` — 신규 커맨드 등록
- `src-tauri/src/git.rs` — diff 추출 유틸 확장
- `src-tauri/src/commands/project.rs` — `generate_edit_prompt` 분리, overview 커맨드
- `src/features/assist/AssistPanel.tsx` — clarify 흐름 + changelog 저장 버튼
- `src/features/projects/ProjectsPanel.tsx` — Overview 카드 통합
- `src/features/git/GitPanel.tsx` — 기존 ChangelogView 명칭 정리
- `src/App.tsx` — Changelog 탭 추가, 위저드 트리거
- `src/lib/bindings.ts` — tauri-specta 자동 재생성

---

## 15. 참고

- 본 계획은 `docs/ROADMAP.md` 의 M5 시리즈와 **병렬 트랙**으로 진행 가능.
- 모든 신규 LLM 호출은 기존 `llm.rs` 추상화를 통해 OpenAI/Anthropic/Gemini 모두 지원.
- 각 Phase 종료 시 ROADMAP.md 에 완료 체크박스를 추가하고, 본 문서의 해당 섹션에 ✅ 마킹.
