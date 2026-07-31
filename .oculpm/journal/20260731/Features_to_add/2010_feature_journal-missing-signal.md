---
schema_version: 1
type: feature
slug: journal-missing-signal
status: done
created_at: 2026-07-31T20:10:00+09:00
session_id: "manual-20260731-201000"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: plugin/oculpm/hooks/session-marker.sh, op: create }
  - { path: plugin/oculpm/hooks/session-end.sh, op: create }
  - { path: plugin/oculpm/hooks/hooks.json, op: update }
  - { path: src-tauri/tests/plugin_manifest.rs, op: update }
  - { path: docs/claude-integration/06-plugin-contract.md, op: update }
  - { path: plugin/oculpm/README.md, op: update }
related: [.oculpm/journal/20260731/Chores/1935_chore_agentic-ab-benchmark.md]
tags: [hooks, journal-missing, benchmark-driven, ponytail]
difficulty: medium
---

[x] 미기록 세션 신호 (H3) — 벤치 실측(헤드리스 준수 0/12)이 근거

## 추가 기능

세션이 일지 없이 끝나는 것을 훅이 감지해 신호로 남긴다:

- **session-marker.sh** (SessionStart 3번째 훅): 세션별 마커 파일 생성 — **create-only** (auto-compact/resume 재발화가 재터치하면 기록한 세션에 오탐이 나는 것을 차단, 리뷰 HIGH). 같은 초 일지 대비 2초 백데이트.
- **session-end.sh** (SessionEnd 인라인 대체): 이벤트 인박스 append 유지 + 마커 이후 `.oculpm/journal/` 에 새 일지가 없으면 → stderr 경고("일지 없이 끝났습니다…") + `.oculpm/hooks/journal-missing.jsonl` 신호 1줄(200줄 상한 자체 트림). 일지가 있으면 기존 안내 유지. 크래시 잔여 마커 청소는 판정 뒤로 이동(живое 세션 경합 축소).
- 알려진 한계 문서화: 동시 세션의 일지가 미작성을 가리는 미탐(보수적 방향), 세션 귀속 판정은 후속 H3b(앱 소비자)로.

## 동작 흐름

세션 시작→마커 / 세션 종료→판정 → 미작성이면 사용자에게 즉시 경고 + 앱이 나중에 소비할 신호. 근거: benchmarks/agentic 실측 — 규칙·도구 주입만으로는 헤드리스 단발 세션이 기록하지 않음(0/12).

## 검증

스모크 3경로(미작성→경고+신호 / 작성→일반 안내·신호 불변 / compact 재발화→오탐 없음) 통과, `cargo test --test plugin_manifest` 7/7 (create-only·상한·청소 위치 회귀 잠금). 적대 리뷰 5건 — HIGH(compact 오탐)·LOW 3건 수정, MED(동시 세션 미탐)는 보수적 한계로 수용·명시.
