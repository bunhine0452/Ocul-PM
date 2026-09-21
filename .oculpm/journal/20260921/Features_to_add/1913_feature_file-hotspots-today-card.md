---
schema_version: 1
type: feature
slug: "file-hotspots-today-card"
status: done
difficulty: medium
created_at: "2026-09-21T19:13:16+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Sonnet 5 (구현 세션 H)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/hotspot.rs"
    op: create
  - path: "src-tauri/src/commands/hotspot.rs"
    op: create
  - path: "src/features/today/HotspotCard.tsx"
    op: create
  - path: "src/__tests__/today_hotspot_card.test.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_english_screens.test.tsx"
    op: update
related: []
tags:
  - "journal-scale"
  - "hotspot"
  - "today"
  - "mcp-tool"
---
[x] 반복 수정 파일 핫스팟 — 파일별 bug/error 집계 커맨드 + Today 카드

## 추가 기능

플랜 `journal-scale-round` {#hotspot-query} {#hotspot-card}. 병렬 워크트리 세션 H(Sonnet 5) 구현, 감독자 합류. PR #26.

근거: `oculpm_journal_files × oculpm_journal` 조인으로 같은 파일에 bug 일지 5건 이상 붙은 파일이 31개 — 재발·반복 수정 신호가 캐시에 있는데 아무 화면도 안 보여줬다.

- `Db::file_hotspots(project_id, since_workday, limit)` (`db/hotspot.rs`): CTE 로 파일별 bug/error/total 집계 + 최신 일지(ROW_NUMBER) 조인. 필터 **bug+error ≥ 2 이고 bug+error 가 total 의 20% 이상** — lib.rs/package.json/i18n 처럼 모든 일지가 걸어 두는 허브 파일은 total 은 크지만 bug 비율이 낮다는 근거를 코드 주석에. 정렬 bug+error desc → total desc → path.
- `oculpm_file_hotspots(project_id, days, limit)` 는 days → workday 컷오프 변환만 하는 얇은 커맨드.
- `HotspotCard`(Today): 상위 5, 기본 90일(헤더 「최근 90일 N개」), 0건이어도 숨지 않는 빈 상태(`{#card-unhide}` 규율), 행 클릭 → `openEntryPath(last_entry_path)` 로 기존 저널 포커스 핸드오프. 경로는 RTL 트릭으로 꼬리 우선 말줄임.
- 부수: `i18n_english_screens.test` 의 `oculpmApi` 전역 목이 미처리 메서드에 객체를 돌려줘 `rows.map is not a function` 이 났다 → `EMPTY_BY_METHOD` 에 `fileHotspots: []`.

## 검증

Rust 단위 2(랭킹+허브/외톨이 제외, since 창) · vitest 2(빈 상태 unhide, 행 클릭). 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시.