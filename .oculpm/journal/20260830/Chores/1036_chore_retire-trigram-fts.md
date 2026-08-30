---
schema_version: 1
type: chore
slug: retire-trigram-fts
status: done
created_at: 2026-08-30T10:36:00+09:00
session_id: "manual-20260830-103600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/migrations/025_fts.sql
    op: delete
  - path: src-tauri/src/db/code_index.rs
    op: update
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/db/tests.rs
    op: update
  - path: src-tauri/tests/fts_search.rs
    op: delete
  - path: src-tauri/tests/text_search.rs
    op: create
related:
  - .oculpm/journal/20260830/Bugs/1036_bug_indexer-gitignore-and-line-duplication.md
tags: [sqlite, search, migrations, audit-round]
---

[x] 등록된 적 없던 trigram FTS5(025) 를 실측 근거로 폐기하고, 마이그레이션 레지스트리에 디스크 대조 가드를 달았다

## 왜

감사에서 `db/mod.rs` 의 `MIGRATIONS` 에 25번이 "025_fts.sql 몫으로 비워 둔다 (아직 미등록)" 라는 주석으로 비어 있는 것을 발견했다. 라이브 DB 에 `chunk_fts` 는 없었고(`user_version=30`), `search_text` 는 매번 FTS 질의를 먼저 던져 실패하면 `warn` 을 삼키고 LIKE 로 폴백하고 있었다. 반면 플래너 `v2-release.md` 의 U11 은 `[x]` 였고, `tests/fts_search.rs` 의 "FTS 테스트" 5건은 테이블을 만들지 않은 채 `Db::open` 만 하므로 **폴백 경로로 통과**하고 있었다 — 넉 달 동안 계획은 완료, 코드는 미완인 상태가 아무 신호 없이 유지됐다.

등록만 하면 끝인지 라이브 DB 사본으로 재 봤다:
- trigram FTS 적재: **14.7초**, 색인 크기 **376MB(본문 178MB 의 2.1배)** — DB 585MB → 981MB.
- 같은 질의(`parseFallbacks`): FTS 6ms vs LIKE **132ms** — 오염된 178MB 위에서.
- 색인 소음 정리(031) 뒤 본문은 58MB, 프로젝트당 수십 MB — LIKE 는 수십 ms.

수십 ms 를 수 ms 로 만들려고 디스크를 2배 내는 거래라 폐기가 맞다. 설계 당시(v2 U11) 는 청크가 수만 행이 될 때를 걱정했지만, 실제로 검색을 느리게 한 것은 FTS 부재가 아니라 색인 오염이었다.

## 변경

- `025_fts.sql` 삭제. 25번은 비워 두고 재사용하지 않는다(주석으로 사유 명시).
- `search_text`: FTS 분기·폴백 `warn` 제거, LIKE 단일 경로. 3자 미만 질의 제한도 자연히 사라졌다.
- `tests/fts_search.rs` → `tests/text_search.rs`: 실제 경로를 검증한다 — 식별자 substring · 한글 2자 · LIKE 메타문자(`%`·`_`) 리터럴 · FTS 연산자 무해 · 갱신/삭제 즉시 반영 · 프로젝트 격리.
- 레지스트리 가드 `migration_registry_matches_disk`: 등록 번호 단조 증가 + `migrations/*.sql` 전수가 **파일명 번호 그대로** 등록돼야 한다. 이 테스트를 통과시키기 위해 `011_project_blueprints.sql` 의 등록 번호를 10→11 로 바로잡았다(`IF NOT EXISTS` 라 어느 DB 든 결과 동일).
- `PRAGMA journal_size_limit = 64MiB` — WAL 이 첫 색인 크기(80MB) 로 눌러앉아 있던 것을 체크포인트 때 잘라낸다.

## 검증

`cargo test` 전체 그린(레지스트리 가드 포함 — 가드는 025 가 남아 있으면 즉시 실패한다). 라이브 DB 사본에서 `Db::open` 이 031 까지 정상 적용됨을 확인.

## 메모

`v2-release.md` 는 `status: done` 이라 수정하지 않는다 — U11 의 실제 결말은 이 일지와 `improvement-audit-round.md` D2 가 정본이다. `db/mod.rs` 의 `oculpm-defer:` 마커(번호 충돌 → 원장 전환)는 그대로 둔다: 이번 가드는 "디스크↔등록 불일치" 를 막을 뿐 "이미 지나간 DB 의 자가 치유" 는 여전히 원장이 필요하다.
