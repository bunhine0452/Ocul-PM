---
schema_version: 1
type: feature
slug: discussion-pr2-attachments
status: done
difficulty: low
created_at: "2026-06-29T12:34:01+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/discussion.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
related:
  - ./1203_feature_discussion-pr1-write.md
tags: ["discussion-feature", "PR-DISC-2", "oculpm", "attachments"]
---

[x] 문제 해결(Discussion) PR-DISC 2 — 조사 자료 첨부 사이드카

## 추가 기능

`<slug>/attachments/` 사이드카에 외부 파일을 붙이고 인라인으로 읽는 커맨드. docs_asset 의 base64/secure_join 패턴 미러.

- `discussion_attach(source_path)` — 알려진 절대경로(드래그드롭) 복사 in.
- `discussion_attach_via_dialog` — 네이티브 파일 피커(tauri-plugin-dialog) 열어 선택→복사, None=취소.
- `discussion_asset(rel_path)` — base64 + MIME (16MB 상한), `data:` URI 조립용.
- `discussion_detach(rel_path)` — 첨부 1개 삭제.
- `discussion_read_raw` — 편집기용 원본 본문(redact 전) 반환(저장 round-trip 무손실).
- 공통 `copy_into_attachments`(파일명만 사용·중복 dedup) + `secure_attachment_join`(폴더 밖 `../` 거부).

## 동작 흐름

attach → discussion 폴더 확인 → attachments/ 생성 → 파일명 dedup 복사 → rel_path 반환. asset/detach 는 secure_join 으로 폴더 내부로 가둠. 첨부 메타는 PR-DISC 0 투영(dir 스캔)이 이미 캐시.

## 검증

`cargo test` 전체 lib 311 green, bindings 에 attach/attachViaDialog/asset/detach/readRaw 생성. (경로 탈출 거부는 docs.secure_docs_join 동형 로직.)
