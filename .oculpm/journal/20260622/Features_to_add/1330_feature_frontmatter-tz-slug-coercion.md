---
schema_version: 1
type: feature
slug: frontmatter-tz-slug-coercion
status: done
difficulty: medium
created_at: "2026-06-22T13:30:00+09:00"
session_id: "20260622-m10"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/frontmatter.rs
    op: update
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
related:
  - "20260622/Features_to_add/0730_feature_expose-parse-warnings.md"
tags: ["feature", "reliability", "oculpm", "dev-report-followup", "F7a", "frontmatter-coercion"]
---

[x] frontmatter 자동 보정 — tz 오프셋 backfill + slug 정규화 (F7a-B, 캐시/표시 전용)

## 추가 기능

보고서 03 §F7a-B. A(노출, v1.12.0)에 이어 **자동 보정** 파트. 에이전트가 tz 오프셋 없이 쓴 `created_at`(예: `2026-05-24T09:25:13`)은 `new Date()`/사전식 정렬에서 UTC 로 오해석된다. 이제 인덱싱 투영 시점에 프로젝트 tz 로 오프셋을 backfill 하고(DST 정확), 비정규 slug 는 kebab-case 로 정규화해 **캐시/표시에만** 반영한다. **디스크 SSOT 는 절대 건드리지 않는다.**

## 동작 흐름

- **순수 헬퍼**(`frontmatter.rs`): `iso_lacks_offset`(오프셋 없는 ISO 만 식별, date-only/Z/garbage 제외), `backfill_tz_offset`(chrono_tz `from_local_datetime().earliest()`, DST 정확), `normalize_slug`(ASCII 전용 — 비-ASCII 한 글자라도 있으면 no-op 라 한글/혼합 slug 를 망가뜨리지 않음). 소수점초·DST gap 포함 단위테스트.
- **캐시 전용 보정**(`cache.rs`): `JournalCache.tz`(opt-in `.with_tz`) → 단일 스냅샷 생산자 `CacheRowSnapshot::from` 에서 created_at/updated_at backfill + slug 정규화. **보정 경고는 advisory** — `parse_warnings` 에 기록해 ⚠ 배지는 켜지만 `parse_ok` 는 **구조적 파싱 신호**로 유지(tz 누락은 구조적 정상이므로 `parse_ok=true`). `body_md_hash`/full_text 불변 → redaction no-churn·mtime 빠른경로 그대로.
- **tz 배선**: `manager.tz_for(project_id)`(redact_patterns 미러)로 5개 투영 경로 + `WatcherInner.tz`(config 에서)로 라이브 인덱싱 경로.
- **프런트**(`EntryDetailView`): 배지를 `parse_ok===false || 경고존재`로 확장하고, 구조실패="파싱 경고" vs 보정="보정됨"/"보정 내역"으로 문구 구분(악성 오인 방지).

## 적대적 리뷰 반영 (6에이전트, blocker 0)

5개 불변식 렌즈로 검증 — **디스크 불변 주장은 refute 실패(참 확정)**. should-fix 3건 + nit 2건 **전부 수정**:
1. `normalize_slug` 가 혼합 slug 의 한글 절반을 ASCII 조각으로 손실(`버그-fix`→`fix`) → 비-ASCII 면 no-op.
2. `update_journal_entry_body` 가 tz=None 으로 재업서트해 backfill 값 clobber → `.with_tz` 추가(본문은 at-write 마스킹 완료라 redaction 불필요).
3. `parse_ok` 과적재 → 구조신호로 분리. 이로써 `difficulty_mix`/`observed_agent_ids`(`WHERE parse_ok=1`)가 tz-누락 정상 행을 **올바르게 포함**(리뷰 우려 해소).
4. nit: DST spring-forward gap 도 경고; 소수점초 timestamp 인식.

## 검증

- 백엔드 cargo build(경고 0)·cargo test 273 lib + 통합 전부 통과(신규 5 테스트: 헬퍼 3 + 캐시 보정 2 — backfill 후 **디스크 byte-identical** 단언 포함). 프런트 typecheck/test(125)/lint/build 전부 exit 0. DTO/커맨드 무변경 → bindings.ts 불변.

## 메모

- 이로써 `#parse-warnings` 항목(A 노출 + B 보정) 완료.
- **한계/후속**: (1) 기존 캐시 행은 mtime 변경·전체 재인덱스 시에만 재보정(표시 전용이라 허용). (2) slug 정규화 ASCII 전용(한글 slug 는 의도적으로 미보정). (3) 선택적 "원본 고치기"(보정값을 디스크에 1회 기록, `update_entry_meta` 경유)는 미구현 — 별도 affordance.
