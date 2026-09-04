---
schema_version: 1
type: chore
slug: "v241-gates-eslint-deny-ratchet"
status: done
difficulty: high
created_at: "2026-09-04T13:00:43+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "eslint.config.js"
    op: create
  - path: "rust-toolchain.toml"
    op: create
  - path: "deny.toml"
    op: create
  - path: "scripts/file-size-policy.mjs"
    op: create
  - path: "src/__tests__/file_size_policy.test.ts"
    op: create
  - path: "scripts/check-file-sizes.mjs"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "gates"
  - "eslint"
  - "cargo-deny"
  - "ci"
  - "v241"
  - "mcp-tool"
---
[x] 눈먼 게이트를 뜨게 한다 — ESLint·툴체인 핀·cargo-deny·래칫 fail-open

플랜 `v241-errors-first` Phase `gates`. 이 라운드가 고치는 결함들을 **찾아 주고 재발을 막는** 층이라 오류 수정보다 먼저 놓았다 — 지금 고쳐도 막는 게 없으면 3.0 동안 같은 것이 다시 생긴다.

## 무엇이 없었나

- **ESLint 가 아예 없었다.** 그런데 `src/`(테스트 제외)에 `eslint-disable` 주석이 **33개** — 돌지 않는 검사를 억제하고 있었다.
- **툴체인 핀이 없었다.** CI 가 `dtolnay/rust-toolchain@stable` 이라 stable 이 움직이면 코드가 한 줄도 안 바뀐 커밋이 어제 초록·오늘 레드가 된다(실제로 겪은 고통).
- **의존성 게이트가 하나도 없었다.** Rust 의존성이 817 크레이트인데 취약점·라이선스·출처를 보는 잡이 0개.
- **파일 크기 래칫에 fail-open 이 있었다.**

## 무엇을 했나

**ESLint** — flat config, `react-hooks/rules-of-hooks` 는 위반 0 이라 `error` 하드 게이트, `exhaustive-deps` 는 `warn`. 래칫은 "전부 warn + max-warnings" 가 아니라 **오늘 실제 위반이 있는 6개 규칙만** warn 으로 내렸다 — 전부 내리면 200여 규칙이 예산 안에서 서로 자리를 바꿀 수 있어 래칫이 헐거워진다. 상한 61(실측). 부산물로 `exhaustive-deps` 위반 **39건 + disable 로 눌린 23건**과 불용 disable 지시자 5건이 드러났다.

**툴체인** — `rust-toolchain.toml` 에 `1.98.0` 핀 + `rustfmt`·`clippy`·`rust-analyzer`. **`dtolnay/rust-toolchain` 액션은 이 파일을 읽지 않는다** — `@stable` 로 두면 핀을 박고도 CI 는 그날의 stable 을 쓴다. `ci.yml` 이 채널을 grep 해 넘기도록 고쳤다.

**cargo-deny** — `Cargo.lock` 817 패키지의 `license` 필드를 전부 집계해 allow 8종 + 크레이트별 exception 9건(전역이 아니라 크레이트별이라 *새* MPL 의존성은 게이트에 걸린다). `[graph] targets` 를 apple 2종으로 좁혀 리눅스 gtk 소음 제거.

**래칫** — `baseContent()` 가 `git show` 실패를 전부 신규파일로 삼키던 것을 제거하고 신규는 git 상태코드로 판정, 읽기 실패는 던진다. 정책표를 `scripts/file-size-policy.mjs` 로 분리하고 **순서까지 `deepEqual` 로 무는 테스트** + 진입 판정을 `realpathSync` 비교로.

## 조사 중 정정된 것 둘

1. **래칫 fail-open 의 피해 방향이 반대였다.** 기준선을 잃으면 상한이 800으로 **내려간다**(`allowedLineCount(null,800)=800` vs `(1256,800)=1256`). 위반을 놓치는 게 아니라 ① 큰 파일을 **줄이는** PR 이 거짓으로 붉어지고 ② 보고서가 그 파일을 "신규"로 거짓 표기하며 ③ 원인이 stderr 와 함께 버려진다. 고칠 값어치는 그대로지만 이유가 다르다.
2. **rustup 은 툴체인을 버전이 아니라 이름으로 구분한다.** `1.98.0` 은 `stable` 과 같은 컴파일러라도 별개 툴체인이라 첫 `cargo` 호출이 툴체인을 새로 받는다. 이번엔 두 이름이 같은 `1.98.0 (88d9e12ae)` 이라 재빌드 비용은 없었다.

## 게이트가 첫 실행에서 잡은 것

`cargo-deny` 를 실제로 설치해 돌린 결과 **취약점 4건 적발**. 셋은 `cargo update` 로 닫았다(`crossbeam-epoch 0.9.18→0.9.20`, `h2 0.4.14→0.4.19`). `quick-xml 0.39.4` 의 2건은 `plist 1.9.0 ← tauri 2.11.2` 가 `^0.39` 를 요구하고 수정본이 `>=0.41.0`(semver 비호환)이라 **우리가 못 올린다** — 도달 불가 근거(밖에서 온 XML 을 파싱하지 않는다)와 해제 조건을 적어 ignore.

`src-tauri/Cargo.toml` 에 `license = "MIT"` 를 넣어(루트 LICENSE 가 MIT) 라이선스 검사를 **비차단 → 차단**으로 올렸다. 없을 때는 cargo-deny 가 `ocul-pm` 자신을 unlicensed 로 봐서 우리 자신 하나 때문에 붉었다.

## 검증

`cargo-deny check advisories bans sources licenses` → **`advisories ok, bans ok, licenses ok, sources ok`**(파이프 없이 실제 종료코드 0 으로 확인). 래칫 테스트는 **fail-open 두 결함을 실제로 되살려** 4건이 붉어지는 것을 확인한 뒤 복원했다 — 판정 로직을 지워도 통과하는 테스트는 아무것도 안 지킨다. `typecheck`·`lint`(6종)·`build`·`test`·`cargo fmt`·`clippy`·`cargo test` 전부 exit 0.