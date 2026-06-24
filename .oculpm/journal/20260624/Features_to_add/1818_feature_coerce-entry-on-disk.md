---
schema_version: 1
type: feature
slug: coerce-entry-on-disk
status: done
difficulty: medium
created_at: "2026-06-24T18:18:04+09:00"
session_id: "20260624-m05"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ref: 20260624/Features_to_add/1805_feature_f7a-b-coercion-coverage.md
    kind: followup
tags: ["feature", "oculpm", "post-1.17-round", "F7a-B"]
---

[x] F7a-B 후속 ③ "원본 고치기" — 시간대 보정을 원본 파일에 1회 기록 (Unit B)

## 추가 기능

F7a-B 의 마지막 한계: tz 보정은 캐시/표시 전용이라 디스크 SSOT 의 `created_at` 은 여전히 오프셋이 없었다. 이제 작업 일지 상세에서 **명시적·옵인** 버튼으로 보정값을 **원본 .md 에 1회 기록**할 수 있다. F7a-B 설계가 지켜온 "디스크 절대 불변" 원칙을 **유일하게, 사용자가 의도적으로 누를 때만** 깨는 경로.

## 동작 흐름

- 백엔드 `manager.coerce_journal_entry_timestamps_on_disk` (커맨드 `oculpm_coerce_entry_on_disk`): 디스크 읽기→frontmatter 파싱→`backfill_tz_offset` 로 created_at/updated_at 에 프로젝트 tz 오프셋 적용→`write_frontmatter_and_body`+`write_atomic`(update_journal_entry_meta 와 동일한 신뢰된 패턴)→redact+tz 로 재투영→갱신 엔트리 반환. 보정할 게 없으면 에러(멱등 가드).
- **범위=타임스탬프만**. slug 은 파일명과 결합돼 있어 frontmatter 만 고치면 desync — 의도적으로 디스크에 안 씀(표시용 정규화는 Unit A 로 유지).
- 프런트(EntryDetailView): "frontmatter 보정 내역" 박스(=미리보기)에 `backfilled to` 경고가 있을 때만 **"원본 파일에 시간대 적용"** 버튼 노출 → 클릭 시 인라인 확인("원본 .md 를 직접 수정합니다" + 적용/취소) → `oculpmApi.coerceEntryOnDisk` → 경고 로컬 갱신(배지·박스 즉시 반영)+토스트.

## 검증

- 백엔드 cargo test 289(신규 1: 디스크에 +09:00 1회 기록·본문 보존·재실행 에러). 프런트 typecheck/test/lint/build 전부 exit 0. 커맨드 추가로 bindings 재생성.
- 디스크 쓰기는 update_journal_entry_meta(상태/난이도 편집, 기존 프로덕션)와 같은 read→parse→write_frontmatter_and_body→atomic 경로 재사용 — 변경 필드만 timestamp.

## 메모

- `#f7a-b-followups` 3개 서브태스크(①한글slug ②기존행재보정 ③원본고치기) 전부 완료([~]→[x]).
- 본문은 디스크 원본 그대로 다시 씀(시크릿 신규 노출 없음, 캐시는 redact 투영). DST gap("could not backfill") 경고는 버튼 미노출.
- 후속 단위(auto-reconcile C/D/E)와 묶어 v1.19.0 릴리스 예정.
