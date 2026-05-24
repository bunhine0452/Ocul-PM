# W3 Dogfooding 회고

> **누가 쓰나**: 프로젝트 owner (= 너) 가 직접 작성. AI 가 가상으로 채우면 안 됨 — 본 회고의 목적은 **사용자의 실제 마찰** 채집.
> **언제 쓰나**: [`../W3/MANUAL-CHECKLIST.md`](../W3/MANUAL-CHECKLIST.md) §4 를 진행하면서 entry 작성 직후 바로.
> **어디에 인용되나**: W4-PR1 의 어댑터 마스터 템플릿 강화 + W4-PR9 의 자동 dogfooding 회고와 비교.
> **PR9 형식 요구사항**: [`../W3/PR9-dogfooding-bootstrap.md`](../W3/PR9-dogfooding-bootstrap.md) §2.

---

## 0. 사전 기록된 시스템 발견 (작업 시작 전 채집)

본인 (Claude) 이 사용자와의 대화 중 함께 발견한 항목 — 아래 entry 자리에 옮겨 적기 위한 메모. 사용자 본인의 마찰 경험은 §1~§3 에 채움.

### F-1 — 워처 자동 시작 wire-up 누락 (2026-05-24 발견)

- **증상**: 사용자가 기존 프로젝트 `/Users/kimhyunbin/Desktop/git/bunhine_web/` 를 앱에서 열고 ocul-pm 활성화 → 수동 entry 1개 작성 성공 → Antigravity 로 파일 수정 → 수정된 파일들이 어디에도 안 보임.
- **근본 원인**: `App.tsx:104` 가 프로젝트 선택 시 `oculpmInit` 만 호출하고 `oculpmApi.watcherStart(projectId)` 는 호출하지 않음. 결과: `.oculpm/index/<오늘>/file_changes.ndjson` 미생성, 워처 알림 0건.
- **부가 영향**:
  - `MANUAL-CHECKLIST.md §1.6 #11` (EmptyToday V3) 가 사실상 검증 불가 (file_changes 가 영원히 0).
  - W4-PR5 (compare_layers) 의 입력이 W3 종료 시점에 비어 있는 상태.
- **대응**:
  - 본 checklist §0 에 devtools 1줄 명령으로 수동 시작 우회.
  - 진짜 wire-up 은 별 PR (= W3.5 또는 W4-PR0 격) — 아래 §3 의 "W4 로 넘기는 결정" 에 기록.
- **시드 entry 후보**: §1 의 entry #2 에 그대로 기록 권장 (status `planned`).

### F-2 — Journal 파일 변경이 SQLite cache 에 미반영 (2026-05-24 발견 + 즉시 수정)

- **증상**: 사용자가 `.oculpm/journal/<오늘>/<Cat>/foo.md` 를 외부 에디터/터미널에서 삭제하거나 frontmatter 만 수정해도 Today UI 의 카드가 그대로 남음. 상단의 `RefreshCw` 버튼을 눌러도 변화 없음. `MANUAL-CHECKLIST §1.1 #2` (삭제 → 1초 안에 카드 사라짐) 실패.
- **근본 원인**: `src-tauri/src/oculpm/watcher.rs::handle_event` 가 `.oculpm/journal/**` 변경 감지 시 `OculpmJournalPathChanged` tauri 이벤트만 emit 하고 `JournalCache::apply_path_change` 는 호출 안 함. 프론트의 `TimelineView` 가 이벤트를 들어 `oculpm_list_journal_entries` 를 재조회해도, 그 커맨드는 SQLite 의 `oculpm_journal` 테이블을 곧장 읽기 때문에 stale row 가 그대로 반환됨. 상단 `RefreshCw` 도 `commands.dailyBrief` 만 호출 — journal cache 와 무관.
- **부가 영향**:
  - §1.1 #1 (생성 → 표시), §1.1 #3 (frontmatter 수정 → 제목 갱신) 도 같은 메커니즘 실패. 다만 카드 선택 시 `getJournalEntry` 의 disk fallback (`manager.rs:637-651`) 로 detail 만 *부분적으로* 채워질 수 있음 — list 카드 자체는 영구히 stale.
  - W4-PR9 (자동 dogfooding) 가 외부 LLM 으로 `.md` 자동 생성 시 동일 버그가 Create 미반영 형태로 즉시 노출됨 → W4 게이트 차단 가능성.
- **대응 (2026-05-24)**: 다음 4 변경으로 해결.
  1. `watcher.rs::WatcherInner::handle_event` 의 journal-prefix 분기에 `apply_journal_cache_invalidation` 호출 추가. 새 메서드는 `app_handle.state::<Db>()` 로 process-wide `Db` 를 lookup → `JournalCache::apply_path_change` 호출. `app_handle: None` (테스트) 환경에서는 self-suppress (기존 watcher 테스트 9건 그대로 통과).
  2. `is_journal_entry_path` helper 추가 — `cache::walk_journal` 의 skip 규칙과 동일하게 `_template.md` / `_attachments/` / hidden / non-`.md` 를 걸러서 SQLite 에 쓰레기 row 안 들어가게.
  3. `src/App.tsx` 의 useEffect 가 `oculpmInit` 성공 후 `oculpmWatcherStart` 자동 호출 + 프로젝트 전환 시 cleanup 으로 `oculpmWatcherStop` 호출. F-1 의 워처 자동 시작 wire-up 누락도 같이 해결.
  4. 새 unit test `is_journal_entry_path_matches_walk_journal_skip_rules` 추가.
- **결과**: cargo test --lib oculpm 131/131 그린. tsc --noEmit / lint:storage 그린. §1.1 #1~#3 모두 동작해야 함 (실제 검증은 사용자 dev 띄워 확인 필요).
- **시드 entry 후보**: §1 의 entry #3 (자유 bug) 에 그대로 기록 권장.

---

## 1. 각 entry 별 회고

> 5+ 개 entry 를 작성하면서 각자 옆에 즉시 기록. 시간은 시계 보면서 1분 단위로.

### Entry #1 — Greenfield → Today 자동 진입 흐름 (의무)

- **type**: feature
- **파일**: `.oculpm/journal/<오늘>/Features_to_add/____.md`
- **작성 시간**: __ 분
- **frontmatter 작성 시 헷갈렸던 필드**:
  - (예: `created_at` 의 tz offset 형식 — `+09:00` vs `+0900` 어느 게 맞나?)
  - (예: `session_id` 가 비어도 되나? `agent.id` 는 manual?)
- **본문 강제 헤더가 자연스러웠나**:
  - (예: feature 타입의 `## 추가 기능` / `## 동작 흐름` 헤더가 위저드 흐름 기록에 맞았는가?)
- **UI 가 잘못 표시한 케이스**:
  - (Card / Detail / Filter 중 어디서 어떻게)

### Entry #2 — 워처 자동 시작 wire-up 누락 (권장 — F-1 참조)

- **type**: bug
- **status**: `planned` (W4 시작 직후 수정 예정)
- **파일**: `.oculpm/journal/<오늘>/Bugs/____.md`
- **작성 시간**: __ 분
- **frontmatter 작성 시 헷갈렸던 필드**:
- **본문 작성 시 어색했던 점**:
  - (예: 본문에 "발생 원인" 을 쓸 때 코드 라인 인용해야 하나? 어떤 깊이까지?)
- **UI 가 잘못 표시한 케이스**:

### Entry #3 — (자유)

- **type**: bug
- **파일**:
- **작성 시간**: __ 분
- **frontmatter / 본문 / UI 메모**:

### Entry #4 — (자유)

- **type**: feature
- **파일**:
- **작성 시간**: __ 분
- **frontmatter / 본문 / UI 메모**:

### Entry #5 — (자유)

- **type**: refactor
- **파일**:
- **작성 시간**: __ 분
- **frontmatter / 본문 / UI 메모**:

---

## 2. 전체 회고

> entry 5+ 개 작성 후, 패턴을 본 다음 작성.

### 2.1 가장 마찰이 큰 필드 top 3

> W4-PR1 의 어댑터 마스터 템플릿 강화 시 직접 인용될 항목.

1. **___** — 이유: ___. 어댑터 템플릿 권장: ___.
2. **___** — 이유: ___. 어댑터 템플릿 권장: ___.
3. **___** — 이유: ___. 어댑터 템플릿 권장: ___.

### 2.2 가장 마찰이 작은 패턴

> 어댑터 마스터 템플릿이 그대로 권장할 패턴.

- (예: type 별 `## 발생 원인` / `## 해결 방법` 헤더가 항상 자연스러웠음 — 강제 헤더 정책 유지)
- (예: `tags` 자유 입력이 분류보다 검색에 유용했음)

### 2.3 W3 의 UI 가 시안 (페이즈 §3) 과 얼마나 일치했는가

> W4-PR6 의 DiffVsNarrative 디자인 입력.

- 일치도: __ % (체감)
- 가장 큰 시각적 차이:
- DiffVsNarrative 가 만들어질 때 본 UI 의 어떤 토큰을 그대로 따라야 하나:

### 2.4 PR10 의 Greenfield 흐름이 의도대로 동작했나

> refactor-integration §3.1 의 R-13 / R-14 완화책 검증.

- 위저드 ON → 신규 프로젝트 → Today 진입까지 onboarding 모달이 뜨지 않았는가: ___
- "한 박자 빈 모달 깜빡임" (PR5 mount guard) 의 체감 강도: 무시 가능 / 약간 거슬림 / 즉시 cleanup 필요
- 위저드 OFF → EmptyToday V1 의 "활성화" 회복 동선이 자연스러웠나: ___

---

## 3. W4 로 넘기는 결정 / 주의

> 본 회고가 W4 진입 시 영향을 미칠 결정 사항.

### 3.1 코드 변경 후보

- ~~**워처 자동 시작 wire-up** — F-1 의 후속.~~ **2026-05-24 해결 (F-2 §대응 #3)**: `App.tsx` useEffect 가 `oculpmInit` 성공 후 `oculpmWatcherStart` 자동 호출 + 프로젝트 전환 시 cleanup.
- ~~**Journal cache 인발리데이션** — F-2 의 후속.~~ **2026-05-24 해결 (F-2 §대응 #1,#2,#4)**: watcher 가 journal 변경 감지 시 `JournalCache::apply_path_change` 호출하도록 wire-up.
- ~~**Detail/Card 에서 frontmatter inline edit**~~ **2026-05-24 해결**: `oculpm_update_entry_meta` 커맨드 추가 (manager.rs::update_journal_entry_meta — `set_journal_verified` 패턴 재사용) + `JournalEntryDetail` 의 status/difficulty badge 자리를 `<select>` dropdown 으로 교체. 옵티미스틱 업데이트 + 에러 rollback. TimelineView 의 list row 도 `onMetaUpdated` 콜백으로 동기화.
- **정책 확정 — `.oculpm/` 자동 생성 vs EmptyTodayV1 dead path**: **(a) 의도된 동작으로 유지**. d4d631d (Greenfield 통합) 와 정합. EmptyTodayV1 은 (1) 사용자가 "[나중에]" 로 dismiss 후 status bar 의 인라인 링크로 재진입, (2) `oculpmInit` 자체가 실패 (디스크 권한 / 이미 잠긴 디렉토리 등) 시의 fallback 으로 살려둠. **(b) opt-in 화 안 함** — 이유: 활성 ocul-pm 이 ai-pm 의 정체성이고 (PR9 자동 dogfooding 의 전제), V1 을 거치게 하면 매 신규 프로젝트마다 마찰. W3 종료 시점에서 받아들이는 trade-off.

### 3.2 W4-PR1 어댑터 템플릿 강화 항목 (= §2.1 의 top 3 가 인용됨)

- (entry 작성 후 §2.1 의 결과를 그대로 옮김)

### 3.3 W4-PR9 자동 dogfooding 게이트 조정

- W3 dogfooding 의 작성률은 100% (= 사용자가 직접 씀). W4 의 자동 dogfooding 게이트 (작성률 ≥ 60%) 와 비교 기준점.
- W3 entry 1개당 평균 작성 시간: __ 분. W4 자동 dogfooding 의 entry 1개당 LLM 호출 시간과 비교 예상.

---

## 4. 작성 완료 후 후속 액션

- [ ] [`../W3/MANUAL-CHECKLIST.md`](../W3/MANUAL-CHECKLIST.md) §6 "완료 선언 절차" 의 1번 (W3/README.md §5/§7/§8 표 갱신) 수행.
- [ ] W3/README.md 페이즈 회고 (예상 vs 실제 / 발견된 함정 / W4 로 넘기는 결정) 채우기.
- [ ] W4 진입 시 W4-PR1 의 PR 본문에 본 회고의 §2.1 항목을 **최소 1건 인용**.
- [ ] §3.1 의 "워처 자동 시작 wire-up" PR 을 W4 PR 그래프에 추가할지 결정 (W4-PR0 또는 W3.5).
