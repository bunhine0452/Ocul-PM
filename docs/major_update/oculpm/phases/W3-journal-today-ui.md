# W3 — Journal 인덱싱 + Today UI 골격 (+ 수동 dogfooding 시작)

> **목표**: 사용자가 `.oculpm/journal/<오늘>/Bugs/2055_bug_x.md` 를 손으로 떨궈 넣으면 Today 탭에서 1초 안에 카드로 보인다. **이 페이즈 종료 시점부터 수동 dogfooding 을 시작한다.**
> **기간**: 1주. (가장 무거운 페이즈)
> **선행 조건**: W2 의 §6 핸드오프 6개 항목 모두 ✅.

---

## 0. 이 페이즈가 끝나면 보이는 그림

- 프로젝트 진입 시 디폴트 탭이 **Today**.
- Today 화면이 타임라인(좌) + 디테일 패널(우) 의 두 영역으로 분할.
- 세션 단위로 collapsible 카드가 시간 역순으로 쌓이고, 그 안에 journal entry 카드들이 있다.
- 카테고리 필터바 (전체/Bug/Feature/Error/Refactor/Chore + verified_only + mismatch_only + 검색).
- 빈 상태 3 변형 모두 의도된 UI 로 노출.
- 사용자가 손으로 `.oculpm/journal/20260522/Bugs/2055_bug_test.md` 를 만들면 1초 안에 Today 에 반영.
- SQLite 캐시가 백엔드에서 자동으로 증분 갱신.
- **이 시점부터 사용자(나) 가 직접 journal entry 를 작성해보면서 W4 의 어댑터 템플릿을 다듬는다.**

---

## 1. PR 분해

### W3-PR1 — `frontmatter.rs` + `markdown.rs`

**`frontmatter.rs`**:

```rust
pub struct ParsedFrontmatter {
    pub raw_yaml: String,
    pub parsed: Option<JournalFrontmatter>,  // None = 깨짐, raw_yaml 만 보존
    pub parse_warnings: Vec<String>,
}

pub fn parse_frontmatter_and_body(markdown: &str) -> (ParsedFrontmatter, String /* body */);
pub fn write_frontmatter_and_body(fm: &JournalFrontmatter, body: &str) -> String;
```

알고리즘:
1. 앞 3줄이 `---\n` 으로 둘러싸인 YAML 인지 검사.
2. 없으면 `parsed: None, raw_yaml: ""`, body = markdown 전체.
3. 있으면 YAML 파싱 시도. 실패 시 `parsed: None` + warnings.
4. 성공 시 필수 필드 검증 (`schema_version`, `type`, `slug`, `status`, `created_at`, `session_id`, `agent.id`, `language` 8개).
5. 누락 필드는 warning + default 채워 `parsed`.

**`markdown.rs`**:

```rust
pub struct ParsedBody {
    pub title: String,             // 첫 줄에서 추출. "[x] ..." 또는 "# ..."
    pub checkbox: Option<bool>,    // None = 체크박스 없음, Some(true) = [x]
    pub headers: Vec<String>,      // ## 헤더만 추출
    pub raw: String,
}

pub fn parse_body(body: &str) -> ParsedBody;
```

`pulldown-cmark` 의 `Parser::new(body)` 로 이벤트 스트림 → 헤딩 추출.
첫 줄 정규식: `^\s*\[([ xX])\]\s+(.+)$` → checkbox + title. 매치 안 되면 첫 비공백 줄 그대로 title.

**테스트**:
- 정상 frontmatter + 본문 → 모든 필드 채워짐.
- frontmatter 없음 → `parsed: None`, body 전체 보존.
- YAML 안에 한국어 값 → 정상 파싱.
- created_at 이 ISO 가 아니면 → warning + 기본값.
- 본문 첫 줄 `[x] 제목` → checkbox=true, title="제목".
- 본문 첫 줄 `[ ] 제목` → checkbox=false.
- 본문 첫 줄 `# 제목` → checkbox=None, title="제목".
- 본문 안의 \`\`\`fenced \n## 가짜헤더\n\`\`\` → 헤더 추출에서 제외.

**DoD**:
- [ ] 8개 테스트 통과.
- [ ] 깨진 frontmatter 도 panic 없이 통과.

### W3-PR2 — `cache.rs` SQLite 테이블 + 증분 재인덱싱

**`db.rs` migration**: `01-backend.md §9` 의 4개 테이블 (`oculpm_journal`, `oculpm_journal_files`, `oculpm_journal_tags`, `oculpm_sessions_cache`) + `oculpm_settings`.

**`cache.rs`**:

```rust
pub struct JournalCache {
    db: Db,
}

impl JournalCache {
    pub async fn upsert_entry(&self, project_id: u32, entry: &JournalEntry) -> Result<(), OculpmError>;
    pub async fn delete_entry(&self, project_id: u32, relative_path: &str) -> Result<(), OculpmError>;
    pub async fn list_entries(&self, project_id: u32, workday: Option<&str>, filters: &EntryFilters) -> Result<Vec<JournalEntrySummary>, OculpmError>;
    pub async fn get_entry(&self, project_id: u32, relative_path: &str) -> Result<Option<JournalEntry>, OculpmError>;
    pub async fn reindex_full(&self, project_id: u32, root: &Path) -> Result<ReindexReport, OculpmError>;
    pub async fn reindex_incremental(&self, project_id: u32, root: &Path) -> Result<ReindexReport, OculpmError>;
}
```

**증분 알고리즘** (`reindex_incremental`):
1. `oculpm_journal` 의 모든 (relative_path, file_mtime) 를 메모리로.
2. `.oculpm/journal/**/*.md` 를 walkdir 로 순회.
3. 비교:
   - DB 에 없고 디스크에 있음 → parse + insert.
   - DB 에 있고 디스크에 없음 → delete.
   - mtime 다름 → re-parse + update.
   - mtime 같음 → skip.
4. report 반환.

**이벤트 트리거**: W2-PR5 의 `oculpm:journal_path_changed` 를 받아 (단일 파일에 대해) `upsert_entry` 또는 `delete_entry` 호출. 100ms 디바운스.

**테스트**:
- 빈 `.oculpm/journal/` → reindex_full → 0 entries.
- 손으로 .md 3개 떨굼 → 100ms 후 cache 3개.
- 1개 삭제 → 100ms 후 cache 2개.
- mtime 안 바뀐 파일 → reindex_incremental 이 그 파일 skip (로그 검사).

**DoD**:
- [ ] 4개 테스트 통과.
- [ ] 1000 entries 의 full reindex < 5초 (개인 노트북 기준).

### W3-PR3 — 커맨드 7개

W1, W2 의 커맨드 + 다음 추가:

```rust
async fn oculpm_list_journal_entries(project_id: u32, workday: Option<String>) -> Result<Vec<JournalEntrySummary>, String>;
async fn oculpm_get_journal_entry(project_id: u32, relative_path: String) -> Result<JournalEntry, String>;
async fn oculpm_set_journal_verified(project_id: u32, relative_path: String, verified: bool) -> Result<(), String>;
async fn oculpm_reindex_cache(project_id: u32) -> Result<ReindexReport, String>;
async fn oculpm_create_manual_entry(project_id: u32, draft: ManualEntryDraft) -> Result<JournalEntry, String>;
```

`oculpm_set_journal_verified` 는 **frontmatter 의 `verified_by_user` 필드만 수정**해 파일을 atomic rewrite. cache 도 갱신.

`oculpm_create_manual_entry` (수동 dogfooding 지원):
```rust
pub struct ManualEntryDraft {
    pub r#type: EntryType,
    pub slug: String,           // 사용자 입력
    pub title: String,
    pub difficulty: Option<Difficulty>,
    pub body_markdown: String,
    pub session_id: Option<String>,   // None 이면 현재 세션 또는 신규 manual session
    pub files_touched: Vec<FileTouched>,
}
```
프론트의 "수동 entry 작성" 모달이 이 커맨드를 호출. 백엔드가 frontmatter 채워서 atomic write.

**DoD**:
- [ ] 5개 커맨드 호출 성공.
- [ ] specta TS 자동 export.
- [ ] manual_entry 작성 → frontmatter 의 `agent.id == "manual"`.

### W3-PR4 — Frontend: specta wrapper + WorkspaceContext + 라우팅

**`src/api/oculpm.ts`** — `02-frontend.md §2.2` 의 래퍼 구현. 12개 메서드:
- init, getStatus, getConfig, setConfig
- getCurrentSession, startSessionManual, endSessionManual, listSessions
- getFileChanges, getIndexSnapshot
- listJournalEntries, getJournalEntry, setJournalVerified, reindexCache, createManualEntry
- watcherStart, watcherStop, watcherStatus

**`WorkspaceContext`** — 확장:
- `oculpmEnabled: boolean`
- `currentSession: Session | null`
- `workdayKey: string` (자정 넘기면 자동 갱신)
- `oculpmStatus: OculpmStatusView`

이벤트 listener (mount):
- `oculpm:session_started/ended` → currentSession 갱신
- `oculpm:journal_path_changed` → invalidateQueries(["oculpm", projectId, "journal"]) 또는 setState

**localStorage 마이그레이션** (`02-frontend.md §3` 의 `defaultTab` 패치):
- 기존 사용자 storage 의 `workspace.schema_version` 확인.
- 1 → 2: `defaultTab` 을 "today" 로 강제 (단, `defaultTabUserOverride: true` 면 기존값 유지).

**`App.tsx`** 변경:
- 사이드바 순서: Today (1st), Overview (2nd), Code, Chat, Git, Planner, Settings, ...
- Today 아이콘 옆에 unread verified 카운트 배지 (W4 까지는 미구현, 자리만).
- 프로젝트 진입 시 `navigate("/p/:id/today")` 로 자동 redirect.

**DoD**:
- [ ] 새 프로젝트 진입 시 디폴트 Today.
- [ ] 기존 사용자 storage 가 마이그레이션됨.
- [ ] DevTools 콘솔에 새 이벤트 listener 가 잡힌 로그 표시.

### W3-PR5 — `EmptyToday` 3 변형 + `OculpmOnboardingModal`

**EmptyToday 의 분기 조건** (`oculpm_get_status` + `oculpm_list_journal_entries` 결과 조합):

| 조건 | 변형 |
|---|---|
| `initialized == false` | **V1 — 비활성**: "ocul-pm 으로 이 프로젝트를 추적할까요?" + [활성화] 버튼 → Onboarding 모달 |
| `initialized == true && today entries 0개 && file_changes 0개` | **V2 — 시작 안 함**: "오늘은 아직 기록이 없습니다. 코드를 수정하면 자동 추적됩니다." + 수동 entry 작성 버튼 |
| `initialized == true && today entries 0개 && file_changes > 0` | **V3 — narrative 누락**: "오늘 N개 파일이 변경됐지만 narrative 가 작성되지 않았습니다." + 어댑터 상태 + DiffVsNarrative 보기 |

V3 는 외부 LLM 이 규칙을 안 따를 때 사용자가 즉시 인지하는 핵심 UI.

**`OculpmOnboardingModal`** — 3 step:

1. **소개**: "ocul-pm 이 이 프로젝트의 작업을 자동 기록할 수 있어요." (수동 changelog vs 자동 차이 그림)
2. **에이전트 선택** (W4 까지는 토글만, 실제 sync 는 W4): 감지된 에이전트 + 사용자 선택.
3. **요약 + 확인**: `.oculpm/`, `.gitignore` 변경, 어댑터 파일 경로 — 무엇이 어디에 생기는지 명시.

확인 → `oculpm_init` + `oculpm_set_active_agents` (W4 까지는 단순 저장).

거절 → `localStorage[oculpm_dismissed_${projectId}] = true`. 상단 상태바에만 "ocul-pm 비활성화 — 활성화" 링크 유지.

**DoD**:
- [ ] 3 변형 모두 의도된 모양으로 표시.
- [ ] V3 가 file_changes 있을 때 정확히 트리거됨.
- [ ] Onboarding 거절 후 재진입 시 모달 안 뜸.

### W3-PR6 — `TimelineView` + `SessionCard` + `JournalEntryCard`

**컴포넌트 트리 (TodayScreen 안)**:

```
TodayScreen
├── TodayHeader (날짜, workday, tz, 설정 톱니)
├── CategoryFilterBar (chip × 5 + verified_only + mismatch_only + 검색)
├── (mainArea split — left 70%, right 30%)
│   ├── TimelineView
│   │   ├── SessionCard (collapsible) × N
│   │   │   ├── SessionHeader (id, started_at, ended_at, file_event_count, agent_label_guess)
│   │   │   └── EntryList
│   │   │       └── JournalEntryCard × M
│   │   └── EmptyToday (sessions 0개일 때 inline 표시)
│   └── DetailPane (선택된 entry 있을 때만)
│       └── JournalEntryDetail
└── (footer status: workspace.watcherStatus, integrity warnings)
```

**`SessionCard` props/state**:
```ts
type Props = {
  session: Session;
  entries: JournalEntrySummary[];
  defaultExpanded: boolean;            // 오늘 첫 세션만 true
  selectedEntryPath?: string;
  onSelect: (path: string) => void;
};
```

표시 항목:
- 헤더: `Session 20260522-003 · 09:13 → 11:47 · 47 파일 · 12 unique · claude-code`
- 진행 중 세션은 `→ 진행 중` 표시 + 펄스 dot.
- entries 0 개면 "이 세션에 narrative 없음" + DiffVsNarrative 버튼 (W4 까지는 disable).

**`JournalEntryCard` 표시**:

```
┌────────────────────────────────────────────────────────────────────┐
│ [bug] [medium] [done]  09:25 · src-tauri/src/db.rs +1개 더 · ⚠ 미검증 │
│ Changelog Export 파라미터 불일치                                     │
│ #changelog #sqlite                                                  │
└────────────────────────────────────────────────────────────────────┘
```

호버:
- 호버 시 hover ring + cursor pointer.
- 우측에 작은 토글: ⚠ 미검증 ↔ ✓ 검증됨 (클릭 시 `setJournalVerified`).
- frontmatter 깨진 경우 노란 점 + tooltip "frontmatter 일부 오류".

**키보드**:
- `j/k` → 다음/이전 entry 선택.
- `space` → 선택 entry 의 verified 토글.
- `enter` → 디테일 패널 포커스.

**DoD**:
- [ ] 손으로 만든 .md 3개가 카드로 표시.
- [ ] 클릭 → 우측 디테일 패널 열림.
- [ ] j/k 키 동작.

### W3-PR7 — `JournalEntryDetail` (마크다운 렌더)

**구성**:
- 상단: FrontmatterBadge 들 (type, status, difficulty, agent, session 링크).
- 중간: 본문 마크다운 렌더링 — 기존 changelog 의 마크다운 렌더러 재사용 (코드 하이라이팅 포함).
- 하단: 액션 영역.
  - [Verify ✓ / 미검증으로 되돌리기]
  - [원본 파일 열기] — `tauri-plugin-opener` 로 OS file manager / 에디터 열기.
  - [Compare with index] — DiffVsNarrative 토글 (W3 에서는 자리만, W4 에서 동작).

**마크다운 렌더러 선택**: 기존 코드에 `react-markdown` 류가 이미 있는지 확인. 있으면 재사용. 없으면 `react-markdown` + `remark-gfm` 추가.

**body_markdown 안의 상대경로 이미지** (`./_attachments/...`):
- `.oculpm/journal/<workday>/_attachments/...` 를 base 로 해석.
- Tauri 의 `convertFileSrc` 로 변환해 안전 URL.

**DoD**:
- [ ] 본문에 코드 블록/리스트/이미지 정상 렌더.
- [ ] verified 토글 클릭 → frontmatter 파일이 실제로 업데이트되고 카드에도 반영.

### W3-PR8 — `CategoryFilterBar` (필터 상태 영속화)

**필터 상태**:
```ts
type CategoryFilter = {
  types: Set<EntryType>;          // 빈 set = 전체
  verifiedOnly: boolean;
  mismatchOnly: boolean;
  unfinishedOnly: boolean;        // checkbox === false || status !== "done"
  search: string;                 // 디바운스 200ms
};
```

**영속화**: `localStorage["oculpm.filter." + projectId]` JSON. 프로젝트별.

**UI**: shadcn 의 ToggleGroup + Input. 검색 아이콘 우측.

**검색 매치**: title + body_markdown + slug + tags. 대소문자 무시. 한국어 정상 매치.

**DoD**:
- [ ] 5개 type 필터 토글 동작.
- [ ] 검색 디바운스 동작 (input 매 키스트로크에 fetch 하지 않음).
- [ ] 새로고침 후 필터 상태 복원.

### W3-PR9 — 수동 dogfooding 부트스트랩

이건 코드 PR 이 아니라 **사용자(나) 자체의 작업 트리거**:

1. **이 페이즈 종료 직후** 사용자가 직접 `.oculpm/journal/<오늘>/Bugs/<HHMM>_bug_<slug>.md` 를 작성한다.
2. 최소 5개 entry (bug × 2, feature × 2, refactor × 1) 를 다양한 frontmatter 조합으로 시드.
3. 다음 항목을 기록 (`docs/major_update/oculpm/phases/_dogfooding-w3.md` 에):
   - 각 entry 작성에 걸린 시간.
   - frontmatter 작성 시 헷갈렸던 필드.
   - 본문 강제 섹션이 자연스러웠는지.
   - UI 가 잘못 표시한 케이스.
4. 발견된 이슈는 **W4 의 어댑터 템플릿에 반영**. 예:
   - "created_at 의 timezone 형식이 헷갈림" → 어댑터 템플릿에서 명시적 예시 강조.
   - "slug 길이 60자가 너무 길어서 파일명이 길다" → 어댑터 템플릿에서 권장 40자로 제한.

이 단계는 W4 의 어댑터 템플릿 품질을 좌우하므로 시드는 **최소 5개, 가능하면 그 주의 실제 작업**.

**DoD**:
- [ ] `_dogfooding-w3.md` 파일이 생성되고 5+ entries 의 회고가 기록됨.
- [ ] 그 중 1개 이상이 W4-PR1 (어댑터 템플릿) 의 PR 본문에서 인용됨.

---

## 2. 핵심 기술 노트

### 2.1 specta 와 frontend 빌드 순서

specta 가 export 한 TS 타입을 프론트가 import 하려면, 백엔드 변경 후 `pnpm tauri dev` 를 한 번 돌려야 binding 파일이 갱신된다. CI 에서는 `pnpm tauri build` 가 자동으로 한다. 로컬에서는 매 PR 마다 한 번 더 dev 를 돌리는 습관.

### 2.2 SQLite 캐시의 손실 가능성

**핵심 약속**: cache 는 언제든 `oculpm_reindex_cache` 로 .oculpm/journal/ 에서 재생성 가능. 따라서 cache 가 깨져도 데이터 손실 X.

증분 reindex 알고리즘이 mtime 만 보는데, **파일 내용 변경 없이 mtime 만 바뀌는 경우** (예: `touch`) → 불필요한 re-parse. 무해하지만 비효율. 후속 최적화 옵션: body_md_hash 비교.

### 2.3 `react-markdown` 의 XSS

journal 본문은 사용자 또는 LLM 이 쓰지만, 단일 사용자 환경 + 로컬 only 이므로 XSS 위험은 작음. 그래도 `rehype-sanitize` 기본 schema 적용.

### 2.4 Today 의 새로고침 전략

3 단계:
1. **Mount 시**: `listJournalEntries(workday)` + `listSessions(workday)` 일괄 fetch.
2. **이벤트 기반**: `oculpm:journal_path_changed` 가 오면 해당 entry 1개만 `getJournalEntry` 로 fetch + 캐시 갱신.
3. **포커스 복귀**: tab visibility 가 visible 로 바뀌면 전체 재요청 (혹시 다른 인스턴스가 썼을 가능성).

### 2.5 가상화 (큰 리스트)

journal entry 가 하루 100개 넘는 경우는 드물 것 (개인 1인). 가상화는 W6 에서 성능 측정 후 결정. W3 에서는 일반 렌더링.

---

## 3. TodayScreen 시안 (위임 결정 #4)

### 3.1 데스크탑 1440 와이어

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ ☰  ai-pm  ›  Today                                                   [⚙ 설정]║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   Today · 2026-05-22 (목)                  workday 20260522 · KST · 03:00시작║
║                                                                              ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │ [전체] [버그] [기능] [에러] [리팩] [잡일]  ·  □ 미검증만  □ mismatch만 │ ║
║  │                                                       [🔍 검색      ]  │ ║
║  └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                              ║
║  ┌─────────────────────────────────────────────┬────────────────────────┐ ║
║  │ ▼ Session 20260522-003 · 진행 중            │  Detail               │ ║
║  │   09:13 → ⋯ · 47 파일 (12 unique)           │                        │ ║
║  │   guess: claude-code                        │  [bug] [medium] [done]│ ║
║  │                                             │  [agent: claude-code] │ ║
║  │   ┌─────────────────────────────────────┐   │                        │ ║
║  │   │ [bug] [medium] [done] · ⚠ 미검증    │   │  Changelog Export     │ ║
║  │   │ Changelog Export 파라미터 불일치    │   │  파라미터 불일치       │ ║
║  │   │ 09:25 · src-tauri/src/db.rs +1     │   │                        │ ║
║  │   │ #changelog #sqlite                  │   │  ## 발생 원인          │ ║
║  │   └─────────────────────────────────────┘   │  `Db::list_changelog_ │ ║
║  │   ┌─────────────────────────────────────┐   │  entries` 의 SQL 빌더 │ ║
║  │   │ [feat] [high] [in_progress] · ✓     │   │  가 since=None 분기.. │ ║
║  │   │ Chat + QuickEdit 통합               │   │                        │ ║
║  │   │ 10:01 · 6개 파일                    │   │  ## 해결 방법          │ ║
║  │   └─────────────────────────────────────┘   │  ...                  │ ║
║  │                                             │                        │ ║
║  │ ▼ Session 20260522-002 · 06:50 → 08:30      │  [✓ 검증]  [📂 원본]  │ ║
║  │   ...                                       │  [⚖ index 비교]       │ ║
║  │ ▶ Session 20260522-001 · 02:01 → 03:12      │                        │ ║
║  └─────────────────────────────────────────────┴────────────────────────┘ ║
║                                                                              ║
║  ● 워처 정상 · cache 동기화 · 0 경고                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 3.2 작은 화면 (1024) 적응

- 1280 미만: 디테일 패널이 사이드 → 모달로.
- 768 미만: 카테고리 필터바 chip 들이 가로 스크롤.

### 3.3 상태별 인터랙션 매트릭스

| Trigger | 결과 |
|---|---|
| 카드 클릭 | DetailPane 에 entry 로드 + URL 쿼리 `?entry=...` 갱신 |
| 카드 더블클릭 | DetailPane + 원본 파일 OS 에서 열기 |
| 카드 우클릭 | 컨텍스트 메뉴: 검증/해제, 원본 열기, 복사 (markdown), 삭제 (확인) |
| 카드 hover | 우측 ✓ 토글 표시 + ⌨ shortcut hint |
| Session 헤더 클릭 | 펼침/접힘 |
| 필터 chip 클릭 | 토글, URL/localStorage 동기 |
| 검색 input | 200ms 디바운스 → list 재요청 |
| `j` / `k` | 다음/이전 카드 선택 (Detail 자동 로드) |
| `space` | 선택 카드 verify 토글 |
| `cmd+enter` | DetailPane 의 "Verify" 클릭 |
| `cmd+shift+j` | "수동 entry 작성" 모달 (W3) |
| `cmd+shift+s` | 세션 수동 시작/종료 토글 |
| `cmd+f` | 검색 input 포커스 |
| `esc` | DetailPane 닫기 |
| 우측 [⚖ index 비교] | DiffVsNarrative (W4 까지 disabled, hover tooltip "다음 페이즈") |

### 3.4 디자인 토큰 (Tailwind 임시)

```
type badge:
  bug      → bg-red-100   text-red-800     dark:bg-red-950/40   dark:text-red-300
  feature  → bg-green-100 text-green-800   dark:bg-green-950/40 dark:text-green-300
  error    → bg-amber-100 text-amber-800   dark:bg-amber-950/40 dark:text-amber-300
  refactor → bg-blue-100  text-blue-800    dark:bg-blue-950/40  dark:text-blue-300
  chore    → bg-zinc-100  text-zinc-800    dark:bg-zinc-800/60  dark:text-zinc-300

difficulty (농도):
  superhigh → opacity-100 + 좌측 dot
  high      → opacity-90
  medium    → opacity-80
  low       → opacity-60
  verylow   → opacity-40

status:
  done        → 체크박스 [x] 채워짐
  in_progress → 점 회전 애니메이션
  planned     → 빈 체크박스
  abandoned   → 취소선 + opacity 50%

warning:
  미검증     → 우상단 회색 dot
  mismatch  → 노란 ⚠ 아이콘
  parse error → 빨간 ⚠ 아이콘
```

(W4 에서 디자인 시스템 토큰화 정리 — 우선 인라인 클래스로 구현, 이후 토큰화.)

---

## 4. 단위/통합 테스트 매트릭스

| 영역 | 테스트 수 |
|---|---|
| `frontmatter::parse` | 8 |
| `frontmatter::write` 라운드트립 | 2 |
| `markdown::parse_body` | 8 |
| `cache::upsert/delete/list` | 4 |
| `cache::reindex_incremental` | 4 |
| Today UI (Vitest) - empty 변형 분기 | 3 |
| Today UI - 카테고리 필터 | 3 |
| Today UI - 키보드 단축키 | 2 |

총 ~34 개. CI 1분 안.

---

## 5. 통합/수동 QA 체크리스트

- [ ] `.oculpm/journal/20260522/Bugs/0900_bug_test.md` 손으로 만들고 1초 안에 Today 에 카드 표시
- [ ] 그 파일 삭제 → 1초 안에 카드 사라짐
- [ ] 파일 내용만 수정 (frontmatter title 변경) → 카드 제목 갱신
- [ ] frontmatter 일부러 깨뜨림 (`type: ` 빈 값) → 카드 노란 dot, detail 에서 원본 보기 가능
- [ ] 5개 type 필터 토글 OK
- [ ] 검색 "export" → 매치 카드만 표시
- [ ] verified 토글 → 파일 frontmatter 실제로 변경 (cat 확인)
- [ ] j/k 키 동작
- [ ] EmptyToday V1 (`.oculpm/` 없는 새 프로젝트): "활성화" 카드
- [ ] EmptyToday V2 (init 했는데 오늘 0개, file_changes 0개): "코드 수정하세요" 카드
- [ ] EmptyToday V3 (오늘 file_changes 있지만 journal 0개): "narrative 누락" 카드 + DiffVsNarrative 버튼 (disabled OK)
- [ ] Onboarding 모달 3 step 완주
- [ ] Onboarding 거절 → 재진입 시 모달 안 뜸, 상단 링크 유지
- [ ] 디폴트 탭이 Today
- [ ] 기존 사용자 storage 가 마이그레이션됨 (devtools 로 확인)
- [ ] manual entry 작성 → agent.id == "manual"

---

## 6. 알려진 함정

| 함정 | 대응 |
|---|---|
| LLM 이 (W4 전엔 사람이) frontmatter 들여쓰기를 잘못 → YAML 파싱 실패 | fail-soft. body 는 보임. 노란 dot 으로 사용자 인지. |
| `created_at` 의 timezone offset 누락 ("2026-05-22T09:00:00") | warning, UTC 로 해석. 사용자에게 "tz 명시 권장" 토스트는 미검증 토글 누를 때 한 번. |
| 같은 슬러그로 두 번 작성 → 파일명 충돌 | atomic_io 가 `__2` suffix 자동 추가 |
| 파일이 다른 워크데이로 잘못 들어감 (사용자가 폴더명 오타) | cache 가 폴더명에서 workday 파싱 — 파싱 실패면 노란 dot + Today 의 오늘에 안 보이고 "기타" 섹션에 표시 |
| 큰 본문 (100 KB+) 의 매번 cache 저장 부담 | body_md_hash 가 같으면 db update 생략 |
| react-markdown 의 코드블록 syntax highlight 가 무거움 | `prism` lazy load. 디테일 패널 열릴 때만. |

---

## 7. Definition of Done (W3 전체)

- [ ] 모든 PR 의 DoD ✅
- [ ] §5 의 수동 QA 15개 ✅
- [ ] 통합 테스트 `tests/oculpm_journal_indexing.rs` 5 시나리오 green
- [ ] dogfooding 시드 entry 5개 + 회고 `_dogfooding-w3.md`
- [ ] 시안 (§3) 과 실제 UI 가 80% 이상 일치 (디자인 디테일 잔작업은 W4 마무리)
- [ ] `cargo test`, `cargo clippy`, `pnpm test`, `pnpm tauri build` 모두 green

---

## 8. 다음 페이즈로 넘기는 것 (W4 의 선행 조건)

- [ ] 손으로 작성한 journal 이 Today UI 에서 보이는 상태 (자동 작성 X).
- [ ] cache 가 실시간 증분 갱신 (`oculpm:journal_path_changed` 트리거).
- [ ] EmptyToday V3 (file_changes 있는데 journal 없는 상태) 의 UI 가 살아있음 — W4 의 어댑터 sync 가 완성되면 이 변형이 점차 줄어들 것.
- [ ] dogfooding 회고가 어댑터 템플릿(`agents/_template.md`) 의 첫 draft 에 인용 가능한 형태.
- [ ] "수동 entry 작성" 모달이 동작 — W4 자동화의 fallback 으로 항상 살아있어야 함.
