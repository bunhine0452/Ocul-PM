---
schema_version: 1
type: feature
slug: "search-screen-journal-scope"
status: done
difficulty: medium
created_at: "2026-09-21T23:35:50+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Fable 5.1 (감독) / Sonnet 5 (구현 세션 U)"
  session: "90a6ae8d-a58d-4177-a11b-44f0b573394f"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/search/JournalScopeResults.tsx"
    op: create
  - path: "src/__tests__/journal_scope_results.test.tsx"
    op: create
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "journal-scale"
  - "search"
  - "ui"
  - "mcp-tool"
---
[x] 검색 화면에 「일지」 스코프 — 사람도 727건을 관련도순으로 찾는다

## 추가 기능

플랜 `journal-scale-round` {#search-scope-ui}. 2차 웨이브 세션 U(Sonnet 5) 구현, 감독자 합류. PR #27.

근거: 검색 화면 스코프가 의미·심볼·텍스트 셋뿐이라 사람은 일지를 검색할 화면이 없었다. 1차 웨이브가 만든 `oculpm_search_journal`(캐시 기반·관련도 랭킹)에 프런트 호출자가 없었다.

- `oculpmApi.searchJournal` 파사드 추가. 4번째 스코프 `journal`(`NotebookText`, navRegistry 의 일지 아이콘과 통일). `noIndex`/`indexing` 게이트는 일지 스코프를 건너뜀 — 코드 색인과 무관한 SQLite 일지 캐시라서.
- `JournalScopeResults`(99줄, 새 CSS 0줄): 타입 배지(`TriggerBadge` 재사용)·제목/스니펫 매치 하이라이트·워크데이, 헤더 「N건 중 M건」(`total_matched`), 「더 보기」 20→50→100 계단. 행은 `<button className="sresult-symrow">` 라 클릭·Enter 둘 다.
- 열기: `ShellV2` 에 `onOpenJournal` 배선 — 플래너의 것과 동형(`setJournalReturnView("search")` → `setJournalOpenEntry` → `setUiV2View("journal")`). `SearchScope` 유니언에 `"journal"` 한 줄로 영속은 기존 WorkspaceContext 경로 그대로.
- 지시서의 「에이전트」 열은 백엔드 `JournalSearchHit` 에 그 필드가 없어 지어내지 않고 뺐다(커맨드 무변경 우선). ↑/↓ 는 다른 세 스코프에도 없어 추가하지 않음.

## 검증

vitest 2(헤더·행 렌더 / 클릭 콜백·더 보기 노출). `SearchScreenV2.tsx` 793줄(한계 800). 통합 브랜치 전 게이트 exit 0. 실기기 육안 미실시.