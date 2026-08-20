---
schema_version: 1
type: bug
slug: "today-line-churn-always-zero"
status: done
difficulty: medium
created_at: "2026-08-20T22:02:00+09:00"
session_id: "manual-20260820-220200"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/migrations/028_journal_file_lines.sql"
    op: create
  - path: "src-tauri/src/db.rs"
    op: update
  - path: "src-tauri/src/oculpm/entry_diffs.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/today/TodayActivityRing.tsx"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/__tests__/today_ring.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: ".oculpm/planner/three-features-round.md"
    op: correct
related: []
tags: ["today", "oculpm", "entry-diffs", "svg", "claude-code"]
---

[x] Today 링의 「라인 변화」가 늘 0 — 채우는 경로가 없었고, 0 은 점으로 그려졌다

## 발생 원인

증상은 두 개가 겹쳐 있었다. 사용자는 링 안쪽에 떠 있는 점 하나를 보고 "업데이트하면 생기는 것 같다"고 의심했지만, 업데이트와는 무관했다.

**(1) 데이터 — 「라인 변화」를 채우는 쓰기 경로가 없다.** 값의 출처는 프론트매터 `files_touched[].bytes_added/bytes_removed` 뿐이었다 (`frontmatter.rs`가 읽고 `cache.rs`가 캐시할 뿐, 계산하는 코드는 백엔드에 없었다). 즉 에이전트가 손으로 적어야만 값이 생기는데 `AGENTS.md`는 그 필드를 요구한 적이 없다. 2026-07-20 `884a7a9`(oculpm-mcp 서버)로 일지 작성이 `journal_write` 도구 경로로 옮겨간 뒤로는 `bytes_added: None` 이 하드코딩되어 있어 구조적으로 0 이 됐다. 실제로 캐시를 조회하니 churn 이 있던 마지막 날이 정확히 20260720 이고 그 뒤 한 달은 전부 0 이었다.

**(2) 렌더링 — 0 이 "없음"이 아니라 "점"으로 그려진다.** `TodayActivityRing` 은 값이 0 이어도 arc `<circle>` 을 그렸고, 그때 `strokeDasharray` 가 `"0 100"` 이 된다. 그룹에 `strokeLinecap="round"` 가 걸려 있어 길이 0 인 dash 는 SVG 에서 **점**으로 렌더된다(점선 만들 때 쓰는 그 트릭). 그래서 12시 방향에 유령 점이 떠 있었다. 앱 업데이트 후에 눈에 띈 건 재시작으로 Today 가 다시 그려졌기 때문일 뿐, 재빌드해도 디스크에 값이 없으니 결과는 같았다.

## 해결 방법

값을 **이미 갖고 있는 곳에서** 파생시켰다. 엔트리별 diff 사이드카(`.oculpm/index/diffs/*.json`)에는 unified patch 가 그대로 저장돼 있고, 캐시 재빌드에도 살아남는다.

- `entry_diffs::count_patch_lines` / `line_counts` — patch 의 `+`/`-` 줄을 센다(`+++`/`---` 헤더 제외).
- 마이그레이션 `028_journal_file_lines.sql` — `oculpm_journal_files` 에 `lines_added`/`lines_removed`(nullable) 추가. NULL = "아직 센 적 없음", 합산 시 0.
- `JournalCache::set_line_counts` / `workday_lines` / `entries_missing_line_counts` — 저장·합산·백필 work-list. `workday_bytes` 는 `workday_lines` 로 대체(호출처 1곳).
- 채우는 시점 2군데: 워처가 새 엔트리의 사이드카를 캡처한 직후(`store_line_counts` — 즉시 반영), 그리고 프로젝트 열 때 `backfill_line_counts` 스윕([FLOW] step 2.7, 기존 사이드카 백필용). 엔트리는 한 번 세면 work-list 에서 빠진다.
- `WorkdayBrief.bytes_added/removed` → `lines_added/removed`, 프런트도 `linesAdded/linesRemoved` 로. 통계 카드 단위는 "바이트" → "줄".
- 링은 `fraction > 0` 일 때만 arc 를 그린다(유령 점 제거). 단위가 바이트에서 줄로 바뀌었으니 포화 상수도 `k=160` → `400`.

## 검증

- `cargo test` 610 통과(신규 3: patch 줄 세기 2, 캐시 왕복 1 — 인덱싱 직후 NULL→work-list 등재, 세어 넣으면 워크데이 합에 잡히고 목록에서 빠짐). `pnpm test` 1039 통과(신규: 0 인 지표는 `.tr-arc` 를 만들지 않고 track/hit 은 남는다). typecheck·lint·build 각각 exit 0.
- 실제 데이터로 기대값 확인 — 오늘치 사이드카 5개를 직접 세면 +1213 / −55 (churn 1268 → 링 76%). 앱을 다시 열면 step 2.7 이 과거 일지까지 같은 방식으로 채운다.

## 메모

프론트매터의 `bytes_*` 필드는 디스크 스키마라 건드리지 않았다(schema_version 유지). 에이전트가 적어주면 그대로 남지만, Today 가 읽는 값은 이제 사이드카 파생값이다.

`three-features-round.md` 의 미착수 항목이 `028_mobile_devices.sql` 을 예약해 두고 있어 번호가 겹쳤다 — 이번에 028 을 쓰면서 그 항목을 029 로 정정했다(글리프 변화 없음).
