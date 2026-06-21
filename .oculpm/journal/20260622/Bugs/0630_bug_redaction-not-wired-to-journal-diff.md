---
schema_version: 1
type: bug
slug: redaction-not-wired-to-journal-diff
status: done
difficulty: high
created_at: "2026-06-22T06:30:00+09:00"
session_id: "20260622-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/redact.rs
    op: update
  - path: src-tauri/src/oculpm/entry_diffs.rs
    op: update
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/oculpm/migrate_from_sqlite.rs
    op: update
related: []
tags: ["redaction", "security", "oculpm", "dev-report-followup", "structural-debt"]
---

[x] redaction(redact_text)을 일지·diff 쓰기/읽기 경로에 연결 — 시크릿 무방비 정합성 버그 해소

## 발생 원인

`redact.rs` 의 `redact_text`/`compile_redact_patterns`(AWS `AKIA…`·OpenAI/Anthropic `sk-…`·GitHub `ghp_…`·Slack `xox…` 정규식)는 구현·테스트까지 끝나 있었지만 **호출처가 `planner/project.rs` 단 한 곳**(플랜 투영)뿐이었다. 다음 경로는 redaction 을 전혀 거치지 않았다:

- 수동 일지 본문(`create_manual_journal_entry`), 인-앱 본문 편집(`update_journal_entry_body`)
- watcher 의 journal-index 투영(에이전트가 직접 쓴 `.md` → SQLite 캐시)
- 메타 편집(`set_journal_verified`/`update_journal_entry_meta`) — 본문은 그대로 둔 채 캐시에 재투영
- `entry_diffs` 의 영속 diff sidecar 캡처/재구성
- 마이그레이션(레거시 changelog → 새 `.md`) 본문 쓰기·재인덱스

기존 방어는 **경로 차단**(`is_forbidden_path`)뿐이라 **본문/ diff hunk 에 붙여넣은 토큰은 그대로 통과**했다. 그 평문은 SQLite 캐시 → `aiContext.ts` → LLM API 로 나갈 수 있고, `.oculpm/` 을 git 에 커밋하면 마스킹 안 된 시크릿이 팀 전체로 배포된다 — CLAUDE.md 의 "never put secrets in journals/diffs" 가 실제로는 깨져 있었다.

## 해결 방법

작성 주체에 따라 마스킹 시점을 둘로 갈랐다.

- **에이전트 작성분 → 투영(읽기) 시 마스킹** (디스크 원본=SSOT 보존, 에이전트 파일을 되쓰지 않음): `JournalCache::with_redaction` + 새 `project_text`(프런트매터는 건드리지 않고 **본문만** 마스킹 — `[REDACTED]` 가 YAML 스칼라를 깨뜨리는 것 방지)로 `reindex_full`/`reindex_incremental`·`apply_path_change`·캐시미스 디스크 읽기·`set_journal_verified`·`update_journal_entry_meta`·마이그레이션 재인덱스를 일원화.
- **우리 작성분 → 쓰기 시 마스킹** (보존할 디스크 원본이 없음): `create_manual_journal_entry`·`update_journal_entry_body`·마이그레이션 일지 본문을 `write_atomic` 직전 마스킹.
- **diff sidecar**: `capture_entry_diffs` 가 `redact` 를 받아 patch 본문을 캡처 시점에 마스킹하고 마스킹 span 수를 반환. `SCHEMA_VERSION` 2→3 으로 bump → 구 sidecar 가 읽기 시 무효화되어 마스킹된 v3 로 자가치유.
- **토스트**: 마스킹 span > 0 이면 watcher 가 `oculpm-integrity-warning`(journal upsert·diff 캡처)으로 "비밀 N건 마스킹됨" 안내. 수동 일지는 반환 엔트리에 마스킹된 본문이 그대로 보여 별도 토스트 불필요.

## 검증

- 백엔드: `cargo test` 294 lib + 통합 스위트 전부 통과(redaction 신규 테스트 10건 포함 — 본문 마스킹/프런트매터 보존/sidecar v2→v3 자가치유/메타편집 비-재오염/at-write 마스킹/sk-·xox 양성/증분 한계 핀).
- 게이트: `cargo build` + `pnpm typecheck`/`test`/`lint`/`build` 전부 exit 0 직접 확인. 커맨드 추가 없음 → `bindings.ts` 무변경.
- 적대적 멀티에이전트 리뷰(4차원 × 검증)로 10건 확인 → 즉시 반영 8건: 메타편집 캐시 우회, 전체텍스트 마스킹 시 프런트매터 손상, 마이그레이션 디스크 평문 누출, `update_journal_entry_body`/sk-·xox/ sidecar 자가치유 테스트 공백 등.

## 메모

- **알려진 한계**: `reindex_incremental` 은 mtime 동일 파일을 마스킹 전에 skip 하므로, **pre-R1 캐시에 이미 들어간 시크릿은 증분 재인덱싱으론 안 지워진다** — 전체 재인덱스("재인덱스" 버튼) 또는 본문 편집이 필요. 신규 프로젝트는 생성 시점부터 redaction 기본 on 이라 전부 커버됨.
- **후속(이번 범위 밖)**: ① `file_snapshots`/임베딩 인덱서가 `.oculpm/journal` 평문을 at-rest 보관(인덱서 `.oculpm` 제외 작업으로 일괄 해소) — LLM 직결 경로는 없음. ② 구 v2 sidecar 가 재캡처에서 patch 0건일 때 잔존(`.oculpm/index/` 는 gitignore). ③ live `compute_diff`(변경 diff 화면)는 미마스킹.
- 브랜치 `feat/redaction-wire-journal-diff-20260622` (cleanup PR #2 위에 스택). 플랜 항목 `#redaction-wire` 완료.
