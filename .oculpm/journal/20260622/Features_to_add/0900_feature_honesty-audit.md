---
schema_version: 1
type: feature
slug: honesty-audit
status: done
difficulty: low
created_at: "2026-06-22T09:00:00+09:00"
session_id: "20260622-m06"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/today/HonestyAudit.tsx
    op: create
  - path: src/features/today/TodayScreenV2.tsx
    op: update
related: []
tags: ["feature", "honesty-audit", "trust", "oculpm", "dev-report-followup", "F2"]
---

[x] 정직성 감사 — 에이전트가 빠뜨린 변경 탐지 (F2)

## 추가 기능

제품의 신뢰 전제("일지가 실제 변경을 반영")를 아무것도 검증하지 않아, 에이전트가 12파일 바꾸고 3개만 기록해도 알 수 없었다. **이미 완성됐으나 호출처가 0이던 `oculpm_compare_layers`**(watcher ground-truth `file_changes.ndjson` vs 세션 일지 `files_touched` 합집합)를 Today 화면에 재활성화해, `only_in_index`(바뀌었으나 미기록) 파일을 severity 와 함께 노출한다.

## 동작 흐름

- 신규 `HonestyAudit` 컴포넌트: 그날 세션(`listSessions(workday)`)별로 `compareLayers(sessionId)` 호출 → `only_in_index.length > 0` 인 세션만 카드로 렌더(세션·심각도·누락 파일 목록, 12개 초과 시 접기).
- **문제 있을 때만 렌더**(깨끗한 날엔 노이즈 0). read-only.
- `TodayScreenV2` 의 PlanUpdates 아래에 마운트(projectId·workday·oculpmReady 전달).

## 검증

- 백엔드 무변경(`compare_layers` 기존). 프런트 typecheck/test/lint/build 전부 exit 0(125 통과).

## 메모

- MVP는 **표시**까지. 보고서의 "이 변경 일지에 추가" 원클릭(ManualEntryModalV2 프리필 + entry_diffs sidecar→LLM narrative 초안)은 후속. 핵심 가치(격차 가시화)는 단독 제공.
- 백필 git 세션(`{workday}-git`)은 watcher 세션이 아니라 `listSessions` 에 안 잡혀 오탐 없음.
