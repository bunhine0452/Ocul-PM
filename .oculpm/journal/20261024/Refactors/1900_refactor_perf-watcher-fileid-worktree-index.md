---
schema_version: 1
type: refactor
slug: "perf-watcher-fileid-worktree-index"
status: done
difficulty: high
created_at: "2026-10-24T19:00:16+09:00"
session_id: "20261024-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/watcher/file_id_cache.rs"
    op: create
  - path: "src-tauri/src/indexer/worktree.rs"
    op: create
  - path: "docs/optimization/00-ledger.md"
    op: update
related: []
tags:
  - "perf"
  - "watcher"
  - "indexer"
  - "parallel-round"
  - "mcp-tool"
---
[x] 감시 파일 id 캐시 구간 탐색 + 프로젝트 안 git worktree 사본 색인 제외 (실측)

## 동기

설치본 실측(4일 19시간, CPU 누계 565분): `sample` 10초의 바쁜 스레드가 FSEvents 콜백 → notify-debouncer-full `FileIdMap::remove_path` 의 `retain(starts_with)`. project_naeri 워처 handle_max 13.7초, 감독관이 두 번 끊음. DB 사본(836MB) 대조: 청크의 18.3% 가 살아 있는 worktree 사본, 33.8% 가 지운 worktree 유령.

## 변경 요약

- `OrderedFileIdCache`(BTreeMap) — 자손 구간만 걷는다. 같은 넣기·빼기 순서에 FileIdMap 과 같은 답을 내는지 대조 테스트(`c1`/`c10`, `src`/`src-old`). 캐시 3만·Remove 3천: 16,106ms → 8.1ms (디버그).
- `.git` 파일이 `…/worktrees/<이름>` 을 가리키는 폴더 = worktree → 걷기·증분 색인·기동 화해·로컬 히스토리에서 제외(서브모듈·중첩 저장소는 유지). 화해가 지우는 양 13,026행 → 18,555행.
- 재 봤지만 안 바꾼 것: 임베더 로드/언로드(하루 3초), 진입 청크, 일지 질의, 기동 경로.

## 검증

- 레인 게이트 전부 + 합류 게이트(PR #90). 미해결: 라이브 풋프린트 Malloc Small 511MB 원인, 이미 쌓인 worktree 히스토리 판 236MB 정리.