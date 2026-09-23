# 크로스플랫폼 — Windows · Linux 출시 (Mac App Store 는 하지 않는다)

2026-09-23 · 진행 상태는 여기 없다 — 플랜 `cross-platform-port` 가 갖는다. 이 문서는
"왜 이 모양인가" 만 갖는다. Mac App Store 는 같은 날 사용자가 **하지 않기로 결정**했다
(플랜 `mac-app-store` 는 그 결정과 근거만 남기고 전 항목 종결).

## 출발점

- 공식 빌드는 macOS Apple Silicon 뿐이다. `release.yml` 매트릭스에 Windows 가
  주석으로 남아 있고, `ci.yml` 의 Rust 잡은 `macos-latest` 고정이다("ubuntu 빌드는
  미검증").
- Windows 를 의식한 코드는 이미 꽤 있다 — `open_native.rs` 3갈래, `shim.rs` 의
  심링크→복사 폴백, `a2a/registry.rs` 의 `pid_state`(non-unix = Unknown),
  `lock.rs`·`acp/env.rs` 의 `cfg(not(unix))` 폴백, `greenfield.rs` 의 Windows 후보
  경로, `keyring` 의 `windows-native`, `icon.ico`.
- **컴파일을 막는 것 하나**: `ptyhost/client.rs:13`·`ptyhost/host/mod.rs:24` 가
  `tokio::net::UnixStream/UnixListener` 를 게이트 없이 쓴다. Windows 에서는 크레이트
  전체가 안 뜬다.
- 테스트 파일 ~25곳이 `std::os::unix::fs::symlink` 를 게이트 없이 쓴다 —
  `cargo test` 가 Windows 에서 컴파일조차 안 된다.
- 프런트엔드: UI·번역 문자열의 `⌘` 리터럴 476곳, OS 판정 `navigator.platform`
  4곳(`ShellV2`·`StartScreen`·`TabbedWindow`·`TerminalWindow`).
- 플러그인(`plugin/oculpm/bin/oculpm-mcp`)은 macOS `.app` 경로만 찾고 "플러그인 v1 은
  macOS 전용" 이라고 말한다. 훅 크로스플랫폼은 `skill-catalog-round-2 #hooks-xplat`
  이 "Windows 앱 트랙과 동승해야 실효" 로 미뤄 둔 항목이다 — 이 라운드가 그 트랙이다.

## 사용자 제약 — 이 라운드 설계의 전부를 정한다

> 사용자가 Windows·Linux 를 직접 테스트할 수 없다. 오류가 나면 안 된다.

그래서:

### D1. CI 러너가 실기기다

`windows-latest` · `ubuntu-22.04` 러너가 사용자의 눈을 대신한다. **"그 OS 에서
컴파일된다" 는 완료가 아니다.** 항목이 done 이 되려면 그 동작을 실행하는 테스트가
**그 OS 러너에서** 돌아 초록이어야 한다. macOS 에서만 돈 테스트로 Windows 항목을
닫지 않는다 (`ledger-and-liveness-honesty #test-liveness` 가 "Windows 경로는 cfg 라
macOS 에서 실행 불가 — 코드로만 갈라 뒀다" 로 닫힌 선례가 있다 — 이번엔 그러지 않는다).

### D2. 이식성 CI 는 릴리스 게이트와 분리해서 시작한다

`release.yml` 의 gate 는 태그 커밋에서 **`ci.yml` 이 초록인지** 본다. 처음부터 붉을
Windows·Linux 잡을 `ci.yml` 에 넣으면 macOS 릴리스가 막힌다. 그래서 새 워크플로
`portability.yml` 로 시작하고, 잡이 초록이 되는 대로 required 로 올린 뒤 전부
초록이면 `ci.yml` 로 합친다(`#w0-promote`).

### D3. macOS 동작은 불변

공유 코드를 고치는 모든 레인은 `ci.yml`(macOS) 초록을 유지한다. 플랫폼별 번들 설정은
`tauri.windows.conf.json` · `tauri.linux.conf.json` 으로 분리해 `tauri.conf.json`
(macOS 가 쓰는 것)을 건드리지 않는다 — Tauri 가 플랫폼 파일을 자동 병합한다.

### D4. 아직 없는 기능은 명시적으로 실패한다

Windows 에서 아직 구현 안 된 경로(W1 의 컴파일 스텁)는 **"이 OS 에서는 아직
지원하지 않아요" 에러**를 돌려준다. 빈 목록·`Ok(())` 로 조용히 넘어가지 않는다 — 이
저장소의 정직성 원칙(모름을 아는 척하지 않는다)과 같다. 스텁은 전부
`// PORT-STUB(<레인>)` 주석을 달고, W2 종료 조건은 `rg "PORT-STUB"` 0건이다.

### D5. 프로세스 생성은 한 창구

GUI 앱이 Windows 에서 `Command::new` 를 그냥 쓰면 **자식마다 콘솔 창이 깜빡인다**
(git · LSP · DAP · ACP 어댑터 · ps 대체…, ~40곳). 또 npm 이 까는 CLI 는
`claude.cmd` · `codex.cmd` 라 `Command::new("claude")` 가 못 찾는다. 새 모듈
`src-tauri/src/proc.rs` 가 `CREATE_NO_WINDOW` 와 `PATHEXT` 해석을 소유하고, clippy
`disallowed-methods` 로 그 밖의 `Command::new` 를 막는다.

### D6. 레인 = 파일 소유

병렬 세션은 **파일 소유가 겹치지 않게** 나눈다(`01-lane-briefs.md` 의 소유 표).
공유 핫스팟 셋 — `src-tauri/src/lib.rs` · `src-tauri/Cargo.toml` · `src/lib/bindings.ts`
— 은 레인이 최소 변경만 하고, **새 Tauri 커맨드 추가는 금지**(필요하면 보고서에
적어 오케스트레이터가 합류 때 넣는다). 합류는 오케스트레이터가 순서대로 한다.

### D7. 첫 출시는 '베타', 검증 통과한 플랫폼만 업데이터에 싣는다

`latest.json` 에는 E2E·설치 스모크를 통과한 플랫폼만 들어간다. Windows·Linux 빌드
실패가 **macOS 릴리스와 macOS 업데이트를 오염시키지 않는다**(`#w4-latest-json`).
README·랜딩에는 "베타" 로 표기하고, 졸업 기준(`#w5-graduate`)을 넘은 뒤 뗀다.

### D8. CI 로 못 보는 것은 목록으로 정직하게 남긴다

실제 한글 IME(Linux fcitx/ibus), Wayland 트레이 위치, HiDPI 혼합 모니터, 사용자
PC 의 WebView2 버전 편차는 러너가 못 본다. 이것들은 `#w5-eyes` 원장에 남고,
외부 테스터 확인 전까지 해당 항목을 닫지 않는다. Windows IME 는 WebView2 의 CDP
(`Input.imeSetComposition`)로 **조합 이벤트까지는** CI 에서 흉내 낸다(`#w3-ime-cdp`).

### D9. x64 먼저

`x86_64-pc-windows-msvc` · `x86_64-unknown-linux-gnu`. ONNX Runtime(ort)이 두 타깃의
사전 빌드를 제공한다(Intel 맥이 막힌 이유 — x86_64-apple-darwin 사전 빌드 없음 —
와 다르다). ARM64 는 이 라운드 밖.

### D10. Linux 형식은 AppImage + deb

Tauri 업데이터가 자동 업데이트하는 Linux 형식은 AppImage 뿐이다. deb 는 배포판
패키지 관리자로 업데이트한다(앱 안 업데이트 버튼은 안내로 바뀐다). rpm 은 보류.
glibc 하한을 낮추려고 `ubuntu-22.04` 에서 빌드한다.

**AppImage 함정**: 실행 중에만 존재하는 squashfs 마운트(`/tmp/.mount_XXXX`) 안에
사이드카가 있다. 다른 앱(Claude Code·Codex·Claude Desktop)의 설정에 적는
`oculpm-mcp` 경로와 심 `oculpm` 은 **마운트 밖 안정 경로**로 복사해서 가리켜야
한다(`#integ-sidecar`, `#shell-shim`). `current_exe()` 대신 `$APPIMAGE` 를 본다.

## 파동 (waves)

```
W0 이식성 CI ─► W1 컴파일 기준선 (단독) ─► W2 플랫폼 레인 6개 (병렬) ─► W3 패키징·E2E ─► W4 릴리스 ─► W5 베타 운영
                  proc.rs · 테스트 게이트 · PORT-STUB
```

| 파동 | 세션 | 끝나는 조건 |
|---|---|---|
| W0 | 오케스트레이터 | `portability.yml` 이 돌고, 첫 실행의 오류 전수가 `02-error-inventory.md` 에 레인별로 배정됨 |
| W1 | 단독 1 | ubuntu·windows 에서 `cargo check --all-targets` · `clippy -D warnings` 초록. `cargo test` 는 **컴파일**까지(실패 테스트는 인벤토리로 레인 배정). macOS `ci.yml` 초록 |
| W2 | 병렬 6 | 각 레인 소유 범위의 테스트가 windows·ubuntu 러너에서 실행돼 초록, `PORT-STUB` 0건, macOS 불변 |
| W3 | 병렬 2 (패키징 / E2E) | 설치 파일이 만들어지고, E2E·설치 스모크가 두 OS 에서 초록, 스크린샷 아티팩트 |
| W4 | 단독 1 + 사용자 결정 | 서명 결정 반영, 릴리스 매트릭스·플랫폼별 게이트, 5면 반영 |
| W5 | 사용자 + 오케스트레이터 | 졸업 기준 충족 |

## 합류 규칙

- 각 레인은 `origin/main` 에서 딴 자기 worktree·브랜치(`port/<레인>`)에서 일한다.
  인덱스·HEAD 공유 사고(메모리 `shared-git-index-parallel-sessions`)가 원천 차단된다.
- Rust 세션은 `CARGO_TARGET_DIR=<repo>/src-tauri/target` 공유. "Blocking waiting for
  file lock" 은 정상.
- **레인은 일지·플랜을 쓰지 않는다** — MCP 서버가 메인 루트를 보고, 여러 세션의
  `plan_update` base_hash 가 서로 충돌한다. 레인은 보고서를 돌려주고, 오케스트레이터가
  합류 때 일지와 `plan_update` 를 쓴다.
- 레인은 자기 브랜치(`port/**`)를 push 해 `portability.yml` 결과를 **conclusion 필드로**
  확인한다(`gh run watch --exit-status` 는 취소된 run 도 exit 0 — 메모리). `ci.yml`(macOS)은
  PR 에서만 돌므로 레인은 로컬 macOS 게이트로 대신하고, PR 은 오케스트레이터가 합류 때 연다.
- 합류 순서는 W2 안에서 **L-PTY → L-FS → L-INTEG → L-SHELL → L-OS → L-UI** (컴파일 영향이 큰
  순). 뒤 레인은 앞 레인 합류 후 rebase 하고 다시 초록을 확인한다.
- 머지는 초록이면 묻지 않고 rebase 머지 + 브랜치 삭제, 사후 보고(메모리 `no-asking-before-merge`).

## 사용자 결정이 필요한 것 (막는 파동)

| 결정 | 막는 곳 | 선택지 |
|---|---|---|
| Windows 코드 서명 | W4 | Azure Trusted Signing(월 과금, SmartScreen 신뢰 누적) / 무서명 베타(설치 때 SmartScreen "알 수 없는 게시자" 경고) |
| Linux 형식 확정 | W3 | AppImage+deb(권장, D10) / +rpm / +Flatpak |
| 외부 테스터 모집 | W5 | GitHub 이슈·디스코드 등 — 사용자 액션 |
| ~~Mac App Store 진행 여부~~ | — | **결정됨 (2026-09-23): 하지 않는다** |

## Mac App Store — 하지 않는다 (2026-09-23 사용자 결정)

App Sandbox 가 필수인데 이 앱의 핵심(내장 터미널이 띄우는 `claude`·`codex`, 다른
도구의 설정 파일 쓰기, git·LSP·DAP·ACP 실행, 임의 프로젝트 폴더 감시, 자체 업데이터,
`macOSPrivateApi`)이 샌드박스와 정면으로 부딪힌다. MAS 판은 기록 루프가 빠진 **다른
제품(Lite)** 이 된다. 사용자가 출시하지 않기로 했다. macOS 배포는 지금처럼 Developer ID
서명·공증 + 자체 업데이터로 간다. 판단 근거(기능별 표)는
[`03-mas-feasibility.md`](03-mas-feasibility.md) 에 남긴다 — 다시 논의가 열리면 여기서 출발한다.

## 문서

- [`01-lane-briefs.md`](01-lane-briefs.md) — 파동·레인별 브리프(병렬 세션에 그대로 넘기는 지시문)와 파일 소유 표
- [`02-error-inventory.md`](02-error-inventory.md) — 층별 오류 인벤토리(앞 층이 막으면 뒤 층이 안 보인다)와 레인 배정
- [`03-mas-feasibility.md`](03-mas-feasibility.md) — Mac App Store 기능별 샌드박스 호환 표 (결정: 하지 않는다 — 근거 기록)
