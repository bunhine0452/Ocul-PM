---
schema_version: 1
type: refactor
slug: "embedder-idle-unload-malloc-cache"
status: done
difficulty: high
created_at: "2026-09-12T22:32:11+09:00"
session_id: "20260912-007"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "d836ae84-44c9-4a22-9d80-9fa0eb4eb5fd"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/embedding.rs"
    op: update
  - path: "src-tauri/src/ptyhost/env.rs"
    op: create
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host/mod.rs"
    op: update
  - path: "src-tauri/tests/perf_baseline.rs"
    op: update
  - path: "docs/optimization/00-ledger.md"
    op: update
related:
  - ref: "20260912/Refactors/2117_refactor_optimization-round-measured.md"
    kind: "followup"
tags:
  - "performance"
  - "memory"
  - "embedding"
  - "malloc"
  - "watcher"
  - "mcp-tool"
---
[x] 임베더 640MB 의 정체는 macOS malloc 대형 캐시 — MallocLargeCache=0 재실행 + 유휴 언로드, 추정 2건 기각

## 동기

앞 일지가 이월한 `{#embed-unload}` — 세션을 drop 해도 남는 ~640MB 의 정체, 그리고 추정 2건(`chunks-content-dup`·`fileidmap-growth`)의 측정.

## 변경 요약

**정체 = macOS libmalloc 의 대형 블록 캐시.** perf_baseline M6b 에서 세션 로드 직후 `vmmap` 전체를 보니 풋프린트 602MB 중 살아 있는 malloc 은 234MB(모델 파일 224MB 와 일치)이고 **`MALLOC_LARGE (empty)` 323MB** 가 free 된 뒤에도 dirty 로 남아 있었다 — 모델 proto 파싱 임시본이 지나간 자리. `malloc_zone_pressure_relief` 는 all-zones·default-zone 모두 0 바이트를 돌려줬고, ORT 세션 옵션(prepacking off · `use_device_allocator_for_initializers` · memory pattern off · intra threads 1 · `commit_from_memory`)은 전부 602MB 로 무관. **`MallocLargeCache=0`** 이면 로드 237MB · drop 뒤 12MB.

| M6 (256/8) | 캐시 켬 | `MallocLargeCache=0` |
|---|---|---|
| 임베딩 뒤 | 936M | 806M (2차 504M) |
| drop 뒤 | 645M | **38M** |
| 속도 | 12.7 ms/청크 | 13.7 (−8%) |

- `main.rs` `reexec_with_malloc_tuning`: GUI 경로만 그 env 로 자기 자신을 `exec`. malloc 초기화 때만 읽히는 변수라 프로세스 안에서 켤 방법이 없다. 심·CLI 는 매 훅 호출에 exec 를 얹지 않게 제외(이미 위에서 갈라진다). exec 실패는 로그 한 줄 뒤 그대로 진행.
- `ptyhost/env.rs` `shell_command`: 호스트가 사용자 셸을 띄울 때 `OCULPM_MALLOC_TUNED` 표식이 있으면 두 변수를 걷는다 — 사용자 프로그램의 malloc 까지 바꿀 이유는 없다. 표식 없이 직접 건 값은 존중 (테스트 1).
- `embedding.rs`: 5분 유휴 언로드 복원(1분 스윕, 회전문 퍼밋이 없으면 = 추론 중이면 건너뜀). 캐시가 꺼진 뒤라 실제로 돌아온다 — 재로드 247MB / 세션 빌드 ~100ms.

**기각 2건** (원장 §3): `chunks.content` 디스크 재읽기 — 텍스트 검색 `search_text` 가 바로 그 열의 LIKE 풀스캔이라 열을 빼면 검색이 없어진다. `FileIdMap` 성장 — M7(신규): 파일 20,000 Create 에 NoCache 대비 **+3.8MB**(엔트리 ~190B), `target/` 55k 가 전부 쌓여도 10MB.

## 판단이 갈린 자리

- 첫 측정에서 "유휴 언로드는 해롭다"고 결론 낸 것이 **원인을 잘못 짚은 채** 맞은 결론이었다. drop 뒤 647→786 으로 자란 것도 malloc 캐시의 조각화였다. 원장 §1.4 에 후속으로 정정.
- `ptyhost/host/mod.rs` 가 800줄 래칫이라 `CommandBuilder::new` 자리를 `super::env::shell_command` 로 바꿔 줄 수를 그대로 뒀다.

## 검증

- `cargo test` 전부 통과(신규 `ptyhost::env::scrubs_only_under_the_marker`), clippy 0, fmt clean. `pnpm typecheck`·`lint`·`build` exit 0 (프런트 무변경).
- M6/M6b/M7 은 `#[ignore]` 측정 — 재현 명령은 원장 §1.4·§3. **exec 재실행은 설치본에서 `ps eww <pid> | grep MallocLargeCache` 로 확인해야 한다** → `{#eyes-compact}` 에 합침.