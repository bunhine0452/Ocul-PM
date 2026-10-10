---
schema_version: 1
type: bug
slug: "index-duplicate-chunks-low-value"
status: done
difficulty: high
created_at: "2026-10-11T00:00:36+09:00"
session_id: "mcp-20261011-000036"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/indexer/low_value.rs"
    op: create
  - path: "src-tauri/src/indexer/store.rs"
    op: create
  - path: "src-tauri/src/indexer/store_tests.rs"
    op: create
  - path: "src-tauri/src/db/chunk_store.rs"
    op: create
  - path: "src-tauri/migrations/041_purge_duplicate_chunks.sql"
    op: create
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/src/db/code_index.rs"
    op: update
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/commands/project/reconcile.rs"
    op: update
  - path: "src-tauri/src/journal_index.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
related:
  - ref: "20261008/Bugs/1906_bug_index-boot-reconcile-secret-files.md"
    kind: "followup"
  - ref: "20261008/Chores/1830_chore_perf-security-audit.md"
    kind: "followup"
tags:
  - "indexing"
  - "performance"
  - "embedding"
  - "mcp-tool"
---
[x] 색인 사본 17.8% 는 워처 증분의 덧붙이기 버그였다 — 사본·데이터 파일 걷기, 같은 내용은 재임베딩 안 함

## 발생 원인
- 감사의 「내용 같은 사본 23,284(17.8%)」 대부분은 같은 파일 · 같은 범위 · 같은 내용의 사본이었다. 설치본 DB 사본에서 청크 112,027 중 19,987, 심볼 39,999 중 7,595 였다. 하루에 천 행 넘게 늘고 있었다(10/08 3,811 · 10/09 1,832 · 10/10 1,358).
- 원인은 `indexer::reindex_single_file`(워처 증분)이 `upsert_file` 의 `changed=false` 를 무시하고 청크와 심볼을 또 넣은 것이다. 같은 파일의 증분 둘이 겹치면(퍼밋 2 · 해시 없는 이벤트) 뒤의 것이 옛 행을 지우지 않고 덧붙였다.
- .tsv · 평가 결과 JSON · 사전 덤프 .txt 와 vendor/ · .dart_tool/ 이 걸러지지 않았다.
- 저장할 때마다 파일 전체를 다시 임베딩했다.
- 합류 중에 하나 더 찾았다. 워처의 경로 판정(`is_indexable_path`)이 절대 경로의 모든 구성 요소를 차단 목록과 대조했다. 그래서 루트가 `~/.cache/…` · `…/target/…` 아래인 프로젝트는 증분 색인이 통째로 꺼져 있었다. vendor 를 더하면서 그 범위가 넓어질 참이었다.

## 해결 방법
- 해시가 그대로면 `reindex_single_file` 이 바로 끝난다. 세 경로(전체 · 워처 · 일지)의 임베딩 고리를 `indexer::store::store_file_chunks` 하나로 모았다. 교체는 `files.hash` CAS 와 함께 한 트랜잭션에서 한다(`db::chunk_store::replace_file_chunks`).
- 041 마이그레이션이 쌓인 사본을 걷는다. 묶음마다 id 가 가장 작은 행만 남는다. 벡터는 트리거가, graph_nodes 는 CASCADE 가 함께 지운다. 파괴적 마이그레이션이라 기동 때 `.bak-v40` 이 한 번 생긴다.
- `indexer::low_value` 의 판정은 경로와 크기만 보므로 걷기 · 워처 · 기동 화해가 같은 답을 낸다.
  - 크기와 무관하게 제외: .csv · .tsv · .jsonl · .ndjson · .flist · .log
  - 8KB 를 넘을 때만 제외: .json · .txt. 이 저장소의 설정 JSON 은 전부 4KB 미만이고, 실측에서 8KB 를 넘는 116편은 전부 데이터였다.
  - 크기와 무관하게 지키는 이름: package.json · tsconfig* · *.config.json · README · LICENSE 등
  - `DENY_DIR_NAMES` 에 vendor · .dart_tool 을 더했다.
  - 기동 화해가 같은 stat 으로 이미 든 데이터 파일도 걷는다.
- 이 파일의 지금 청크와 내용이 같은(files.hash) 다른 파일 하나에서, 문자열이 완전히 같은 청크의 벡터를 복사해 재사용한다. 공유하면 vec0 파티션과 KNN 의 k 가 흔들리므로 복사한다.
- 워처 판정은 `is_indexable_path(root, rel, cfg)` 로 바꿔 루트 아래만 보게 했다(내가 합류하며 고침).
- 병렬 레인(Opus 5.5)이 구현했다. PR #83.

## 검증
- 설치본 DB 사본(원본 무접촉)에서 청크가 112,027 → 92,040(041) → 82,112(새 규칙의 화해)가 됐다. 합계 −26.7%, 본문은 109.9 → 82.7MB 다.
  - 전체 색인 때 통째 사본 10,792 청크(13.1%)는 모델을 부르지 않는다.
  - 커밋 400개를 재생해 보니 저장 시 새 청크의 64.4% 가 옛 청크와 같았다.
- 새 시험 통과: 바뀐 청크만 임베딩, 사본은 0회, CAS, 041, 판정 일치, 루트 조상 3종. cargo test --no-fail-fast 실패 0.
- 설치본에서 041 시간 · 백업, 화해 로그, 실제 재사용률(`chunks_embedded` 로그 필드)은 다음 릴리스 뒤에 본다.