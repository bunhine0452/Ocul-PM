---
schema_version: 1
type: feature
slug: export-digest
status: done
difficulty: medium
created_at: "2026-06-24T17:41:28+09:00"
session_id: "20260624-m04"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
files_touched:
  - path: src-tauri/src/commands/export.rs
    op: create
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/capabilities/default.json
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["feature", "export", "share", "C2", "post-1.17-round"]
---

[x] 공유 가능한 일지 내보내기 (.md 번들, C2)

## 추가 기능

코드베이스 어디에도 export 경로가 없어 "이번 주 AI 가 뭘 출시했는지"를 동료·매니저에게 건넬 산출물이 화면 공유밖에 없었다 — 로컬-퍼스트 도구의 가장 유기적 입소문 채널을 막던 격차. 이제 **회고 화면**에서 기간(7/14/30일)을 고르고 **"내보내기"** 를 누르면 그 기간의 작업 일지를 **자기완결 단일 .md** 로 평탄화해 저장한다. **엄격 read-only·offline.**

## 동작 흐름

- 백엔드 `oculpm_export_digest(project_id, since, until) -> Option<String>`: `JournalCache::range_entries`(F4 에서 만든 범위 쿼리 재사용)로 정렬된 일지를 워크데이별로 묶고, 각 일지의 본문은 `get_entry`로 가져와 렌더(타입 한국어 라벨·상태·에이전트·파일·본문). 0건이면 다이얼로그 전에 에러. 네이티브 저장 다이얼로그(기본 `oculpm-journal-<범위>.md`)→`write_atomic` 까지 백엔드에서(=`select_project_folder` 패턴), 취소 시 `None`.
- **보안 by construction**: 본문은 이미 시크릿 마스킹된 SQLite 캐시(R1)에서 읽어 별도 정제 불필요. 저장 권한은 `dialog:allow-save` 명시(런타임 검증 불가 경로 디리스크).
- 프런트: 회고 툴바에 Download 버튼(기간 picker 재사용). 결과 경로를 토스트로 안내, 취소는 조용히.

## 검증

- 백엔드 286 테스트(export 단위 2: type_label/fmt_workday) + capability 빌드 검증. 프런트 typecheck/test/lint/build 전부 exit 0. 커맨드 추가로 bindings 재생성.

## 메모

- MVP=.md 평탄화(매트릭스의 "무의존, 먼저 출시 가능" 변형). 한계·후속: ① 자기완결 HTML(인라인 CSS+PatchView 식 diff 컬러) 변형 ② per-entry diff sidecar 포함 ③ forbidden-path 일지 제외(현재는 본문 마스킹으로 시크릿은 안전, 파일 경로는 raw). ④ 회고 화면 co-location — 추후 일지 화면에도 진입점 가능.
- post-1.17-round `#export-digest` 완료. orphan-db-methods(표면0)와 묶어 v1.18.0 릴리스.
