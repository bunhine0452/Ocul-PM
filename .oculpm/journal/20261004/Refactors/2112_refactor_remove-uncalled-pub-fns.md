---
schema_version: 1
type: refactor
slug: "remove-uncalled-pub-fns"
status: done
difficulty: low
created_at: "2026-10-04T21:12:25+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/cache/stats.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/db/changes.rs"
    op: update
  - path: "src-tauri/src/db/planning.rs"
    op: update
  - path: "src-tauri/src/db/mod.rs"
    op: update
related: []
tags:
  - "dead-code"
  - "refactor"
  - "mcp-tool"
---
[x] 호출자 0 인 pub 함수 정리 — 개요 통계(overview_stats)·옛 changelog DB 층 등 약 900줄

## 동기
lib 크레이트의 `pub` 항목은 `dead_code` 경고를 받지 않는다. "정의 말고 참조 0" 을 스캔하니 커맨드(매크로 등록) 오탐을 빼고 실제로 버려진 함수들이 나왔다. 그중 두 개는 버려진 게 아니라 **연결이 안 된 기능**이라 고장으로 따로 고쳤다 (중단점 이름 따라가기·무결성 토스트).

## 변경 요약
- `JournalCache::overview_stats` + 타입 5개 + 테스트 5개 + 변환 헬퍼 3개 (-573). W5-PR5 개요 위젯이 끝내 안 생겨 테스트만 불렀고, 절반이 읽는 `oculpm_sessions_cache` 는 운영 코드가 한 번도 쓰지 않는 표였다.
- 옛 SQLite changelog(file_changes) 읽기·쓰기 4개, 목표 대시보드 집계·`DashboardStats`·`FileChange`, `refresh_file_hash`, `clear_project_dependencies`, `touches_oculpm`, `is_running`, `get_index_snapshot`, `_absolute_for_test`, `oculpm_agent_state_clear_project`(delete_project 가 대신함) (-322).
- 표(스키마)는 남겼다 — 옛 표는 "inert 로 보존" 결정이 있고 heal_columns 가 의존한다. 프런트는 고아 모듈이 shadcn textarea 하나뿐이라 그대로.

## 검증
bindings.ts 무변경(노출 안 된 것만), clippy -D warnings · 전체 테스트 초록.