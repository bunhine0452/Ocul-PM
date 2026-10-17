---
schema_version: 1
type: refactor
slug: "perf-vec0-partition-repack"
status: done
difficulty: high
created_at: "2026-10-18T01:14:24+09:00"
session_id: "20261018-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/vec_repack.rs"
    op: create
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/indexer/store.rs"
    op: update
related: []
tags:
  - "perf"
  - "db"
  - "sqlite-vec"
  - "indexer"
  - "mcp-tool"
---
[x] perf: 색인 적재 뒤 성긴 vec0 파티션을 스스로 다진다 — KNN 128→13ms

병렬 레인 D (Opus 5.5 medium, worktree). 측정으로 확정된 것만 고친다는 조건이었다.

## 동기
설치본 v3.13.0(3.5일 가동) 실측:
- ocul-pm footprint 232MB, Rust 스레드는 유휴 중 전부 대기한다.
- DB 813MB 중 `chunk_embeddings` vec0 블롭이 550MB다. 칸 374,784개 중 산 벡터는 97,701개(26%)뿐이다.
- project 29 파티션은 251,904칸 중 7.8%만 산다.
- 원인: sqlite-vec 는 새 벡터를 마지막 청크에만 넣고 지운 칸을 재사용하지 않는다. 증분 색인은 저장할 때마다 지웠다 다시 넣으니 구멍만 쌓인다. `compact()` 는 진단 탭 버튼과 프로젝트 삭제 때만 돈다.

## 변경 요약
- 새 함수 `Db::repack_vec0_if_sparse(project_id)`(`db/vec_repack.rs`).
  - 발동 조건: 산 벡터가 칸의 절반 미만이고, 죽은 칸이 4,096칸 이상일 때.
  - 동작: 가장 빈 청크부터 벡터를 지웠다 다시 넣는다. 걸음당 최대 16청크·2048행이고, 걸음마다 트랜잭션이 따로라 사이에 다른 DB 호출이 낄 수 있다.
- 호출 위치: `store_file_chunks` 가 적재 직후 부른다. 프로젝트당 1분에 한 번으로 제한했다. 전체 색인·워처 증분·일지 색인을 모두 덮는다.
- 스키마·마이그레이션 변경 없음.
- 전/후(설치본 DB 사본에 release 빌드로 실제 코드 실행):
  - p29: 251,904 → 32,768칸, 2.4s
  - KNN k=20: **128ms → 13ms**, top-20 동일
  - 진단 탭 compact 까지 하면 813MB → 366MB

기각한 후보: 프런트 번들 분할(엔트리 279KB, 이미 lazy), 기동 시간(보통 1초 미만), 임베딩 언로드 주기(로드 비용 근거 없음), 5KB non-object 블록(줄고 있음). WebGL 그래픽 1.19GB 는 터미널 레인 A 로 넘겼다.

## 검증
- 테스트 2건: 성긴 파티션이 다져지고 다른 파티션·KNN 결과는 그대로인지, 작은 파티션은 손대지 않는지. 합류 브랜치 cargo fmt/clippy/test(2062 passed) exit 0.
- **설치본 재측정 필요**: 로그 `vec0 partition repacked`, p29 청크 수, 다지기 중 다른 탭 init 이 막히지 않는지.
- `ocul-pm.db.bak-v40` 734MB 정리는 정책 결정이라 넘겼다.