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

