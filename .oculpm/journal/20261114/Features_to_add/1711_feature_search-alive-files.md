---
schema_version: 1
type: feature
slug: "search-alive-files"
status: done
difficulty: medium
created_at: "2026-11-14T17:11:32+09:00"
session_id: "20261114-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "b0484e51-1db3-430e-ae0e-a34545df4bb6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/journal_search/alive.rs"
    op: create
  - path: "src-tauri/src/oculpm/journal_search/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_search/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_search/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/search.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/search_alive.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/tests/search.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/mod.rs"
    op: update
  - path: "src-tauri/src/commands/journal_search.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/stale.rs"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20260921/Features_to_add/1912_feature_journal-search-cache-rank.md"
    kind: "followup"
tags:
  - "일지-검색"
  - "mcp"
  - "journal-search"
  - "mcp-tool"
---
[x] 일지 검색: 사라진 코드의 일지를 뒤로 보낸다

## 추가 기능

일지는 지우지 않아서 쌓인다. 이 저장소 실측(1,030건): 건드린 파일이 하나도 남지 않은 일지 86건, 절반 이상 사라진 것까지 치면 424건(41%). 그런 일지가 지금 코드의 일지와 같은 얼굴로 검색에 섞였다.

- `journal_search` 결과에 `files` 칸이 생겼다. 그 일지가 건드린 파일 중 지금 프로젝트에 남은 수/전체(`2/5`), 셀 파일이 없으면 `-`.
- 하나도 남지 않은 일지(`0/N`)는 뒤로 간다. 두 무리 안의 순서는 랭킹 그대로다. 모든 결과가 그런 일지면 순서를 건드리지 않는다.
- 뒤로 보낸 수는 응답의 `gone_last` 와 `note` 가 말한다. 조용히 순서를 바꾸지 않는다.
- 앱의 일지 검색(`oculpm_search_journal`)도 같은 함수(`alive::gone_last`)를 불러 같은 순서다.

## 동작 흐름

1. 두 경로(캐시 · 디스크)가 일지마다 `files_dropped`(op 이 delete · rename 인 경로)를 함께 모은다. 캐시는 `oculpm_journal_files.op` 에서, 디스크는 frontmatter 에서.
2. `rank` 뒤에 `alive::gone_last(root, scored)` 가 일지마다 남은 파일을 센다. 프로젝트 밖 · `.oculpm/` 안 · 지우거나 옮긴 파일은 셈에서 뺀다. 윈도우 일지의 `\` 는 편다. 같은 경로는 검색 한 번에 한 번만 묻는다.
3. 판정은 파일이 있는가 하나다. LLM 0 · git 실행 0.

## 검증

- `cargo test --locked` 1162 passed · 0 failed · `cargo clippy --all-targets --locked -- -D warnings` exit 0 · `cargo fmt --check` exit 0
- `pnpm typecheck` · `pnpm test`(1109 passed) · `pnpm lint` · `pnpm build` exit 0
- 새로 빌드한 `oculpm-mcp` 로 이 저장소를 실제로 검색(`터미널 한글`): 45건 중 1건이 뒤로 갔고 `files` 칸이 `3/4` · `2/7` 처럼 실렸다. 캐시 경로 28~31ms(디버그 빌드, 1,030건).

## 메모

- 「이후 같은 파일을 건드린 일지 수」도 붙이려 했지만 뺐다. 이 저장소에서 재 보니 중앙값 49건(25% 12 · 75% 136)이었다. `lib.rs` 같은 허브 파일 탓에 거의 모든 일지에 큰 수가 붙어 아무것도 가르지 못한다. 2026-11-14 기준 숫자이고, 허브 파일을 빼고 세면 달라질 수 있다.
- 「없다」는 거친 판정이다. 이름만 바꾼 파일도 없는 것으로 센다. 그래서 뒤로 보내는 근거로만 쓰고 지우는 근거로는 쓰지 않는다.
- 기존 테스트는 열 수 단언 하나(6 → 7)만 고쳤다. 새 테스트는 파일 크기 게이트 때문에 `search_alive.rs` 로 따로 뒀다.
- 랜딩의 플러그인 문서(`landing/plugin.html`)의 `journal_search` 줄은 릴리스 때 맞춘다.