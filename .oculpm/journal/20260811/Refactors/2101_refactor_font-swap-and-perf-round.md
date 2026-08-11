---
schema_version: 1
type: refactor
slug: "font-swap-and-perf-round"
status: done
difficulty: high
created_at: "2026-08-11T21:01:03+09:00"
session_id: "manual-20260811-210103"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/App.css"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/assets/fonts/Pretendard-subset.woff2"
    op: create
  - path: "src/assets/fonts/SUITE-Light.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-Regular.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-Medium.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-SemiBold.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-Bold.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-ExtraBold.otf"
    op: delete
  - path: "src/assets/fonts/SUITE-Heavy.otf"
    op: delete
  - path: "scripts/build-pretendard-subset.py"
    op: create
  - path: "src/lib/hljs.ts"
    op: create
  - path: "src/features/diff/PatchView.tsx"
    op: update
  - path: "src/features/search/CodeSnippet.tsx"
    op: update
  - path: "src-tauri/src/db.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "package.json"
    op: update
related: []
tags: ["performance", "font", "bundle", "sqlite", "cargo-profile"]
---

[x] 최적화 라운드 — 폰트 교체(SUITE→Pretendard Variable)·hljs 지연로드·인덱싱 N+1 제거·빌드 프로파일

## 동기

전반 최적화 지점을 훑어달라는 요청에서 출발해, 실측으로 근거가 잡힌 것만 골라 처리했다.

가장 큰 발견은 **타이포그래피가 조용히 망가져 있었다**는 것이다. CSS 가 `font-weight: 550` 을 14곳, `650` 을 26곳, 그 밖에 520/560/620/640/660/680/720/750/760 을 15곳에서 쓰는데 SUITE 는 300~900 정적 7종이라 전부 이웃 굵기(600/700)로 스냅됐다. 즉 96개 선언이 의도한 굵기로 렌더된 적이 없다. 용량 문제로 시작했다가 정합성 문제로 판명된 건이다.

나머지 셋은 순수 성능이다. `PatchView` 가 `highlight.js/lib/common` 을 정적 임포트하는데 `DiffScreenV2` 는 `ShellV2` 가 eager 로 물고 있어, 문법 37종이 "프로젝트 선택 직후 로드되는" 청크에 박혀 있었다. 인덱싱은 청크 하나마다 트랜잭션을 열고 닫았다. Cargo 프로파일은 아예 지정이 없어 `target/debug` 가 24GB 였다.

## 변경 요약

**폰트** — SUITE 7종 OTF 를 지우고 Pretendard Variable 서브셋 1개로 교체했다. npm `pretendard` 의 기본 산출물은 둘 다 이 앱에 안 맞았다: 단일 VF 2.06MB 는 한자·가나를 통째로 들고, dynamic subset 은 92파일 3.0MB 라 로컬 파일인 데스크톱 앱에서 지연 로드 이득 없이 번들만 키운다. D2Coding 과 같은 방식으로 직접 서브셋했다 (`scripts/build-pretendard-subset.py`, 한자 제거 + 한글 완성형 11,172자 전량 유지 = 1.72MB). `@fontsource/eb-garamond` 는 `latin-400` 서브패스로 좁히고(304KB→48KB), `@fontsource-variable/inter` 는 Pretendard 라틴이 Inter 기반이라 폴백이 필요 없어져 제거했다. 폰트 총량 2.72MB → 2.00MB.

**highlight.js** — 공용 지연 로더 `src/lib/hljs.ts`(`loadHljs` + `useHljs`)를 만들어 `PatchView`·`CodeSnippet` 이 함께 쓰게 했다. `PatchView` 는 렌더 중 동기로 하이라이터를 쓰던 구조라 `hljs` 를 prop 으로 내려보내게 고쳤다 — 훅은 `PatchView` 최상단 한 곳에만 건다(줄마다 걸면 diff 한 장에 훅 수천 개가 붙는다). 로드 전에는 평문 escape 로 그리고 준비되면 색이 입혀진다. ShellV2 청크 266KB → 125KB.

**인덱싱 N+1** — `insert_chunk_with_embedding`/`insert_symbol_definition` 은 행 하나마다 tokio-rusqlite 채널 왕복 + BEGIN/COMMIT + 문장 준비를 했다. 배치판(`insert_chunks_with_embeddings`/`insert_symbol_definitions`)으로 대체해 트랜잭션 1회 + `prepare_cached` 로 묶었다. 임베딩이 이미 `EMBED_BATCH`(32) 단위라 적재도 같은 단위다. 단수형 두 개는 호출부가 없어져 삭제했다.

**SQLite** — `busy_timeout`(WAL 이라도 쓰기는 하나씩이라 인덱싱과 워처 재인덱싱이 겹치면 즉시 SQLITE_BUSY 였다) · `cache_size = -64000` · `mmap_size = 256MiB` · `temp_store = MEMORY` 추가.

**Cargo 프로파일** — `[profile.release]` 에 `lto = "thin"`/`codegen-units = 1`/`strip`, `[profile.dev]` 에 `debug = "line-tables-only"`, `[profile.dev.package."*"]` 에 `opt-level = 2`. `panic = "abort"` 는 일부러 뺐다 — `oculpm/lock.rs` 의 `LockGuard` 가 Drop 으로 잠금을 푸는데 abort 는 되감기를 건너뛰어 패닉 한 번에 잠금 파일이 남는다. 이유를 Cargo.toml 주석에 박아 뒀다.

## 검증

`pnpm typecheck` · `pnpm test`(611 통과) · `pnpm lint` · `cargo test`(563 통과, 0 실패) 전부 exit 0 을 직접 확인. `bindings.ts` 는 재생성 후 무변경 — 커맨드 시그니처를 건드리지 않았다는 뜻. 번들은 `pnpm build` 산출물에서 폰트 총량 2.00MB, ShellV2 125KB 를 직접 쟀고, hljs 문법이 별도 `common-*.js` 로 분리된 것도 청크 grep 으로 확인했다. `target/debug` 는 clean 후 풀 빌드 기준 24GB → 5.3GB(deps 파일 50,619개 → 7,059개).

**Pretendard 실기기 렌더는 아직 눈으로 확인하지 않았다** — `verified_by_user: false` 인 이유이고, `pnpm tauri dev` 로 한글/영문 본문과 550/650 굵기 자리를 봐야 완결된다.

## 메모

- 최초 보고에서 폰트 절감을 -2.1MB 로 잡았다가 실측 후 -720KB 로 정정했다. Pretendard 의 한글 완성형 자체가 1.65MB 라 그게 하한이다 (라틴+기호+자모만이면 69KB).
- `MarkdownImpl` 청크에 highlight.js 사본이 하나 더 있다. `rehype-highlight`→`lowlight` 가 자체 경로로 등록하는 별개 중복이고 lazy 청크라 첫 화면엔 영향이 없어 손대지 않았다.
- 일지 타임라인 무한 렌더를 초기 후보로 올렸다가 취소했다. `JournalScreenV2` 는 `idx < 2` 기본 접힘이 이미 있어 오래된 날의 항목을 렌더하지 않는다.
- `pretendard` 는 devDependency 다 — 서브셋 결과물만 커밋되므로 일반 빌드는 이 패키지를 필요로 하지 않는다.
