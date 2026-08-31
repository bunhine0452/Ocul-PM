---
schema_version: 1
type: feature
slug: automation-foundation-phase0
status: done
created_at: 2026-08-31T18:53:00+09:00
session_id: manual-20260831-185300
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
difficulty: high
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/session_id.rs
    op: update
  - path: src-tauri/migrations/033_automation.sql
    op: create
  - path: src-tauri/src/db/automation.rs
    op: create
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/oculpm/automation/mod.rs
    op: create
  - path: src-tauri/src/oculpm/automation/store.rs
    op: create
  - path: src-tauri/src/oculpm/automation/core_model.rs
    op: create
  - path: src-tauri/src/oculpm/automation/runner.rs
    op: create
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/journal_draft.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/commands/config.rs
    op: update
  - path: src-tauri/src/commands/llm.rs
    op: update
  - path: src/lib/settings.ts
    op: update
  - path: src/features/settings/tabs/LlmTab.tsx
    op: update
  - path: src/features/today/CoreModelSeededCard.tsx
    op: create
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/__tests__/core_model_slot.test.tsx
    op: create
related:
  - .oculpm/journal/20260831/Chores/1808_chore_osaurus-bench-design-and-plan.md
  - .oculpm/journal/20260831/Chores/1823_chore_osaurus-bench-design-review.md
tags: [automation, osaurus-bench, phase0, core-model]
---

[x] Osaurus 라운드 Phase 0 — 자동화의 토대 (Core Model · 발동 출처 · 잡 러너 · 파일 SSOT)

## 추가 기능

이 저장소에는 자동화 축이 하나도 없었다. 있는 건 배경 작업 둘뿐이고
(`auto_reconcile` · `auto_journal_draft`) 각자 트리거·락·모델 선택·귀속 규약을
따로 들고 있었다. 그래서 "자동 일지" 가 락 공유 미설계를 이유로 오래 보류돼
있었다. Phase 0 은 그 셋을 하나로 모아 Phase 1(Schedules)·2(Watchers)가 얹힐
자리를 만든다. 7항목 전부 구현했다.

**Core Model 슬롯** (`core_provider`/`core_model`). 배경 작업은 이제 대화용
`default_*` 를 읽지 않는다 — 자주, 조용히, 과금되는 작업이 대화 모델을 그대로
쓰면 사용자가 대화 모델을 비싼 것으로 바꿀 때 배경 비용이 말없이 따라 오른다.
설정 → LLM 에 「배경 작업 모델」 섹션을 넣었고, 폴백 체인은 배경 작업에도 그대로
적용된다(체인 없이 한 번 실패하고 끝나면 조용한 소실이 된다).

**기존 두 작업 이관 + 1회 시드.** `reconcile.rs`·`journal_draft.rs` 를 `core_*`
로 옮기되, 이미 자동화를 켜 둔 사용자에게 **강제만 하면 잘 되던 기능이 말없이
멈춘다.** 프로젝트를 열 때 자동화가 켜져 있고 슬롯이 비었으면 대화 모델을 1회
복사한다 (`oculpm_init` step 2.8, 동작 변화 0). 조용한 시드도 조용한 정지만큼
정직하지 않으므로 Today 에 안내 카드 1회 — 값이 어디로 갔고 왜 더 싼 모델로
바꿀 만한지 말한다.

**발동 출처.** `SessionKind::Schedule`/`Automation` + `sched-`/`auto-` 접두를
`manual-`/`mcp-` 와 **같은 모양**으로 추가했다 (Decision 8). 접미형
`<workday>-sNN` 을 쓰면 `kind()` 가 tail 을 숫자로 못 읽어 `Unknown` 이 되는데
`workday()` 는 관용적으로 통과시킨다 — **색인은 되는데 분류만 조용히 죽는다.**
그 사실 자체를 회귀 테스트로 못박았다.

**잡 러너**(`automation/runner.rs`) · **파일 저장소**(`automation/store.rs`) ·
**033_automation.sql** · **`AutomationConfig`**.

## 동작 흐름

```
run(Job) → 동시 1건 try_lock  → 밀린 건 큐가 아니라 드롭 + 사유를 원장에
         → Core Model 해석    → 미설정이면 조용히 스킵 (오류 아님)
         → 일일 예산 확인      → 0 이면 전면 정지, 소진이면 스킵 + 사유
         → LLM (failover)     → 실패해도 "돌았다" 는 run 레코드로 남는다
         → redact 이중 방어
         → 산출물 (일지 / 없음 / 플랜은 Phase 2)
         → AutomationRun 마감 + automation_state 도장
```

큐가 아니라 드롭인 이유: 자동화는 전부 과금되는 호출이고, 쓰기 폭주 중에 큐를
쌓으면 폭주를 **지연**시킬 뿐이다 (auto-reconcile N4 선례). 대신 왜 버렸는지를
남긴다 — 안 돈 이유를 모르는 것이 자동화 디버깅에서 가장 나쁜 상태다.

락은 새로 만들지 않았다. 기존 `plan_write_lock` 공유락을 **쓰기 구간에서만**
잡는다 (LLM 왕복 동안 사용자 편집을 막지 않는다).

정의는 온디스크가 SSOT다 (D1). `.oculpm/automation/{schedules,watchers}/<id>.md`
= frontmatter + 지시문 본문, SQLite 는 런타임 상태만. id 는 파일 stem 이 정본이고
kebab 정규화를 통과한 값으로만 경로를 조립한다(`../../escape` 가 여기서 죽는다).
쓰기는 멱등 — 같은 바이트면 디스크를 안 건드린다(mtime 만 바꿔 워처를 깨우는
`config.rs` 선례). 정의가 사라지면 상태·이력 행도 지운다(`oculpm_init` step 2.9);
디렉터리를 **못 읽으면 건너뛴다** — 빈 목록으로 오해해 전부 지우면 안 된다.

`[automation]` 은 `#[serde(default)]` 라 기존 `config.toml` 이 전부 off 로
파싱되고 `schema_version` 은 그대로다 (D4). 파생 `Default` 를 쓰지 않고 필드별
serde 기본값과 손으로 맞췄다 — 파생을 썼으면 섹션이 빠진 config 의 예산이 0 이
돼 조용히 전면 정지된다.

## 검증

- `pnpm typecheck` · `pnpm test`(125파일 1510) · `pnpm lint`(storage·i18n·bindings)
  · `pnpm build` · `cargo test` · `cargo clippy --all-targets -- -D warnings` ·
  `cargo fmt --check` 전부 exit 0 을 직접 확인.
- 설계 문서 §3 의 Phase 0 테스트 3종을 작성: **동시성**(`tokio::join!` 로 두 잡
  → 정확히 1건 실행 + 1건 드롭, 모델 호출 1회, 드롭 사유가 원장에) ·
  **Core Model 미설정 스킵**(모델 호출 0회 = 과금 없음, 스킵 사유가 원장에) ·
  **파일 SSOT 삭제/복구**(정의 삭제 → 목록에서 사라짐 → 재작성 시 동일 복구,
  고아 상태·이력 정리).
- 그 밖에: D8 접미형 회귀, 경로 탈출 차단, 멱등 쓰기, 과대 정의 거부,
  예산이 과금된 실행만 센다, 모델 실패 시 run 이 닫힌다, `automation_defaults_agree`.
- 프런트: `coreModelTarget` 이 백엔드 `resolve` 와 같은 판정(미설정→null,
  대화 모델로 대체 없음) + 시드 카드 1회 표시·닫기.
- 시각은 전부 주입 가능 — 러너 안에서 시계를 읽지 않는다(`Job::now`/`workday`).

## 메모

**플랜 산출물은 의도적으로 미연결이다.** `AutomationOutput::Plan` 은 러너에서
스킵 + 사유(`Phase 2 #reconcile-absorb`)로 끝난다 — 여기서 만들면 `reconcile.rs`
를 두 벌 들고 있게 되고, 플랜 편집 경로 흡수는 Phase 2 의 명시된 항목이다.
조용히 성공한 척하지 않도록 `oculpm-defer:` 마커와 테스트로 못박았다.

키체인 접근은 `ChatBackend::has_credentials` 로 옮겼다 — 러너가 직접
`secrets::get` 을 부르면 테스트가 OS 키체인을 두드린다.

Phase 0 은 릴리스하지 않는다 — Phase 1 과 묶어 v2.26.0.
