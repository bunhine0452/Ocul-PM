# W4 dogfooding 회고 (자동 모드)

> 본 문서는 W4-PR9 의 SSOT. PR1~PR8 의 모든 코드 작업이 ✅ 된 시점에서
> **Claude Code / Cursor / Gemini 등 어댑터가 자동으로 `.oculpm/journal/`
> 에 기록을 쓰는지** 매일 추적한다.
>
> W3 의 회고 (`_dogfooding-w3.md`) 가 인간 손작성 entries 기반이었다면,
> W4 부터는 LLM 이 어댑터 규칙을 따라 **자동 작성**하는지 + 그 결과를
> `compare_layers` 의 mismatch 분포로 검증한다.
>
> 참조: [`./W4-agents-dual-layer.md`](./W4-agents-dual-layer.md) §0 / §W4-PR9.

---

## 시작 절차 (1회)

1. **본 프로젝트 (ai-pm) 에서 `pnpm tauri dev` 실행.**
2. Settings → `ocul-pm` 탭 → Agents 섹션 →
   - "감지" 클릭 → 4 어댑터 confidence 확인
   - 사용 중인 어댑터 (예: Claude Code) chip 활성화
   - "지금 동기화" 클릭 → 토스트 "동기화 완료 (1 어댑터 갱신)" 확인
3. `cat .claude/CLAUDE.md` 로 ocul-pm 관리 블록 (`<!-- oculpm:begin v1 -->`)
   안에 마스터 템플릿 내용이 들어갔는지 확인.
4. **첫 자동 기록 테스트**: Claude Code 에 본 프로젝트의 작은 작업
   (예: README typo 수정) 1건 부탁. 작업 끝나면 `.oculpm/journal/<오늘>/...md`
   가 자동 생성됐는지 확인.
   - 안 됐으면: 마스터 템플릿의 trigger 조건이 부족. §3 으로.

---

## 매일 회고 템플릿

```markdown
## YYYY-MM-DD

### 작성률
- 의도한 작업 단위: N건 (PR/이슈/세션 단위)
- 자동 기록된 entries: M건
- 작성률: M/N = XX%

### frontmatter 오류율
- 자동 entries 중 parse error: K건 (전체의 K/M)
- 가장 흔한 오류: (예: created_at tz 누락 / files_touched.op enum / agent.id 누락)

### 본문 헤더 누락률
- bug/error 중 "## 발생 원인" 없음: ...
- refactor 중 "## 동기" 없음: ...

### mismatch 분포 (LayerComparison, PR5)
- 오늘 종료 sessions: S건
- severity: Ok=..., Warning=..., Critical=...
- 가장 큰 mismatch session 1개:
  - session_id: 20260526-007
  - only_in_index (워처가 본): ["src/foo.rs", ...]
  - only_in_journal (LLM 이 적은): ["src/legacy.rs (환각)"]

### 토스트 / drift 관찰
- agent_drift 발생: 회 / 어댑터: ... / [동기화] vs [무시] 비율: ...
- integrity_warning 발생: 회 / kind 분포: ...
- journal_added 토스트: 사용자가 클릭한 비율: ...

### 발견된 함정
- (자유 기술)

### 마스터 템플릿 강화 후보
- (예: "기록 시점이 모호 → 마스터 의 trigger 섹션에 '⌘+Shift+J' 강조 추가")
```

---

## 작성률 < 60% 일 때 조치 순서

1. **마스터 템플릿 강화** — `.oculpm/agents/_template.md` 수정 → "언제
   기록하는가" 의 trigger 를 더 명확하게. 예: "단일 파일 수정도 기록 대상".
2. **사용자가 explicit reminder 추가** — 예: "작업 끝났어. ocul-pm 에
   기록해줘" 같은 명시적 요청이 효과적인지 측정.
3. **어댑터 교체** — Claude Code 대신 Cursor / Gemini 활성화하고 같은
   마스터 규칙에 대한 LLM 별 준수율 비교.
4. **CommandPalette 단축키 학습** — `⌘+Shift+J` 로 보충 entry 작성 비율
   기록 → 충분히 쓰이면 OK, 거의 안 쓰면 UI 가시성 강화 필요.

---

## 기록 시작

> 회고 entries 는 시작 후 본 위치 아래에 추가.

(첫 entry 는 사용자가 §시작 절차 1~4 완료 후 작성.)

---

## 2026-05-25 — 사용자 직접 dogfooding 1차 발견

> 대상 외부 프로젝트: `/Users/kimhyunbin/Desktop/pi/black-corp-tycoon`
> 사용 어댑터: antigravity (그리고 Claude Code 의 CLAUDE.md 위임)

### 발견 1 — 어댑터 파일 위치: `AGENTS.md` 가 더 잘 동작

- **현재 동작**: `.oculpm/agents/_template.md` 에 마스터 템플릿을 두면 외부
  LLM 이 그 규칙을 일관되게 따르지 않음. 반대로 프로젝트 **루트의 `AGENTS.md`**
  (같은 내용) 로 옮겼더니 antigravity 가 `.oculpm/journal/20260525/Features_to_add/0953_feature_game-overhaul-active-skills-bgm-office-grid.md`
  같은 frontmatter + 본문이 정상인 entry 를 **자동으로** 생성함.
- **추정 원인**: 외부 어댑터들은 프로젝트 루트의 관용적 위치
  (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules` 등) 만 자동 참조. `.oculpm/agents/_template.md`
  는 ocul-pm 내부 규약일 뿐 외부 LLM 이 이 경로를 자발적으로 읽지 않음.
- **`CLAUDE.md` 의 위임 패턴**: 프로젝트 루트 `CLAUDE.md` 에 `@AGENTS.md`
  한 줄만 적어도 충분히 동작함 (실측: black-corp-tycoon 의 `CLAUDE.md` 가
  실제로 `@AGENTS.md` 1줄짜리 파일임).
- **제안 (구현 시 별도 PR)**:
  1. 마스터 템플릿의 1차 배포 경로를 **프로젝트 루트 `AGENTS.md`** 로 변경.
  2. `.oculpm/agents/_template.md` 는 ocul-pm 내부 SSOT 로만 유지하고,
     동기화 엔진이 `AGENTS.md` 를 **관리 블록** (`<!-- oculpm:begin v1 -->`)
     으로 렌더링.
  3. 어댑터별 파일 (CLAUDE.md, .cursor/rules, .gemini/* 등) 은 `@AGENTS.md`
     로 위임하는 1줄 stub 만 두는 것을 기본값으로 제안.

### 발견 2 — 외부 에이전트 재진입 시 세션 무한 생성 버그

- **재현**: 외부 어댑터 (antigravity / Claude Code) 작업 중 → 에이전트
  종료 → 다시 진입 → 작업 재개. 이때 ocul-pm 워처가 **새 session_id 를
  계속 만들어 냄** (한 사용자 작업 단위 = 1 session 이어야 하는데 N session).
- **영향**:
  - `compare_layers` 의 mismatch 분포가 왜곡됨 (한 의도가 여러 session 으로
    쪼개져 only_in_journal / only_in_index 가 부풀려짐).
  - SessionCard 에 같은 의도의 카드가 중복 표시됨.
- **추측 원인**: session 종료 조건이 "워처 이벤트 idle 타임아웃" 단일 기준일
  가능성. 외부 에이전트 재진입이 새 이벤트 burst 로 인식돼서 새 session 시작.
- **조사 시작점** (코드 추정):
  - `src-tauri/src/oculpm/watcher.rs` — session 경계 판정 로직
  - `src-tauri/src/oculpm/manager.rs` — session lifecycle

### 발견 3 — 원본 열기 기능 동작 불가 (Tauri permission)

- **에러 메시지**: `opener.open_path not allowed. Permissions associated with
  this command: opener:allow-open-path`
- **위치**: 원본 파일 열기 버튼 (JournalEntryDetail 등) 클릭 시.
- **원인**: Tauri v2 의 `opener` plugin 에 `allow-open-path` capability 가
  허용 목록에 들어가 있지 않음. capability JSON 에서 명시적으로 허용 필요.
- **수정 위치** (추정): `src-tauri/capabilities/*.json` 의 `permissions`
  배열에 `"opener:allow-open-path"` 추가, 또는 `tauri.conf.json` 의
  opener plugin scope 확인.

### 발견 4 — Index 비교 보기 UX 가 어려움 + 모달이 부적합

- **현상**: PR5 `LayerComparison` 의 mismatch 뷰가 모달로 뜨는데,
  - only_in_index / only_in_journal / mismatch 의 3-way 차이를 한눈에 비교하기
    어려움.
  - 모달 안에서 텍스트가 길면 스크롤 + 컨텍스트 전환 비용이 큼.
- **제안 방향** (디자인 토의 필요):
  - 모달 대신 **세로 split view** (좌: index, 우: journal narrative, 중간: diff hint)
    또는 SessionCard 의 인라인 expandable 패널로 강등.
  - 또는 DiffVsNarrative 컴포넌트와 동일한 톤으로 통합.
- **열린 질문**: 이 뷰에서 실제 코드 스니펫까지 보여줘야 하는가?
  - 가설 A: 파일 경로 + op + 의도 라벨 정도면 충분. 코드 비교는 git 으로.
  - 가설 B: 환각/누락 판단을 위해 짧은 코드 컨텍스트가 있는 편이 정확.
  - 다음 dogfooding 회차에서 두 모드를 토글로 만들어 실측.

---

## 2026-05-25 — 조치 완료

위 4건의 발견을 같은 날 한 PR (체인지셋) 으로 모두 반영했음. 각 항목의 구현 위치 + 검증 방법:

### ✅ 발견 1 — AGENTS.md 1차 배포

- `src-tauri/src/oculpm/agents/mod.rs` 의 `known_adapters()` 에 **`agents-md`** 어댑터를 추가 (path: `AGENTS.md`, mode: ManagedBlock). 마스터 콘텐츠 (`.oculpm/agents/_template.md`) 를 그대로 root `AGENTS.md` 의 oculpm 관리 블록으로 렌더.
- `src-tauri/src/oculpm/agents/templates/{claude_code,cursor,antigravity,gemini}.md.tpl` 4종을 **짧은 위임 stub** 으로 교체:
  - `claude_code.md.tpl` → `@AGENTS.md` 1줄 + 안내 주석.
  - `gemini.md.tpl` → `@AGENTS.md` + agent.id 라벨링.
  - `cursor.mdc.tpl` / `antigravity.md.tpl` → 트리거 한 줄 + "전체 규칙은 `AGENTS.md` 참조" 위임.
- `src-tauri/src/oculpm/config.rs`:
  - `KNOWN_AGENT_IDS` 에 `"agents-md"` 추가.
  - `default_for_new_project()` 의 `agents.active` 기본값을 `["agents-md"]` 로 변경 (신규 프로젝트는 자동으로 AGENTS.md 가 동기화됨).
- `src/features/settings/OculpmSettings.tsx` 의 `KNOWN_AGENTS` 칩 목록 맨 앞에 `"AGENTS.md (권장)"` 노출.
- **검증 절차** (수동):
  1. 새 프로젝트 init → `.oculpm/config.toml` 의 `agents.active` 가 `["agents-md"]` 인지 확인.
  2. Settings → ocul-pm → 지금 동기화 → 프로젝트 루트에 `AGENTS.md` 생성 + `<!-- oculpm:begin v1 -->` 블록이 마스터 콘텐츠 포함.
  3. 기존 프로젝트 (`.claude/CLAUDE.md` 풀 콘텐츠 있음) → 재동기화 시 관리 블록 안만 `@AGENTS.md` 로 축소되고 블록 밖 사용자 콘텐츠 보존.

### ✅ 발견 2 — 세션 중복 생성 버그

원인 분석: `SessionActor` 의 InactivityFired 가 단일 기준 (idle 타임아웃) 으로만 세션을 종료해, 외부 에이전트가 LLM 응답을 기다리는 동안 짧은 idle 이 누적되면 한 작업이 N session 으로 쪼개졌음.

조치:

1. **기본값 완화** — `default_for_new_project()` 의 `inactivity_timeout_minutes` 를 `30 → 60` 으로 상향. 대부분 외부 에이전트 idle 갭을 흡수.
2. **Resume 메커니즘 도입** — `SessionConfig` 에 `session_resume_grace_minutes: u32` (기본 15) 필드 추가:
   - `src-tauri/src/oculpm/spec.rs` — 필드 + `#[serde(default = ...)]` 추가로 기존 config.toml 후방 호환.
   - `src-tauri/src/oculpm/index.rs` — `unfinalize_session(id)` 메서드 추가 (ended_at/ended_reason/git_head_at_end 초기화).
   - `src-tauri/src/oculpm/session.rs` — `on_activity` 의 Idle 분기에서 `try_resume_session(ev)` 호출:
     - 오늘 workday 의 마지막 세션이 `InactivityTimeout` 으로 닫혔고, `ended_at` 이 grace 안이면 **재오픈**.
     - ndjson 의 이 세션 이벤트들을 다시 읽어 `files_unique` 를 정확히 복원.
     - `OculpmSessionStarted` 이벤트를 재발사 (UI 측은 같은 session_id 면 자동 디바운스).
   - 새 테스트 2건 추가:
     - `resume_within_grace_reopens_prior_session` — grace=15min 이면 두 번째 activity 가 같은 session 으로 묶임.
     - `resume_disabled_when_grace_zero` — grace=0 이면 기존 "새 세션 시작" 동작 보존.
3. **Settings UI** — `OculpmSettings` 의 Session 섹션에 "Resume grace" 슬라이더 (0~60 min) 추가. 0 은 명시적으로 "(비활성)" 라벨.
- **검증**: `cargo test --lib oculpm::session` → 11/11 PASS (resume 2건 포함).

### ✅ 발견 3 — `opener.open_path` 권한 누락

- `src-tauri/capabilities/default.json` 의 `permissions` 배열에 `"opener:allow-open-path"` + `"opener:allow-reveal-item-in-dir"` 추가.
- **검증** (수동): 재빌드 후 `JournalEntryDetail` 의 "원본 열기" 버튼 클릭 → 파일이 OS 기본 앱으로 열림. 에러 메시지 미발생.

### ✅ 발견 4 — LayerComparison 모달 제거

- `src/features/oculpm/DiffVsNarrative.tsx` 를 **인라인 패널** 컴포넌트로 재설계:
  - 외곽의 `fixed inset-0 z-50 ... bg-black/60` 오버레이 제거. Esc-닫기 핸들러도 제거 (인라인이라 불필요).
  - `variant: "panel" | "compact"` prop 추가. SessionCard 는 `compact` (X 버튼 없음, 패딩 축소), TodayScreen/EmptyTodayV3/JournalEntryDetail 은 기본 `panel`.
  - 헤더 우측에 **"코드 스니펫"** 토글 추가. 기본 off. 켜면 각 path row 아래에 "코드 스니펫 미구현 — git diff 로 확인하세요" 힌트 한 줄 (실제 구현은 future PR — ndjson before/after bytes 와 narrative 의 join 이 필요).
- `src/features/oculpm/SessionCard.tsx`:
  - DiffVsNarrative 호출 위치를 **expanded body 안으로 이동** (entries 리스트 아래). 모달 위치 (compareOpen && ...) 가 사라짐.
  - 헤더의 ⚖ 버튼이 `aria-pressed` 로 토글 상태 표시. 토글 시 인라인 패널이 펼쳐짐.
- `src/features/today/TodayScreen.tsx`:
  - 최하단의 top-level 모달 (`{compareSessionId && ...}`) 제거. 대신 메인 컨텐츠 div 안, 타임라인 위 자리로 이동.
- `src/features/oculpm/JournalEntryDetail.tsx`:
  - 기존 코드가 이미 인라인 호출이었음 — DiffVsNarrative 자체에서 모달 chrome 제거됐으므로 자동으로 인라인으로 동작.

**열린 질문 결론 (코드 스니펫)**: 토글로 만들고 "미구현" 상태로 노출 — 다음 dogfooding 회차에서 사용자가 켜는 빈도를 측정해 실제 구현 가치를 판단.

### 검증 명령 요약

```bash
# Rust 단위 테스트 (170/170 PASS 확인)
cargo test --lib oculpm

# TS 타입 체크
pnpm tsc --noEmit

# E2E: pnpm tauri dev 실행 후
#   1. 신규 프로젝트 init → AGENTS.md 생성 확인
#   2. JournalEntryDetail "원본 열기" 클릭 → 권한 에러 미발생
#   3. SessionCard ⚖ 버튼 → 카드 아래 인라인 패널 펼침
#   4. inactivity_timeout 후 새 activity → resume_within_grace 동작 확인
```

---

## 2026-05-26 — 사용자 직접 dogfooding 2차 발견 + 같은 날 조치

> 1차 (위) 조치 후 같은 외부 프로젝트 (`black-corp-tycoon`) 에서 시나리오 재실행. 3건 잔존/신규.

### 발견 5 — "어댑터 규칙 다시 보내기" 라벨 = LLM 으로 prompt 재주입 의도로 오인

- **현상**: `DiffVsNarrative` 의 [어댑터 규칙 다시 보내기] 버튼이 사실은 `syncAgents`
  (AGENTS.md/CLAUDE.md 관리 블록 idempotent 재기록) 만 호출함. 사용자는 라벨의 "보내기"
  를 "실행 중인 LLM 채팅창에 규칙을 다시 주입" 이라 해석해서 반복 클릭했고, 워크플로 상
  실제로 "프롬프트를 LLM 에 여러 번 붙여넣는" 시나리오가 됐을 때 컨텍스트 중복이 우려된다고 보고.
- **조치 (라벨 + 동작 분리)**:
  1. 기존 버튼 라벨 변경: `어댑터 규칙 다시 보내기` → **`AGENTS.md 재동기화`**.
     동작은 동일 (`syncAgents`), tooltip 에 "파일 쓰기만, 실행 중인 LLM 세션엔 영향 없음" 명시.
  2. 신규 버튼 추가: **`프롬프트 복사`** — `oculpmApi.getMasterTemplate(projectId)` 로
     `.oculpm/agents/_template.md` 텍스트를 받아 `navigator.clipboard.writeText` →
     warning 토스트 `프롬프트 복사 완료 / 한 번만 붙여넣으세요 — 여러 번 붙이면 LLM 컨텍스트가
     부풀어 같은 규칙이 중복 적용될 수 있어요.`
  3. 백엔드: `OculpmManager::read_master_template` + `oculpm_agents_get_master_template`
     커맨드 신설 (read-only, 어댑터 파일 미터치). 파일 없으면 임베디드 `MASTER_KO` fallback.

### 발견 6 — DiffVsNarrative 헤더가 좁은 폭에서 "코드 스니펫" 글자별 세로 줄바꿈

- **현상**: `JournalEntryDetail` 우측 컬럼 (sticky, 좁음) 안에 인라인 패널로 마운트될 때,
  헤더의 단일 row flex 가 과제약 → 타이틀의 `manual-20260526-225000` sessionId 가 줄을
  대부분 차지하고 우측의 `코드 스니펫` 라벨이 글자 단위로 세로 줄바꿈됨 (스크린샷 첨부).
- **원인**: `header` 가 `flex items-center justify-between` 한 줄, 자식 div 에 min-width
  지정 없음 → 우측 control 영역이 0폭에 가깝게 짜부라들면서 label 텍스트가 vertical wrap.
- **조치**:
  - `header` 에 `flex-wrap gap-x-3 gap-y-1` 추가 → 좁으면 컨트롤이 다음 줄로 떨어짐.
  - 좌측 타이틀 컨테이너 `min-w-0 flex-1`, sessionId 부분 `min-w-0 truncate` + `title={sessionId}` 로 호버 시 전체 노출.
  - 우측 컨트롤 영역 `shrink-0`, 체크박스 라벨 `whitespace-nowrap` 강제 → 세로 wrap 차단.
  - icon 들에 `shrink-0` 일관 적용.

### 발견 7 — `opener.open_path` 권한이 capability 에 있는데도 여전히 거부됨

- **현상**: 1차에서 `opener:allow-open-path` 권한 identifier 만 추가 → 그래도
  `ForbiddenPath /Users/.../black-corp-tycoon/.oculpm/journal/.../2250_feature_...md` 발생.
- **원인 (소스 추적)**: `tauri-plugin-opener` 2.5.4 의 `commands::open_path` 는
  `Scope::is_path_allowed` 를 거치는데, 이 함수는 (a) fs scope glob 매칭 **AND** (b) 최소 한
  개 이상의 allow entry 가 program 매칭 (Application::Default vs `with: None`) 을 요구함.
  단순 identifier 만 추가하면 allow 배열이 비어 (b) 가 무조건 false → `ForbiddenPath`.
- **조치**: `src-tauri/capabilities/default.json` 의 두 permission 을 **객체 형식 + `allow: [{ "path": "**" }]`** 로 승격:
  ```json
  { "identifier": "opener:allow-open-path", "allow": [{ "path": "**" }] },
  { "identifier": "opener:allow-reveal-item-in-dir", "allow": [{ "path": "**" }] }
  ```
  `**` 글로브 = 모든 절대경로 허용. external project 의 `.oculpm/journal/**` 도 통과.
- **검증** (수동, 재빌드 후):
  - JournalEntryDetail "원본 열기" → OS 기본 에디터 (cmd-K → Cursor / VSCode / Typora 중 default) 로 .md 열림.
  - "코드 스니펫" 토글 켜고 path row hover → 향후 PR 에서 reveal-item 도 같은 scope 로 동작 예정.

### 검증 명령 (2차 조치)

```bash
cargo check --manifest-path src-tauri/Cargo.toml        # warnings only
cargo test --manifest-path src-tauri/Cargo.toml --lib oculpm::agents  # 13/13 PASS
pnpm tsc --noEmit                                       # clean
# 재빌드 필요한 항목 (런타임 검증):
#   - capability JSON 변경 → tauri dev 재시작 필요
#   - 새 커맨드 oculpm_agents_get_master_template → bindings.ts 한 줄 수동 추가 (다음 dev 빌드가 덮어씀)
```

### 발견 9 — start ↔ 프로젝트 뷰 반복 토글이 세션 N개 양산 (1차 발견 2 의 변종)

- **현상**: 사용자가 프로젝트 → 시작화면 → 프로젝트 를 빠르게 반복하면 매 진입마다 새 session_id 가 생성. 1차 발견 2 의 resume 메커니즘 (`session_resume_grace_minutes=15`) 이 작동 안 함.
- **원인 (코드 추적)**:
  1. `App.tsx` 의 useEffect 가 `selectedProjectId` 변화마다 cleanup 으로 `oculpm_watcher_stop` 호출.
  2. `OculpmManager::watcher_stop` 이 **세션 actor 까지** shutdown → `finalize_active(EndedReason::AppQuit, ...)`.
  3. resume 의 `try_resume_session` 은 prior session 의 `ended_reason == InactivityTimeout` 만 인정. `AppQuit` 은 `NoCandidate` → 새 세션 시작.
- **조치**:
  - `OculpmManager::watcher_stop` 가 더 이상 `session.shutdown()` 을 호출하지 않음. fs watcher 만 정지, SessionActor 는 메모리에 살려둠. 뷰 토글 사이엔 같은 세션 유지.
  - 사용자가 오래 떠나 있어 inactivity timeout 이 자연 발생하면 session 이 `InactivityTimeout` 으로 종료되고, 다시 돌아와도 grace (기본 15min) 안이면 resume 이 픽업.
  - `OculpmManager::watcher_start` 가 `entry.session.is_some()` 이면 기존 actor 를 재사용 (clone). 처음 진입에서만 spawn.
  - app 실제 종료 (`shutdown_all_blocking`) / `on_project_closed` 에선 ProjectEntry 드롭으로 SessionActor 가 자연 종료되고, 다음 launch 의 `recover_zombie_sessions` 가 `crash_recovered` 로 finalize → 데이터 손실 없음.
- **로그 단서**: 토글 사이에 `[FLOW] watcher_stop: ... session_alive=true` 가 보이면 정상. 새 진입에서 `[FLOW] watcher_start: ... reused_session=true` 면 같은 세션 유지됨.

### 발견 10 — 흐름 전체 가시성 부재 → 로그 인프라 + [FLOW] 태그

- **요청**: 사용자가 "프로젝트 로드 → 외부 LLM 작성 → UI 갱신" 흐름이 끊겼을 때 원인을 찾을 수 있게 로그를 남기고 싶다.
- **조치**:
  1. **파일 로그**: `tracing-appender` 추가, `setup_logging()` 이 `<app_data>/logs/oculpm.log.YYYY-MM-DD` 로 daily rotation. stdout + 파일 dual output.
  2. **`[FLOW]` 태그 INFO 로그**: 7개 핵심 지점에 삽입:
     - step 0 (frontend): 프로젝트 선택
     - step 1: `oculpm_init` 시작/완료
     - step 2: `sync_agents` 결과 요약 (활성 어댑터별 action)
     - step 3: `watcher_start` 시작/완료, `ProjectWatcher::start` armed
     - watcher fs event: journal 경로 진입
     - cache invalidation: outcome (Inserted/Updated/MtimeOnly/SkippedUnchanged)
     - emit: `OculpmJournalAdded` / `OculpmJournalUpdated`
     - step 4 (frontend): TimelineView 가 이벤트 수신, refetch 스케줄
     - session lifecycle: `[FLOW] session started/ended` 로 중복 세션 감지 가능
  3. **신규 커맨드**:
     - `oculpm_get_log_dir`: 로그 디렉터리 절대경로
     - `oculpm_log(level, target, message)`: frontend → backend tracing 브리지
  4. **frontend 모듈** `src/lib/oculpmLog.ts`: `oculpmLog.flow/info/warn/error` API + `installConsoleBridge()` 가 `console.warn/error` 를 자동 forward.
  5. **Settings UI**: "로그" 섹션 신설 — 경로 표시 + "로그 폴더 열기" 버튼 (opener 의 `revealItemInDir`). 사용자가 가장 최근 `oculpm.log.YYYY-MM-DD` 를 첨부할 수 있음.
- **사용**: 흐름 추적할 때 `grep '\[FLOW\]' oculpm.log.YYYY-MM-DD` 로 happy path 모두 확인.

### 발견 12 — AI 가 만든 파일이 안 보이는 진짜 원인: init 시 reindex 누락

- **사용자 신고**: `~/Desktop/pi/storygame/.oculpm/journal/20260526/Features_to_add/{2318,2327,2335}_*.md` 3건이 antigravity 가 작성한 정상 frontmatter 파일인데 TodayScreen 에 안 보임.
- **원인 (코드 추적)**: `OculpmManager::init_project` 는 lock + watcher 기반 인프라만 셋업, **SQLite 캐시 reindex 가 빠져 있었음.** 사용자 시나리오:
  1. ai-pm 앱이 꺼져 있는 상태에서 antigravity 가 `.oculpm/journal/.../*.md` 생성.
  2. 사용자가 ai-pm 앱 켜고 storygame 프로젝트 select → `oculpm_init` + `sync_agents` + `watcher_start` 실행.
  3. **watcher 는 시작 이후의 fs event 만 감지**. 이미 디스크에 있는 파일들은 event 없음 → 캐시도 비어 있음 → `oculpm_list_journal_entries` 가 0건 반환 → UI 빈 화면.
- **조치**:
  - `OculpmManager::reindex_journal_cache_incremental` 신설 — mtime-keyed, idempotent, 변하지 않은 행은 parse 스킵 (가벼움).
  - `oculpm_init` 명령의 sync_agents 직후에 호출. 디스크에만 있던 entries 가 한 번에 캐시로 들어감.
  - 결과를 `[FLOW] step 2.5 OK — incremental reindex picked up pre-existing journal entries inserted=N updated=N deleted=N skipped=N` 로 로깅 → 사용자가 로그만 봐도 "이번 init 에서 N개 잡아왔다" 확인 가능.
- **부수 효과**:
  - `reindex_incremental` 은 디스크에 없는 캐시 row 도 청소 (`deleted`). 사용자가 외부에서 파일 지운 경우 다음 open 에서 정리됨.
  - 큰 journal 트리도 mtime 매치 비율이 높아 거의 무비용.

### 발견 11 — `OculpmJournalAdded` 이벤트가 한 번도 emit 되지 않던 dead-end

- **현상**: 프론트 `WorkspaceContext` / `TimelineView` 가 `oculpmJournalAdded` 를 listen 만 함. 백엔드에서 emit 되는 곳이 0 — "새 기록: ..." 토스트가 외부 LLM 작성 시 절대 발생 안 함.
- **원인**: watcher 가 `OculpmJournalPathChanged` (저수준, 경로만) 만 emit, `JournalAdded`/`JournalUpdated` (고수준, summary 포함) 는 enum 으로만 존재.
- **조치**:
  - `JournalCache::apply_path_change` 가 `Option<UpsertOutcome>` 반환 (Removed=None, 나머지=Some).
  - 신규 `JournalCache::get_summary_by_path(project_id, rel)` → 단일 path 의 hydrated summary (tags + files_count 포함).
  - `WatcherInner::emit_journal_outcome` 가 Inserted → `OculpmJournalAdded`, Updated → `OculpmJournalUpdated` 로 분기 emit. MtimeOnly / SkippedUnchanged 는 emit 안 함.
  - 전 과정에 `[FLOW]` 로그 — `outcome = ?outcome` 으로 어떤 emit 이 일어났는지 추적 가능.

### 발견 8 — 프로젝트 초기 로드 시 AGENTS.md 자동 생성 누락

- **현상**: 신규 프로젝트는 Greenfield 위저드가 sync 를 호출해서 `AGENTS.md` 가 생기지만,
  **기존 프로젝트 / 다른 머신에서 clone 한 직후 / 사용자가 수동으로 `AGENTS.md` 삭제한 뒤**
  에 프로젝트를 다시 열 때, `oculpm_init` 은 `.oculpm/config.toml` 만 보고 fast-path 로
  반환해서 어댑터 파일을 만들지 않음. 결과: 외부 LLM 이 root `AGENTS.md` 를 못 보고 1차 발견 1
  의 "외부 LLM 이 `.oculpm/agents/_template.md` 를 자발적으로 안 읽음" 문제가 재현됨.
- **조치**:
  - `src-tauri/src/commands/oculpm.rs::oculpm_init` 의 성공 분기 끝에 **`manager.sync_agents(&db, project_id)`** 1회 호출 추가.
  - `sync_active` 는 idempotent — 이미 존재하면서 내용 일치하면 no-op (mtime 도 안 움직임).
  - 실패해도 init 자체는 성공 처리 (warn 로그만). 다음 "지금 동기화" 로 사용자가 직접 retry 가능.
- **부수 효과 검토**:
  - 모든 프로젝트 open 시점에 sync 가 돌아도, default config 의 `agents.active = ["agents-md"]` 만 해당 → 기존 `.cursor/rules/`, `.claude/CLAUDE.md` 등은 user opt-in 어댑터라 자동 생성 안 됨.
  - drift 감지 영향 없음 (sync 후 우리가 방금 쓴 hash 가 agent_state 에 기록 → 다음 watcher event 와 일치).
- **검증**: `cargo test --lib oculpm::manager` → 39/39 PASS (기존 통합 테스트가 init→sync_agents 시퀀스를 이미 일부 사용 중).

