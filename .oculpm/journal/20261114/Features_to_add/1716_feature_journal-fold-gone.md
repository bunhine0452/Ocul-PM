---
schema_version: 1
type: feature
slug: "journal-fold-gone"
status: done
difficulty: medium
created_at: "2026-11-14T17:16:33+09:00"
session_id: "20261114-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "b0484e51-1db3-430e-ae0e-a34545df4bb6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/journal_search/alive.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_search/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/commands/journal_search.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/features/oculpm/useGoneJournals.ts"
    op: create
  - path: "src/features/oculpm/JournalList.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261114/Features_to_add/1711_feature_search-alive-files.md"
    kind: "followup"
tags:
  - "일지-화면"
  - "journal"
  - "mcp-tool"
---
[x] 일지 화면: 사라진 코드의 일지를 접는다

## 추가 기능

일지 목록이 건드린 파일이 지금 프로젝트에 하나도 없는 일지를 그날 목록 끝의 「사라진 코드의 일지 N건」 한 줄로 접는다. 누르면 펴진다. 일지는 지우지 않는다.

접지 않는 경우 셋:
- 찾거나 거르는 중(검색어 · 종류 필터 · 「검증 없는 것만」). 그때 사람은 바로 그 일지를 찾는 중일 수 있다.
- 목록의 모든 일지가 그런 경우. 경로를 다른 폴더 기준으로 적은 저장소에서 날짜 머리만 남는 것을 막는다.
- 고른 일지가 접힌 쪽이면 그 줄은 펴 둔다.

## 동작 흐름

1. 새 명령 `oculpm_gone_journals(project_id)` 가 캐시의 `(일지 경로, 건드린 파일, op)` 전부를 읽어(본문은 읽지 않는다) `alive::gone_entries` 로 경로 목록을 낸다. 판정은 검색과 같은 `AliveCheck` 다.
2. `useGoneJournals` 가 그 집합을 들고, 일지가 바뀌면 다시 읽는다. 못 읽으면 빈 집합이라 접지 않을 뿐 숨기는 것은 없다.
3. `JournalList` 가 날마다 `<details>` 한 줄로 접는다. 계획 목록의 「끝난 계획」 과 같은 손잡이다.

## 검증

- `pnpm test` 1113 passed · `pnpm typecheck` · `pnpm lint` · `pnpm build` exit 0
- `cargo test --locked` 1163 passed · 0 failed · clippy · fmt exit 0
- 화면 테스트 넷(`journal_v2.test.tsx`): 접힌 줄의 건수와 내용 · 거르는 중에는 안 접음 · 고른 일지면 펴 둠 · 전부면 안 접음. 설치본에서 눈으로 보지는 않았다.

## 메모

- 처음 쓴 도움말 「접어 둡니다」 가 말투 게이트(`i18n_glossary` 해요체)에 걸렸다. 화면 문구는 해요체다.
- 일지 화면을 띄우는 테스트는 `oculpmApi` 를 통째로 목으로 바꾼다. 화면이 새 API 를 부르면 그 목에도 넣어야 한다 (`goneJournals`).
- 계획 쪽(닫을 수 있는 계획)은 하지 않았다. 앱에도 MCP 에도 계획을 닫는 동작이 없다 (`planner/lifecycle.rs` 머리말: 4.0 에서 「완료 · 잠금」 토글을 걷었다). 한 줄만 세워 봐야 누를 것이 없다.