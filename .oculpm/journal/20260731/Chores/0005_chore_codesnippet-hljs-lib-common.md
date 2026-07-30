---
schema_version: 1
type: chore
slug: "codesnippet-hljs-lib-common"
status: done
difficulty: verylow
created_at: "2026-07-31T00:05:44+09:00"
session_id: "mcp-20260731-000544"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/search/CodeSnippet.tsx"
    op: update
related: []
tags:
  - "bundle"
  - "highlight.js"
  - "search"
  - "plugin-round"
  - "mcp-tool"
---
[x] 검색 CodeSnippet 의 hljs 풀빌드를 lib/common 으로 경량화 (808KB 청크 소멸)

플러그인 전략 라운드의 즉시 체크리스트 1건. 검색 결과 하이라이팅(`CodeSnippet.tsx`)만 `import("highlight.js")` 풀 빌드(전체 언어 등록, dist 808KB lazy 청크)를 쓰고 있었고, diff 의 `PatchView.tsx` 는 이미 `highlight.js/lib/common`(~90KB) 이었다. CodeSnippet 을 같은 경로로 통일 — lib/common 에 없는 언어(예: protobuf)는 기존 `getLanguage()` 가드가 `highlightAuto` 폴백으로 이미 처리하므로 동작 저하 없음.

같은 체크리스트의 나머지 1건(`cargo clean`, target 183.7GiB 회수)은 레포 무변경이라 plan-log 메모로만 기록.

## 검증

- 게이트 4종 그린: typecheck · lint · vitest 332 · build 5.9s.
- 빌드 산출물에서 808KB hljs 청크 소멸 확인 — 최대 청크가 typescript 포맷터 452KB 로 내려감.