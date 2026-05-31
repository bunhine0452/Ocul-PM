# 02. 화면 명세 — 8 screens

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) U3~U6 + [`01-ia-and-shell.md`](./01-ia-and-shell.md) §1.2 의 9 슬롯 중 화면이 있는 8 개의 *인터랙션 · 데이터 · 상태* 명세.
> 시각 SSOT: [`Ocul-PM1.0/src/`](./Ocul-PM1.0/src/) 의 5 jsx (today / journal-diff / planner-search / terminal-ai-settings / shell).

각 화면은 다음 4 단으로 기술:
- **§Goal** — 이 화면이 사용자에게 주는 1 줄 가치
- **§Layout** — 시각 골격 + 주요 영역 식별자
- **§Data** — 표시되는 데이터의 출처 (backend command / context state)
- **§Interaction** — 클릭 / 호버 / 단축키 / 라우팅 동작
- **§Edge** — 빈/로딩/에러 + 이슈 노트

---

## 1. Today (⌘1)

### Goal
*"오늘 무엇이 바뀌었는지를 한 화면에서 본다."*

### Layout

```
Toolbar:  [Today] [PROJECT.today]                   [⌘K 검색 박스] [전체 일지 →]
────────────────────────────────────────────────────────────────────────
.today-hero (greet + date · primary 버튼 "오늘 변경 검토")
.stat-row (4 stat cards)
.grid-2:
  LEFT  (1.55fr)
    .card 오늘의 하이라이트 (MiniEntry × N — entry id 목록)
    .card 어제 마무리한 작업 (MiniEntry × N)
  RIGHT (1fr)
    .card-pad 이번 주 작업량 (.week-row 7 막대)
    .card 에이전트별 기여 (agent-list)
    .card 다음 할 일 (next-item × N — subtask id 목록)
```

### Data

| 영역 | 출처 |
|---|---|
| stat (changedToday, filesTouched, linesAdded, linesRemoved, cyclesRecovered) | `oculpmApi.getTodayBrief(projectId)` (신규 backend command — workday 기준 집계) |
| week | 동 command 의 7-day rolling 필드 |
| agents | 같은 workday 의 journal entries 의 `agent.id` group-by |
| highlights | `oculpmApi.getTodayHighlights(projectId, limit=3)` — 점수 기준 (cycles > 0 우선, 그 다음 라인 변경량) |
| yesterdayDone | 어제 workday 의 `status: done` entries (limit 3) |
| next | `commands::list_planner_subtasks(filter: active OR next-up)` (limit 3) |

### Interaction

- **MiniEntry 클릭** → `go("journal", { focus: entry.id })`. 작업 일지 화면이 마운트되고 해당 카드에 1.6s ring-highlight.
- **"오늘 변경 검토" primary** → `go("diff")`.
- **Toolbar 검색 박스** → `go("search")` (실제 input focus 는 search 화면에서).
- **next-item 클릭** → `go("planner")` (해당 goal 의 카드 자동 expand).
- **단축키**: ⌘N → ManualEntry 모달 (수동 일지). ⌘R → reindex 트리거.

### Edge

- **빈 (오늘 작업 0)**: hero greet 가 "오늘 아직 기록이 없어요" + 4 stat 모두 0. 하이라이트/어제 섹션은 empty hint. 이 경우 *primary 버튼 라벨이 "AGENTS.md 배포 확인"* 로 변환 (마스터 프롬프트가 LLM 에 도달했는지 점검 동선).
- **로딩**: 4 stat skeleton + grid-2 skeleton.
- **에러**: `oculpmApi` 실패 시 *오늘 데이터 영역만* 에러 카드 + 재시도, hero 영역은 정상 표시.

---

## 2. 작업 일지 (⌘2)

### Goal
*"AI 에이전트가 남긴 모든 markdown 일지를 시간순으로 본다."*

### Layout

```
Toolbar:  [작업 일지] [N건의 자동 기록]           [scope-chip × 6: 전체/기능/버그/리팩토링/에러/잡일]
────────────────────────────────────────────────────────────────────────
.page (maxWidth 820)
  day-label "오늘 · YYYY-MM-DD"
  .tl (vertical timeline, padding-left 30px)
    .tl-node × N
      .tl-dot (trigger 색의 도트)
      JournalCard
  day-label "어제 · YYYY-MM-DD"
  ...
```

### Data

- `commands::list_journal_entries(project_id, day_range)` — workday 기준 그룹.
- 각 entry: `{ id, trigger, day, time, agent, title, summary, files[], tags[], cycles? }`.
- 필터링은 *프론트 클라이언트사이드* (entries N ≤ 수천 가정).

### Interaction

- **JournalCard 클릭** → `go("diff", { entry: entry.id })`. 변경 diff 화면에서 해당 entry 의 files 만 미리 표시.
- **focused entry** (route.params.focus) → 마운트 시 카드에 ring-highlight 1.6s + scrollIntoView.
- **scope-chip 클릭** → 필터 즉시 적용. URL state 영속화 (`WorkspaceContext.journalFilter`).
- **⌘F** → in-page 검색 (title + summary substring).
- **⌘N** → ManualEntry 모달 (현재 workday 의 새 entry).

### Edge

- **빈**: empty hint + AGENTS.md 안내. 마스터 프롬프트 미배포 시 "AGENTS.md 가 프로젝트에 없습니다" 경고 + "복사" 버튼.
- **필터로 0**: 해당 필터 hint ("기능 entry 가 없어요").
- **시간순 정렬**: 항상 newest first. 다른 정렬 옵션 없음 (1.0).

### Note
- *cycles* (에러 사이클 재시도 횟수) 가 있는 entry 는 `cycle-flag` chip 으로 표시.
- *agent* 표시는 `Bot` 아이콘 + 에이전트 이름 평문.

---

## 3. 변경 diff (⌘3)

### Goal
*"커밋 전 변경된 파일들을 로컬에서 즉시 검증한다."*

### Layout

```
Toolbar:  [변경 diff] [PROJECT.branch · N개 파일 변경]   [+add −del] [통합|분할] [검토 완료]
────────────────────────────────────────────────────────────────────────
.diff-screen (grid 260px 1fr, height 100%)
  .diff-files (좌측, 260px)
    .diff-files-head "변경된 파일"
    .dfile × N  (A/M 배지 + path + +add −del)
  .diff-main (우측, 1fr)
    .diff-bar (파일 경로 + 상태 chip + +add −del + 외부 에디터 버튼)
    .diff-code (.hunk-head + .dl 행)
      각 행: dl-gut(old) dl-gut(new) dl-x(코드)
      footer: "이 diff는 로컬 작업 폴더 스냅샷 기준입니다"
```

### Data

- `commands::diff_for_project(project_id, mode: "git" | "snapshot")` — Lite-W6 PR6.6 의 hybrid path.
- 파일별 hunks 는 `similar` crate (snapshot) 또는 `git diff --no-color` (git) 출력 파싱.

### Interaction

- **dfile 클릭** → 우측 main 갱신. 마지막 active 는 `WorkspaceContext.diffActivePath` 로 영속화.
- **통합 / 분할 토글** → side-by-side mode (≥1024px 폭 시) 또는 unified. [`../07-implementation-checklist.md`](../07-implementation-checklist.md) §0.6 의 기본 모드 결정 준수.
- **외부 에디터 버튼** → 사용자가 Settings 에 등록한 명령 실행 (`code "%path"` default).
- **"검토 완료" primary** → 현재 diff 의 모든 파일을 *읽음* 표시. `WorkspaceContext.diffReadPaths` 에 push.
- **단축키**: ⌘F → in-file 검색. j/k → 파일 목록 이동.

### Edge

- **변경 없음**: empty hint "이 브랜치엔 아직 변경이 없어요" + git status 출력 표시.
- **git 저장소 아님**: 자동으로 snapshot fallback. footer 에 "스냅샷 기준" 표시.
- **큰 hunk**: 우측 main 스크롤. 파일별 collapse 가능 (1.0 옵션 — [`../07-implementation-checklist.md`](../07-implementation-checklist.md) §0.6 의 collapse 결정 준수).
- **"AI 에게 이 변경 설명"** 액션 → diff-bar 우상단 액션 (1.0 옵션 — 같은 §0.6).

---

## 4. Planner (⌘4)

### Goal
*"주 단위 목표 → 분 단위 일지 entries 의 연결을 본다."*

### Layout

```
Toolbar:  [Planner] [goal → subtask → 작업 일지로 자동 연결]   [필터 진행중] [+ 새 목표]
────────────────────────────────────────────────────────────────────────
.page (maxWidth 880)
  .goal-card × N
    .goal-head (chevron + Target + 제목 + 진행률)
    .subtask × M (체크 + 제목 + entries 카운트)
```

### Data

- `commands::list_goals(project_id, status?)` — 기존 Lite 와 동일.
- 각 goal: `{ id, title, due, status: active|planned|done, progress, subtasks[] }`.
- subtask 의 `entries` = 해당 subtask 와 *연결된 journal entries 수* (마스터 프롬프트의 `related[]` 또는 frontmatter `goal:` 참조).

### Interaction

- **goal-head 클릭** → expand / collapse. 영속화 `WorkspaceContext.plannerOpen: Record<goalId, boolean>`.
- **+ 새 목표 (⌘N)** → 모달 (`GoalForm.tsx`).
- **subtask 의 entries chip 클릭** → `go("journal", { filter: subtaskGoal })`.
- **체크박스 클릭** → done 토글 (`commands::update_subtask(done)`).
- **drag-drop**: 1.1 로 미룸 (현재 정렬은 manual).

### Edge

- **빈**: "첫 목표를 만들어보세요" + primary 버튼.
- **필터 진행중 → 0**: hint + "전체 보기" link.

---

## 5. 코드 검색 (⌘5)

### Goal
*"자연어 또는 코드로 코드베이스를 의미 단위 검색."*

### Layout

```
Toolbar:  [시맨틱 코드 검색] [PROJECT.name · 로컬 인덱스]   [chip: N개 심볼 인덱싱됨]
────────────────────────────────────────────────────────────────────────
.search-hero (max 720, 중앙 정렬)
  .search-big (46px 큰 input + 클리어 버튼)
  .search-scope (chip 3: 의미 검색 / 심볼 / 정확히 일치)
.search-results (max 880, 중앙 정렬)
  .card.sresult × N
    .sresult-head (FileCode + path + sym chip + L범위 + score bar)
    .scode (라인번호 + 코드, 첫 줄 하이라이트)
```

### Data

- 의미 검색 (`scope=semantic`) → `commands::semantic_search(query, top_k=20)` (현재 백엔드 그대로).
- 심볼 (`scope=symbol`) → `commands::symbol_search(query)` (tree-sitter AST 인덱스 직접 조회).
- 정확 일치 (`scope=text`) → ripgrep-like backend grep.

### Interaction

- **마운트 시 input auto-focus**.
- **scope-chip 토글** → 즉시 재검색.
- **결과 카드 클릭** → 외부 에디터 열기 (Settings 의 명령).
- **단축키**: ⌘F → input focus, ⌘N → 빈 input + reset.

### Edge

- **빈 query**: empty hint.
- **결과 0**: "다른 키워드로 시도해보세요" + 최근 검색 chip 5 개.
- **인덱스 미완료**: progress chip "인덱싱 중 · N / M" + 검색 비활성.

### Note
- **⌘K 와의 분리**: ⌘K = 명령 팔레트 (open Today, run reindex, switch project 등). ⌘5 = 코드 검색. 두 화면이 *완전히 다른 책임*.

---

## 6. 터미널 (⌘6)

### Goal
*"외부 LLM CLI 를 같은 앱 안에서 실행하고, 일지가 쌓이는 걸 옆에서 본다."*

### Layout

```
Toolbar:  [터미널] [에이전트 실행을 감지해 자동으로 일지를 작성합니다]   [chip 변경 감시중] [+ 새 세션]
────────────────────────────────────────────────────────────────────────
.term-wrap
  .term-tabs (탭 N개 + 우측 .term-watch ".oculpm 감시중" indicator)
  .term-screen (xterm.js 실제 출력 · #1b1b1f / #0c0c0e 배경)
  .term-input-row (.t-prompt + input + cursor)
```

### Data

- `commands::pty_spawn(shell, cwd)` → PTY handle (W2 PR3 기존).
- 탭별 PTY 인스턴스. `WorkspaceContext.terminalTabs: Array<{ id, label, shell, cwd, pid }>`.
- `.term-watch` 의 indicator = `.oculpm/index/` 의 마지막 line append 시각 (5초 내 = 녹색 점, 그 외 = 회색).

### Interaction

- **탭 추가** → 새 PTY (디폴트 zsh, cwd = 현재 프로젝트 root).
- **탭 클릭** → 활성 PTY 전환. 출력은 xterm.js 가 in-memory 유지.
- **탭 닫기** → SIGTERM. 닫힌 후 *남은 탭이 없으면* 새 zsh 자동 spawn.
- **입력** → input row 가 *focus 기본*. Enter 시 PTY stdin 으로 송신.
- **단축키**: ⌘T → 새 탭. ⌘W → 현재 탭 닫기. ⌘1~⌘9 (Cmd 동시 누름) → 탭 N 으로 전환 — *주의*: 글로벌 ⌘1~⌘7 (IA) 와 충돌. 터미널 focus 일 때만 글로벌이 *모달 차단됨*. 자세한 규약은 [`05-implementation-checklist.md`](./05-implementation-checklist.md) §3 의 키바인딩 매트릭스.

### Edge

- **세션 없음**: 마운트 시 자동 zsh spawn.
- **PTY 생성 실패**: 에러 chip + 재시도 버튼.
- **에이전트 출력 후 journal entry 작성됨** → 별도 `.t-journal` 행 (녹색 배경 inline pill) 으로 표시. 클릭 시 작업 일지 화면 (focus).

---

## 7. AI 패널 (⌘7)

### Goal
*"코드베이스 컨텍스트를 자동 첨부한 채로 여러 LLM 에 같은 질문."*

### Layout

```
Toolbar:  [AI 패널] [여러 LLM에 같은 컨텍스트로 질문]   [대화 기록]
────────────────────────────────────────────────────────────────────────
.ai-wrap
  .ai-models (수평 칩 — 모델별 + active outline)
  .ai-thread (max 780, 중앙)
    .msg × N (.user · .assistant)
      .msg-av (30x30 둥근, vendor 색)
      .msg-body (.msg-name · .msg-text + .msg-points + .msg-refs)
  .ai-compose
    .compose-ctx (첨부된 컨텍스트 chips + "전체 코드베이스는 로컬에만 저장됩니다")
    .compose-box (textarea + send button)
```

### Data

- 모델 목록 = `commands::list_llm_models()` (Settings 에 키 등록된 provider 만).
- 대화 = `commands::list_ai_threads(project_id, limit=50)` (로컬 SQLite).
- 컨텍스트 첨부 = *현재 active 파일 + 오늘의 diff + last 3 journal entries* 자동.

### Interaction

- **모델 칩 클릭** → 활성 모델 변경. 같은 thread 에서 다음 답변은 새 모델.
- **send (compose primary)** → 스트리밍 응답. `commands::ai_chat_stream(prompt, model, context)`.
- **ref-pill 클릭** → 변경 diff 화면 진입 (해당 파일).
- **대화 기록 버튼** → 좌측 drawer (이전 thread 리스트).

### Edge

- **API 키 미설정** → empty hint "Settings 에서 키를 추가하세요" + ⌘, 진입 link.
- **rate limit** → 인라인 에러 메시지 + retry 카운트.
- **AiOverlay (⌘\\)** 와의 관계: 둘 다 같은 thread 를 공유. 오버레이는 *짧은 질문* 용, 화면은 *깊은 대화* 용. thread state 는 `WorkspaceContext.aiThread`.

---

## 8. Settings (⌘,)

### Goal
*"기기 단일 저장 + 키체인 보관 + 워크데이 설정."*

### Layout

```
Toolbar:  [설정] [모든 데이터는 이 기기에만 저장됩니다]
────────────────────────────────────────────────────────────────────────
.page (maxWidth 760)
  section-title "일반"
    .card.set-section
      .set-row × N (label + desc + ctl)
  section-title "기록 & 보안"
  section-title "API 키 · 키체인 저장"
```

### Sections

- **일반**:
  - 테마 — light / dark scope-chip 토글.
  - 워크데이 시작 시각 — set-input (HH:MM).
  - 자정 자동 롤오버 — Toggle.
  - 외부 에디터 명령 — set-input (`code "%path"` 디폴트, [`../07-implementation-checklist.md`](../07-implementation-checklist.md) §0.4).
- **기록 & 보안**:
  - 자동 일지 작성 — Toggle.
  - 시크릿 자동 마스킹 — Toggle.
  - 익명 사용 통계 — Toggle (디폴트 OFF).
  - `.oculpm/config.toml` 직접 열기 — link 버튼.
- **API 키 · 키체인 저장**:
  - Anthropic / OpenAI / Google AI 각 row.
  - 상태 chip ("키체인에 저장됨" / "미설정").
  - 변경 / 추가 버튼 → 키 입력 모달 (값은 표시되지 않음, 새로 입력만).
- **고급**:
  - 데이터 폴더 열기 (Finder/Explorer).
  - 인덱스 재구축.
  - WorkspaceContext 초기화 (확인 모달 후).
- **About**:
  - 버전 / 빌드 해시 / 라이선스 / 업데이트 확인 (1.1 로 미룸은 *비활성 link*).

### Data

- 모든 row 는 `commands::get_setting / set_setting` 또는 keyring command.
- 변경 즉시 영속화 (debounce 300ms 인 값은 set-input 만).

### Interaction

- **Toggle 클릭** → 즉시 반영 + toast "저장됨".
- **API 키 추가** → 모달에서 입력 → keyring 저장 → row chip 갱신.
- **WorkspaceContext 초기화** → 모든 in-app state 리셋. 확인 모달 + "삭제됩니다" 카피 강조.

### Edge

- **키체인 unavailable** (Linux 환경) → row 에 *대체 — 평문 파일* 경고 + 사용자 confirm.
- **데이터 폴더 부재** → 자동 생성 후 toast.

---

## 9. 부록 — 화면 → WorkspaceContext 키 매트릭스

본 라운드에서 *추가되는* state 키 (모두 영속화 — Lite-W6 의 `aipm:workspace:v1` schema 의 *v3* 로 마이그레이션):

| 키 | 타입 | 화면 |
|---|---|---|
| `activeView` (union 확장) | `"today" \| "journal" \| "diff" \| "planner" \| "search" \| "terminal" \| "ai" \| "settings"` | 전역 |
| `journalFilter` | `"all" \| "feature" \| "bugfix" \| "refactor" \| "error" \| "chore"` | 작업 일지 |
| `diffActivePath` | `string \| null` | 변경 diff |
| `diffReadPaths` | `string[]` | 변경 diff |
| `diffMode` | `"unified" \| "split"` | 변경 diff |
| `plannerOpen` | `Record<string, boolean>` | Planner |
| `searchScope` | `"semantic" \| "symbol" \| "text"` | 코드 검색 |
| `searchRecent` | `string[]` (last 10) | 코드 검색 |
| `terminalTabs` | `Array<{ id, label, shell, cwd }>` (PTY 핸들은 휘발성) | 터미널 |
| `terminalActiveId` | `string \| null` | 터미널 |
| `aiActiveModel` | `string` (model id) | AI 패널 |
| `aiThreadId` | `string \| null` | AI 패널 + 오버레이 공유 |
| `themeMode` | `"light" \| "dark"` (— `localStorage["oculpm-theme"]` 와 동기화) | 전역 |

*삭제되는* 키:
- `codeSubTab` — Code Workbench 폐기.
- `bottomDrawerTab` — TerminalDock 폐기.
- `layoutMode` / `splitRatio` — Lite-W6 의 split 도크 폐기.
- `sidePanelOpen` — ⌘B 폐기.

마이그레이션 함수는 [`04-removal-and-migration.md`](./04-removal-and-migration.md) §3 에 코드 수준으로 명시.
