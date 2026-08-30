---
schema_version: 1
type: bug
slug: reconcile-error-was-silent
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src-tauri/src/oculpm/reconcile.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
related: []
tags: [reconcile, planner, observability, audit-round]
---

[x] 자동 화해의 LLM·쓰기 오류가 로그 한 줄 없이 사라져, 키가 만료되면 영원히 조용한 no-op 이었다

## 발생 원인

`reconcile.rs` 의 플랜 루프가 LLM 호출 실패를 `Err(_) => continue` 로 삼켰고, 플랜 쓰기 실패도 `.is_err() { continue }` 였다. 뒤이어 워처는 `Ran(results)` 를 받아 "auto-reconcile finished" 를 info 로 남기므로 성공처럼 보였다. API 키 만료·쿼터 소진이면 옵인한 자동 화해가 아무 신호 없이 멈춘 채로 있었다.

## 해결 방법

`PlanReconcileResult` 에 `error: Option<String>` 을 더하고, 두 실패 지점에서 `warn!`(plan_id · error) + 결과에 오류를 실어 보낸다. 워처는 결과를 돌며 오류가 있는 플랜마다 `OculpmIntegrityWarning`(kind=`reconcile`, 메시지 "자동 화해 실패 (plan): …") 을 한 번 emit — 프런트의 무결성 경고 토스트 경로를 그대로 탄다.

## 검증

`cargo test` 그린(reconcile 파서 테스트 포함). 실기기: 키를 무효화한 뒤 일지를 하나 쓰면 토스트가 떠야 한다 — 앱 꺼진 뒤 몰아서.
