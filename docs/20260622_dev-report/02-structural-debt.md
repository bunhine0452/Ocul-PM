# 02 — 구조적 부채 (정리보다 중요한 정합성 문제)

> 이 3가지는 "죽은 코드"가 아니라 **활성 코드의 정합성 버그**다. `03-next-features.md` 의 여러 제안이 이걸 전제로 한다.
> 우선순위상 단순 정리(01)보다 먼저 다뤄야 할 수도 있다.

---

## 1. 플래너 이중화 — 살아있는 두 시스템이 화해되지 않음

### 증상
파일 기반 플래너(`PlannerScreenV2` → `commands/plan.rs` → `.oculpm/planner/*.md`)와 **레거시 SQLite goals/subtasks**(`commands/planner.rs`)가 공존한다. Planner 화면은 파일 기반을 읽는데, 다음 세 곳은 **죽은 SQLite sink 에 쓴다:**

| 쓰는 곳 | 무엇을 | 결과 |
|---|---|---|
| `useNextTasks` (Today "다음 할 일") | `goalList`/`subtaskList` 읽기 | Today 가 **레거시 goals** 를 보여줌 — Planner 화면과 불일치 |
| AI 챗 플래너 액션 (`aiActions.tsx`) | `goalCreate` 등 | 사용자가 챗에서 승인한 액션이 **Planner 화면에 안 나타남** |
| 그린필드 위저드 시드 목표 | `commands.goalCreate` (SQLite) | 위저드가 만든 목표를 **PlannerScreenV2 가 영원히 못 읽음** |

추가로 `useNextTasks` 는 goal status 를 `'active'` 로 기대하지만, 실제 쿼리하는 레거시 SQLite goals 는 `'in_progress'`/`'open'` 을 쓴다(`'active'` 는 파일 기반 `plan.rs` 만). → `'active'` 분기가 사실상 죽은 코드.

### 왜 중요한가
이건 단순 중복이 아니라 **사용자가 보는 데이터가 갈라지는 정합성 버그**다. "AI 가 계획을 스스로 갱신한다"는 제품의 핵심 서사가, 갱신이 보이지 않는 sink 로 가기 때문에 실제로 깨진다.

### 권장 조치
- Today `useNextTasks`, AI 챗 `aiActions.tsx`, 그린필드 시드 목표를 **전부 파일 기반 `plan.rs` 경로로 일원화.**
- 레거시 SQLite goals/subtasks 커맨드(`goal_get`·`dashboard_stats` 는 즉시 삭제; `goal_list`/`goal_create`/`subtask_*` 는 일원화 후 폐기) 및 `planner/hooks.ts` 제거.
- 일회성 데이터 이행은 이미 `plan_migrate_goals`(`migrate.rs`)가 존재 — 재사용.
- 관련 정리 항목: `01-code-cleanup.md` §1-C(`planner/hooks.ts`), §3-A(`goal_get`/`dashboard_stats`).

---

## 2. redaction 미연결 — 시크릿이 일지·diff 에 무방비

### 증상
CLAUDE.md 는 "never put secrets in journals/diffs" 를 명령한다. `redact.rs` 의 `redact_text`/`compile_redact_patterns`(AWS·OpenAI/Anthropic `sk-`·GitHub PAT·Slack 정규식)는 **구현·테스트(5개)까지 끝났다.** 그런데 호출처는 **`oculpm/planner/project.rs` 단 한 곳**(플래너 읽기 투영)이다.

다음 경로는 `redact_text` 를 전혀 호출하지 않는다:
- `create_manual_journal_entry` (수동 일지 본문)
- watcher 의 journal-index 경로 (에이전트가 직접 쓴 `.md`)
- `entry_diffs.rs` (`capture_entry_diffs` / `read_or_reconstruct_entry_diffs` — 영속 diff sidecar)
- `compute_diff` / `git.rs` (live diff)

현재 방어는 **경로 차단**(`is_forbidden_path` — `.env`/`*secret*` 등 파일 자체를 일지에서 거부)뿐. **본문에 붙여넣은 키, diff hunk 안의 토큰은 그대로 통과**한다.

### 왜 중요한가 (이중 위험)
1. **로컬 무결성 버그**: 그 일지·diff 가 SQLite 캐시 → AI 컨텍스트(`aiContext.ts`)로 들어가 LLM API 로 전송된다. 즉 시크릿이 외부로 나갈 수 있는 유일한 경로(LLM 콜)를 통해 누출 가능.
2. **공유 차단**: 이 레포가 그렇듯 `.oculpm/` 을 git 에 커밋하면, 마스킹 안 된 시크릿이 팀 전체로 배포된다. → `03` 의 모든 공유/내보내기 기능의 **차단 전제**.

### 권장 조치 (effort S~M, impact high — 1순위)
이미 있는 `planner/project.rs` 패턴(config 로드 → `compile_redact_patterns` → `redact_text`)을 그대로 복제:
- **(쓰기)** `entry_diffs::capture_entry_diffs`: `render_unified_diff` 직후 patch 본문에 적용 후 sidecar 저장. (schema_version v2→v3 bump 권장 — v1→v2 무효화 선례 존재)
- **(쓰기)** `create_manual_journal_entry`: `body_markdown`/frontmatter 직렬화에 적용.
- **(쓰기)** watcher journal upsert: `cache.upsert_entry` 전 본문에 적용.
- 변수명 오탐(`sk_initialize_module`)은 redact.rs 주석이 경고 → **경로/식별자가 아닌 본문·diff hunk content 에만** 적용.
- `RedactHit` 발생 시 기존 `oculpm-integrity-warning` 이벤트로 "비밀 N건 마스킹됨" 토스트.
- 디스크 SSOT 불변 원칙과의 조율: diff sidecar 는 **캡처 시점 마스킹**(인덱스가 평문 보관 안 하도록), 일지 본문은 **투영 시 마스킹**(디스크 원본 보존) 중 택일 — sidecar 는 at-capture, 일지는 on-projection 권장.

> 부수: `redact.rs:22` 의 "not yet consumed (W5)" 주석은 갱신해야 한다(이미 planner 가 소비 중).

---

## 3. "자동 갱신" 약속 미실현 — 플랜은 수동으로만 바뀐다

### 증상
마스터플랜(`docs/planner-upgrade`)의 간판 문구:
> "일하는 그 에이전트가 일지를 쓰며 대응 Plan 항목도 자동 갱신 — 스스로 업데이트"

실제로 파일 기반 플랜이 바뀌는 경로는 둘뿐:
1. 외부 에이전트가 AGENTS.md 규칙을 따라 `.md` 를 **수기 편집**.
2. 사용자가 Planner 화면에서 **"AI 갱신"(`plan_ai_refresh`) 버튼**을 클릭.

**일지를 쓰는 행위 자체는 플랜에 아무 영향이 없다.** 게다가 watcher 는 `.oculpm/planner/**` 를 short-circuit 해서(emit 안 함) 외부 `.md` 편집의 live-push 도 없다. 인-앱 편집은 `journal_ref` 컬럼을 항상 `None` 으로 남겨, 항목↔일지 연결(📓 버튼·"완료?" 제안)이 외부 에이전트 로그로만 채워진다.

### 왜 중요한가
제품의 가장 강력한 차별점("에이전트 활동의 종단 기록 위에서 계획이 살아 움직인다")이 **데모로만 존재**한다. 이 레포의 `.oculpm/planner/` 가 비어 있다는 사실이 — 일지는 도그푸딩하지만 살아있는 플랜은 안 한다 — 이 격차를 방증한다.

### 권장 조치 → `03-next-features.md` **F1 (자동 일지→플래너 화해)**
watcher 의 신규-일지 인덱싱 분기(이미 `capture_entry_diffs` 를 트리거하는 `UpsertOutcome::Inserted`)에 **디바운스된 best-effort 플랜 화해 패스**를 추가. 기존 `plan_ai_refresh` 머신(`ai.rs` 프롬프트 + `parse_ai_edits` + `set_item_status` + `append_log_row`)을 재사용하되, 25개 윈도우 대신 **방금 쓰인 항목 1개**로 스코프를 좁혀 어떤 `item_id` 를 진전시켰는지 묻고 유효한 status flip 만 적용 — `agent_id='auto:<provider>'`, `journal_ref` 채움. (effort M, impact transformative)

---

## 정리: 세 부채의 공통 교훈

세 가지 모두 **"백엔드/로직은 있는데 마지막 한 겹이 안 연결됐다"** 는 동일 패턴이다. 이는 `01` 의 고아-커맨드 현상과 같은 뿌리 — **프런트가 백엔드를 따라가지 못함**. 따라서 발전 전략의 핵심은 새 기능 발명보다 **"이미 만든 능력을 연결하고 일원화하는 것"** 이며, 이게 임팩트 대비 노력이 가장 높다(→ `03`).
