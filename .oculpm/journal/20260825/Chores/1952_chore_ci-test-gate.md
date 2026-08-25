---
schema_version: 1
type: chore
slug: "ci-test-gate"
status: done
difficulty: low
created_at: "2026-08-25T19:52:00+09:00"
session_id: "manual-20260825-195200"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/ci.yml"
    op: create
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: ["20260825/Chores/1942_chore_feedback-triage-ci-plan.md"]
tags: ["ci", "github-actions", "test", "release"]
---

[x] CI 테스트 게이트 신설 — PR·main 에서 typecheck·test·lint·build·cargo test 자동 실행

## 무엇을 했나

`.github/workflows/ci.yml` 을 새로 만들었다. 기존 release.yml 은 `v*` 태그에서
번들만 굽고 테스트를 하나도 돌리지 않아, 1,303개 vitest 와 868개 Rust 테스트가
전부 수동 실행에 의존하고 있었다.

**프런트 잡 (ubuntu-latest)** — `pnpm install --frozen-lockfile` 뒤 typecheck →
test → lint(storage+i18n) → build. Rust 툴체인이 필요 없어 ubuntu 로 뺐다.
pnpm/action-setup 을 setup-node 보다 먼저 둬야 `cache: pnpm` 이 스토어를 찾는다.

**Rust 잡 (macos-latest)** — `cargo test --locked` + swatinem/rust-cache.
macOS 고정이 필요한 이유는 tauri 의 `macos-private-api` feature 와
`cfg(target_os = "macos")` 코드 경로 9개 파일이다. 저장소가 public 이라 macOS
러너 분과금은 없다.

**bindings 신선도 게이트** — `cargo test` 는 `export_bindings_typescript` 로
`src/lib/bindings.ts` 를 재생성한다. 그 직후 `git diff --exit-code` 로 커밋본과
비교해, 백엔드 커맨드만 고치고 bindings 재생성을 빠뜨린 커밋을 막는다. 이
저장소의 Rust↔TS 브리지 구조에서만 생기는 실수 경로라 게이트로 세웠다.

문서는 README ko/en 에 CI 배지를 얹고, docs/RELEASE.md §0 에 "태그를 밀기 전 main
CI 그린 확인"을 넣었다 — release.yml 이 테스트를 안 하므로 붉은 main 에 태그를
밀면 깨진 빌드가 그대로 릴리스로 나간다.

## 붉게 날 뻔한 것들 (미리 확인)

- **`dist/` 부재** — `frontendDist: "../dist"` 인데 dist 는 gitignore 다. dist 를
  잠시 치우고 `touch build.rs && cargo build --tests` 로 실측했더니 exit 0 —
  번들 단계가 아니라 frontendDist 존재를 요구하지 않는다. Rust 잡에 node/pnpm 을
  넣지 않아도 되는 근거다.
- **사이드카 바이너리** — build.rs 가 0바이트 플레이스홀더를 자가 생성한다(기존 대비).
- **외부 도구 의존 테스트** — lsp_rust_analyzer·dap_lldb·acp_login_shell 은 바이너리가
  없으면 eprintln 후 return 으로 건너뛴다. acp_handshake 는 기본 `#[ignore]` 라
  애초에 게이트에 안 들어온다.
- **`--locked`** — Cargo.lock 이 커밋돼 있고 `cargo test --locked --no-run` 이
  통과하는 것을 확인한 뒤에 붙였다.

## 검증

커밋 전 게이트를 전부 직접 돌려 exit 0 을 확인했다 — typecheck 0 · vitest
113파일 1,303케이스 0 (10.7초) · lint 0 · build 0 · `cargo test --locked` 0
(18스위트 ok, FAILED 0). 저장소 루트에서 `git diff --exit-code src/lib/bindings.ts`
도 무변경. ci.yml 은 `yaml.safe_load` 로 파싱을 확인했고 잡 2개·스텝 8/5개가
의도대로 잡힌다.

## 메모

**아직 GitHub 에서 한 번도 실행되지 않았다.** 워크플로 파일은 푸시돼야 동작하므로,
첫 실행의 콜드/웜 소요시간 측정과 조정은 플래너 [#ci-timing] 으로 남겨 뒀다.
러너에서만 드러나는 문제(캐시 키, macOS 이미지의 툴체인 차이)는 첫 실행에서 확인해야 한다.
