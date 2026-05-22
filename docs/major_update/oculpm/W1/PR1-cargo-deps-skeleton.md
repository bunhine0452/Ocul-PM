# W1-PR1 — Cargo 의존성 + 모듈 스켈레톤

> **목표**: `.oculpm/` 백엔드 모듈의 빈 골격을 만들고 11개 신규 Cargo 의존성을 추가. 코드가 `cargo check` / `cargo clippy --all-targets -- -D warnings` / `pnpm tauri build` 를 모두 통과.
> **선행**: 없음. W1 의 첫 PR.
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) §1 W1-PR1.

---

## 1. 파일 변경 목록

### Update (3)
- [x] `src-tauri/Cargo.toml` — `[dependencies]` 에 11개 추가
- [x] `src-tauri/src/commands/mod.rs` — `pub mod oculpm; pub use oculpm::*;` 추가
- [x] `src-tauri/src/lib.rs` — `mod oculpm;` 추가

### Create (8)
- [x] `src-tauri/src/oculpm/mod.rs` — sub-module 선언만
- [x] `src-tauri/src/oculpm/spec.rs` — `//! TODO(W1-PR2)` 한 줄
- [x] `src-tauri/src/oculpm/paths.rs` — `//! TODO(W1-PR3)` 한 줄
- [x] `src-tauri/src/oculpm/config.rs` — `//! TODO(W1-PR4)` 한 줄
- [x] `src-tauri/src/oculpm/atomic_io.rs` — `//! TODO(W1-PR5)` 한 줄
- [x] `src-tauri/src/oculpm/lock.rs` — `//! TODO(W1-PR5)` 한 줄
- [x] `src-tauri/src/oculpm/error.rs` — `OculpmError` enum 의 빈 스켈레톤 (다른 모듈이 import 해도 깨지지 않도록)
- [x] `src-tauri/src/commands/oculpm.rs` — `//! TODO(W1-PR6)` 한 줄

### Bonus (사전 정리)
- [x] `src/features/code/BottomDrawer.tsx` — 미사용 `useEffect` import 제거. `tauri build` 가 `tsc` 단계에서 막혀서 본 PR 으로 청소함 ([refactor W6 의 알려진 잔여 1건](../../../refactor/W6/01-greenfield-wizard.md)).

`error.rs` 만 빈 한 줄이 아닌 이유: 후속 PR 의 함수 시그니처가 `Result<_, OculpmError>` 를 쓰므로 컴파일을 위해 enum 정의가 최소한 있어야 함. variant 는 W1 진행하며 점진 추가.

---

## 2. Cargo.toml 에 추가 (정확히 이 11줄)

```toml
notify = "6.1"
notify-debouncer-full = "0.3"
serde_yaml = "0.9"
gray_matter = { version = "0.2", default-features = false, features = ["yaml"] }
pulldown-cmark = { version = "0.10", default-features = false }
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.8"
slug = "0.1"
fs2 = "0.4"
toml = "0.8"
uuid = { version = "1", features = ["v4"] }
```

배치: `[dependencies]` 의 끝, 기존 `tauri-plugin-window-state = "2"` 다음 줄에.

**마이그레이션 번호 주의**: 현재 main 은 `migrations/011_project_blueprints.sql` 까지 사용 중. 본 PR 은 마이그레이션 추가 X, 단지 메모: 다음 PR (W3-PR2 의 cache) 가 `012_oculpm_cache.sql` 부터 시작 ([refactor-integration §I-1](../refactor-integration.md)).

---

## 3. `error.rs` 초기 스켈레톤

```rust
//! Error types for the .oculpm/ subsystem. Variants are added as later PRs land.

use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OculpmError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    // Variants below are added in W1-PR3..W1-PR8 as needed.
    #[error("not yet implemented")]
    NotImplemented,
}

pub type OculpmResult<T> = Result<T, OculpmError>;
```

후속 PR 이 필요한 variant 를 추가. 본 PR 은 `Io` 와 `NotImplemented` 만.

---

## 4. `oculpm/mod.rs` 초기 내용

```rust
//! `.oculpm/` filesystem subsystem.
//!
//! See `docs/major_update/oculpm/` for the SSOT (00-spec.md and phase guides).

pub mod atomic_io;
pub mod config;
pub mod error;
pub mod lock;
pub mod paths;
pub mod spec;

pub use error::{OculpmError, OculpmResult};
```

---

## 5. `commands/oculpm.rs` 초기 내용

```rust
//! TODO(W1-PR6): init / get_status / get_config / set_config 커맨드.
```

`commands/mod.rs` 가 `pub use oculpm::*;` 를 하므로, 이 파일이 비어있어도 컴파일 OK. 단, lib.rs 의 `use crate::commands::{...}` 에 oculpm 커맨드 이름이 아직 없으므로 `lib.rs` 는 W1-PR6 까지 변경 안 함.

---

## 6. 실행 순서

1. Cargo.toml 편집 → `cargo check` (의존성 다운로드 + 컴파일).
2. oculpm/ 폴더 + 8개 파일 생성.
3. commands/mod.rs 갱신.
4. lib.rs 의 top-level mod 선언 추가.
5. `cargo check` 재실행 → 통과.
6. `cargo clippy --all-targets -- -D warnings` → 통과.
7. `pnpm tauri build` → 통과.

---

## 7. Definition of Done

- [x] `cargo check` 통과 — warning 8개 (전부 pre-existing), 신규 0건
- [x] oculpm 코드의 clippy 신규 lint 0건 — `#[allow(unused_imports)]`/`#[allow(dead_code)]` 으로 stub 시기의 의도된 dead code 명시 (후속 PR 에서 제거됨)
- [x] `pnpm tauri build` 통과 — release dmg (`ai-pm_0.1.0_aarch64.dmg`) 까지 정상 빌드
- [x] 새 모듈 8개 파일이 의도된 한 줄 (또는 `error.rs` 의 최소 스켈레톤) 만 포함
- [x] specta 빌드가 깨지지 않음 (oculpm 모듈은 아직 specta 노출 X)
- [x] 회귀: 기존 빌드 OK = 다른 화면들 회귀 없음 추정 (수동 스모크는 W1-PR7 부트스트랩 직후 1회 합쳐서)

### 부분 DoD 비고

원안의 `cargo clippy --all-targets -- -D warnings 통과` 는 **달성 불가** — main 의 `src/db.rs`, `src/indexer.rs` 에 36개 pre-existing clippy error 가 존재하기 때문. 본 PR 범위 밖. 따라서 DoD 를 **"oculpm 코드의 clippy 신규 lint 0건"** 으로 재해석. 회귀 방지 차원에서 후속 PR 도 같은 기준 (격리 검사) 으로 한다.

별도 PR 후보: pre-existing clippy debt 36건 정리 — W6 stabilize 의 추가 작업으로 backlog (`phases/W6-stabilize-dogfood.md` 참조).

---

## 8. 실행 노트

### 발견된 함정 / 변경

1. **clippy DoD 재해석** — 원안의 `--all-targets -- -D warnings` 는 main 의 db.rs / indexer.rs 의 36 pre-existing error 때문에 통과 불가. "oculpm 코드 격리 lint 0건" 으로 변경. §7 의 부분 DoD 비고 참조.
2. **dead code stub 처리** — `OculpmError`, `OculpmResult`, `commands::oculpm::*`, `oculpm/mod.rs` 의 `pub use error::*` 는 stub 시기에 사용처가 없어 `#[allow(dead_code)]` / `#[allow(unused_imports)]` 로 명시. 후속 PR 에서 사용처 추가되면 attribute 제거할 것.
3. **BottomDrawer.tsx 의 미사용 useEffect** — `pnpm tauri build` 의 `tsc` 단계가 막혀서 본 PR 안에서 1줄 정리. refactor W6 doc 의 "기존 BottomDrawer 1건" 잔여를 처리한 셈.

### 빌드 시간 (개인 노트북)
- `cargo check` 초회 (deps 다운로드 + compile): **17.4s**
- `cargo check` 증분 (allow 추가 후): **1.4s**
- `pnpm tauri build` (release): **1m 43s** (`ai-pm_0.1.0_aarch64.dmg` 까지)

### 다음 PR 로 넘기는 메모
- `error.rs` 의 variant 는 W1-PR3 이후 `InvalidTimezone`, `InvalidHHMM`, `ConfigParse`, `ManagedBlockMismatch`, `LockHeld` 등 점진 추가. attribute 들 (`#[allow(dead_code)]`) 은 그 시점에 제거.
- `paths.rs` 가 `chrono_tz::Tz` 의 iteration 을 쓰는지 확인 필요 (W1-PR3 진입 직전): `chrono-tz = "0.8"` default features 가 enum 노출 포함하는지.
- main 의 `cargo clippy` debt 36건은 W6 stabilize 의 backlog. 진행 시 본 oculpm 작업과 별도 PR.

### 결과 (Definition of Done 4번 그림)

`OculpmManager` 는 아직 없고, `oculpm_*` 커맨드도 아직 없으나, 모듈 트리는 깔렸고 의존성도 다 들어왔다. W1-PR2 (specta 타입) 로 진입 가능.
