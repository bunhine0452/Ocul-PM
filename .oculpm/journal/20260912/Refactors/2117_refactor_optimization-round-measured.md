---
schema_version: 1
type: refactor
slug: "optimization-round-measured"
status: done
difficulty: high
created_at: "2026-09-12T21:17:35+09:00"
session_id: "20260912-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "d836ae84-44c9-4a22-9d80-9fa0eb4eb5fd"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/embedding.rs"
    op: update
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/db/code_index.rs"
    op: update
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/db/tests.rs"
    op: update
  - path: "src-tauri/src/git/nesting.rs"
    op: update
  - path: "src-tauri/tests/perf_baseline.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src/features/terminal/imeTrace.ts"
    op: update
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "src/__tests__/ime_trace.test.ts"
    op: update
  - path: "docs/optimization/00-ledger.md"
    op: update
related: []
tags:
  - "performance"
  - "memory"
  - "sqlite"
  - "embedding"
  - "ime"
  - "ledger"
  - "mcp-tool"
---
[x] 최적화 라운드 — 실측이 낸 확정 3건: 임베딩 아레나·vec0 구멍+스냅샷 복사본·IME 덤프

## 동기

"최적화할 것을 찾아 달라" 는 요청. 코드만 읽는 감사는 지난 라운드들이 소진해 둔 상태라(번들·폴링·프라그마·인덱스·프로필 전부 정상, 원장 §2.1·§2.2 도 이미 고쳐져 있었다) **실행 중 프로세스(`vmmap`)·라이브 DB 사본(`dbstat`)·12일치 로그 집계** 로 쟀다. 원장 규칙대로 측정된 것만 올리고, 측정이 반대로 나온 설계(유휴 언로드)는 넣지 않았다.

## 변경 요약

**1. 임베딩 아레나 (`{#ort-arena}`)** — 메인 프로세스 RSS 1,887MB 중 MALLOC_LARGE 1.5GB 가 4M→8M→…→128M×9 로 2배씩 자란 ORT 아레나였다. fastembed 기본 `max_length` 512 → `MAX_TOKENS` 256, `EMBED_BATCH` 32 → 8. perf_baseline **M6**(신규): 2KB 청크 256개 임베딩 뒤 풋프린트 **2.2G → 940M**, 속도 **27.5 → 11.1 ms/청크**. 유휴 언로드는 구현했다가 뺐다 — drop 이 아레나 300M 만 돌려주고(940→647) 모델 로드 ~640M 은 남으며 재로드마다 +140M 이 더 남았다(647→786). 근거 없이는 안 켠다 → 플랜 `{#embed-unload}`.

**2. DB 553MB (`{#vec0-holes}` `{#snapshot-git-dup}`)** — vec0 슬롯 189,440 중 살아 있는 벡터 101,120(53%); sqlite-vec 는 통째로 빈 블록만 버린다. `file_snapshots` 100MB 는 `diff.rs` 가 `git show HEAD:` 실패 때만 읽는 폴백인데 색인이 모든 파일을 찍어 81MB 가 git 복사본, 고아 1,000행 12MB. `freelist_count=1` 이라 기존 「정리」(VACUUM) 는 0 바이트. 고침: `Db::compact()` 가 vec0 를 살아 있는 행으로 재구축(032 방식) + VACUUM 뒤 WAL 재절단(VACUUM 이 WAL 모드에서 새 DB 전체를 WAL 에 쓰는 것을 사본에서 봤다 — 458MB); 전체 색인은 `git::nesting::HeadIndex`(저장소당 `ls-tree` 1회)로 HEAD 에 있는 파일의 스냅샷을 건너뛰고 끝에 `retain_file_snapshots` 로 필요 목록 밖(HEAD 복사본·고아)을 한 트랜잭션으로 삭제; 단일 파일 재색인은 `path_in_head` → `sync_file_snapshot`. **M5**(신규, 라이브 사본): 553MB(+WAL 64) → **434MB, 4.8초**, vec0 블록 185 → 107.

**3. IME 자동 덤프 (`{#ime-dump-budget}`)** — `post-commit-passthrough` 판정이 정상 한글 타이핑에서 분당 1회꼴로 걸려 12일간 5,500회 덤프(하루 최대 1,264회, 매일 로그의 85~90%, ~50MB). 타이핑 도중 5~20KB 직렬화 + IPC — 모듈 머리말이 경고한 "진단이 관측을 바꾼다" 가 상시였다. `dumpImeTraceAuto`: 처음 3회 그대로, 이후 10분 1회, 억제 횟수를 다음 덤프 머리에 `(+N suppressed)`. 수동 ⌃⌥⇧I 는 예산 밖.

원장 `docs/optimization/00-ledger.md` 에 §1.4~1.6·§2.4~2.5·기각 4행·잔고 표 갱신, §2.1/§2.2 는 해결됨 정정. 새 플랜 `optimization-round-2026-09-12`.

## 판단이 갈린 자리

- 유휴 언로드를 **뺀 것**이 이 라운드의 핵심 결정 — 직관적으로 맞아 보였지만 측정이 반대였다.
- `HeadIndex` 는 `git.rs` 가 800줄 래칫에 걸려 `git/nesting.rs`(중첩 저장소 경로 되맞춤 모듈)로 옮겼다. 자식 모듈이라 `super::repo_root_for` 의 비공개 접근이 된다.
- 첫 vec0 테스트가 실패해 배웠다: sqlite-vec 0.1.9 는 **통째로 빈 블록은 스스로 지운다**. 재현하려면 살아남을 행이 여러 블록에 흩어져야 한다.

## 검증

- `cargo test` 1465 + 통합 전부 통과(신규 `retain_file_snapshots_drops_unlisted_and_orphans` · `compact_rebuilds_vec0_and_keeps_embeddings`), clippy 0, fmt clean.
- `pnpm typecheck` · `pnpm test`(2702) · `pnpm lint`(6 게이트) · `pnpm build` 전부 exit 0.
- M5/M6 는 `#[ignore]` 측정 테스트 — 재현 명령은 원장 §1.4·§1.5. 설치본에서 「정리」·전체 재색인 후 실기기 확인은 `{#eyes-compact}` 로 이월.