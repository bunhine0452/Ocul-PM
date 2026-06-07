# 04. 구현 체크리스트 — PR-PLN DoD · 결정 로그 · 진행 상태

> 본 문서의 위상: Planner Upgrade 라운드의 *진행 추적표*. 각 PR-PLN 머지 시 해당 행이 ✅ 로 갱신된다.
> [`../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md`](../Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md) 와 같은 형식.
> 메타: 이 라운드가 끝나면 *이 문서 자체가 Planner 의 첫 plan* 으로 흡수될 수 있다(self-hosting) — `05-…` 가 UI 라운드를 추적했듯.

---

## 0. 시작 전 잠금 항목 (확정 — 2026-06-07)

> 상태: 핵심 결정은 [`00-master-plan.md`](./00-master-plan.md) §5 가 보유. 본 §0 은 *구현 측 정책* 잠금만.

### 0.1 작성 모델
- [x] **파일 기반 `.md` SSOT + watcher 투영** (사용자 결정 2026-06-07). SQLite+AI커맨드 안은 reversal.
- [x] SSOT = `.oculpm/planner/<slug>.md`. SQLite `plan_*` 는 재구축 가능한 캐시.
- [x] 쓰기 경로 3개(외부 에이전트 파일편집 / 인앱AI `plan_apply_edit` / 사람 `plan_apply_edit`) 모두 watcher 흡수.

### 0.2 일지 불변식(겹침 금지)
- [x] Plan = 제자리 갱신·현재상태 1개 / 일지 = append-only 불변 ([`00`](./00-master-plan.md) §2).
- [x] Plan→일지 *참조만*. 자동 진척은 *제안*, 침묵 덮어쓰기 금지.

### 0.3 귀속
- [x] 항목별·갱신별 로그(`oculpm_plan_item_updates`). plan-level 마지막편집자 아님.
- [x] `agent_id` 공간 = 일지와 단일화 + `inapp:*` / `user`. 색은 `agentColor.ts` 재사용.

### 0.4 백엔드 재사용(신규 표면 최소)
- [x] frontmatter/atomic_io/paths/watcher/redact/lock = 일지 인프라 재사용.
- [x] agents drift(013) 파이프라인 = Planner 절이 같은 managed block 이라 자동 커버(추가 동기화 0).

### 0.5 §0 결정 요약 (한 화면)

| 결정 | 잠금 값 |
|---|---|
| 작성 모델 | 파일 .md SSOT + watcher |
| SSOT 경로 | `.oculpm/planner/<slug>.md` |
| 상태 어휘 | ☐todo ▣in_progress ☑done ⚠blocked →deferred ✗dropped |
| 항목 id | 안정 `{#slug}`, 누락 시 해시+⚠ |
| 귀속 입자 | 항목별·갱신별 로그 |
| 귀속 정체성 | 일지 agent_id ∪ inapp:* ∪ user, AgentBreakdown 색 |
| 결정 | 1급 — 인라인 잠금 + plan_decision 캐시 |
| 일지 연동 | 참조만 + 진척 제안(클릭 확정) |
| 마이그레이션 | goals/subtasks → `_imported.md` 1회, 보존 |
| 동시성 | `.oculpm/.lock` + atomic_io |

위 잠금 → **PR-PLN 0** 진입 가능.

---

## 1. Phase A — Backend Foundation

### PR-PLN 0 — 스키마 + 파일트리 + 파서 + watcher

| 체크 | 항목 |
|---|---|
| ✅ | `migrations/016_oculpm_planner.sql` — plan/plan_items/plan_item_updates/plan_decisions ([`01`](./01-data-model-and-markdown-spec.md) §3) (014·015 선점) |
| ✅ | `oculpm/paths.rs` — `planner_root`/`plan_path` + 테스트 |
| ✅ | `oculpm/planner/parse.rs` — `.md → {Plan,Items,Decisions,Updates}` (글리프/id/managed-log/decision 파싱, 관용 폴백+⚠) |
| ✅ | `oculpm/planner/project.rs` — `PlanCache` 투영(`oculpm_plan*` 4테이블 재구축) + DTO + on-read reproject. round-trip 테스트 |
| ✅ | tauri-specta 커맨드: `plan_list`/`plan_get`/`plan_item_history` (commands/plan.rs) + lib.rs 등록 + bindings.ts 재생성 |
| ◐ | watcher — `.oculpm/planner/**` 단락 처리(코드변경 ndjson 오염 방지). 재투영은 커맨드 on-read. **라이브-push 이벤트는 PR-PLN 3 이월** |
| ⬜→PR-PLN 1 | `oculpm/redact.rs` 적용(시크릿 마스킹) — 쓰기 경로(plan_apply_edit)와 함께 PR-PLN 1 에서 |
| ✅ | `cargo test` green — parse 10건 + 투영 round-trip(list/get/history, SQLite 재조회) 1건. 전체 lib 239 pass. 프론트 typecheck/test/lint green |

### PR-PLN 1 — 마크다운 SSOT 쓰기 경로 + 갱신 로그

| 체크 | 항목 |
|---|---|
| ✅ | `oculpm/planner/plan_edit.rs` — 순수 마크다운 편집: create_plan_skeleton / set_item_status(글리프 교체) / add_item(phase 생성) / append_log_row(plan-log managed block). 형식 보존, write→parse 무손실 |
| ✅ | `plan_create(project_id, title)` — slug 생성(중복 -N) + 골격 .md + write_atomic |
| ✅ | `plan_apply_edit(project_id, plan_id, op, agent_id?)` — PlanEditOp(SetStatus/AddItem) → 본문 갱신 + plan-log append, agent_id 스탬프(기본 user, inapp:* 지원). bindings: planCreate/planApplyEdit |
| ◐ | 원자성=`atomic_io::write_atomic`(temp+rename). `.oculpm/.lock` 은 manager 가 프로세스 단위로 이미 보유 → 재획득 안 함. **프로세스 내 동시편집은 last-write-wins**(단일 사용자 가정; 필요시 tokio mutex 후속) |
| ✅ | `oculpm/redact.rs` 적용 — 투영 읽기 측에서 config `auto_redact_patterns` 로 시크릿 마스킹(PR-PLN 0 이월분 해소) |
| ✅ | round-trip 테스트: 6건(skeleton/full write/missing/dup/new-phase/콘텐츠 보존) + 전체 lib 245 pass + 프론트 typecheck/test/lint green |

---

## 2. Phase B — Agent Protocol

### PR-PLN 2 — AGENTS.md Planner 규칙 + 템플릿 5종 + 귀속

| 체크 | 항목 |
|---|---|
| ✅ | `master_ko.md.tpl` §7 "Planner 갱신" — 절차(파일 열기→글리프 교체→plan-log 한 줄 append)·글리프 표·로그 6열·결정 잠금·복붙 금지 불변식 ([`02`](./02-agents-protocol-and-attribution.md) §1.1) |
| ✅ | claude_code/gemini/cursor/antigravity 템플릿 delta — 일지 직후 Planner 갱신 안내 + agent.id 명시 (claude-code/gemini-cli/cursor/antigravity). 전부 AGENTS.md(=master) 상속 |
| ✅ | AGENTS.md 재생성: master §7 가 같은 managed block 안 → 기존 drift 파이프라인 자동 커버(추가 동기화 0). 가드 테스트 `master_template_carries_planner_rules` + cargo test 246 pass |
| ◐ | agent_id 값은 일지와 동일 체계(claude-code/cursor/antigravity/gemini-cli) 일치 확인. **라벨/색(agentColor.ts) 재사용은 UI 측 → PR-PLN 3** |
| ⬜ dogfood | 외부 LLM 수기 시나리오(실제 Claude Code 가 항목 [~]→[x] + 로그 append) — 런타임 검증(앱 실행 후). 단위 테스트 불가 |

---

## 3. Phase C — UI

### PR-PLN 3 — PlannerScreenV2 재설계

| 체크 | 항목 |
|---|---|
| ⬜ | `PlanHeader`/`PhaseSection`/`PlanItemRow`/`AttributionChip`/`ItemHistoryPopover`/`DecisionCard`/`PlanStatusTable` 신규(ui_v2 토큰) ([`03`](./03-ui-screen-spec.md) §3) |
| ⬜ | `plan_list`/`plan_get` 실연동 + 진척 가중 롤업 + phase 파생 |
| ⬜ | AttributionChip = `agentColor.ts` 재사용(일지와 색 일관) |
| ⬜ | Icons.tsx 에 CircleDot/Ban/ArrowRightToLine 추가(자체 SVG 0) |
| ⬜ | watcher 라이브 반영(외부 편집 → 화면 즉시 갱신) |
| ⬜ | 레거시 `PlannerPanel`/`GoalCard` **0 diff** + flag-off 안전 |
| ⬜ | `planner_v2.test.tsx` — 글리프/롤업/귀속/빈상태/axe 0(light+dark) |

---

## 4. Phase D — Linkage & AI authoring

### PR-PLN 4 — 일지 ↔ Plan 상호참조 + 진척 제안

| 체크 | 항목 |
|---|---|
| ⬜ | plan-log 의 `journal_ref` → 항목↔entry 양방향 투영 |
| ⬜ | 항목 📓 클릭 → 연결 일지 focus(기존 핸드오프 재사용) |
| ⬜ | 진척 *제안* 배지(연관 일지 N건 → "완료?") — 클릭 확정만, 침묵 덮어쓰기 0 |
| ⬜ | `plan_item_history` 타임라인 UI |

### PR-PLN 5 — 인앱 AI "계획 갱신" + 마이그레이션

| 체크 | 항목 |
|---|---|
| ⬜ | "AI에게 갱신 요청" — 인앱 LLM(anthropic/openai/gemini/nim)이 plan 컨텍스트+최근 일지로 `plan_apply_edit` 수행, agent_id=`inapp:<provider>` |
| ⬜ | 기존 goals/subtasks → `_imported.md` 1회 변환(progress 보존, agent_id=user), 사용자 확인 |
| ⬜ | 구 `goal_*`/`subtask_*` 커맨드 읽기 폴백 유지(차후 제거 검토) |
| ⬜ | typecheck/test/lint/build green ([[commit-gate-discipline]]) |

---

## 5. 운영 — 진행 중 새 결정의 흐름

1. PR 안에서 본 §0 에 *새 항목 추가*.
2. 영향 문서(§00~§03) *동일 PR* 동기화.
3. §0.5 결정 요약 + §7 상태표 갱신.

이 3단이 한 PR 내에 끝나지 않으면 결정은 *잠금 안 됨*.

---

## 6. 비상 — 회귀 시

| 단계 | 처리 |
|---|---|
| PR-PLN 0~2(백엔드/프로토콜) 회귀 | plan_* 캐시는 재구축 가능, .md SSOT 무손실. 마이그레이션 전이라 사용자 영향 0 |
| PR-PLN 3~4(UI) 회귀 | ui_v2 Planner 만 영향, 레거시 PlannerPanel 0 diff(롤백 경로) |
| PR-PLN 5(마이그레이션) 회귀 | `_imported.md` 는 생성형(구 테이블 비파괴) — 역변환 불필요, .md 삭제로 원복 |

---

## 7. 진행 상태 (2026-06-07 작성 시점)

| PR-PLN | 상태 | 머지 해시 |
|---|---|---|
| 0 — 스키마/파서/watcher | ✅ done (스키마·paths·파서·투영·커맨드·바인딩. redact·라이브push 만 이월) | — |
| 1 — .md 쓰기 + 갱신로그 | ✅ done (plan_edit + plan_create/plan_apply_edit + redact. 락은 manager 프로세스락+write_atomic) | — |
| 2 — AGENTS.md + 템플릿 | ✅ done (master §7 + 5종 템플릿 + 가드 테스트. dogfood 런타임 검증 대기) | — |
| 3 — PlannerScreenV2 | ⬜ 설계 | — |
| 4 — 일지 상호참조 + 제안 | ⬜ 설계 | — |
| 5 — 인앱 AI + 마이그레이션 | ⬜ 설계 | — |

각 PR 머지 시 본 표 (`⬜` → `✅`) + 해시 갱신. (참고: `rev-parse` 로 확인, 추측 금지 — [[commit-gate-discipline]].)
