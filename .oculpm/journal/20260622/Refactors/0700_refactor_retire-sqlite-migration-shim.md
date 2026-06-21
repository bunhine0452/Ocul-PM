---
schema_version: 1
type: refactor
slug: retire-sqlite-migration-shim
status: done
difficulty: medium
created_at: "2026-06-22T07:00:00+09:00"
session_id: "20260622-m02"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/migrate_from_sqlite.rs
    op: delete
  - path: src-tauri/tests/oculpm_migration.rs
    op: delete
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/src/oculpm/mod.rs
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: src-tauri/tests/lite_w6_safety_net.rs
    op: update
related:
  - 20260622/Refactors/0157_refactor_orphan-backend-commands.md
tags: ["cleanup", "dead-code", "migration", "oculpm", "dev-report-followup"]
---

[x] 일회성 SQLite→.oculpm 마이그레이션 shim 은퇴 (코드 제거, 테이블 보존)

## 동기

dev-report §3-C. `migrate_from_sqlite.rs`(~1.9k줄) + 마이그레이션 커맨드 6개 + `slug` 크레이트 + db.rs changelog 리더는 v0.x SQLite changelog → `.oculpm` **일회성 업그레이드 경로**다. 백엔드는 완전히 배선돼 있었으나 진입 UI(`legacy/projects/`)가 cleanup PR #2 에서 삭제돼 사용자가 도달 불가했고, **v0.x 는 외부 공개 배포된 적이 없어** 올라올 사용자가 없다 → 순수 사장(死藏) 코드. cleanup PR 의 "orphan 백엔드 제거" 방향과 일치한다.

## 변경 요약

사용자 결정 **C(코드 제거, 테이블 DROP 안 함 — 데이터 손실 위험 0, git 복구 가능)**. 컴파일러 주도 + grep 검증으로 제거.

- **삭제**: `migrate_from_sqlite.rs` + 통합테스트(`oculpm_migration.rs`); 커맨드 6개(`oculpm_migration_dry_run`/`migrate_from_sqlite`/`migration_rollback`/`open_backup_dir`/`get_migration_history`/`delete_legacy_changelog`) + `lib.rs` 등록 + `OculpmMigrationProgress` 이벤트; `manager` 6 메서드 + `validate_confirm_token` + 테스트 서브모듈; `db.rs` changelog 리더 5개 + migration-history 4개 + `ChangelogEntry`/`ChangelogFileEntry` 구조체 + `changelog_entry_from_row`; `spec.rs` 마이그레이션 타입 12개(+`ConflictResolution`); 프런트 `oculpmApi` 5 메서드 + 타입 import; `slug` 크레이트(migrate 전용); `lite_w6` `invariant_10`.
- **보존**: `changelog_entries`/`changelog_files`/`oculpm_migrations` 테이블 + `007`/`014` SQL(비활성·DROP 없음); `project_snapshot`/`ProjectSnapshot`(overview_stats 와 공유); `EndedReason::SyntheticMigrated`(세션 enum 변형, serde 호환 위해 유지).

## 검증

- 백엔드 `cargo test` 267 lib + 통합(lite_w6/local_diff/agents_compare) 전부 통과. 커맨드 6개 제거 반영해 `bindings.ts` 재생성(마이그레이션 참조 0건).
- 게이트 전부 exit 0 직접 확인: `cargo build` + `pnpm typecheck`/`test`/`lint`/`build`. 프런트 stray ref 0(grep 스윕). 제거 심볼 전부 외부 참조 0 확인 후 삭제. 순삭 ~2.9k줄.

## 메모

- 결정은 사용자에게 A(게이트)/B(전면+DROP)/C(코드만) 제시 후 C 선택. 테이블을 남겨 두었으니 "v0.x 미배포"가 영구 확정된 뒤 별도 DROP 마이그레이션으로 완전 제거 가능.
- `delete_project` 의 changelog 행 정리는 (제거된 `truncate_changelog_for_project` 가 아니라) 스키마/인라인 SQL 경로라 테이블 유지로 무영향.
- 브랜치 `chore/retire-migration-shim-20260622` (R1 위에 스택). 플랜 `#migration-shim` 완료.
