---
schema_version: 1
type: feature
slug: "port-compile-baseline-w1"
status: done
difficulty: high
created_at: "2026-09-24T00:58:04+09:00"
session_id: "20260924-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/proc.rs"
    op: create
  - path: "src-tauri/clippy.toml"
    op: create
  - path: "src-tauri/src/glibc_compat.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/unsupported.rs"
    op: create
  - path: "src-tauri/src/ptyhost/host/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/build.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
related:
  - ref: "20260923/Chores/2308_chore_cross-platform-plan-and-portability-ci.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "ci"
  - "mcp-tool"
---
[x] 컴파일 기준선 — Windows·Linux 에서 check·clippy 초록, Ubuntu 는 테스트까지 (W1, PR #32)

## 추가 기능

크로스플랫폼 라운드 W1(L-BASE, 병렬 worktree 세션)의 합류. 컴파일 오류는 앞 층이 막으면 뒤 층이 안 보여 CI 를 층층이 걷어냈다.

- `src-tauri/src/proc.rs` — 프로세스 생성 단일 창구(D5). Windows: `CREATE_NO_WINDOW`(GUI 앱의 자식 콘솔 깜빡임) + PATH×PATHEXT 로 `.cmd/.bat` 해석. 배치 파일 인용은 손으로 `cmd /C` 로 감싸지 않고 **전체 경로를 std 에 넘겨 std 의 BatBadBut(CVE-2024-24576) 방어를 살린다**(브리프와 다르게 간 판단 — 옳았다). 42곳 이전, `clippy.toml` disallowed-methods 재발 게이트, `egress_inventory` 가 새 호출 모양도 본다.
- 층별로 걷어낸 것: trash `coinit_apartmentthreaded`(우리 `default-features=false` 가 크레이트의 의도적 컴파일 에러를 켰다) → `hidden_title` mac 한정 → ptyhost Unix 소켓 `cfg(unix)` + Windows 명시적 실패 스텁 → **Linux 링크**(사전 빌드 ONNX Runtime 이 glibc 2.38+ `__isoc23_strto*` 를 불러 22.04 하한에서 실패 → `glibc_compat.rs`, D11) → **Windows 테스트 실행 파일 0xc0000139**(tauri-build 가 Common Controls v6 매니페스트를 bin 에만 → `build.rs` 가 MSVC 에서 링커로 모든 실행 파일에).
- 오케스트레이터 추가: `windows-sys` 0.61 공통 의존성(W2 레인 병렬 전에, lock 한 줄) · 파일 크기 래칫 수정.

## 발생 원인 (PR #32 첫 CI 붉음)

W1 스텁이 `ptyhost/host/mod.rs` 를 810→840줄로 늘려 `lint:filesize` 래칫(800줄 넘은 파일은 기준보다 늘지 않는다)에 걸렸다. 세션이 Rust 만 고쳐 `pnpm lint` 를 안 돌린 탓. 비-unix 스텁 다섯을 `host/unsupported.rs` 로 모아 810줄로 되돌렸고, 레인 공통 규칙에 "Rust 만 고쳐도 `node scripts/check-file-sizes.mjs`" 를 넣어 5레인에 알렸다.

## 오케스트레이터 검토 (macOS 불변)

`proc.rs` 비-windows 는 `Command::new` 그대로, `build.rs` mac 은 `tauri_build::build()` 그대로, ptyhost 는 Unix 코드를 함수로 옮기기만, trash feature 는 Windows 코드에만.

## 검증

- portability(8390a922): ubuntu check·clippy·test 초록(1,827 통과), windows check·clippy 초록 · 테스트 1,609+ 통과 · 19 실패(전부 W2 레인 몫, 인벤토리 층 2 — 수정 전후 동일).
- PR #32 ci.yml 3잡 SUCCESS → rebase 머지 d7185e98. W0·W1 worktree·브랜치 정리.
- CI 로 못 본 것: 릴리스 프로필(thin LTO)·`tauri build` 에서 glibc_compat 링크와 Windows 매니페스트 → W3.