---
schema_version: 1
type: feature
slug: statusline-badge
status: done
created_at: 2026-07-31T21:10:00+09:00
session_id: "manual-20260731-211000"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: plugin/oculpm/hooks/oculpm-statusline.sh, op: create }
  - { path: plugin/oculpm/hooks/session-end.sh, op: update }
  - { path: src-tauri/src/commands/plan.rs, op: update }
  - { path: src-tauri/src/commands/retro.rs, op: update }
  - { path: src-tauri/tests/plugin_manifest.rs, op: update }
  - { path: plugin/oculpm/README.md, op: update }
  - { path: docs/claude-integration/06-plugin-contract.md, op: update }
related: []
tags: [statusline, dispatch, ponytail, plugin]
difficulty: medium
---

[x] statusline 배지 (B1) — 디스패치된 플랜 항목을 터미널 상태줄에

## 추가 기능

- **write_dispatch_flag**: 플래너 ▶실행·회고 디스패치가 `.oculpm/index/dispatch/current.json` 에 현재 항목(title·plan_rel·item_id·ts·ttl)을 기록. 제목의 따옴표·역슬래시는 쓰기 측에서 순화(sed 파서 계약 앱 보장), 회고 배지는 ttl 2h(완료 재확인 불가 대비).
- **oculpm-statusline.sh**: `/statusline` 으로 옵인 — 플래그가 신선하고 항목이 미완 글리프면 `⏵ OCULPM: <항목>`, 아니면 모델·폴더 기본 상태줄. 문자 단위 절단(perl -CS), item_id 는 고정 문자열 매치(regex 메타문자 안전), 저비용(grep ≤2).
- **1회성 넛지**: 디스패치 사용 프로젝트에서 statusLine 미설정(전역+프로젝트 3파일 검사)일 때 SessionEnd 가 딱 한 번 안내.
- current.json 키 스냅샷 테스트(크로스-언어 계약) + 매니페스트 계약 확장.

## 동작 흐름

▶실행 → 플래그 기록 → 상태줄에 항목 표시 → 항목 done 글리프/ttl 경과 시 자동 소등. 플래너 레일의 터미널 거울.

## 검증

3상태 스모크(미완 표시/완료 소등/플래그 없음) + 한글 장제목 절단 + regex 메타 id. 적대 리뷰 반영: 제목 따옴표 파손(쓰기 살균)·id 메타문자(-F 매치)·회고 24h 점유(ttl)·넛지 스코프. plugin_manifest 7/7, dispatch_flag 테스트 그린.
