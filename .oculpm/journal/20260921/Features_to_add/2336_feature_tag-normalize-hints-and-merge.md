---
schema_version: 1
type: feature
slug: "tag-normalize-hints-and-merge"
status: done
difficulty: high
created_at: "2026-09-21T23:36:11+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Opus 5 (구현 세션 T)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/tags.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tags.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/tags.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/tags.rs"
    op: create
  - path: "src-tauri/src/commands/tags.rs"
    op: create
  - path: "src/features/oculpm/TagTidySheet.tsx"
    op: create
  - path: "src/__tests__/tag_tidy_sheet.test.tsx"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
related: []
tags:
  - "journal-scale"
  - "tags"
  - "mcp"
  - "journal-screen"
  - "mcp-tool"
---
[x] 태그 정규화 힌트 + 「태그 정리」 병합 시트 — 806종 중 437종 1회용 어휘를 접는다

## 추가 기능

플랜 `journal-scale-round` {#tag-normalize} {#tag-merge}. 2차 웨이브 세션 T(Opus 5) 구현, 감독자 합류. PR #27.

근거: 727건에 태그 806종, 437종이 1회용. 에이전트가 매번 새 어휘를 만들어 태그 필터가 죽었다.

- **정규화는 적용, 유사 태그는 제안만.** 몰래 치환하면 에이전트는 자기 일지에 뭐가 적혔는지 모른 채 다음에 또 같은 말을 쓴다 — 고칠 것은 한 건이 아니라 어휘라 `tag_hints: [{given, suggest, reason}]` 로 응답에만(`auto_related` 와 같은 원칙).
- 정규화 순서: 공백/밑줄→하이픈 → 소문자 → 앞뒤 구두점 제거 → 연속 하이픈 접기(구두점을 먼저 털면 `c++` 꼬리가 사라진 뒤 공백 치환이 할 일이 없어진다). 한글은 그대로.
- 유사 판정 확신 순: 단복수 → Levenshtein 1(`TYPO_MIN_LEN=5`, `ui`↔`ux` 는 한 글자 차이가 곧 다른 뜻; 자리바꿈은 거리 2 라 안 잡음) → 접두 분리(긴 접두부터).
- 사전: 빈도 ≥3, 300개 상한, 빈도 내림차순·동점 사전순. MCP 출처 두 길 — 읽기전용 캐시(`journal_search::cache::open_for_root`) → 실패 시 최신 300건 디스크 walk. 실패는 무해(힌트 0건).
- **병합 후보는 캐시가 고르고 쓰기는 디스크.** SQL `GROUP BY tag` 를 안 쓴 이유: SQLite `lower()` 는 ASCII 전용이라 `bug_fix`↔`bug-fix` 를 못 접는다. `oculpm_tag_stats`/`oculpm_tag_merge` — `entry_write_guard` 안에서 frontmatter 만 갈고 본문 바이트 불변, 실패는 기계 토큰 사유로 건너뜀, 멱등. `SOURCE_MARKER_TAGS` 는 거절.
- 일지 화면 「태그 정리」 시트: 빈도순 목록·「1회」 칩·유사 그룹 제안(`suggest_into`)·체크 후 병합.
- `mcp/tools/mod.rs` 804→799줄(태그 처리 13줄을 새 모듈로).

## 검증

Rust 단위 9(정규화·유사) + manager 4 + MCP 4 · vitest 2. 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시. 캐시 지연 한계(앱 꺼진 동안 손으로 쓴 일지는 워처가 따라잡은 뒤 잡힘)는 모듈 doc 에.