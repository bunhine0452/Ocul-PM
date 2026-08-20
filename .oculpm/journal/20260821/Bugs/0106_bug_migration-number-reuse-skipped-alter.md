---
schema_version: 1
type: bug
slug: migration-number-reuse-skipped-alter
status: done
difficulty: high
created_at: "2026-08-21T01:06:00+09:00"
session_id: "manual-20260821-010600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
related:
  - ".oculpm/journal/20260820/Bugs/2202_bug_today-line-churn-always-zero.md"
tags: [sqlite, migration, schema-drift, today, dogfooding]
---

[x] Today 가 늘 "오늘 데이터를 불러오지 못했어요" — 번호가 재사용된 마이그레이션이 통째로 건너뛰어졌다

## 발생 원인

증상은 Today 를 열 때마다 뜨는 한 줄이었다.

```
sqlite cache error: no such column: f.lines_added in
SELECT COALESCE(SUM(f.lines_added), 0), … FROM oculpm_journal_files f … at offset 20
```

질의(`cache.rs` `workday_lines`)도 맞고, 그 컬럼을 더하는 마이그레이션
(`028_journal_file_lines.sql`)도 저장소에 있고, `db.rs` 의 `MIGRATIONS` 에도 등록돼
있었다. 그런데 이 기기의 DB 에는 컬럼이 없었다.

```
PRAGMA user_version               → 28
PRAGMA table_info(oculpm_journal_files)  → …, bytes_added, bytes_removed   ← 없다
PRAGMA table_info(oculpm_journal)        → …, lines_added, lines_removed, diff_mtime  ← 있다
```

마지막 줄이 범인이다. **번호가 재사용됐다.**

적용 이력이 `PRAGMA user_version` 정수 **하나**뿐이고, 러너는 `current < version` 인
파일만 돌린다. 즉 번호는 한 번 소비되면 끝이다.

- 병합되지 않은 브랜치 `fix/today-ring-line-delta-and-audit`(29915fb)가 028 을 먼저
  썼다 — `028_journal_line_delta.sql`, `oculpm_journal` 에 `lines_added/removed/diff_mtime`.
  그 빌드를 돌린 이 기기의 DB 가 그때 28 이 됐다
  (`oculpm.log.2026-08-15`: `migration applied version=28`).
- main 은 나중에 **같은 번호로 다른 파일**을 넣었다(69b1cc5) —
  `028_journal_file_lines.sql`, `oculpm_journal_files` 에 `lines_added/removed`.
- user_version 이 이미 28 이라 main 의 028 은 이 DB 에서 **영영 실행되지 않는다**.
  파일을 아무리 고쳐도 28 을 지나온 DB 는 스스로 낫지 못한다.

릴리스 궤적은 선형이라 배포된 빌드만 따라온 사용자는 겪지 않는다. 브랜치를 오가며
도그푸딩하는 기기가 정확히 이 상태에 빠진다.

## 해결 방법

마이그레이션 러너를 고치는 대신, **결과(스키마)** 를 대조해 메우는 안전망을 뒤에 뒀다.
어떤 경로로 어긋났든(번호 충돌·수동 편집·부분 복구) 결과가 같아진다.

- `ADDITIVE_COLUMNS` — `ALTER TABLE … ADD COLUMN` 으로 더해진 가산 컬럼 전수 목록
  (테이블, 컬럼, 선언). 현재 8개(`file_changes.entry_id` … `oculpm_journal_files.lines_removed`).
- `Db::heal_columns()` 를 `migrate()` 끝에서 호출. 테이블이 없으면 건너뛰고,
  `pragma_table_info` 로 컬럼 유무를 보고, 없을 때만 `ADD COLUMN` + `warn!` 로그.
  멱등하고 데이터가 사라지지 않는다.
- `every_added_column_is_declared_for_healing` — `MIGRATIONS` 의 SQL 을 훑어
  `ALTER TABLE x ADD COLUMN y` 를 파싱하고 목록에 없으면 실패한다. 다음 사람이
  목록 갱신을 잊는 경로를 막는다.

적용 이력을 (버전, sql 해시) 원장으로 바꾸는 큰 수술은 하지 않았다 — 실제로 유실되는
것은 가산 마이그레이션이고, 그건 이 그물이 전부 덮는다. 덮지 못하는 경우(번호 충돌로
`CREATE TABLE` 이 통째로 유실)는 `// oculpm-defer:` 마커로 재방문 트리거를 남겼다.

돌고 있는 이 기기의 DB 에는 같은 두 `ALTER` 를 직접 넣어 즉시 복구했다 — 다음 빌드를
기다리지 않아도 되고, 앱 재시작 없이 다음 질의부터 통과한다. 두 컬럼은 NULL 로 시작하고,
기존 백필 스윕(`entries_missing_line_counts`)이 diff 사이드카에서 다시 채운다.

## 검증

- RED: `heal_columns()` 호출만 빼면 새 테스트가 **신고와 같은 문구**로 실패한다 —
  `no such column: f.lines_added … offset 20`. 되돌리면 통과.
- `cargo test` 전량 그린 — lib 631 + 통합 스위트 전부, 실패 0. 새 테스트 3개
  (치유·멱등·목록 누락 게이트).
- 실제 DB: `PRAGMA table_info` 로 두 컬럼 확인, Today 워크데이 합 질의가
  `0|0|51` (합 0, 조인 51행)로 통과 — 백필 전이라 합이 0인 것은 정상.

## 메모

브랜치가 남긴 `oculpm_journal.lines_added/lines_removed/diff_mtime` 3컬럼은 main 에서
쓰이지 않은 채 DB 에 남아 있다. 전부 NULL 이고 읽는 코드가 없어 그대로 뒀다.

`025_fts.sql` 처럼 디스크에만 있고 `MIGRATIONS` 에 미등록인 번호도 있는데, 그건 반대
방향(등록 누락)이라 이 그물과는 무관하다.
