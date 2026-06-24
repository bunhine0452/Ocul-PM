---
schema_version: 1
type: feature
slug: f7a-b-coercion-coverage
status: done
difficulty: high
created_at: "2026-06-24T18:05:48+09:00"
session_id: "20260624-m05"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/migrations/023_coercion_version.sql
    op: create
  - path: src-tauri/src/db.rs
    op: update
  - path: src-tauri/src/oculpm/cache.rs
    op: update
  - path: src-tauri/src/oculpm/frontmatter.rs
    op: update
related:
  - ref: 20260622/Features_to_add/1330_feature_frontmatter-tz-slug-coercion.md
    kind: followup
tags: ["feature", "reliability", "oculpm", "post-1.17-round", "F7a-B"]
---

[x] F7a-B 후속 ① 한글 slug 정규화 + ② 기존 캐시행 재보정 (Unit A)

## 추가 기능

F7a-B 한계 2가지 해소(둘 다 캐시/표시 전용, 디스크 SSOT 불변):

1. **한글 slug 정규화**: 기존 `normalize_slug` 는 비-ASCII 한 글자라도 있으면 no-op(혼합 slug 의 한글 절반 손실 방지용)이라 `버그 수정`(공백) 같은 한글 slug 가 전혀 정돈 안 됐다. 이제 **Unicode-aware**: 알파뉴메릭(한글 포함) 보존 + ASCII 소문자화 + 구분자 런 → 단일 `-`. `버그 수정!!`→`버그-수정`, `버그-FIX`→`버그-fix`, 이미 깔끔한 `버그-fix`/`한글슬러그`는 불변.

2. **기존 캐시행 재보정**: 보정 로직이 바뀌어도 mtime 안 바뀐 기존 행은 증분 인덱싱이 통째로 skip 해 재보정이 안 됐다(전체 재인덱스만 됐음). 새 `coercion_version` 컬럼(migration 023, 기본 0)을 도입 — `COERCION_VERSION` 상수(현재 1)와 다른 행은 증분 패스가 mtime 같아도 **1회** 재투영 후 현재 버전으로 도장(이후 다시 skip). `upsert_entry` 빠른경로(full_text 해시 일치)도 버전 stale·보정값 drift 시 싼 frontmatter 파생 컬럼만 self-heal.

## 동작 흐름

- `frontmatter.rs normalize_slug`: ASCII 전용 가드 제거, `is_alphanumeric()`(Unicode) 기준 + `to_ascii_lowercase`(비-ASCII 무영향). 결과가 빈 문자열이거나 입력과 같으면 여전히 None(무손실).
- `cache.rs`: `COERCION_VERSION` 상수. `upsert_entry` SELECT 가 created_at/updated_at/slug/parse_warnings/parse_ok/coercion_version 까지 읽어 빠른경로에서 `coerced_drift || 버전 stale` 시 그 컬럼들만 UPDATE+버전 도장. 통짜 INSERT 에 coercion_version 추가. `load_known_mtimes`→(mtime, version), `reindex_incremental` skip 조건을 `mtime 일치 && version==현재` 로.

## 검증

- 백엔드 cargo build clean + test 288(신규 3): Unicode slug 케이스, 버전 stale 행이 증분에서 재보정→도장됨, 기존 ASCII slug 회귀. DTO/커맨드 무변경 → bindings.ts 불변(internal). 마이그레이션 023 = ADD COLUMN DEFAULT 0(기존 행 안전, 다음 증분서 1회 재보정).

## 메모

- `#f7a-b-followups` 의 ①② 완료. ③ "원본 고치기"(보정값 디스크 1회 기록, update_entry_meta)는 Unit B 로 분리(디스크 SSOT 쓰기라 별도 신중 처리).
- 표면 변화 미미(한글 slug 표시 정돈) → 단독 릴리스 안 함, 후속 단위와 묶음.
- 첫 증분 인덱싱 시 전 행 1회 재읽기(version 0→1) — 일회성 I/O 비용, 이후 정상 skip.
