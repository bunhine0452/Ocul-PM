---
schema_version: 1
type: feature
slug: "index-usage-and-source-marker-tag"
status: done
difficulty: medium
created_at: "2026-09-21T19:13:21+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Sonnet 5 (구현 세션 D)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/index_usage.rs"
    op: create
  - path: "src/api/indexUsage.ts"
    op: create
  - path: "src/features/settings/tabs/IndexUsageSection.tsx"
    op: create
  - path: "src/features/oculpm/sourceMarkerTags.ts"
    op: create
  - path: "src-tauri/src/oculpm/skill_promotion_tests.rs"
    op: create
  - path: "src/__tests__/index_usage_section.test.tsx"
    op: create
  - path: "src/__tests__/journal_tag_source_marker.test.tsx"
    op: create
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/skill_promotion.rs"
    op: update
  - path: "src/features/settings/tabs/DiagnosticsTab.tsx"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/EntryMasthead.tsx"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
related: []
tags:
  - "journal-scale"
  - "settings"
  - "index"
  - "tags"
  - "mcp-tool"
---
[x] 인덱스 디스크 사용량·diff 정리 + mcp-tool 태그를 통계·칩에서 출처 표식으로 분리

## 추가 기능

플랜 `journal-scale-round` {#index-usage} {#tag-source-marker}. 병렬 워크트리 세션 D(Sonnet 5) 구현, 감독자 합류. PR #26.

### 인덱스 사용량
근거: 일지 원본 4MB 에 `.oculpm/index/` 330MB(history 280MB·diffs 39MB) — 사용자에게 안 보였다.
- `oculpm_index_usage(project_id)` → {history_bytes/files, diffs_bytes/files, other_bytes, total_bytes}(f64, DbHealth 관례). `spawn_blocking` 안에서 walk, 심링크는 `symlink_metadata` 로 걸러 크기에 안 넣음. `history::history_root()` 재사용, diffs 경로는 `entry_diffs.rs` 가 래칫에 걸려 직접 구성.
- `oculpm_index_clear_diffs(project_id)`: `index/diffs/` 삭제. `read_or_reconstruct_entry_diffs` 가 git 재구성 폴백을 가지므로 안전 — UI 문구에 담음.
- 설정 → 진단, DB 섹션 아래 `IndexUsageSection`: 세 갈래 + 합계, 「diff 정리」는 `useConfirm` → 실행 → 재조회, 로컬 히스토리 정리는 `openSettings("code")` 안내. i18n 키는 `settings.idxUsage.*` — 처음 `settings.index.*` 로 지었다가 `IndexingTab` 이 같은 접두를 써 `title`/`desc` 가 조용히 덮일 뻔한 걸 esbuild dup-key 경고로 잡았다.

### mcp-tool 출처 표식
근거: MCP `journal_write` 가 붙이는 `mcp-tool` 이 727건 중 431건 — 가장 큰 "태그" 인데 의미가 없다. frontmatter 스키마·`journal_write` 는 무변경(계약).
- `SOURCE_MARKER_TAGS: &[&str] = &["mcp-tool"]` 을 `spec.rs` 에. 실제 태그 집계 소비처는 `cache/stats.rs` 가 아니라 `skill_promotion.rs::is_stoplisted`(반복 tag → 스킬 후보 클러스터링) 였다 — 이 표본에서는 mcp-tool 이 항상 1위 클러스터가 돼 실제 절차 후보를 상한 밖으로 밀어냈다는 것을 테스트로 확인.
- 프런트 `sourceMarkerTags.ts`(백엔드 상수와 짝 명시) → `JournalRow`·`EntryMasthead` 태그 칩에서 `visibleTags()`. `SourceBadge`("mcp") 는 이미 있어 그대로.
- `skill_promotion.rs` 가 815줄로 래칫 초과라 테스트 모듈 330줄을 `skill_promotion_tests.rs` 로 순수 이동(507줄).

## 검증

Rust 단위 3(usage) + 1(클러스터 제외) · vitest 2(usage 표시·정리 흐름) + 3(칩 필터). 통합 브랜치 전 게이트 exit 0.