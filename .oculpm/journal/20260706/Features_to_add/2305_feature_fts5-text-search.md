---
schema_version: 1
type: feature
slug: fts5-text-search
status: done
difficulty: medium
created_at: "2026-07-06T23:05:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/migrations/025_fts.sql
    op: create
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/tests/fts_search.rs
    op: create
related: []
tags: ["v2-release", "U11", "fts5", "search", "performance"]
---

[x] U11 FTS5 텍스트 검색 — LIKE 풀스캔 제거 (trigram, substring 의미 보존)

## 추가 기능

- **마이그레이션 025**: `chunk_fts` external-content FTS5 (`content='chunks'`), **tokenize='trigram'** — 기존 `LIKE '%…%'` 와 동일한 substring 의미를 인덱스로 보존 (unicode61 이면 `fallback` 으로 `parseFallbacks` 를 못 찾는 의미 회귀 발생). 트리거 3종(insert/delete/update)이 인덱서 쓰기 경로를 자동 추종 — Rust 인덱서 무변경. 기존 행 백필 포함.
- **`search_text` 2단 경로**: 3자 이상 쿼리 → FTS MATCH (전체를 phrase 인용해 사용자 입력의 FTS 연산자 중화, 내부 `"` 는 FTS 규칙 2배 이스케이프) / 3자 미만(trigram 매치 불가)·FTS 오류 → 기존 LIKE 폴백. 정렬은 기존과 동일(path, start_line) — 동작 표면 불변.
- **심볼 검색은 의도적으로 LIKE 유지** (스펙 §3 에서 조정): symbol_definitions 는 행 수가 작아 스캔이 싸고 substring 의미가 필수라 FTS 이득이 없음 — 마이그레이션 주석에 근거 기록.

## 동작 흐름

코드 검색(텍스트 scope) 입력 → chunk_fts trigram 인덱스 매치 → 대형 인덱스에서도 상수형 응답. 짧은 쿼리·구버전 캐시는 LIKE 로 동일 결과.

## 검증

- 신규 통합 테스트 5개 (`tests/fts_search.rs`): 식별자 중간 substring·한글 매치(trigram 계약), 2자 쿼리 LIKE 폴백, FTS 연산자(`AND`/`col:`/`"`/`*`) 무해화, 트리거 update/delete 동기화, 프로젝트 격리.
- cargo **344 passed / 0 failed** (마이그레이션은 모든 Db::open 테스트에서 실행됨), 프런트 게이트 4/4 = 0.
