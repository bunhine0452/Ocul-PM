---
schema_version: 1
type: feature
slug: expose-parse-warnings
status: done
difficulty: low
created_at: "2026-06-22T07:30:00+09:00"
session_id: "20260622-m03"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
related: []
tags: ["feature", "reliability", "oculpm", "dev-report-followup", "F7a"]
---

[x] 파싱 경고 노출 — 깨진 frontmatter 일지에 ⚠ 신뢰성 배지 (F7a 노출 파트)

## 추가 기능

`frontmatter.rs` 가 `parse_warnings`(tz offset 누락·agent-as-string·잘못된 op 등)를, `cache.rs` 가 `parse_ok`/`parse_warnings` 컬럼에 저장하지만 DTO 에 필드가 없어 UI 에 **신뢰성 신호가 0** 이었다. 이제 `JournalEntry`/`JournalEntrySummary` 에 `parse_ok`/`parse_warnings` 를 노출하고, 작업 일지 상세에 ⚠ "파싱 경고" 배지 + 경고 목록을 렌더한다.

## 동작 흐름

- (백엔드) `spec.rs` 두 DTO 에 `parse_ok: bool` + `parse_warnings: Vec<String>` 추가. `cache.rs` 의 세 읽기 경로(`get_entry`·`get_summary_by_path`·`build_list_sql`) SELECT 에 두 컬럼 추가, `entry_row_from`/`summary_from_row` 매핑, 저장된 JSON 배열을 `parse_warnings_vec` 로 디코드. (저장 컬럼이 이미 있어 마이그레이션 불필요.)
- (프런트) `EntryDetailView` 가 `parse_ok === false` 일 때 헤더에 ⚠ 배지(경고를 title 툴팁), aside 에 경고 리스트. 낙관적 UI/구 픽스처 대비 `?? []`·`=== false` 방어.

## 검증

- 백엔드 `cargo test` 267 lib + 통합 통과, `bindings.ts` 재생성(parse_ok/parse_warnings 노출). 다른 DTO 리터럴 생성처 없음(grep) 확인.
- 프런트 typecheck/test/lint/build 전부 exit 0(125 통과). 픽스처 미설정 필드로 인한 런타임 throw 를 방어 코드로 해소.

## 메모

- F7a 의 **노출(A)** 파트. **자동 보정(B — `coerce_frontmatter` 에 tz backfill·slug 정규화)** 는 후속(별도 단위). 본 변경은 "신뢰성 신호 가시화"라는 핵심 가치를 단독으로 제공.
- 브랜치 `feat/dev-report-followup-remainder-20260622`.
