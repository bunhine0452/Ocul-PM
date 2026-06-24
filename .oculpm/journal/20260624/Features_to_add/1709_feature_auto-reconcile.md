---
schema_version: 1
type: feature
slug: auto-reconcile
status: done
difficulty: superhigh
created_at: "2026-06-24T17:09:30+09:00"
session_id: "20260624-m03"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/reconcile.rs
    op: create
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/oculpm/session.rs
    op: update
  - path: src-tauri/src/oculpm/agents/mod.rs
    op: update
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ref: 20260622/Refactors/1000_refactor_planner-unify.md
    kind: followup
tags: ["feature", "auto-reconcile", "planner", "watcher", "dev-report-followup", "F1"]
---

[x] 자동 일지→플래너 화해 (on-journal-write reconciliation, F1)

## 추가 기능

간판 약속("에이전트가 일지를 쓰면 플랜도 스스로 갱신")이 미실현이었다 — 플랜은 수동 "AI 갱신"이나 외부 수기 편집으로만 바뀌었다. 이제 `agents.auto_reconcile`(옵인, 기본 off)을 켜면, 워처가 **새 작업 일지**를 인덱싱한 직후 **단일 활성 플랜**을 그 일지에 비추어 백그라운드 LLM 으로 갱신한다. planner-unify(S1) 로 소비처가 단일 파일 플랜으로 정리된 뒤라 화해 대상이 명확하다.

## 동작 흐름

- **트리거**: watcher 의 신규-일지 분기(`apply_journal_cache_invalidation` 의 `inserted`)에서 `spawn_reconcile`. fire-and-forget tokio 태스크(느린 LLM 이 워처 루프를 막지 않음). **루프 안전**: journal insert 에서만 발동하고 plan `.md` 만 쓰므로(journal 이벤트 아님) 재발동 없음.
- **reconcile(`reconcile.rs`)**: ① 일지 먼저 로드→`-git` 백필 세션이면 즉시 스킵(과금 폭발 방지) ② 설정에서 provider/model + 키체인 키 해석(없으면 스킵) ③ 활성 플랜이 **정확히 1개**일 때만 진행(0·2+ 스킵) ④ 그 일지(타입/상태/파일/본문 발췌) 1건을 `planner/ai.rs` 프롬프트에 넣어 LLM 에 "어떤 item 을 어디로?" ⑤ 유효·변경되는 status flip 만 plan-log 경로로 적용(`agent_id="auto:<provider>"`, **이제껏 항상 None 이던 `journal_ref` 채움**, note="자동 화해").
- **UI**: 설정(OculpmSettings)에 "자동 화해" 토글 + 과금·프라이버시 경고 문구.

## 검증 (적대적 리뷰 반영)

- 단독 적대리뷰(10 영역) — 루프안전·과금경로·provider해석·단일플랜·enum_str·잠금플랜·apply루프 전부 통과. should-fix 3건 반영:
  1. **버스트 과금**: 워처가 insert 마다 태스크 spawn → 동일 플랜에 N 회 호출 + 무한 큐. `reconcile_lock.try_lock_owned()` 로 **동시 1건**만, 겹치면 드롭(베스트에포트, 수동 AI갱신이 보완).
  2. **쓰기 레이스**: 백그라운드 쓰기가 사용자 편집을 덮음. write 직전 **CAS**(디스크 재독→해시 비교, 바뀌었으면 양보). 사람 편집 우선.
  3. **취약한 가드**: `-git` 문자열을 `GIT_BACKFILL_SESSION_SUFFIX` 상수+`is_git_backfill_session` 술어로 중앙화(manager 백필과 공유), 단위테스트 추가.
- 백엔드 284 테스트(reconcile 단위 5)·프런트 typecheck/test/lint/build 전부 exit 0. config 필드 추가로 bindings 재생성(AgentsConfig.auto_reconcile).

## 메모

- 한계(후속): (a) 동시 1건 정책상 버스트 중 일부 일지는 화해 누락 가능 — 수동 "AI 갱신"이 25건 윈도우로 보완. (b) 전 플랜-라이터(plan_apply_edit/plan_ai_refresh) 공유 락은 미구현(N4) — reconcile 측 CAS 로 사람 편집 보호만. (c) 화해 완료 시 라이브 토스트/이벤트 없음 — 다음 Planner 진입 시 `auto:<provider>` 귀속+journal_ref 로 확인. (d) 단일 활성 플랜만(설계대로).
- `#auto-reconcile` 완료. surgical-context-cleanup(표면0)과 묶어 v1.17.0 릴리스.
