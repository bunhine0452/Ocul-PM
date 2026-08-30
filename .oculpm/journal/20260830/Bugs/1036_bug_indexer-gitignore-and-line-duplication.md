---
schema_version: 1
type: bug
slug: indexer-gitignore-and-line-duplication
status: done
created_at: 2026-08-30T10:36:00+09:00
session_id: "manual-20260830-103600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/indexer.rs
    op: update
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src-tauri/src/commands/diff.rs
    op: update
  - path: src-tauri/migrations/031_purge_index_noise.sql
    op: create
  - path: src-tauri/src/db/mod.rs
    op: update
related:
  - .oculpm/journal/20260830/Chores/1036_chore_retire-trigram-fts.md
  - .oculpm/journal/20260830/Features_to_add/1036_feature_db-size-compact-and-true-rebuild.md
tags: [indexer, sqlite, scale, audit-round]
---

[x] 색인이 `.gitignore` 를 무시하고 minified 파일 한 줄을 503번 복제해 앱 DB 를 558MB 로 키웠다

## 발생 원인

전영역 감사에서 라이브 DB(`ocul-pm.db` 558MB + WAL 80MB) 를 `dbstat` 으로 열어 보니 `chunks` 205MB · 벡터 263MB · `file_snapshots` 63MB 였고, 그중 프로젝트 하나(`1dev/project02`)가 청크 21,271개 118MB 를 차지했다. 상위 파일이 전부 `node_modules/…` 였고 1위가 `node_modules/pixi.js/transcoders/ktx/libktx.js` **하나로 103.6MB(청크 503개)** 였다. 원인은 둘이었다.

1. **`.gitignore` 가 무시됐다.** `indexer.rs walk_text_files` 는 `ignore::WalkBuilder::standard_filters(true)` 만 켰는데, ignore 크레이트(0.4.25)는 기본값 `require_git(true)` — **git 저장소 안에서만** `.gitignore` 를 적용한다. 그 프로젝트는 `.gitignore` 에 `node_modules` 가 있었지만 `git init` 을 안 한 상태였다. `commands/code.rs` 의 트리 테스트는 이 사실을 알고 테스트 안에서 `.git` 폴더를 만들어 우회하고 있었고, 워처(`load_project_gitignore`)는 파일을 직접 읽어 git 유무와 무관하게 적용하므로 걷기와 워처의 의미가 갈라져 있었다.
2. **AST 청커가 줄을 복제했다.** `libktx.js` 는 22줄에 최장 줄이 216KB 인 emscripten 산출물이다. `chunk_file` 은 심볼마다 `lines[start..end]` 를 본문으로 잡으므로, 한 줄에 심볼 503개가 있으면 그 216KB 줄이 503번 저장된다(그리고 503번 임베딩된다 — 모델은 앞 512 토큰만 보니 전부 같은 벡터다). 500KB 파일 크기 상한은 216KB 파일을 막지 못했고, 청크 바이트 상한은 없었다.

두 결함 모두 **해시 게이트 때문에 스스로 낫지 않는다** — 규칙을 고쳐도 이미 들어간 `files` 행은 재평가되지 않는다. 그리고 색인을 비우는 `clear_project_index` 커맨드는 프런트 호출처가 0이었다(별도 일지).

## 해결 방법

- `walk_text_files`: `require_git(false)` + `DENY_DIR_NAMES`(node_modules · target · .venv · __pycache__ · Pods · DerivedData 등 21종) 를 `filter_entry` 로 항상 거른다. `.gitignore` 조차 없는 프로젝트를 위한 마지막 그물이다. `dist`·`build`·`out` 은 소스 폴더로 쓰는 프로젝트가 있어 일부러 뺐다. 워처가 쓰는 `is_indexable_path` 도 같은 목록으로 경로 구성 요소를 검사한다.
- 새 `is_indexable_content`: 한 줄이 `MAX_LINE_BYTES`(4KB) 를 넘는 파일은 minified/생성 파일로 보고 **파일 전체를** 건너뛴다(긴 줄만 빼면 줄 범위 의미가 깨진다). `index_project` 는 행을 남기지 않고 `continue`, `reindex_single_file` 은 새 `ReindexSkipReason::Generated` 를 돌려준다.
- `chunk_file`: 같은 `(start_line, end_line)` 범위의 심볼은 한 번만 청크가 된다(`HashSet`). 심볼 본문이 `MAX_CHUNK_BYTES`(16KB) 를 넘으면 하나의 청크 대신 줄 창으로 쪼개되 `// AST Symbol:` 머리줄은 각 창에 남긴다. `last_covered_line` 을 `max` 로 전진시켜 중첩 심볼 뒤 범위가 gap 청크로 다시 들어가지 않게 했다.
- `chunk_lines_with_offset`: 창의 바이트 합이 상한을 넘으면 줄 수를 줄여 맞추고(최소 1줄), 다음 창의 시작은 **실제 창 크기 − 겹침** 으로 계산해 줄을 건너뛰지 않는다.
- 마이그레이션 `031_purge_index_noise.sql`: 청크가 64KB 를 넘는 파일(병리적 행만 — 16~64KB 의 정상 거대 심볼은 다음 변경 때 워처가 다시 쪼갠다)과 벤더 디렉터리 경로의 `files`·`file_snapshots` 행을 지운다. `files` 삭제는 FK CASCADE + `chunks_after_delete` 트리거로 chunks·embeddings·symbols 까지 내려간다(`foreign_keys` 는 open 에서 마이그레이션 전에 ON).

## 검증

- 새 테스트 7종: `.git` 없이도 `.gitignore` 적용 · `.gitignore` 없이도 벤더 디렉터리 거부(워처 경로 판정 포함) · 한 줄 심볼 40개 → 청크 1개 · 3,000줄 함수가 16KB 창으로 쪼개지며 마지막 줄까지 덮음 · 30줄×1KB 가 여러 창으로 나뉘되 줄을 안 건너뜀 · minified 판정. `cargo test` 864 + 통합 전부 그린.
- 라이브 DB **사본**에 앱 경로(sqlite-vec 로드·FK ON) 로 031 을 적용: 5.1초, 청크 70,651→49,523(177.5MB→57.6MB), 파일 6,138→3,495, `chunk_embeddings` 도 49,523 으로 동기, 스냅샷 6,273→3,638. `compact` 뒤 파일 557.6MB→381.8MB. (sqlite3 CLI 로는 vec0 모듈이 없어 cascade 를 재현할 수 없다 — 반드시 앱 경로로 잴 것.)

## 메모

- 남는 382MB 의 236MB 는 벡터 자체(49.5K × ~4.8KB) — 다음 후보는 임베딩 양자화/차원 축소이지 색인 규칙이 아니다.
- 벤더 디렉터리 하드코딩은 `commands/code.rs` 트리 걷기와 `acp.rs` 에도 같은 `require_git` 문제가 있다(트리는 상한으로 잘릴 뿐 오염은 안 됨) — 이 라운드에선 색인만 고쳤다.
