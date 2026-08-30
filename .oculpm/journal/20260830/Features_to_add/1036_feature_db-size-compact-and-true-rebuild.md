---
schema_version: 1
type: feature
slug: db-size-compact-and-true-rebuild
status: done
created_at: 2026-08-30T10:36:00+09:00
session_id: "manual-20260830-103600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/db/mod.rs
    op: update
  - path: src-tauri/src/commands/diagnostics.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/features/settings/tabs/DiagnosticsTab.tsx
    op: update
  - path: src/features/settings/tabs/IndexingTab.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260830/Bugs/1036_bug_indexer-gitignore-and-line-duplication.md
tags: [settings, sqlite, diagnostics, audit-round]
---

[x] 진단 탭이 DB 용량(파일·WAL·빈 공간·큰 표 8개) 을 보여 주고 압축(VACUUM) 할 수 있으며, 인덱스 재구축이 이름대로 처음부터 다시 만든다

## 추가 기능

- `DbHealth` 에 `db_bytes` · `wal_bytes` · `free_bytes` · `top_tables`(dbstat 상위 8개) 추가. specta 가 `u64` 를 내보내지 않으므로 `f64`(JS number, 2^53 까지 정확). dbstat 이 없으면 표만 비우고 나머지는 보고한다.
- 새 커맨드 `db_compact`: `wal_checkpoint(TRUNCATE)` + `VACUUM`, 끝난 뒤의 `DbHealth` 를 돌려준다. 진단 탭 「압축 (VACUUM)」 버튼 + 힌트("색인을 비우거나 프로젝트를 지운 뒤에도 파일은 저절로 줄지 않아요").
- 인덱싱 탭 「인덱스 재구축」이 **`clear_project_index` → `index_project`** 순으로 돈다. 그전엔 증분 색인(해시 게이트) 을 돌리면서 설명에는 "처음부터 다시" 라고 적혀 있었고, `clear_project_index` 커맨드는 프런트 호출처가 0이었다. 색인 오염(벤더 디렉터리·minified 청크) 은 규칙을 고쳐도 비우지 않으면 남으므로(플랜 D1) 이 버튼이 유일한 복구 경로다. 설명 문구를 "기존 색인을 비우고 처음부터 — 모든 파일을 다시 임베딩하므로 큰 프로젝트는 몇 분" 으로 바로잡았다.

## 동작 흐름

진단 탭 진입 → `db_health` → 버전 3칸 아래에 크기 3칸(파일·WAL·빈 공간) + 큰 표 목록 → 「압축」 → `db_compact`(몇 초, 그동안 DB 호출은 줄을 섬) → 새 크기로 갱신 + 토스트 "압축 완료 — 지금 {size}".
인덱싱 탭 「재구축」 → `clear_project_index`(FK CASCADE 로 chunks·embeddings·symbols 까지) → `index_project` 진행 채널 → 완료 토스트.

## 검증

- `health_reports_sizes_and_top_tables`(Rust): 새 DB 라도 `db_bytes > 0`, dbstat 상위 표 비어 있지 않고 내림차순, `compact` 가 빈 DB 에서도 에러 없음.
- 라이브 DB 사본: 031 적용 뒤 `free_bytes` 170.5MB 보고 → `compact` 0.79초 → 557.6MB → 381.8MB.
- `pnpm typecheck` · `pnpm test`(1450) · `pnpm lint` · `pnpm build` 전부 exit 0. 진단 탭을 그리는 a11y·영문 렌더 테스트는 옛 모양의 `dbHealth` 목(`top_tables` 없음) 을 주므로 `?? []` 로 방어했다.

## 메모

실기기 확인(설치본에서 진단 탭 → 압축) 은 앱이 꺼진 뒤 몰아서. 압축 중 다른 창의 DB 호출이 몇 초 기다리는 것은 의도된 동작이며 힌트에 적어 두었다.
