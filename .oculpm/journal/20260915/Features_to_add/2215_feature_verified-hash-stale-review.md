---
schema_version: 1
type: feature
slug: "verified-hash-stale-review"
status: done
difficulty: high
created_at: "2026-09-15T22:15:47+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/verified.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/tests_verified.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/project.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/reindex.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/stats.rs"
    op: update
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/migrations/039_oculpm_verified_stale.sql"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/oculpm/verified.ts"
    op: create
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/oculpm/EntryMasthead.tsx"
    op: update
  - path: "src/features/diff/changeGroups.ts"
    op: update
  - path: "src/features/diff/DiffFileList.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_verified.test.tsx"
    op: create
  - path: "docs/major_update/oculpm/00-spec.md"
    op: update
related: []
tags:
  - "journal"
  - "frontmatter"
  - "cache"
  - "migration"
  - "i18n"
  - "astra-feedback"
  - "parallel-session"
  - "mcp-tool"
---
[x] 확인 표시를 본문 해시에 묶기 — 확인 뒤 바뀐 일지는 「다시 검토」 (verified_hash · verified_stale · 039)

## 추가 기능

Astra 리뷰 B10(§9.4) 을 열려 있던 `improvement-round #verified-loop`(699건 중 8건만 확인) 의 답으로 채택 — 사람의 「확인」은 확인한 **내용**에 묶여야 하고, 그 뒤 본문이 바뀌면 확인은 효력을 잃는다. 병렬 세션 R3 이 worktree 에서 구현, 커밋 `51c6034`(백엔드)·`2001325`(프런트) + 오케스트레이터 fix-up(해요체).

### 동작 흐름

1. **frontmatter `verified_hash`**(선택, `blake3:<hex>`): `set_journal_verified(true)` 가 현재 본문 해시를 적고, `false` 는 지운다. 해시는 frontmatter 분리 뒤 **마스킹 전** 디스크 본문의 `trim_end()` — `frontmatter/verified.rs` 와 spec §3.4 에 명세. `schema_version` 은 1 유지: 파서가 미지 키를 무시하고 버전을 비교하지 않으므로 additive(주석에 근거).
2. **캐시 `verified_stale`**(039 마이그레이션 + `ADDITIVE_COLUMNS`): 투영 시 `verified_by_user && verified_hash.is_some() && verified_hash != hash(디스크 본문)`. `project_text` 가 `Projected{disk_body_hash}` 를 돌려주고 워처·재색인 경로의 `upsert_projected` 가 쓴다(공개 `upsert_entry` 시그니처 불변). `COERCION_VERSION` 2→3 으로 기존 행 1회 재투영(037 선례).
3. **그대로 인정**: 해시 없는 기존 8건(`verified_by_user: true`, `verified_hash` 없음)과 수동 작성 일지(저자 표시이지 검토가 아님)는 stale 아님. 디스크 백필 없음.
4. **노출**: `JournalEntry`/`JournalEntrySummary` 에 필수 `verified_stale: bool`(TS `boolean`). 「검증됨만」 필터는 `verified_by_user = 1 AND verified_stale = 0`, 변경 그룹(`ChangeGroup`)도 stale 을 실어 diff 목록에서 구분.
5. **UI**: 원장 행 `.jl-stale` · 열람 머리띠 「확인 뒤 내용이 변경됐어요 · 다시 검토」(`--warn-text` 잉크, `RotateCcw`, 기존 프리미티브만) · 툴바 토글은 「다시 검토」로 `true` 를 다시 보내 지금 본문에 해시를 묶는다. i18n 4키 ko/en.

### 오케스트레이터 fix-up

전체 vitest 에서 `i18n_glossary`(화자는 해요체) 1건 빨감 — `entry.staleLine` 이 내 브리프 문구 그대로 「변경됐습니다」였다. ko.ts·테스트·spec.rs 주석을 「변경됐어요」로, `bindings.ts` 재생성.

## 검증

- Rust(R3): `manager::tests_verified`(4 — 해시 기록·본문 변경 뒤 stale·레거시 비-stale·시크릿 마스킹된 투영은 stale 아님) · `frontmatter` · `cache::` · `db::`(`migration_registry_matches_disk`·`every_added_column_is_declared_for_healing`) · `mcp::tools::tests::journal` · `export_bindings_typescript` = 124 통과.
- 합류 뒤 오케스트레이터 전체 게이트: `cargo fmt --check`·`clippy -D warnings`·`cargo test --locked` 1485+통합 전부 ok / `pnpm typecheck` 0 · `pnpm test` 217파일 2719/2719 · `pnpm lint` 7게이트 0 · `pnpm build` 0.
- 파일 크기 래칫 때문에 새 테스트는 `manager/tests_verified.rs`·`journal_verified.test.tsx` 로 분리(`manager/tests.rs`·`journal_v2.test.tsx` 는 상한).
- 미검증: 설치본에서 배지·「다시 검토」 토글 육안 — v3-release 류 눈 원장으로 이월 필요.