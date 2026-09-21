---
schema_version: 1
type: feature
slug: "journal-search-cache-rank"
status: done
difficulty: high
created_at: "2026-09-21T19:12:18+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 S)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/journal_search/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/journal_search/cache.rs"
    op: create
  - path: "src-tauri/src/oculpm/journal_search/tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/search.rs"
    op: create
  - path: "src-tauri/src/commands/journal_search.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/paths.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
related: []
tags:
  - "journal-scale"
  - "search"
  - "mcp"
  - "cache"
  - "ranking"
  - "mcp-tool"
---
[x] journal_search 를 SQLite 캐시 기반·관련도 랭킹으로 — 디스크 전수 스캔 제거

## 추가 기능

플랜 `journal-scale-round` {#search-cache} {#search-rank}. 병렬 워크트리 세션 S(Opus 5)가 구현하고 감독자가 합류·게이트·기록. PR #26.

감사(2026-09-21) 근거: 이 저장소 일지 727건, 주 100건 성장. MCP `journal_search` 는 호출마다 `.oculpm/journal` 을 전부 걸어 범위 안 파일을 **모두 읽고 파싱**했고(`since` 기본값 없음), 랭킹은 매치 강도 u8 + 경로 역순뿐이라 관련도 개념이 없었다. AGENTS.md §0 "시작 전 과거를 먼저 찾는다" 가 이 도구에 기대는데 5,000건에서는 작동하지 않을 구조였다.

- **캐시 경로**: `oculpm-mcp` 는 앱과 같은 crate 라 lib 를 그대로 쓴다. `ProjectDirs("com","kimhyunbin","ocul-pm")/ocul-pm.db` 를 `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only=1` + busy_timeout 750ms 로 연다. `Db::open`(마이그레이션=쓰기)은 절대 안 탄다.
- **디스크 폴백 4조건**: DB 없음 / 이 root 의 `projects` 행 없음(문자열·canonicalize 둘 다 비교) / 색인 0건 / **디스크의 (파일 수, 최신 mtime) ≠ 캐시 서명**. 넷째가 핵심 — 캐시는 앱이 돌 때만 최신이고, 앱이 꺼진 사이 손으로 쓴 일지는 캐시에 없다.
- **매칭은 SQL 로 안 내림**: SQLite `lower()` 는 ASCII 전용이라 Rust `to_lowercase()` 와 판정이 갈린다. SQL 은 구조 필터(기간·종류·상태·태그·파일)만, 매칭·랭킹은 두 경로 모두 `rank()` 한 함수.
- **점수식**: 토큰별 최고 필드 가중치 합 + 최신성. 제목 100 > 태그 70 > 슬러그 55 > 경로 40 > 본문 10, 최신성 상한 9(가장 좁은 등급 간격 30 보다 작아야 뒤집히지 않음 — `const _: () = assert!(...)` 로 컴파일 시점 단언). 다중 토큰 AND 후 합산, 구 전체가 한 필드에 걸리면 절반 가산. 최신성은 "오늘" 기준이 아니라 매치 집합 안의 상대 순서라 날짜가 지나도 순서가 안 바뀐다.
- 응답에 `source: "cache"|"disk"` 추가, `total_matched`·기본 상한 20·`since` 기본값 없음 유지. 프런트용 `oculpm_search_journal` 커맨드 추가(UI 는 {#search-scope-ui} 2차 웨이브).
- `mcp/tools/mod.rs` 1197 → 828줄 (`journal_search`/`journal_read` 를 `mcp/tools/search.rs` 로). `redact.rs` `CALL_SITE_FILES` 24→25 (egress_inventory 가 새 파일을 잡음). landing plugin 문서의 옛 "매치 강도순" 설명 갱신.

## 동작 흐름

`journal_search(args)` → 구조 필터 → `CacheHandle::open()` 시도 → 4조건 통과 시 `fetch_rows`(rusqlite 동기) / 실패 시 기존 walk+parse → 공용 `rank()` → 상한·스니펫 → JSON(+`source`).

## 검증

- 실측(727건, release): `ime` 159→35ms, `터미널` 144→31ms, `캐시 무효화` 132→25ms, `릴리스` 100→26ms. 전 케이스 캐시·디스크 `hits_tsv` 완전 일치. 재현 `cargo test --release --lib measure_cache_vs_disk -- --ignored --nocapture`.
- 기존 계약 테스트 8건 무수정 통과 + 캐시 경로 3건 + 랭킹 9건 + 캐시 조회 2건. 통합 브랜치에서 typecheck/vitest 2752/lint/build/cargo fmt·clippy·test(lib 1541) 전부 exit 0.
- 실기기 육안 확인 미실시(설치본 구동 중).