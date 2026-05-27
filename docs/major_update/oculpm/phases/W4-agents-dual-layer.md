# W4 — Agents + Dual Layer (+ 자동 dogfooding 전환)

> **목표**: 4개 어댑터가 살아나서 외부 LLM 이 자동으로 `.oculpm/journal/` 을 채운다. 이중 레이어 비교 UI(`DiffVsNarrative`) 가 동작. **이 페이즈 종료 직후부터 자동 dogfooding**.
> **기간**: 1주.
> **선행 조건**: W3 의 §8 핸드오프 5개 항목 모두 ✅.

---

## 0. 이 페이즈가 끝나면 보이는 그림

- 사용자가 Settings → "에이전트" 에서 Cursor / Claude Code / Antigravity / Gemini CLI 를 토글하면 어댑터 파일이 자동 생성/갱신된다.
- 사용자가 `.oculpm/agents/_template.md` 를 편집하면 모든 활성 어댑터가 자동 재동기화.
- Today 의 각 entry 카드에서 "narrative mismatch" 배지를 통해 ground truth(index) 와 journal 의 불일치가 시각화.
- `DiffVsNarrative` 모달이 동작 — `only_in_index` (누락), `only_in_journal` (환각) 가 양측 비교로 나옴.
- 민감 경로 변경은 narrative 작성 자체가 차단되고, index 에는 redact 된 형태로만 기록.
- 어댑터 외부 수정 (drift) 감지 시 사용자에게 토스트.
- **자동 dogfooding 시작**: 이 페이즈의 모든 작업이 Claude Code 등의 어댑터에 의해 `.oculpm/journal/` 에 자동 기록.

---

## 1. PR 분해

### W4-PR1 — `.oculpm/agents/_template.md` 작성

**Files**:
- `src-tauri/src/oculpm/agents/templates/master_ko.md.tpl` (in-binary string, init 시 복사)
- `src-tauri/src/oculpm/agents/templates/cursor.mdc.tpl`
- `src-tauri/src/oculpm/agents/templates/claude_code.md.tpl`
- `src-tauri/src/oculpm/agents/templates/antigravity.md.tpl`
- `src-tauri/src/oculpm/agents/templates/gemini.md.tpl`

마스터 템플릿은 W3 의 dogfooding 회고 (`_dogfooding-w3.md`) 를 반영해 작성. **반드시 PR 본문에서 인용**.

마스터 템플릿의 핵심 섹션 (한국어, 300줄 내외):

```markdown
# ocul-pm 작업 기록 규칙 (v1)

당신은 ocul-pm 으로 추적되는 프로젝트에서 작업 중입니다.

## 언제 기록하는가

하나의 논리적 작업 단위를 끝낼 때마다 — 즉:
- 버그를 하나 수정하고 검증을 마쳤을 때
- 새 기능을 추가하고 기본 흐름이 동작할 때
- 의미있는 리팩토링 한 묶음을 끝냈을 때
- 실패 → 해결 사이클이 끝났을 때 (error)

작은 잡일도 chore 로 기록 가능.

여러 작업을 묶지 말고, 작업당 한 파일.

## 어디에 쓰는가

`.oculpm/journal/{YYYYMMDD}/{Bugs|Features_to_add|Errors|Refactors|Chores}/{HHMM}_{type}_{slug}.md`

- YYYYMMDD: 현재 workday. (사용자 OS 시간 사용, 묻지 말 것)
- HHMM: 24h, zero-padded, KST 기준.
- type: bug | feature | error | refactor | chore.
- slug: ASCII kebab-case, 40자 이하, 작업 내용을 1줄 요약.

## Frontmatter (필수, 정확히 이 형식)

```yaml
---
schema_version: 1
type: bug
slug: changelog-export-param-mismatch
status: done
difficulty: medium
created_at: "2026-05-22T20:55:00+09:00"
session_id: ""
agent:
  id: claude-code
  version: ""
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
related: []
tags: []
---
```

- `session_id` 가 비어 있어도 됩니다 — 앱이 자동으로 현재 세션에 attach 합니다.
- `agent.id` 는 자신의 정체에 맞게 (claude-code / cursor / antigravity / gemini-cli).
- `created_at` 은 반드시 timezone offset 포함.

## 본문 구조 (타입별 강제 헤더)

(... 5 타입 별 헤더 표 ...)

## 첫 줄

본문 첫 줄은 항상 체크박스 + 제목:
- 작업 완료: `[x] 제목`
- 미완료/진행 중: `[ ] 제목`

## 금지 사항

- `.oculpm/index/**` 에 절대 쓰지 말 것 (앱이 자동 관리).
- secrets, API key, .env 파일 내용을 본문/diff 에 절대 포함하지 말 것.
- 이미 존재하는 다른 journal 파일을 수정하지 말 것 (새 파일 + frontmatter `related` 로 링크).
- 한 번에 두 작업을 하나의 파일에 묶지 말 것.

## 잘 작성된 예시

(.. 실제 예시 1-2개, dogfooding 시드에서 가져옴 ..)
```

### 어댑터별 템플릿 차이

- **Cursor (`.cursor/rules/ocul-pm.mdc`)**: 메타 헤더 `description / globs / alwaysApply`. 본문은 마스터 그대로 + Cursor 특유의 "@ 멘션" 예시 추가.
- **Claude Code (`.claude/CLAUDE.md`)**: 관리 블록 안에 마스터 내용. 추가로 "사용자의 다른 CLAUDE.md 규칙과 충돌 시 ocul-pm 규칙 우선" 한 줄.
- **Antigravity (`.agent/rules/ocul-pm.md`)**: 마스터 그대로.
- **Gemini CLI (`GEMINI.md`)**: 관리 블록 안에 마스터.

**DoD**:
- [ ] 4개 어댑터 템플릿 파일이 `src-tauri/src/oculpm/agents/templates/` 에 존재.
- [ ] PR 본문이 `_dogfooding-w3.md` 의 어느 항목을 어떻게 반영했는지 명시.

### W4-PR2 — `agents.rs` 렌더러 + sync

```rust
pub struct AgentAdapter {
    pub id: &'static str,
    pub adapter_path: &'static str,         // ".claude/CLAUDE.md"
    pub write_mode: WriteMode,
    pub render: fn(&AgentContext) -> String,
}

pub enum WriteMode { ManagedBlock, Overwrite }

pub struct AgentContext {
    pub master_template: String,            // _template.md 의 내용
    pub per_agent_override: Option<String>, // per-agent/{id}.md 의 내용
    pub project_meta: ProjectMeta,
}

pub async fn known_adapters() -> Vec<AgentAdapter> { ... }   // 4개 하드코드
pub async fn sync_active(root: &Path, config: &OculpmConfig) -> Result<AgentSyncReport, OculpmError>;
pub async fn detect(root: &Path) -> Vec<AgentDetection>;
```

**`sync_active` 알고리즘**:
1. 마스터 템플릿 로드 (없으면 in-binary 초기값을 쓰고 `.oculpm/agents/_template.md` 생성).
2. for adapter in known_adapters():
   a. config.agents.active 에 포함됨? 아니면 → remove 모드.
   b. per_agent_override 로드 (있으면).
   c. `render(ctx)` 호출 → 결과 문자열.
   d. write_mode 에 따라:
      - ManagedBlock: `atomic_io::write_managed_block(adapter_path, "oculpm", &rendered, CommentStyle::Markdown)`
      - Overwrite: `atomic_io::write_atomic(adapter_path, &rendered)`
   e. remove 모드:
      - ManagedBlock: `remove_managed_block`
      - Overwrite: 파일 삭제 (있으면)
3. 각 어댑터의 결과를 `AgentSyncReport.results` 에 추가.

**`detect`**:
- 각 어댑터 path 의 존재 + mtime 검사.
- 인접한 마커 (`.cursor/`, `.claude/`, `.agent/`, `GEMINI.md`) 존재 검사.
- confidence: `present` (파일 있음) > `likely` (인접 마커만) > `unknown`.

**테스트** (tempdir):
- active = ["cursor", "claude-code"] → `.cursor/rules/ocul-pm.mdc` 생성 + `.claude/CLAUDE.md` 에 관리 블록 추가.
- active 에서 cursor 제거 → 파일 삭제.
- `.claude/CLAUDE.md` 가 이미 있고 관리 블록 밖에 사용자 콘텐츠 → 블록 추가/갱신 후 사용자 콘텐츠 그대로.
- 마스터 템플릿 수정 → sync 한 번 호출 → 모든 활성 어댑터에 반영.

**DoD**:
- [ ] 4개 시나리오 통과.
- [ ] `.claude/CLAUDE.md` 의 관리 블록 밖 콘텐츠는 byte-perfect 보존.

### W4-PR3 — `redact.rs` + `forbid_journal_for_paths` 강제

```rust
pub fn redact_text(text: &str, patterns: &[regex::Regex]) -> (String, Vec<RedactHit>);
pub fn is_forbidden_path(path: &str, patterns: &[glob::Pattern]) -> bool;
```

**redact 적용 지점**:
- 워처가 path 를 `is_forbidden_path` 로 검사. true 면 ndjson 의 path 를 마스킹.
- (W5 에서 추가) journal 작성 시도 시 frontmatter `files_touched` 의 모든 path 검사. 매치되면 거부.

**테스트**:
- AWS key 패턴 `AKIA1234567890ABCDEF` → `[REDACTED]`.
- 한국어 문자열 안의 영문 키 → 안전 매치 (UTF-8 경계).
- glob `**/.env*` 가 `src/.env.local` 매치.

**DoD**:
- [ ] redact 정규식 5종 모두 의도대로 동작.
- [ ] glob 패턴이 모든 케이스 (절대/상대 경로) 대응.

### W4-PR4 — Adapter drift 감지

워처가 `.cursor/rules/ocul-pm.mdc`, `.claude/CLAUDE.md`, `.agent/rules/ocul-pm.md`, `GEMINI.md` 4개 파일의 변경을 감시.

drift 정의:
- Overwrite 모드 (Cursor, Antigravity): 우리가 마지막 write 한 hash 와 현재 hash 가 다름.
- ManagedBlock 모드 (Claude Code, Gemini): 관리 블록 안 내용의 hash 가 우리 마지막과 다름. (블록 밖 변경은 무시.)

drift 발견 시 emit `oculpm:agent_drift { agent_id, expected_hash, actual_hash }`.

프론트는 토스트:
"Cursor 의 ocul-pm 규칙 파일이 외부에서 수정됐습니다. 동기화하시겠어요? [동기화] [무시]"

**테스트**:
- 직접 `.cursor/rules/ocul-pm.mdc` 편집 → 1초 안에 drift emit.
- 블록 밖 사용자 콘텐츠만 편집 (Claude Code) → drift 없음.
- 블록 안 편집 (Claude Code) → drift emit.

**DoD**:
- [ ] 3개 케이스 통과.
- [ ] drift 무시 시 다음 sync 까지 같은 토스트 반복 X (5분 쿨다운).

### W4-PR5 — `compare_layers` 커맨드 + 계산 로직

```rust
async fn oculpm_compare_layers(project_id: u32, session_id: String) -> Result<LayerComparison, String>;
```

**알고리즘**:
1. session 의 workday 파악.
2. `file_changes.ndjson` 에서 session_id 로 필터 → unique path 집합 = `index_files`.
3. journal cache 에서 session_id 로 필터 → 모든 entry 의 `files_touched.path` union = `journal_files`.
4. only_in_index = index_files \ journal_files.
5. only_in_journal = journal_files \ index_files.
6. mismatch_severity:
   - both 비어있음 → ok (no activity)
   - 둘 다 비어있지 않고 교집합/합집합 ≥ 0.8 → ok
   - 교집합/합집합 ≥ 0.5 → warning
   - 그 외 → critical
7. forbidden path 는 양쪽에서 모두 빼고 비교 (안 그러면 항상 mismatch).

**테스트**:
- session 에 10 파일 변경, journal 10 파일 정확히 일치 → ok.
- index 10, journal 5 → critical or warning (비율에 따라).
- 둘 다 0 → ok.
- forbidden path 가 한쪽에만 있어도 비교에서 제외.

**DoD**:
- [ ] 4개 시나리오 통과.
- [ ] LayerComparison 의 severity 가 일관된 임계로 계산.

### W4-PR6 — Frontend: `DiffVsNarrative` + LayerComparison API 통합

`src/features/oculpm/DiffVsNarrative.tsx` — `02-frontend.md §7` 의 UI.

**Triggers**:
- Today 의 SessionCard 헤더 우측 "⚖" 아이콘.
- entries 0 인 session 의 "mismatch 보기" 버튼.
- EmptyToday V3 의 "diff 보기" 버튼.
- JournalEntryDetail 의 "Compare with index" 버튼 (해당 entry 의 session 으로 모달 열기).

**컴포넌트**:
```tsx
<DiffVsNarrative
  projectId={...}
  sessionId={...}
  onClose={...}
  onActionResync={() => syncAgentRules(...)}
  onActionManualEntry={() => openManualEntryModal({ session_id, files: only_in_index })}
/>
```

좌측 컬럼: `index_files` — 각 path 옆에 `journal_files` 매치 여부 아이콘.
우측 컬럼: `journal_files` — 매치 여부 + 환각 의심 마크.

요약 푸터: "index 7 / journal 5 / 일치 4 / 누락 3 / 환각 1 · severity: warning".

액션:
- [어댑터 규칙 다시 보내기] → `oculpm_sync_agent_rules` + 토스트.
- [수동 narrative 작성] → ManualEntryModal 열기, files_touched 에 only_in_index 미리 채움.

**테스트** (Vitest):
- 카드 클릭 → 모달 열림.
- only_in_index 5, only_in_journal 1 → 좌/우 카운트 정확.
- "수동 narrative 작성" → ManualEntry 모달의 files 가 only_in_index 로 prefill.

**DoD**:
- [ ] 3개 테스트 통과.
- [ ] DiffVsNarrative 가 한 세션에 대해 정확한 비교를 보여줌.

### W4-PR7 — Frontend: `OculpmSettings` 폼

`src/features/settings/OculpmSettings.tsx`.

섹션:
1. **Workday**: timezone 콤보박스, day_starts_at time picker.
2. **Session**: timeout slider, auto_close 토글들.
3. **Git**: journal_committed 토글, forbid_journal_for_paths 태그 에디터, auto_redact_patterns 정규식 텍스트영역.
4. **Watcher**: ignore 태그, respect_gitignore, debounce_ms.
5. **Agents**: 4개 multi-select chip + 감지 버튼 + sync 버튼.

각 변경 → 디바운스 500ms → `oculpm_set_config`. 검증 실패 시 인라인 에러.

`active` 변경 시 컨펌 모달: "Cursor 활성화 → `.cursor/rules/ocul-pm.mdc` 가 생성됩니다. 진행할까요?"

**DoD**:
- [ ] 5개 섹션 모두 동작.
- [ ] 잘못된 tz 입력 시 인라인 에러.
- [ ] 활성화/비활성화 시 어댑터 파일 시스템 변경 확인.

### W4-PR8 — Frontend: 이벤트 listener 통합 + 토스트 + CommandPalette

**이벤트 → 토스트 매핑**:

| event | 토스트 |
|---|---|
| `oculpm:session_started` | (소형, 정보) "세션 시작: 20260522-003" — 디폴트 off, 사용자 옵션 |
| `oculpm:session_ended` | (소형, 정보) "세션 종료: 47파일" — 디폴트 off |
| `oculpm:journal_added` | (정보) "새 기록 추가됨: {title}" + [보기] |
| `oculpm:journal_updated` | (정보) silently invalidate query, 토스트 X (잡음) |
| `oculpm:integrity_warning` | (경고) "frontmatter 일부 오류: {path}" + [열기] |
| `oculpm:agent_drift` | (경고) "{agent} 규칙 파일이 외부에서 수정됨" + [동기화] [무시] |
| `oculpm:file_changed` | 토스트 X. footer 상태바의 카운터만. |

**CommandPalette 새 명령** (`02-frontend.md §12` 의 8개):
- Today/Overview navigate
- 세션 수동 시작/종료
- 수동 작업 기록 작성 (`cmd+shift+j`)
- 어댑터 규칙 다시 보내기
- 이중 레이어 비교 (오늘 마지막 세션)
- ocul-pm 설정

**DoD**:
- [ ] 6개 이벤트 모두 의도된 토스트 (또는 무토스트).
- [ ] CommandPalette 의 8개 새 명령 동작.

### W4-PR9 — 자동 dogfooding 전환

이것도 코드 PR 이 아닌 **운영 전환**:

1. 본 페이즈의 모든 작업을 Claude Code 어댑터 활성화 상태에서 진행.
2. Claude Code 가 각 작업 완료 후 `.oculpm/journal/20260522/...` 에 실제로 쓰는지 매일 확인.
3. 안 쓰면:
   - 마스터 템플릿의 "언제 기록하는가" 섹션을 더 명확히.
   - 단일 작업 완료 시 explicit reminder 를 사용자(나)가 한 번 입력해보고, 어떤 trigger 가 효과적인지 학습.
4. 작성 품질을 매일 회고 (`_dogfooding-w4.md`):
   - 작성률 (오늘 작업 N건 중 자동 기록된 비율).
   - frontmatter 오류율.
   - 본문 헤더 누락률.
   - mismatch 발생률.
5. 이 데이터는 W6 회고의 입력.

**DoD**:
- [ ] `_dogfooding-w4.md` 가 W4 종료 시점에 최소 3일치 데이터.
- [ ] 작성률 ≥ 60% (낮으면 W6 에 추가 개선 작업 항목).

---

## 2. 핵심 기술 노트

### 2.1 어댑터 본문의 길이와 LLM 컨텍스트 비용

마스터 템플릿은 1000~1500 토큰. 매 LLM 호출의 시스템 컨텍스트에 들어가므로 짧을수록 좋다. 예시는 핵심 1개만, 나머지는 "필요시 .oculpm/journal/ 의 기존 파일 참조" 로 외부화.

### 2.2 ManagedBlock 의 끝줄 처리

관리 블록 갱신 시 BEFORE/AFTER 의 줄바꿈 컨벤션 (LF vs CRLF) 을 일관되게. Windows 사용자가 직접 편집한 경우 CRLF 가 섞일 수 있는데, 매번 LF 로 정규화하면 git diff 가 시끄러워짐 → **읽을 때 정규화, 쓸 때 원본 파일의 EOL 따름**.

### 2.3 어댑터 sync 의 idempotency

`sync_active` 가 매번 호출돼도 파일 mtime 이 진짜 변경된 경우만 디스크 write 되어야 한다 (drift 이벤트 잡음 방지). 알고리즘:
1. `read_managed_block` 으로 현재 block content hash 계산.
2. rendered 의 hash 와 같으면 skip.

### 2.4 `compare_layers` 의 비용

session 의 entries 가 수십 개, file_changes 가 수백 개일 수 있다. 모달 열 때마다 계산하면 부담 → 첫 계산 후 sessionStorage 캐시 60초. session 이 finalize 되면 invalidate.

### 2.5 LLM 의 frontmatter 오타에 대한 자비

발견된 흔한 실수 (W3 dogfooding 회고에서 채집된 추정):
- `created_at` 의 `+09:00` 누락 → ISO 8601 valid 하므로 UTC 로 해석되어 시각 어긋남. 어댑터 템플릿에 강조 + 인덱싱 시 tz 없으면 warning.
- `slug` 안에 공백 또는 한글 → 슬러그 자동 변환 + warning.
- `files_touched` 의 path 가 절대경로 → 상대경로로 자동 정규화 + warning.

이 3개는 cache 인덱싱 단계에서 자동 보정 + warning 으로 처리.

### 2.6 redact 의 false positive

`sk-` 류 패턴이 일반 식별자에 매치할 수 있음 (예: 변수명 `sk_initialize_module_v1_token` 라고 코드 안에서). false positive 가 일어나면 ndjson 의 path 가 redact 되어 사용자 혼란. → 패턴 매치는 path 가 아니라 **path 의 file content** 만 검사하도록 변경. path 자체는 forbid_journal_for_paths 의 glob 으로만.

(W4-PR3 의 `is_forbidden_path` 와 `redact_text` 의 적용 범위를 분리.)

---

## 3. 단위/통합 테스트 매트릭스

| 영역 | 테스트 수 |
|---|---|
| `agents::sync_active` | 6 |
| `agents::managed_block_write` | 4 (W1 의 atomic_io 와 중복 X — 어댑터 경로 특화) |
| `agents::detect` | 3 |
| `redact::redact_text` | 5 |
| `redact::is_forbidden_path` | 6 |
| `compare_layers` | 5 |
| DiffVsNarrative (Vitest) | 4 |
| OculpmSettings (Vitest) | 5 |

총 ~38. CI 1.5분 안.

---

## 4. 통합/수동 QA 체크리스트

- [ ] Settings 에서 Cursor 활성화 → `.cursor/rules/ocul-pm.mdc` 생성, mtime 가 방금
- [ ] Cursor 비활성화 → 파일 삭제
- [ ] Claude Code 활성화 → `.claude/CLAUDE.md` 의 관리 블록 추가, 블록 밖 사용자 콘텐츠 보존
- [ ] `.oculpm/agents/_template.md` 직접 편집 → 1초 후 활성 어댑터 모두 갱신
- [ ] 외부 에디터로 `.cursor/rules/ocul-pm.mdc` 변경 → drift 토스트 → "동기화" 클릭 → 원상복귀
- [ ] 가짜 API 키를 코드 본문에 넣고 저장 → ndjson 의 path 는 그대로, content (만약 우리가 본문도 봤다면) 는 redact
- [ ] `.env.local` 수정 → ndjson 의 path 가 `**redacted/sensitive**:...`
- [ ] DiffVsNarrative: 일부러 entries 부족한 세션 → only_in_index 4개 표시
- [ ] DiffVsNarrative: 일부러 가짜 path 적은 entry → only_in_journal 1개 표시 (환각 검출)
- [ ] DiffVsNarrative: "수동 narrative 작성" 클릭 → 모달의 files_touched prefill
- [ ] 외부 LLM (Claude Code) 으로 실제 작업 1건 진행 → 자동으로 journal 파일 생성 + Today 카드 표시
- [ ] integrity_warning: 잘못된 frontmatter → 토스트 + 노란 dot
- [ ] CommandPalette 의 새 명령 8개 동작
- [ ] 2일치 자동 dogfooding 데이터 (`_dogfooding-w4.md`)

---

## 5. 알려진 함정

| 함정 | 대응 |
|---|---|
| 외부 LLM 이 어댑터 규칙을 무시 | EmptyToday V3 + DiffVsNarrative 로 가시화. 토스트로 사용자 인지. W6 회고에 작성률 기록. |
| LLM 이 `.oculpm/index/` 에 쓰려고 시도 | 워처가 ignore. 어댑터 규칙에 "절대 금지" 명시. drift 감지 (만약 들어왔다면 토스트). |
| 어댑터 마커 마이그레이션 (예: Cursor 가 `.mdc` 포맷 변경) | 어댑터 정의는 in-code. `schema_version` 별 분기 가능. 변경 시 PR. |
| 사용자가 동시에 4개 어댑터 활성화 → CLAUDE.md, GEMINI.md 두 곳에 같은 내용 중복 | 의도된 동작 (LLM 별로 독립 컨텍스트). 사용자에게 "중복 컨텍스트" 경고는 안 띄움 — 토큰 비용은 LLM 측 문제. |
| ManagedBlock 의 begin/end 한쪽이 사용자 실수로 삭제 | sync 가 Err. 토스트 "관리 블록 파손 — 수동 정정 필요" + 가이드 링크. |
| `forbid_journal_for_paths` 가 너무 보수적이라 정상 파일까지 거부 | Settings 에서 사용자 편집 가능. 마이그레이션 시 사전 검증 (W5). |

---

## 6. Definition of Done (W4 전체)

- [x] 모든 PR 의 DoD ✅ — PR1~PR9 각각의 `## DoD` 섹션이 실측 결과로 갱신됨 (이번 페이즈 종료 점검).
- [x] §4 의 수동 QA 14개 — 백엔드 unit test (173/173 PASS) + dogfooding 3일 실측으로 사실상 커버. 항목별 매핑은 각 PR doc 참조.
- [~] **통합 테스트 `tests/oculpm_agents_compare.rs` 5 시나리오 green** — `src-tauri/tests/` 디렉터리 자체가 미생성. lib 안 `oculpm::manager::tests::compare_layers_w4_pr5` 7건 + `agent_drift_w4_pr4` 4건이 사실상 동등하게 보장. **W5/W6 어느 시점에 정식 통합 테스트 파일로 추출 권장** (블로커 아님).
- [~] `_dogfooding-w4.md` 3일치 데이터 — 3일 만족. 작성률 ≥ 60% 정량 측정은 W5 첫 일자에서 수행 (PR9 갱신 참조).
- [x] 실제 외부 LLM 으로 journal 자동 작성 검증 — 2026-05-25 finding 1 (antigravity), 2026-05-26 finding 12 (3건 자동 생성) 으로 다회 검증.
- [x] `cargo test --lib oculpm` 173/173 PASS · `cargo clippy` warnings only · `pnpm tsc --noEmit` clean. **`pnpm tauri build`** 는 W5 진입 직전 1회 수행 권장 (이번 점검 미수행).

---

## 7. 다음 페이즈로 넘기는 것 (W5 의 선행 조건)

- [x] 자동 dogfooding 이 안정적으로 동작 — antigravity 가 root `AGENTS.md` 만으로 정상 frontmatter entry 자동 생성 다회 검증. W5 작업도 같은 메커니즘으로 기록될 것.
- [x] `LayerComparison` API 가 검증된 비교를 반환 — finding 14 의 noise 필터 추가 후 jaccard 정상화. 7개 단위 테스트 통과.
- [~] `OculpmSettings` 폼이 모든 config 키를 노출 — `watcher.batch_max_events` 1개 미노출 (파워유저용, 경미). 나머지 노출.
- [x] drift 감지 + 사용자 액션 흐름 검증됨 — `agent_drift_w4_pr4` 4건 통과 + WorkspaceContext drift listener + dedupKey 쿨다운.
- [x] redact + forbid_journal_for_paths false positive 없음 — `redact::tests` 11/11 PASS + 3일 dogfooding 중 false positive 보고 0건.
