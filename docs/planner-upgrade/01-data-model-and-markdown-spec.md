# 01. 데이터 모델 + 마크다운 SSOT 포맷

> 위상: [`00-master-plan.md`](./00-master-plan.md) §3 의 데이터 흐름을 구체화. 마크다운 = 진실, SQLite = 투영.
> 선행 인프라: `src-tauri/src/oculpm/{frontmatter,atomic_io,paths,index,watcher,redact}.rs` (일지에서 검증됨, 재사용).

---

## 1. 파일 트리

```
.oculpm/
  journal/      ← (기존) 일지, 회고적, append-only
  planner/      ← (신규) Plan SSOT
    fastembed-stabilize.md
    final-ui-1.0.md
    _archive/
      2026-q1-foo.md
  index/
    plans/      ← (신규) 투영 sidecar(선택) — 캐시 재구축 hint
```

`paths.rs` 에 `planner_root(root) = root/.oculpm/planner`, `plan_path(root, slug)` 추가(`WorkdayResolver` 메서드). 일지의 `journal_root`/`journal_dir` 패턴과 동형.

---

## 2. 마크다운 SSOT 포맷 (`<slug>.md`)

### 2.1 Frontmatter

```yaml
---
oculpm_plan: v1
id: fastembed-stabilize          # 파일과 무관한 안정 slug (rename 내성)
title: "fastembed 안정화"
status: active                   # active | done | archived
created: 2026-06-07
updated: 2026-06-07T14:03:00+09:00
owner: claude-code               # 최초 작성 주체(agent_id) — 갱신 귀속은 항목별
---
```

### 2.2 본문 — Phase + Item

```markdown
## Phase A — 캐시 경로 안정화

- [x] fastembed 캐시 절대경로 고정 {#abs-cache} @claude-code·6/7
- [~] 패키징 빌드에서 모델 시드 검증 {#seed-verify} @claude-code·6/7
- [!] 다른 머신 첫 실행 시 465MB 다운로드 UX {#dl-ux}  ⟶ 차단: 진행 UI 부재
- [>] 모델 번들링(앱에 동봉) {#bundle}  ⟶ 이월: 배포 라운드

## Phase B — 검색 품질
- [ ] 심볼/정확 검색 scope 실연동 {#search-scopes}
```

**상태 글리프 ↔ 마크다운 토큰** (파서가 양방향 인식):

| 상태 | 토큰 | 글리프 | 진척 가중 |
|---|---|---|---|
| todo | `[ ]` | ☐ | 0.0 |
| in_progress | `[~]` | ▣ | 0.5 |
| done | `[x]` | ☑ | 1.0 |
| blocked | `[!]` | ⚠ | 0.0 (집계서 제외 옵션) |
| deferred | `[>]` | → | 제외 |
| dropped | `[-]` | ✗ | 제외 |

규칙:
- **`{#id}`** = 항목 안정 식별자. 필수(없으면 파서가 title 해시로 생성하되 ⚠ 경고 — id 안정성 권장).
- **`@agent·날짜`** = 사람이 읽기 위한 *요약* 귀속(편의). **권위 있는 귀속은 §2.4 갱신 로그.**
- `⟶ 사유` = blocked/deferred/dropped 의 한 줄 근거(선택).
- Phase(`##`)는 그룹. 중첩 항목은 들여쓰기 리스트(서브항목).

### 2.3 결정(Decision) — 1급 시민

```markdown
## 결정 (Decisions)

### Decision A — 캐시는 app_data_dir 절대경로 {#d-cache-abs}
- 잠금 2026-06-07 · claude-code
- 패키징 .app 의 CWD=`/` 라 상대 캐시가 깨짐. cache 보다 영속적인 app_data 선택.
- 영향: #abs-cache
```

`### Decision X — 제목 {#id}` 블록. 첫 줄 `- 잠금 <날짜> · <agent_id>`, 이후 근거. `영향:` 줄로 항목 연결.

### 2.4 갱신 로그 — managed block (권위 귀속)

`atomic_io::write_managed_block` 으로 앱·AI 가 안전하게 *append* 하는 영역. 파서가 여기서 `plan_item_update` 를 투영한다.

```markdown
<!-- oculpm:plan-log begin v1 -->
| 시각(ISO) | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-07T14:03:00+09:00 | #abs-cache | claude-code | ~→x | journal/20260607/Bugs/0902_bug_onnx-cache.md | 절대경로 적용 |
| 2026-06-07T14:05:11+09:00 | #seed-verify | claude-code | ☐→~ | | 시드 후 검증 시작 |
<!-- oculpm:plan-log end -->
```

- **append-only.** 항목 현재 상태는 본문 글리프가 SSOT, 로그는 *이력*.
- `에이전트` = `agent_id`(일지와 동일 체계). 사람 편집 = `user`.
- `일지` = 선택. 있으면 Plan↔Journal 상호참조로 투영([`00`](./00-master-plan.md) 불변식 §2-3: 참조만, 소유 금지).
- managed block 밖 사용자 콘텐츠는 보존(일지 AGENTS.md 블록과 동일 정책).

---

## 3. SQLite 투영 스키마 (캐시)

> 신규 migration `016_oculpm_planner.sql` (014·015 는 이미 사용 중). `oculpm_journal`(012) 캐시 패턴 그대로 — 파일이 진실, watcher 가 재투영, 언제든 재구축 가능. PK 는 `(project_id, …)` 복합.

```sql
CREATE TABLE IF NOT EXISTS oculpm_plans (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,           -- frontmatter id (slug)
    title        TEXT    NOT NULL,
    status       TEXT    NOT NULL,           -- active | done | archived
    owner_agent  TEXT    NOT NULL,
    progress     REAL    NOT NULL DEFAULT 0, -- 가중 롤업 (0..1)
    file_path    TEXT    NOT NULL,           -- .oculpm/planner/<slug>.md
    updated_at   TEXT    NOT NULL,
    PRIMARY KEY (project_id, plan_id)
);

CREATE TABLE IF NOT EXISTS oculpm_plan_items (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    item_id      TEXT    NOT NULL,           -- {#id}
    phase        TEXT,                       -- "Phase A — …" (nullable)
    title        TEXT    NOT NULL,
    status       TEXT    NOT NULL,           -- todo|in_progress|done|blocked|deferred|dropped
    order_idx    INTEGER NOT NULL,
    parent_item  TEXT,                       -- 서브항목 중첩
    note         TEXT,                       -- ⟶ 사유
    last_agent   TEXT,                       -- 마지막 갱신 agent_id (로그 파생)
    last_update  TEXT,                       -- 마지막 갱신 시각 (로그 파생)
    PRIMARY KEY (project_id, plan_id, item_id)
);

CREATE TABLE IF NOT EXISTS oculpm_plan_item_updates (   -- append-only 이력
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    item_id      TEXT    NOT NULL,
    ts           TEXT    NOT NULL,
    agent_id     TEXT    NOT NULL,           -- 누가 (일지와 동일 체계, user 포함)
    from_status  TEXT,
    to_status    TEXT,
    journal_ref  TEXT,                       -- 연결 일지 상대경로 (nullable)
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_item_updates
    ON oculpm_plan_item_updates(project_id, plan_id, item_id, ts);

CREATE TABLE IF NOT EXISTS oculpm_plan_decisions (
    project_id   INTEGER NOT NULL,
    plan_id      TEXT    NOT NULL,
    decision_id  TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    locked_at    TEXT,
    agent_id     TEXT,
    affects      TEXT,                       -- 영향 item_id CSV
    PRIMARY KEY (project_id, plan_id, decision_id)
);
```

### 3.1 진척 롤업
`oculpm_plans.progress` = Σ(가중) / count(집계대상). 집계대상 = todo/in_progress/done (blocked/deferred/dropped 제외). 상위 Phase 진척은 UI 에서 파생(테이블 미저장 — 투영 단순화).

### 3.2 투영(파싱) 책임
- `oculpm/planner/parse.rs` (신규): `.md → {Plan, Vec<Item>, Vec<Decision>, Vec<Update>}`.
- watcher 가 `.oculpm/planner/**` 변경 감지 → 해당 plan 재파싱 → 4 테이블 upsert(plan/items/decisions replace, updates append-dedup by (ts,item,agent)).
- 파싱 관용성: 글리프 누락→todo, id 누락→해시+⚠, 깨진 표→스킵+⚠. **침묵 실패 금지** (UI 에 노출).

---

## 4. 기존 `goals`/`subtasks` 와의 관계

- 기존 테이블·커맨드(`goal_*`/`subtask_*`, `planner.rs`)는 **PR-PLN 5 까지 유지**(레거시 PlannerPanel/구 UI 호환).
- 마이그레이션: 프로젝트별 기존 goals/subtasks → 단일 `_imported.md` plan 으로 1회 변환(각 goal=Phase, subtask=item, progress 보존, agent_id=`user`). 사용자 확인 후 실행.
- 변환 후 SSOT 는 .md. 구 테이블은 읽기 폴백으로만(차후 라운드에서 제거 검토).

---

## 5. tauri-specta 커맨드(신규, 최소)

| 커맨드 | 용도 |
|---|---|
| `plan_list(project_id)` | plan 요약 목록 |
| `plan_get(project_id, plan_id)` | plan + items + decisions + 항목별 마지막 귀속 |
| `plan_item_history(project_id, plan_id, item_id)` | 갱신 로그(누가/언제/변화/일지) |
| `plan_apply_edit(project_id, plan_id, op)` | 사람/인앱-AI 의 편집 → .md managed-block 갱신(atomic_io) + 글리프 set, agent_id 스탬프 |
| `plan_create(project_id, title)` | 빈 plan .md 생성 |

> `plan_apply_edit` 는 *유일한 쓰기 경로*(앱/인앱AI). 외부 에이전트는 파일 직접 편집(AGENTS.md). 둘 다 watcher 가 흡수. ([`02`](./02-agents-protocol-and-attribution.md))

## 2.x 중첩과 롤업 (3-depth, 2026-07-31 — #plan-3depth)

항목은 **최대 1단계** 중첩된다: 최상위 `- [ ] 부모 {#id}` 아래 **두 칸 들여쓴**
`  - [ ] 하위 {#id}`. 탭 들여쓰기도 중첩으로 인정하고, 더 깊은 들여쓰기(4칸+)는
같은 최상위 항목으로 평탄화된다 (손자 없음). `##`/`###` 헤딩은 항목 흐름을 끊는다
— 헤딩 다음의 들여쓴 항목은 이전 항목에 붙지 않는다.

**롤업이 부모의 정답이다** (`parse.rs::rollup_status`): dropped 는 모수에서 제외
(전부 dropped → dropped) · 하나라도 blocked → blocked · 전부 done/todo/deferred →
그 값 · 그 외 혼합 → in_progress. 파서는 하위를 가진 항목의 상태를 파일 글리프와
무관하게 롤업으로 **파생**시키고, 쓰기 경로(`plan_edit::set_item_status_rolled`)는
하위 변경 시 부모 글리프를 롤업으로 함께 정규화한다 (글리프-파생값 일치 유지;
이 정규화는 plan-log 행을 남기지 않는다 — 하위의 행이 원인 기록이다). 부모를
직접 갱신하는 시도는 거부된다 (phase 와 동일: 설정할 수 있는 상태가 아니다).

**집계는 리프 기준**: `progress()`·요약 done/total·phase 진척·MCP `plan_status`
전부 부모를 제외하고 센다 (부모까지 세면 하위가 이중 가중). MCP TSV 는 `parent`
열(6번째)로 하위→부모 관계를 나른다. 최상위 부모를 `remove_item` 으로 지우면
그 하위들은 최상위로 승격된다 (직전 항목으로의 위치상 입양 방지).
