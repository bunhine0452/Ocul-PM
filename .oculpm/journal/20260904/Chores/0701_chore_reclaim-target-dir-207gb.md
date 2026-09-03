---
schema_version: 1
type: chore
slug: "reclaim-target-dir-207gb"
status: done
difficulty: low
created_at: "2026-09-04T07:01:27+09:00"
session_id: "20260904-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/clean-target.mjs"
    op: create
  - path: "package.json"
    op: update
related: []
tags:
  - "disk"
  - "build"
  - "tooling"
  - "mcp-tool"
---
[x] target 이 207GB 였다 — 비우고, 다시 쌓이지 않게 정리기를 뒀다

## 동기

저장소 전체가 148GB 로 잡혔고 디스크 여유가 28GB 밖에 없었다. 실측:

```
target                147 GB  (du 기준; 실제 삭제량은 206.9 GiB, 파일 323,973개)
├─ debug/incremental   79 GB  증분 세션 디렉터리 994개 — ocul_pm_lib-* 하나에 1.5GB
├─ debug/deps          61 GB  .o 205,011개 + 테스트 바이너리 449개 (ocul_pm-* 각 140MB)
└─ 나머지               7 GB  release 번들 2.9G, aarch64 2.0G, libocul_pm_lib.a 802MB
```

전부 8월 31일 이후 파일이었다 — 14일 이상 된 파일 **0개**. 즉 한 번 빌드가 큰 게
아니라 (`Cargo.toml` 의 `debug = "line-tables-only"` 가 그건 이미 눌러 뒀다)
**세대가 쌓인 것**이다. `tests/*.rs` 16개가 각각 라이브러리 전체를 링크한 별도
바이너리가 되는데, 빌드 지문이 바뀔 때마다 새 해시로 하나 더 생기고 옛것은 남는다.
카고는 자기가 만든 옛 산출물을 지우지 않는다.

## 변경 요약

1. `cargo clean` — 206.9 GiB 회수. 저장소 148G → 1.1G, 디스크 여유 28Gi → 174Gi.
   릴리스 번들도 같이 날아갔지만 그건 CI(`release.yml`)가 만드는 것이라 손해가 없다.
2. `scripts/clean-target.mjs` + `pnpm clean:target` — 재발 방지. 기본 동작은
   증분 캐시 전부 삭제 + N일(기본 3) 이상 mtime 이 안 움직인 `deps` / `build` /
   `.fingerprint` / `examples` 항목 삭제. `--days N` / `--dry-run` / `--all`(=cargo clean).
   프로파일 디렉터리는 이름을 나열하지 않고 **`deps` 를 가진 디렉터리**로 찾는다 —
   `aarch64-apple-darwin/release` 처럼 타깃 삼중자 아래 있는 것도 따라온다.

mtime 으로 고르는 건 보수적이지 않다(카고는 재사용 산출물의 mtime 을 갱신하지 않아
아직 유효한 것도 지워질 수 있다). 다만 틀린 빌드가 나오지는 않고 — 지문이 산출물
없음을 보고 다시 만든다 — cargo-sweep 이 쓰는 것과 같은 방식이라, 의존성을 하나 더
들이지 않는 값으로 받아들였다.

## 검증

합성 트리(`debug/{deps,build,.fingerprint,incremental}` + `aarch64-apple-darwin/release/deps`,
오래된 파일·디렉터리 3건 + 최신 1건)로 `--dry-run` 과 실제 실행을 모두 돌렸다:
30MB → 4MB, 묵은 4건과 incremental 만 사라지고 최신 `new.o` 는 남았으며 두 프로파일
디렉터리 모두 탐색됐다. 이후 합성 트리 제거. `pnpm lint` 5종 전부 통과.