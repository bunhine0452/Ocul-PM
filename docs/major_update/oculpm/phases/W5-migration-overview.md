# W5 — Migration + Overview 재포지셔닝

> **목표**: 기존 SQLite changelog 데이터를 `.oculpm/journal/` 로 무손실 변환할 수 있고, Overview 가 집계/메타 뷰로 재포지셔닝되어 자기 자리를 잡는다.
> **기간**: 1주.
> **선행 조건**: W4 의 §7 핸드오프 5개 항목 모두 ✅. **자동 dogfooding 으로 W5 작업 자체가 기록되어야 한다** (안 되면 W4 가 미완).

---

## 0. 이 페이즈가 끝나면 보이는 그림

- 기존 SQLite changelog 가 있는 프로젝트에서 onboarding 이후 마이그레이션 모달이 뜬다.
- dry-run → 백업 → 실행 → 결과 화면의 4단계 UX 가 완성.
- 마이그레이션 후 entry 카운트가 SQLite 카운트와 일치.
- 실패 시 자동 롤백, 부분 성공 시 사용자에게 명확한 보고.
- Overview 가 4 위젯 (ActivityHeatmap, DifficultyMix, AgentBreakdown, UnfinishedChecklist) + Recent Sessions 표로 재포지셔닝.
- 모든 위젯 클릭 → Today 의 해당 날짜로 이동.
- "구 changelog 데이터 삭제" 가 별도 명시 컨펌 + 안전장치 후 가능.

---

## 1. PR 분해

### W5-PR1 — `migrate_from_sqlite.rs` 핵심 알고리즘 + dry-run

**Files**:
- `src-tauri/src/oculpm/migrate_from_sqlite.rs` (new)

```rust
pub async fn dry_run(db: &Db, project_id: u32, root: &Path, resolver: &WorkdayResolver) -> Result<MigrationPlan, OculpmError>;
pub async fn execute(db: &Db, project_id: u32, root: &Path, resolver: &WorkdayResolver, plan: MigrationPlan) -> Result<MigrationReport, OculpmError>;
```

**`MigrationPlan`**:
```rust
pub struct MigrationPlan {
    pub project_id: u32,
    pub source_entry_count: u32,
    pub by_workday: Vec<MigrationWorkdayPlan>,
    pub conflicts: Vec<MigrationConflict>,
    pub backup_dir: PathBuf,
    pub forbidden_path_hits: u32,
    pub estimated_bytes_written: u64,
}

pub struct MigrationWorkdayPlan {
    pub workday: String,
    pub synthetic_session_count: u32,
    pub entries: Vec<MigrationEntryPlan>,
}

pub struct MigrationEntryPlan {
    pub source_entry_id: u32,
    pub target_relative_path: String,
    pub type_inferred: EntryType,
    pub slug: String,
    pub session_id: String,
    pub forbidden_files: Vec<String>,    // 이 entry 의 파일들 중 forbidden 매치
    pub will_skip: bool,                 // 사용자가 confirm 한 후의 final flag
}

pub struct MigrationConflict {
    pub source_entry_id: u32,
    pub conflicting_target_path: String,
    pub resolution: ConflictResolution,  // SuffixAdded | Skipped
}
```

**dry-run 알고리즘**:
1. SQLite 의 `changelog_entries` 전체 fetch.
2. for entry in entries:
   - workday = `resolver.workday_of(entry.created_at)`
   - hhmm = `resolver.hhmm_of(entry.created_at)`
   - type = entry.category 매핑 (없으면 "chore", "bug"/"feat" 류 휴리스틱).
   - slug = `slugify(entry.user_intent)`.
   - target_path = `{workday}/{Bugs|...}/{hhmm}_{type}_{slug}.md`.
   - 충돌 검사 (이번 plan 내 중복 + 디스크 충돌).
   - forbidden 검사 (이 entry 의 file_paths 중 forbid_journal_for_paths 매치).
3. 그날의 entries 를 30분 단위로 클러스터링 → synthetic session 생성 (`migrated-{workday}-{N}`).
4. backup_dir = `{root}/.oculpm.backup-pre-migration-{ISO_TIMESTAMP}/`.
5. plan 반환.

**execute 알고리즘**:
1. 락 다시 확인 (acquire).
2. 워처 일시정지.
3. backup_dir 생성 + SQLite 의 관련 테이블 (changelog_entries, file_changes) 의 JSON 덤프.
4. for plan.by_workday:
   - `ensure_workday_dirs(workday)`.
   - synthetic sessions.json 작성 (sessions 합성: `agent_label_guess = "migrated"`).
   - for entry in entries (will_skip == false):
     - frontmatter 생성 (agent.id = "manual", `verified_by_user: true` — 사용자가 과거에 직접 만들었으므로).
     - body = entry.summary + 파일 변경 요약 (markdown 표).
     - `atomic_io::write_atomic(target_path, content)`.
     - report.success_count++
5. cache reindex.
6. report 반환.

**테스트**:
- 가짜 SQLite 에 30 entries 심어 dry_run → 카운트 일치.
- 충돌 (같은 분에 같은 slug) → suffix 자동 추가.
- forbidden path 가 포함된 entry → skip 으로 표시.
- execute 중 어느 단계에서 panic → 백업 살아있음 + journal 디스크에 부분 작성 → 다음 PR 의 롤백 코드가 정리.

**DoD**:
- [ ] 4개 테스트 통과.
- [ ] dry_run 이 plan 만 만들고 디스크 변경 X.

### W5-PR2 — 마이그레이션 롤백 + 부분 실패 처리

```rust
pub async fn rollback(db: &Db, project_id: u32, root: &Path, backup_dir: &Path) -> Result<RollbackReport, OculpmError>;
```

**알고리즘**:
1. backup_dir 의 manifest 읽기 (`manifest.json` — 백업 당시 어떤 파일을 어디에 썼는지).
2. 만들어진 journal 파일들 (manifest 의 created_paths) 삭제.
3. cache 의 해당 entries 삭제.
4. backup_dir 자체는 보존 (사용자가 수동 재확인 가능).
5. report.

**부분 실패 처리** (execute 중 panic 발생):
- `execute` 의 모든 write 은 `manifest.json` 에 즉시 append (각 entry write 후 한 줄).
- panic catch 후 `rollback` 자동 호출.
- 사용자에게: "마이그레이션 실패. 부분 작성된 N개 파일을 자동 정리했습니다. 백업은 보존."

**테스트**:
- execute 중간에 강제로 에러 발생 → manifest 기반 정리 → 디스크에 부분 파일 0개.
- backup_dir 안의 SQLite 덤프 보존 확인.

**DoD**:
- [ ] 2개 테스트 통과.
- [ ] rollback 후 cache 와 디스크가 마이그레이션 전 상태와 동일.

### W5-PR3 — 마이그레이션 커맨드 3개

```rust
async fn oculpm_migration_dry_run(project_id: u32) -> Result<MigrationPlan, String>;
async fn oculpm_migrate_from_sqlite(project_id: u32, plan: MigrationPlan) -> Result<MigrationReport, String>;
async fn oculpm_migration_rollback(project_id: u32, backup_dir_name: String) -> Result<RollbackReport, String>;
```

`dry_run` 은 매번 호출 가능 (read-only).
`migrate_from_sqlite` 는 plan 을 인자로 받음 (사용자가 모달에서 will_skip 토글한 결과 반영).
`rollback` 은 backup_dir 이름만 받아 그 백업으로 복원.

**DoD**:
- [ ] 3개 커맨드 invoke 성공.
- [ ] specta TS export.

### W5-PR4 — Frontend: `MigrationModal`

`src/features/projects/MigrationModal.tsx` — `02-frontend.md §10`.

**Flow**:

1. **Step 1 — 요약**: dry_run 결과 표시.
   - 총 entry 카운트.
   - 워크데이별 분포.
   - 예상 충돌 (있으면).
   - forbidden_path_hits (있으면 강조).
2. **Step 2 — 옵션**:
   - 각 entry 별 ☑ 체크박스 (디폴트 모두 체크).
   - forbidden 매치 entry 는 자동 unchecked + 강조 "민감 경로 포함 — 검토 후 선택".
3. **Step 3 — 백업 확인**:
   - 백업 경로 표시.
   - "백업 없이 진행" 옵션은 **없음** (안전 우선).
4. **Step 4 — 진행률**:
   - progress bar (websocket 으로 백엔드의 진행률 stream — 또는 polling).
   - 중간 취소 버튼 (현재 entry 완료 후 중단, 작성된 부분은 보존).
5. **Step 5 — 결과**:
   - 성공/실패/스킵 카운트.
   - 실패 entries 의 사유 목록.
   - [Today 로 이동] / [모달 닫기] / [구 데이터 삭제하기]
   - "구 데이터 삭제하기" 는 별도 확인 모달 (W5-PR7).

**디자인**: shadcn Dialog + Steps 컴포넌트.

**진행률 stream**: Tauri event `oculpm:migration_progress { processed, total, current_entry }` 를 백엔드가 emit, 프론트가 listen.

**DoD**:
- [ ] 5 step 모두 동작.
- [ ] forbidden 매치 entries 가 자동 unchecked.
- [ ] 중간 취소 동작.

### W5-PR5 — Frontend: OverviewScreen 재포지셔닝 + 4 위젯

`src/features/overview/OverviewScreen.tsx` — 기존 내용은 **헤더 박스 1줄 요약**으로 압축, 그 아래에 4 위젯 + RecentSessions 표가 자리한다 (deprecations §3.2 옵션 A 확정).

**ProjectMetaHeader 컴포넌트** (구 OverviewScreen 의 메타 표시를 흡수):

```
┌──────────────────────────────────────────────────────────────────────┐
│  ai-pm · Tauri 2 · React 19 · Rust (rusqlite, tokio)        [▼ 더보기]│
└──────────────────────────────────────────────────────────────────────┘
```

- 1줄 요약은 `generate_project_overview` / `get_project_overview` 의 결과를 압축 — `identity` (1~2단어) + `stack_json` 의 상위 3개 (프레임워크/언어/주요 라이브러리).
- `[▼ 더보기]` 클릭 → expanding panel 에 전체 `overview_md` 마크다운 렌더 + `refresh_project_overview_if_stale` 트리거 버튼.
- 클릭 안 한 상태가 디폴트. 펼침 상태는 localStorage 영속 (`oculpm.overview.header_expanded.${projectId}`).
- 1줄 요약이 길어 줄바꿈 필요 시 ellipsis + 펼침 유도.

**컴포넌트 트리**:

```
OverviewScreen
├── ProjectMetaHeader          # 1줄 요약 + 펼침 패널 (구 OverviewScreen 메타 흡수)
├── (위젯 4종 grid)
│   ├── ActivityHeatmap
│   ├── DifficultyMix
│   ├── AgentBreakdown
│   └── UnfinishedChecklist
└── RecentSessions             # 30일 표
```

**`ActivityHeatmap`** (90일):
- GitHub 스타일 캘린더 그리드.
- 각 셀 = 하루의 entry count + file_event_count 합산 점수.
- hover tooltip: "2026-05-22 · 8 entries · 47 file events".
- 클릭 → Today 의 그 날짜로 navigate.

**`DifficultyMix`**:
- 도넛 차트. 5개 difficulty 비율.
- legend 에 absolute count.
- 클릭 (difficulty 슬라이스) → Today 의 그 필터로.

**`AgentBreakdown`**:
- 가로 막대 차트. 5개 agent ID (4 + manual).
- 작성한 entry 수 + 점유율.
- 클릭 → Today 의 agent 필터 (필터 UI 확장 필요 — W5-PR6).

**`UnfinishedChecklist`**:
- `status != done` OR `checkbox == false` 인 entry 들 (최대 50개).
- date 순 desc.
- 각 entry 클릭 → Today 의 그 날짜 + entry 선택.

**`RecentSessions`** 표:
- 30일치 sessions, 날짜별 그룹.
- 컬럼: 날짜, 세션 수, 총 active_window, 파일 수, narrative 작성률 (= journal entries / sessions with file_events 비율).
- 클릭 → Today.

**모든 위젯 데이터 소스**: `oculpm_journal` + `oculpm_sessions_cache` SQLite 쿼리. 단일 페이지 fetch 1회.

**테스트** (Vitest):
- 90일치 가짜 데이터 → heatmap 의 셀 카운트 정확.
- 클릭 → Today navigate 호출.

**DoD**:
- [ ] 4 위젯 모두 표시.
- [ ] 클릭 → Today navigate 동작.
- [ ] 1000 entry 데이터에서 페이지 로드 ≤ 500ms.

### W5-PR6 — Today 의 agent 필터 확장 (W4 보완)

W4 의 CategoryFilterBar 에 agent 필터 추가:

```ts
type CategoryFilter = {
  ...
  agents: Set<string>;          // "claude-code", "cursor", "antigravity", "gemini-cli", "manual"
};
```

UI: 카테고리 chip 옆에 작은 "에이전트" 드롭다운. 멀티 선택.

**DoD**:
- [ ] agent 필터 토글 동작.
- [ ] Overview 의 AgentBreakdown 클릭과 연동.

### W5-PR7 — "구 SQLite changelog 데이터 삭제" 안전 액션

```rust
async fn oculpm_delete_legacy_changelog(project_id: u32, confirm_token: String) -> Result<DeletionReport, String>;
```

**보안장치**:
1. 마이그레이션이 성공한 이력이 있어야 함 (`MigrationReport.success_count > 0` + reportTimestamp 가 db 에 기록되어 있어야).
2. `confirm_token` = `migrated:<reportTimestamp>:<source_entry_count>` 의 형식. 모달이 받아서 보내는 식.
3. 삭제 전 한 번 더 백업 (별도 백업 폴더).
4. SQLite 의 changelog 관련 테이블 truncate.

**UI**: 빨간 모달 + 24자 슬러그 타이핑 컨펌 (`"delete-legacy-changelog"`).

**DoD**:
- [ ] confirm_token 불일치 시 거부.
- [ ] 마이그레이션 이력 없으면 거부.
- [ ] 삭제 후 SQLite 의 changelog_entries.count == 0.
- [ ] `.oculpm/.backup-legacy-deletion-{ts}/` 폴더 생성 확인.

### W5-PR8 — 통합 + 회귀 점검

- 기존 ChangelogScreen 이 마이그레이션 후에도 (구 데이터가 남아있다면) 정상 동작.
- 구 데이터 삭제 후 ChangelogScreen 진입 → 빈 상태 UI + "Today 로 이동" 안내.
- ChangelogScreen 에 노란 deprecated 배너: "이 화면은 1.0 부터 read-only 가 됩니다. Today 사용을 권장합니다."

**DoD**:
- [ ] 마이그레이션 전후 ChangelogScreen 정상.
- [ ] 구 데이터 삭제 후 빈 상태 UI.
- [ ] 회귀 X.

---

## 2. 핵심 기술 노트

### 2.1 `synthetic session` 클러스터링 알고리즘

목적: 기존 SQLite 의 changelog 들은 session 개념이 없으므로 합성해야 함.

알고리즘 (간단):
- 같은 워크데이 안의 entries 를 created_at ASC 정렬.
- 30분 간격이 벌어지면 새 session.
- session 1개의 시작/끝 = 그 session 의 entries 의 created_at min/max.

→ "migrated-20260522-001", "migrated-20260522-002" 식 ID.

대안: 모든 entries 를 그날 단일 session 으로. 더 단순하지만 timeline UI 가 덜 유용. → **30분 클러스터링 채택**.

### 2.2 type 추론

SQLite 의 category 필드가 있으면 그대로. 없으면 user_intent 의 키워드 휴리스틱:
- "fix", "버그", "오류", "에러" → bug
- "feat", "add", "기능", "추가" → feature
- "refactor", "리팩" → refactor
- "doc", "rename", "chore" → chore
- 그 외 → chore (안전한 기본값)

휴리스틱 실패 시 사용자가 마이그레이션 모달에서 entry 별로 type 을 조정 가능 (Step 2 의 옵션 확장).

### 2.3 마이그레이션의 멱등성

`execute` 가 중간에 죽었다가 사용자가 다시 시도 → manifest 가 있으면 거기서 이어서. (또는 사용자가 명시적으로 "처음부터" 선택.)

가장 안전한 길: dry_run 을 다시 돌려서 "이미 작성된" entries 는 `will_skip = true` 로 표시. 그 후 다시 execute.

### 2.4 백업 자동 정리

`config.toml` 에 `[migration] auto_delete_backup_after_days = 7` 추가. 앱 시작 시 7일 지난 백업 폴더는 자동 삭제 (사용자 토스트로 알림).

### 2.5 Overview 의 데이터 fetch 성능

90일 × 30 entries/day = 2700 entries 단위로 cache 쿼리. SQLite 인덱스 (workday, project_id) 로 ≤ 50ms 보장.

heatmap 셀별 카운트는 `GROUP BY workday` 하나의 쿼리로.

---

## 3. 단위/통합 테스트 매트릭스

| 영역 | 테스트 수 |
|---|---|
| `migrate_from_sqlite::dry_run` | 6 |
| `migrate_from_sqlite::execute` | 5 |
| `migrate_from_sqlite::rollback` | 3 |
| 충돌/forbidden 처리 | 4 |
| 마이그레이션 진행률 stream | 2 |
| OverviewScreen 4 위젯 (Vitest) | 5 |
| 구 데이터 삭제 안전장치 | 4 |

총 ~29. CI 1.5분 안.

---

## 4. 통합/수동 QA 체크리스트

- [ ] 신규 프로젝트 (SQLite changelog 0개) → 마이그레이션 모달 안 뜸
- [ ] 기존 프로젝트 (SQLite changelog 10+ 개) → onboarding 후 마이그레이션 모달
- [ ] dry_run 결과 카운트 = SQLite 카운트
- [ ] 충돌 케이스 (의도적 시드) → suffix 자동 추가 표시
- [ ] forbidden 매치 entries 자동 unchecked
- [ ] 마이그레이션 실행 → 진행률 표시 → 완료 → 결과 화면
- [ ] journal 디스크에 변환된 .md 파일 카운트 = success_count
- [ ] cache 가 자동 reindex 되어 Today 에 모든 entries 표시
- [ ] 백업 폴더 (`.oculpm.backup-pre-migration-...`) 존재 확인
- [ ] 마이그레이션 중간에 강제 종료 → 재시작 → rollback 자동 + 토스트
- [ ] Overview 의 ActivityHeatmap 90일 셀 표시
- [ ] DifficultyMix 도넛 슬라이스 클릭 → Today 의 difficulty 필터
- [ ] AgentBreakdown 막대 클릭 → Today 의 agent 필터
- [ ] UnfinishedChecklist 50개 표시 + 클릭 → Today 의 entry 선택
- [ ] 구 데이터 삭제: 슬러그 타이핑 미입력 → 버튼 disabled
- [ ] 구 데이터 삭제: 마이그레이션 이력 없으면 메뉴 자체 hidden
- [ ] 구 데이터 삭제 성공 → ChangelogScreen 빈 상태
- [ ] 회귀: 기존 화면들 모두 정상

---

## 5. 알려진 함정

| 함정 | 대응 |
|---|---|
| 사용자가 마이그레이션 중간에 앱 강제 종료 | manifest 기반 부분 정리. 다음 시작 시 자동 rollback. |
| 백업 폴더가 너무 큼 (수년치 데이터) | dry_run 의 estimated_bytes 가 100 MB 초과면 사용자에게 경고 |
| SQLite 의 timestamp 가 unix epoch 인데 timezone 정보 없음 | UTC 로 해석. resolver 가 workday 계산. 사용자가 다른 tz 였다면 frontmatter `created_at` 가 살짝 어긋남 — 경고 1회. |
| 변환된 entry 의 body 가 너무 길어서 (수십 KB) cache 부담 | 64KB cap, 초과는 truncate + tags 에 `body-truncated` |
| 사용자가 SQLite 변경 후 즉시 마이그레이션 (워처가 ndjson 갱신 전) | snapshot_open 새로 캡처 후 마이그레이션. race 방지. |
| Overview 의 heatmap 이 첫 사용자에게 90% 빈 그리드 | 빈 셀이 너무 많으면 "활동 30일치만 표시" 토글 디폴트 |

---

## 6. Definition of Done (W5 전체)

- [ ] 모든 PR 의 DoD ✅
- [ ] §4 의 수동 QA 18개 ✅
- [ ] 통합 테스트 `tests/oculpm_migration.rs` 6 시나리오 green
- [ ] 자동 dogfooding 데이터에 W5 작업의 자동 기록이 ≥ 80% 작성률
- [ ] 실제 마이그레이션 1회 수행 (본 ai-pm 프로젝트의 SQLite changelog 를 본 페이즈가 마이그레이션 — meta dogfooding)
- [ ] `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green

---

## 7. 다음 페이즈로 넘기는 것 (W6 의 선행 조건)

- [ ] 마이그레이션이 검증됨 — 실제 데이터로 1회 이상 무손실 변환.
- [ ] Overview 가 자기 역할로 자리잡음.
- [ ] 자동 dogfooding 4일치 데이터 누적 (W3 + W4 + W5 = 약 2주).
- [ ] 모든 핵심 흐름 (W1~W5) 이 동작. W6 는 안정화만.
