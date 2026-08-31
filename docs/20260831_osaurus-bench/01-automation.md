# 01 — 자동화: Core Model · 잡 러너 · Schedules · Watchers

> Phase 0 · 1 · 2 · 상위: [00-master-plan.md](00-master-plan.md)

## 0. 무엇을 가져오는가

Osaurus 는 자동화를 두 축으로 나눕니다: **Schedules 는 시계에 반응하고, Watchers 는
현실에 반응한다.** 둘 다 "에이전트에게 지시문을 주고 결과를 대화 세션으로 남긴다"
는 같은 실행 모델을 씁니다.

ocul-pm 에는 자동화 축이 **하나도 없습니다.** `grep cron` 무소득 · 스케줄러 부재.
있는 건 두 개의 옵인 배경 작업뿐입니다:

| 기존 | 트리거 | 파일 |
|---|---|---|
| `agents.auto_reconcile` | 워처가 새 일지를 봄 → 플랜 화해 | `oculpm/reconcile.rs` |
| `agents.auto_journal_draft` | 훅이 Claude Code 세션 종료(AgentExit) 를 봄 | `oculpm/journal_draft.rs` |

이 둘은 각자 트리거·락·모델 선택·귀속 규약을 따로 들고 있습니다. Phase 0 은
**그 셋을 하나로 합치고**, Phase 1·2 가 그 위에 새 발동원을 얹습니다.

---

## Phase 0 — 토대

### 0.1 Core Model 슬롯

Osaurus: *"메모리 쓰기는 Core Model 을 통한다 — 배경 작업 전용의 작고 빠른 모델.
설정하지 않으면 아무것도 증류되지 않는다."*

ocul-pm 도 같게 합니다 ([D2](00-master-plan.md#decision-2)).

**설정 키** (`src/lib/settings.ts` KEYS — SQLite `settings` 테이블):
```ts
// --- LLM ---
coreProvider: "core_provider",   // Provider | "" (미설정)
coreModel:    "core_model",      // 모델 id
```

**규약**
- 배경 작업은 `defaultProvider`/`defaultModel` 을 **읽지 않습니다.** 전부
  `core_*` 를 봅니다. 미설정이면 그 작업은 성립 불가 → 조용히 스킵(기존
  `journal_draft.rs` 의 "자격증명 없으면 조용히 스킵" 규약과 동일).
- failover 체인(`fallbackModels`)은 Core Model 에도 적용합니다 — 배경 작업이
  체인 없이 한 번 실패하고 끝나면 조용한 소실이 됩니다.
- 설정 UI: `LlmTab` 에 "배경 작업 모델" 섹션. 설명 문구는 *"자동 화해 · 일지 초안 ·
  스케줄 · 감시가 이 모델을 씁니다. 대화 모델과 따로 두는 이유는 배경 작업이
  자주, 조용히, 과금되기 때문입니다."*

**기존 두 작업 이관** — 조용한 정지를 만들지 않습니다.

`reconcile.rs` · `journal_draft.rs` 의 모델 선택을 `core_*` 로 바꾸면, 이미
`auto_reconcile` 을 켜 둔 사용자는 업데이트 순간 그 기능을 **말없이 잃습니다**.
D2 의 취지는 "몰랐는데 과금됐다" 를 막는 것이지 "잘 되던 게 멈췄다" 를 만드는 게
아닙니다.

1회 마이그레이션으로 시드합니다:
- `core_provider`/`core_model` 이 비어 있고 `auto_reconcile` 또는
  `auto_journal_draft` 중 하나라도 켜져 있으면 → `default_provider`/`default_model`
  값을 그대로 복사합니다. **동작 변화 0.**
- 둘 다 꺼져 있으면 시드하지 않습니다 (자동화를 처음 켤 때 고르게).
- 업데이트 후 1회 카드(`lastSeenVersion` 인프라 재사용)로 알립니다: *"배경 작업이
  이제 별도 모델을 씁니다. 지금은 대화 모델과 같은 값이며, 더 싼 모델로 바꾸면
  자동화 비용이 줄어듭니다."*

즉 **새 사용자에게는 게이트, 기존 사용자에게는 시드**입니다.

### 0.2 발동 출처 (SessionId 확장)

**실제 타입 구조를 먼저 확인했습니다** (`oculpm/session_id.rs`, polish-round Phase 4):

```rust
pub struct SessionId(String);          // #[serde(transparent)] — 직렬화 모양 불변
pub enum SessionKind { Watcher, Manual, Mcp, GitBackfill, Unknown }
pub const MANUAL_PREFIX: &str = "manual-";
pub const MCP_PREFIX:    &str = "mcp-";
```

즉 방언은 **접두 문자열**로 구분되고, `kind()` 가 접두를 보고 분류하며
`workday()` 가 방언마다 다른 자리에서 8자리를 꺼냅니다.

**따라서 `<workday>-sNN` 형태를 쓰면 안 됩니다.** `kind()` 는 `head`(8자리) 뒤의
`tail` 이 전부 숫자여야 `Watcher`, `git` 이어야 `GitBackfill` 로 보고, `s01` 같은
tail 은 **`SessionKind::Unknown`** 이 됩니다. `workday()` 는 관용적으로 앞 8자를
돌려주므로 색인은 통과하지만 **분류가 죽어** Phase 3 의 소스 배지가 자동화를
구분하지 못합니다.

정답은 기존 두 접두와 같은 모양입니다.

```rust
pub const SCHEDULE_PREFIX:   &str = "sched-";   // sched-YYYYMMDD-HHMMSS
pub const AUTOMATION_PREFIX: &str = "auto-";    // auto-YYYYMMDD-HHMMSS

pub enum SessionKind { Watcher, Manual, Mcp, GitBackfill, Schedule, Automation, Unknown }

impl SessionId {
    pub fn schedule(workday: &str, local: impl Timelike) -> Self { … }
    pub fn automation(workday: &str, local: impl Timelike) -> Self { … }
}
```

`kind()` 의 두 접두 분기와 `workday()` 의 두 arm 을 `Manual`/`Mcp` 와 **동일한
모양으로** 추가합니다. id 조립은 생성자에서만 하고 호출부에서 문자열을 만들지
않습니다.

> **정정(R2)**: 기존 메모 "IndexWriter 는 첫 8자가 workday 숫자일 것을 강제한다" 는
> polish-round 이전 규약입니다. 지금은 `SessionId::workday()` 가 접두 방언을
> 알고 있으므로 접두형이 정식입니다 — 이 문서가 그 메모를 대체합니다.

일지 frontmatter 의 `agent.id` 는 auto-reconcile 선례를 따라 `auto:<provider>` 를
유지하되, **출처는 session_id 접두로 구분**합니다 — Phase 3 의 배지가 이걸 읽습니다.

### 0.3 잡 러너 (`oculpm/automation/runner.rs`)

하나의 백그라운드 러너가 모든 자동화를 집행합니다.

```
enqueue(Job) → [동시 1건 try_lock] → resolve Core Model
             → 프로젝트 락 획득(plan_write_lock 공유락 규약 재사용)
             → LLM 호출 (failover 체인)
             → redact 통과 → 산출물 쓰기 (일지 / 플랜 / 없음)
             → AutomationRun 기록 + 이벤트 emit
```

**규약**
| 항목 | 규칙 | 근거 |
|---|---|---|
| 동시성 | `try_lock` 동시 1건. 밀린 것은 큐가 아니라 **드롭 + 사유 기록** | auto-reconcile N4 선례. 큐는 폭주를 지연시킬 뿐 |
| 락 | 기존 `plan_write_lock` 공유락 재사용. 새 락 만들지 않음 | R4 |
| 취소 | 실행 중 1건은 항상 취소 가능 (Phase 3 의 인라인 Stop 이 이걸 부름) | |
| redact | LLM 산출물은 쓰기 전 프로젝트 redact 패턴 통과 | `journal_draft.rs` 이중 방어 선례 |
| 실패 | 강등하되 소실 없음 — 요약 실패 시에도 "이 자동화가 돌았다" 는 run 레코드로 남김 | 동상 |
| 귀속 | `agent.id = auto:<provider>`, `session_id` 접두로 출처 구분 | 0.2 |

### 0.4 저장소 (D1)

**정의 = 온디스크 마크다운**
```
.oculpm/automation/
  schedules/<id>.md
  watchers/<id>.md
```

frontmatter + 본문(지시문):
```yaml
---
oculpm_automation: v1
id: weekly-dev-summary          # 파일명과 동일 kebab
kind: schedule                  # schedule | watcher
title: "주간 개발 요약"
enabled: true
created: 2026-08-31
updated: 2026-08-31
# --- schedule 전용 ---
frequency: weekly               # once|minutes|hourly|daily|weekly|monthly|yearly|cron
at: "17:00"
weekday: fri
cron: null
# --- watcher 전용 ---
watch: "src/"                   # 프로젝트 상대 경로
recursive: true
responsiveness: relaxed         # 아래 2.1 티어
# --- 공통 ---
output: journal                 # journal | plan | none
---

이번 주 git 활동을 훑고 커밋·브랜치·미결 항목을 요약해 주세요.
플래너의 활성 항목과 대조해 어긋난 것이 있으면 짚어 주세요.
```

**런타임 상태 = SQLite** (`033_automation.sql`)
```sql
CREATE TABLE automation_state (
  project_id   INTEGER NOT NULL,
  automation_id TEXT   NOT NULL,       -- 파일 id
  next_run_at  TEXT,                    -- ISO8601 (schedule 만)
  last_run_at  TEXT,
  last_status  TEXT,                    -- ok | failed | skipped | cancelled
  last_error   TEXT,
  PRIMARY KEY (project_id, automation_id)
);
CREATE TABLE automation_runs (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL,
  automation_id TEXT NOT NULL,
  session_id    TEXT NOT NULL,          -- <workday>-sNN / -aNN
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  status        TEXT NOT NULL,
  journal_path  TEXT,                   -- 산출물이 있으면
  note          TEXT
);
CREATE INDEX idx_automation_runs_lookup
  ON automation_runs(project_id, automation_id, started_at DESC);
```

정의가 SSOT 이므로 상태 행은 언제든 재생성 가능합니다 — 파일이 사라지면 상태도
지웁니다(고아 정리는 인덱스 재구축 경로에서).

### 0.5 설정 (D4)

`spec.rs` 에 `AutomationConfig` 를 추가하고 `OculpmConfig` 에 `#[serde(default)]` 로 답니다.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutomationConfig {
    /// 스케줄 집행 전역 스위치 (개별 파일의 enabled 와 AND)
    #[serde(default)]
    pub schedules: bool,
    /// 워처 자동화 전역 스위치
    #[serde(default)]
    pub watchers: bool,
    /// 한 워크데이에 자동화가 부를 수 있는 LLM 호출 상한 (폭주 가드)
    #[serde(default = "default_daily_budget")]
    pub daily_run_budget: u32,   // 기본 20
}
```

`schema_version` 은 올리지 않습니다 — 신규 섹션이고 기존 `config.toml` 은 전부
`false` 로 파싱됩니다.

---

## Phase 1 — Schedules

### 1.1 빈도 모델

Osaurus 의 8빈도를 그대로 가져옵니다.

| frequency | 필드 | 예 |
|---|---|---|
| `once` | `at` (ISO 날짜시각) | 1회 알림 |
| `minutes` | `every` (N분) | 잦은 폴링 |
| `hourly` | `every` (N시간) | 정시 스윕 |
| `daily` | `at` (HH:MM) | 아침 브리핑 |
| `weekly` | `at` + `weekday` | 금요일 주간 요약 |
| `monthly` | `at` + `day_of_month` | 월간 목표 리뷰 |
| `yearly` | `at` + `month`/`day` | 연간 회고 |
| `cron` | `cron` (5필드) | `0 9 * * 1-5` |

크레이트: `cron`(파싱·다음 시각 계산). `chrono-tz` 는 이미 있으므로 프로젝트
workday 타임존을 그대로 씁니다 (OS 로컬 — AGENTS.md 규약과 일치).

### 1.2 놓친 실행 복구

Osaurus: *"맥이 자고 있었거나 앱이 안 떠 있었으면, 다음 실행 때 돈다."*

ocul-pm 규칙:
- 앱 시작 / 프로젝트 열기 시 `next_run_at < now` 인 스케줄을 찾습니다.
- **최대 1회만 따라잡습니다.** 3일 꺼져 있었다고 3번 돌면 폭주입니다.
- 따라잡은 run 은 `note = "missed catch-up"` 로 표시해 History 에서 구분됩니다.
- `daily_run_budget` 을 넘으면 따라잡기를 포기하고 사유를 남깁니다.

### 1.3 화면

**새 화면을 만들지 않습니다.** `navRegistry` 는 11번째 이후 자유 배치지만,
자동화는 "설정에 가까운 관리면" 이라 **설정 → 자동화 탭**으로 넣습니다.
(`SettingsPanel` TAB 배열에 `automation` 추가, `Clock` 아이콘, `oculpm` 탭 아래.)

레이아웃 — 카드 목록:
```
┌────────────────────────────────────────────────────────┐
│ 주간 개발 요약                          [활성]  ⋯      │
│ 매주 금 17:00 · 다음 실행 9/5 (금) 17:00               │
│ 마지막 실행 8/29 17:00 · 성공 · 일지 1건               │
└────────────────────────────────────────────────────────┘
```
`⋯` 컨텍스트 메뉴: **편집 · 지금 실행 · 기록(History) · 일시중지/재개 · 삭제**
(삭제는 `useConfirm()` — polish-round `#confirm-unify` 규약).

**History**: `automation_runs` 를 시각 역순으로. 각 행은 상태 배지 + 산출 일지
링크(있으면 클릭 → 일지 화면으로 `NAV_BUS.openEntity`).

에디터는 우측 패널(2-pane) — 이름 / 빈도 / 시각 / 출력 종류 / 지시문(모노스페이스
textarea). 지시문 아래에 **작성 도움말**을 상시 표시합니다 (Osaurus 의 "구체적으로
쓰라" 조언을 UI 로): *"이 지시문이 그대로 모델에게 갑니다. 무엇을 보고, 무엇을
만들지 명시하세요."*

### 1.4 씨앗 스케줄 3종

빈 화면 대신 **비활성 상태의 예시 3개**를 프로젝트 첫 자동화 진입 시 제안합니다
(생성이 아니라 "이걸로 시작" 버튼):

| 이름 | 빈도 | 지시문 요지 | output |
|---|---|---|---|
| 주간 개발 요약 | 금 17:00 | 이번 주 git·일지를 훑어 커밋/미결 요약 | journal |
| 아침 브리핑 | 매일 09:00 | 어제 일지 + 플래너 활성 항목으로 오늘 우선순위 3가지 | none(카드) |
| 월간 회고 | 매월 1일 09:00 | 지난달 회고 신호를 읽고 다음 달 초점 제안 | journal |

이것이 백로그 C1(스탠드업/PR 리포트)의 실현입니다.

---

## Phase 2 — Watchers + 반응성 티어

### 2.1 반응성 티어

현재 `WatcherConfig.debounce_ms` 는 숫자 하나입니다. 이를 **이름 있는 정책**으로
승격합니다 (숫자 필드는 하위호환으로 유지 — 커스텀 값을 쓰던 config 를 안 깹니다).

| 티어 | 지연 | 쓰임 |
|---|---|---|
| `fast` | 200ms | 단일 파일 저장, 즉시 반응 |
| `balanced` | 1s | **기본** — 일반 감시 |
| `patient` | 3s | 배치·대용량 |
| `relaxed` | 60s | 편집 중인 세션이 멎기를 기다림 |
| `deferred` | 5m | 장시간 작성 |
| `extended` | 10m | 세션 끝 체크포인트 |

핵심 개념은 **settle-then-act** — "변경이 있었다" 가 아니라 "변경이 멎었다" 가
트리거입니다. 이것이 자동 일지의 락 문제를 우회하는 열쇠입니다: 에이전트가
활발히 쓰는 동안에는 아무것도 하지 않고, 손이 멎은 뒤에만 락을 잡습니다.

구현: 디바운서 창을 티어 값으로 설정하되, `relaxed` 이상은 notify 디바운서에
직접 걸지 않고 **러너 쪽 정착 타이머**로 처리합니다 (10분짜리 디바운스는 OS
워처가 이벤트를 들고 있게 만들어 메모리·유실 위험). 즉:
```
notify(balanced 창) → 이벤트 수집 → "마지막 이벤트 + 티어 지연" 타이머 리셋
                    → 타이머 만료 = 정착 → 자동화 발동
```

### 2.2 워처 자동화

`.oculpm/automation/watchers/<id>.md` 정의로 폴더를 감시하다 정착하면 러너에
잡을 넣습니다.

**ocul-pm 용 씨앗 2종:**

| 이름 | watch | 티어 | 지시문 요지 | output |
|---|---|---|---|---|
| 일지 초안 (손이 멎으면) | 프로젝트 루트 | `deferred` | 이 정착 창에서 바뀐 파일과 git diff 를 보고 일지 초안 1건 | journal |
| 플랜 화해 | `.oculpm/journal/` | `relaxed` | 새 일지와 활성 플랜을 대조해 글리프 갱신 제안 | plan |

두 번째는 기존 `auto_reconcile` 을 워처 자동화로 **흡수**하는 것입니다 — 별도
경로를 유지하지 않고 러너 하나로 모읍니다.

### 2.3 자동 일지 초안의 두 번째 경로

현재 `journal_draft.rs` 는 훅의 `AgentExit` 만 봅니다. 즉 **Claude Code 를 통해서
일한 것만** 초안이 생깁니다. 터미널에서 직접 편집하거나 다른 도구로 작업하면
아무것도 안 남습니다.

정착 트리거가 그 구멍을 메웁니다. 기존 안전장치는 전부 유지합니다:
- **에이전트 우선** — 정착 창 안에 자필 일지가 하나라도 있으면 아무것도 안 만듦
- **강등하되 소실 없음** — LLM 실패 시 메타 전용 chore 엔트리
- **규격은 코드가 보장** — LLM 은 내용만, frontmatter 조립은 결정적 composer
- **redact 이중 방어**

**추가 가드 — 두 경로의 이중 생성 금지.** 훅 `AgentExit` 와 정착 트리거는 같은
작업 구간에 **둘 다** 걸릴 수 있습니다. Claude Code 세션이 끝나면 훅이 초안을
쓰고, 그 쓰기가 잦아든 뒤 정착 타이머가 만료되면 두 번째 초안이 생깁니다.

기존 "에이전트 우선" 판정만으로는 못 막습니다 — 그 판정은 **자필 일지**(에이전트가
AGENTS.md 규칙대로 쓴 것)만 보는데, 훅이 만든 초안은 `agent.id = auto:*` 라
자필이 아니기 때문입니다.

규칙:
- 정착 트리거는 창 안에 **어떤 일지든**(자필이든 `auto:*` 초안이든) 있으면 스킵합니다.
- 두 경로가 **같은 중복 키**를 씁니다 — `(project_id, 작업 구간 시작~끝)`.
  먼저 도착한 쪽이 키를 잡고, 나중 쪽은 스킵을 사유와 함께 run 으로 남깁니다.
- 훅 경로가 살아 있는 프로젝트에서는 정착 트리거를 **보조**로만 둡니다
  (훅이 감지하지 못한 비-Claude-Code 작업이 이 경로의 존재 이유입니다).

### 2.4 증폭 루프 가드 (R1)

자동화 트리거 판정에서 **다음 경로의 변경은 원인에서 제외**합니다:
```
.oculpm/journal/**      ← 자동화 자신의 산출물
.oculpm/planner/**      ← 동상
.oculpm/automation/**   ← 정의 파일 편집
.oculpm/index/**        ← 이미 self-suppress 중
```
`watcher.rs` 는 지금 `journal/` 을 "이벤트 emit only" 로 통과시키는데
(헤더 주석 2번), **자동화 트리거 경로에서는 이를 원인 제외로** 확장합니다.
UI 는 emit 을 계속 받아야 하므로 두 판정을 분리합니다.

추가 가드:
- 같은 자동화는 **최소 간격**(티어 지연의 2배) 안에 재발동하지 않음
- `daily_run_budget` 초과 시 이후 발동은 사유를 남기고 스킵
- 에디터의 지시문 도움말에 **멱등 가이드** 상시 노출:
  *"이미 처리한 것은 건너뛰라고 명시하세요. 자동화는 여러 번 돌 수 있습니다."*

### 2.5 문제 해결 문구

Osaurus 가 문서에 못박은 트러블슈팅 절차를 그대로 UI 에 넣습니다.

| 증상 | 안내 |
|---|---|
| 안 돌았다 | 일시중지 상태인지 · 폴더가 존재하는지 · 재귀가 꺼져 있는지 · 앱이 떠 있었는지 |
| 너무 자주 돈다 | 티어를 길게 · 지시문을 멱등하게 · 자동화 산출물이 자신을 다시 트리거하는지 |
| 결과가 이상하다 | **진단 → 발동 원장**에서 어떤 규칙·스킬이 실제로 걸렸는지 확인 → 지시문을 더 구체적으로 |

세 번째가 중요합니다 — `firing_ledger.rs` 는 이미 "규칙·스킬이 실제로 걸렸는지"
를 결정론적으로 관측하는데, 지금은 배지로만 쓰입니다. Osaurus 의 Insights 처럼
**자동화 디버깅의 정식 경로**로 문서·UI 에 명시합니다 → [02-provenance.md](02-provenance.md) §4.

---

## 3. 테스트

| 대상 | 방식 |
|---|---|
| 빈도 → 다음 시각 | 순수 함수. 8빈도 × 경계(월말·윤년·DST) 테이블 테스트 |
| 놓친 실행 | 시각 주입으로 "3일 꺼져 있었음" → run 이 **정확히 1건** |
| 티어 정착 | 이벤트 스트림 주입 → 마지막 이벤트 + 지연에만 발동, 중간엔 0건 |
| 증폭 루프 | 자동화가 일지를 쓰는 시나리오 → 재발동 0건 |
| 동시성 | 잡 2개 동시 → 1건 실행 + 1건 드롭(사유 기록) |
| Core Model 미설정 | 자동화 전부 스킵, 에러 아님 |
| 파일 SSOT | 정의 파일 삭제 → 상태 행 정리, 재생성 시 복구 |

시각은 전부 주입 가능해야 합니다 (`Date.now()` 직접 호출 금지 — 기존 규율).
비동기 대기 예산은 CI 러너 기준 5s (dab12ce 선례).
