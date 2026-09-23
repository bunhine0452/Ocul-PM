# 레인 브리프 — 병렬 세션에 그대로 넘기는 지시문

`00-master-plan.md` 의 D1~D10 을 전제로 한다. 각 절은 **한 세션의 지시문**이다.
오케스트레이터는 「공통 규칙」 + 해당 레인 절을 이어 붙여 넘긴다.

## 파일 소유 표 (W2)

한 파일은 한 레인만 고친다. 표에 없는 `src-tauri/src/**` 는 **L-OS** 소유.

| 레인 | 소유 (고쳐도 되는 곳) |
|---|---|
| L-PTY | `src-tauri/src/ptyhost/**` · `src-tauri/src/commands/terminal.rs` · `src-tauri/src/main.rs` 의 `--pty-host` 분기 · `src-tauri/tests/ptyhost_*.rs` |
| L-SHELL | `src-tauri/src/oculpm/shell_integration/**` · `src-tauri/src/oculpm/shim.rs` · `src-tauri/src/acp/env.rs` · `src-tauri/tests/acp_login_shell.rs` |
| L-INTEG | `src-tauri/src/oculpm/mcp/register.rs` · `oculpm/mcp/codex.rs` · `oculpm/claude_hooks.rs` · `oculpm/paths.rs` · `src-tauri/src/bin/oculpm_mcp.rs` · `src-tauri/src/commands/mcp.rs` · `src-tauri/build.rs` · `plugin/**` · `scripts/build-sidecar.mjs` · `src-tauri/tests/plugin_manifest.rs` · `src-tauri/tests/delivery_gate.rs` |
| L-FS | `src-tauri/src/oculpm/atomic_io.rs` · `oculpm/lock.rs` · `oculpm/watcher/**` · `oculpm/index/**` · `oculpm/frontmatter/**` · `oculpm/markdown.rs` · `oculpm/entry_diffs.rs` · `src-tauri/src/journal_index.rs` · `src-tauri/src/git/**` · **(W1 뒤 추가)** `src-tauri/src/indexer.rs` · `oculpm/rule_scope.rs` · `oculpm/redact.rs` · `oculpm/verdict/markers.rs` · `oculpm/a2a/registry.rs`(pid 생사) · 새 파일 `src-tauri/src/pid.rs` · 테스트 `journal_create_two_process` · `plan_cas_two_process` · `plan_parallel_write` · `local_diff` · `nested_repo_paths` · `oculpm_lock_scope` · `watcher_backpressure` |
| L-OS | 나머지 `src-tauri/**` (`lib.rs` · `deeplink.rs` · `tray.rs` · `menu.rs` · `secrets.rs` · `commands/window/**` · `commands/{themes,external_editor,open_native,greenfield,notion,skills}.rs` · `dap/**` · `lsp/**` · `acp/adapter.rs` · `mobile_bridge/**` · `plugins/**` · `Cargo.toml`) + 나머지 `src-tauri/tests/*` |
| L-UI | `src/**` (단 `src/lib/bindings.ts` 제외) · `index.html` |

공유 핫스팟: `src-tauri/src/lib.rs`(L-OS 소유지만 다른 레인이 한 줄 필요할 수 있다) ·
`src-tauri/Cargo.toml`(L-OS) · `src/lib/bindings.ts`(생성물). **다른 레인은 여기를
고치지 않고 보고서의 「합류 때 필요한 변경」 에 정확한 diff 를 적는다.**

W1 뒤에 정해진 것:
- **`src-tauri/src/proc.rs` 는 어느 레인 소유도 아니다** (W1 산출물). 고칠 일이 생기면 보고서에 diff.
  Windows 에서 `creation_flags` 를 다시 부르면 **덮어쓴다** — 추가 플래그는 `proc::CREATE_NO_WINDOW` 와 OR 해서 넘긴다.
  PATHEXT 해석은 **부모 프로세스 PATH** 기준이다 — `.env("PATH", …)` 로 자식 PATH 를 바꾸는 호출부는 전체 경로를 넘겨야 한다.
- **`windows-sys` 0.61 은 이미 열려 있다** (Win32_Foundation · Security(+Authorization) · Storage_FileSystem ·
  System_Console · Diagnostics_ToolHelp · JobObjects · Pipes · ProcessStatus · Threading). 더 필요한 feature 는 보고서에 적는다.
- **pid 생사 판정은 L-FS 가 `src-tauri/src/pid.rs` 한 곳에** 만들고 `lock.rs`·`a2a/registry.rs` 가 쓴다
  (Windows: `OpenProcess` + `GetExitCodeProcess`, `STILL_ACTIVE`). L-PTY 가 호스트 생사에 필요하면 합류 뒤 가져다 쓴다.
- portability.yml 잡 API 의 단계 `conclusion` 은 continue-on-error 때문에 **늘 success** 다. 판정은 잡 로그의
  「요약」 표(outcome)나 아티팩트로 한다.
- **Windows 전용 코드의 컴파일 피드백을 20초에** (L-FS2 고안): `rustup target add x86_64-pc-windows-msvc` 뒤
  가짜 cc·ar·rc(빈 산출물만 만드는 python 스크립트)를 `CC_/CXX_/AR_/RC_x86_64_pc_windows_msvc` 로 넘기고 별도
  `CARGO_TARGET_DIR` 에서 `cargo clippy --lib --tests --target x86_64-pc-windows-msvc -- -D warnings`. check 는 링크를
  안 하므로 통과한다. **실행·링크 검증은 아니다** — push 전 오타·타입 오류를 거르는 용도. 레시피는 메모리
  `windows-cargo-check-on-mac`.

---

## 공통 규칙 (모든 레인 지시문 맨 앞에 붙인다)

```
너는 Ocul-PM(Tauri 2 · Rust + React) 크로스플랫폼 라운드의 한 레인을 맡은 병렬 세션이다.
설계 SSOT: docs/20260923_cross-platform/00-master-plan.md (D1~D10) — 먼저 읽어라.
사용자는 Windows·Linux 를 직접 테스트할 수 없다. 그래서 GitHub Actions 러너가 실기기다.

작업 환경
- 너는 격리된 git worktree 에 있다. 브랜치 이름은 port/<레인> 으로 바꿔라
  (git branch -m port/<레인>). 기준은 origin/main 이다.
- Rust 빌드는 CARGO_TARGET_DIR=/Users/kimhyunbin/Desktop/git/ai-pm/src-tauri/target 을
  공유한다. "Blocking waiting for file lock" 은 정상이다.
- node_modules 가 없으면 `pnpm install --frozen-lockfile` 을 먼저.
- gh 는 PATH 에 없다: /opt/homebrew/bin/gh 절대경로로 부른다.
- pnpm tauri dev / 앱 실행 금지 (설치본이 떠 있으면 app-data·락이 경합한다).

금지
- 소유 표 밖의 파일 수정 (필요하면 보고서에 diff 로 적어라).
- 새 Tauri 커맨드 추가, src/lib/bindings.ts 손편집.
- journal_write · plan_update · plan_create (오케스트레이터가 쓴다).
- git add -A · 디렉터리 경로 stage. 파일 단위 명시 경로만.
- main 에 push, 머지, 태그.
- macOS 동작 변경. 공유 코드는 cfg 로 가르고 macOS 경로는 그대로 둔다.
- 조용한 폴백. 아직 못 하는 것은 명시적 에러 + `// PORT-STUB(<레인>)` 주석.

완료 조건 (D1 — "컴파일된다" 는 완료가 아니다)
1. 로컬(macOS): src-tauri 에서 cargo fmt --check · cargo clippy --all-targets --locked -- -D warnings ·
   cargo test --locked 초록. 프런트를 고쳤다면 pnpm typecheck · pnpm test · pnpm lint · pnpm build 초록.
   **Rust 만 고쳤어도 저장소 루트에서 `node scripts/check-file-sizes.mjs`** — 800줄을 넘은 파일은 더
   늘리면 안 되는 래칫이고, 이 게이트는 ci.yml 의 프런트 잡에서 돈다(W1 이 PR #32 에서 여기 걸렸다:
   ptyhost/host/mod.rs 810→840). 늘어야 하면 새 파일로 뗀다.
2. 브랜치(port/<레인>)를 push 하면 portability.yml(windows·ubuntu)이 돈다. 결과는
   `gh run view <id> --json jobs --jq '.jobs[]|{name,conclusion}'` 의 conclusion 과
   아티팩트 로그(`gh run download <id>`)로 확인. 네 소유 범위의 테스트가 windows·ubuntu 에서
   **실행되어** 통과해야 한다. 다른 레인 소유의 실패는 무시하되 보고서에 적는다.
   ci.yml(macOS)은 PR 에서만 돈다 — PR 은 오케스트레이터가 합류 때 연다. 레인은 1번의
   로컬 macOS 게이트로 대신한다. Windows 콜드 빌드는 40분 이상 걸린다: 한 번에 여러 수정을
   묶어 push 하고, 기다리는 동안 로컬에서 다음 것을 준비한다.
3. 네가 고친 동작마다 그 OS 러너에서 실제로 도는 테스트가 있어야 한다
   (#[cfg(windows)] 테스트는 windows 러너에서 돈다 — 로그에서 테스트 이름이 보이는지 확인).
4. 네 소유 범위에 PORT-STUB 이 남아 있으면 완료가 아니다.

보고서 (마지막 메시지 — 오케스트레이터가 이것으로 일지와 플랜을 쓴다)
- 브랜치 이름과 마지막 커밋 SHA (git rev-parse 로 읽을 것)
- 플랜 항목 id 별: 무엇을 했고 어느 테스트가 어느 OS 에서 돌았는지
- CI run URL 과 잡별 conclusion
- 남은 PORT-STUB · 실패 테스트(소유 레인 추정) · CI 로 못 본 것
- 합류 때 필요한 변경(소유 밖 파일)의 정확한 diff
- 한국어로.
```

---

## W1 · L-BASE — 컴파일 기준선 (단독, W2 전에)

플랜 항목: `#w1-proc` `#w1-proc-gate` `#w1-test-gates` `#w1-compile-green`

소유: `src-tauri/**` 전부 (단독 파동이라 충돌 없음). 단 **기계적 변경만** 한다 — 동작
구현은 W2 레인의 몫이다.

1. **`src-tauri/src/proc.rs`** — 프로세스 생성 단일 창구.
   - `pub fn std_cmd(program) -> std::process::Command` / `pub fn tokio_cmd(program) -> tokio::process::Command`.
   - Windows: `creation_flags(CREATE_NO_WINDOW)` (0x0800_0000). `program` 에 확장자가 없고
     절대경로가 아니면 `PATHEXT` 순서로 PATH 를 뒤져 `.exe`/`.cmd`/`.bat` 를 찾는다.
     `.cmd`/`.bat` 는 `cmd /C` 로 감싸야 인자가 안전하다 — 인자 인용 규칙을 테스트로 고정.
   - 그 밖의 OS: 지금과 같은 `Command::new` 그대로(동작 불변).
   - `src-tauri/src` 와 `src-tauri/src/bin` 의 `Command::new` 전부(~40곳, `rg -n "Command::new" src`)를
     이 함수로 옮긴다. `tests/` 의 것은 그대로 둬도 된다.
   - `tests/egress_inventory.rs` 가 초록인지 확인(외부 호출 원장).
2. **재발 게이트** — `src-tauri/clippy.toml` 의 `disallowed-methods` 로
   `std::process::Command::new` · `tokio::process::Command::new` 금지, `proc.rs` 안에서만
   `#[allow(clippy::disallowed_methods)]`.
3. **유닉스 전용 테스트 게이트** — `std::os::unix::*` 를 쓰는 테스트(`rg -ln "std::os::unix" src tests`)에
   `#[cfg(unix)]`. 심링크 테스트 중 Windows 에서도 의미 있는 것(경로 탈출 가드)은
   `// PORT-TEST(L-FS)` 주석만 달고 넘긴다(Windows 판 테스트는 L-FS 가 쓴다).
4. **컴파일 초록** — windows·ubuntu 에서 `cargo check --all-targets` · `clippy -D warnings` 초록.
   - `ptyhost` 의 Unix 소켓 전송은 `#[cfg(unix)]` 로 가르고, Windows 에는 연결 시도가
     "이 OS 에서는 아직 터미널을 지원하지 않아요" 에러를 돌려주는 스텁
     (`// PORT-STUB(L-PTY)`). 다른 컴파일 오류도 같은 방식(스텁 + 담당 레인 태그).
   - `cargo test` 는 **컴파일까지**가 목표다. 실패하는 테스트 목록을 보고서에 레인별로 나눠 적는다
     (오케스트레이터가 `02-error-inventory.md` 에 옮긴다).

---

## W2 · L-PTY — 터미널 호스트 Windows

플랜 항목: `#pty-transport` `#pty-detach` `#pty-kill` `#pty-conpty` `#pty-liveness` `#pty-tests`

배경: PTY 호스트는 앱과 별도 프로세스(`--pty-host`)로 떠서 업데이트·재시작 뒤에도 셸을
살린다(메모리: 소켓 이름에 프로토콜을 담지 말 것 — 자리 고정 + 옛 자리 이어받기 + 협상).
그 설계를 Windows 로 옮기는 것이지 새로 짓는 것이 아니다.

- 전송: `tokio::net::windows::named_pipe`. 이름은 사용자별(`\\.\pipe\ocul-pm-ptyhost-<사용자 SID 또는 해시>`),
  첫 인스턴스만 만들도록 `first_pipe_instance(true)`, 보안 기술자는 현재 사용자 전용.
  Unix 쪽 `socket_candidates` 의 "옛 자리 이어받기" 규칙을 같은 모양으로.
- 호스트 분리 기동: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`.
  앱이 꺼져도 호스트가 산다.
- 세션 종료: 셸마다 Job Object 에 넣고 Kill 은 Job 종료(프로세스 트리 전체).
  `signal_session`(SIGHUP→SIGKILL) 의 Windows 대응.
- 기본 셸: `pwsh.exe` → `powershell.exe` → `%COMSPEC%`. 한글 출력: 셸 시작 시 UTF-8
  코드페이지(ConPTY + `chcp 65001` 또는 PowerShell `[Console]::OutputEncoding`).
- `ps` 로 보던 호스트/포그라운드 판정(`host/mod.rs` 의 `ps` 호출)을 Windows 에서는
  Toolhelp32 스냅숏 또는 `sysinfo` 로. 새 크레이트가 필요하면 보고서에 적는다(Cargo.toml 은 L-OS 소유).
- 테스트(**windows 러너에서 실행**): 세션 열기 → `echo 한글-ok` → 출력에서 단언 → 리사이즈 →
  Kill 뒤 자식 프로세스 0 → 앱 측 클라이언트 재접속(`ptyhost_reattach` 의 Windows 판).
- W1 이 남긴 스텁 6곳(`rg -n "PORT-STUB\(L-PTY\)" src-tauri`): `ptyhost/mod.rs` `UNSUPPORTED_OS` ·
  `host/mod.rs` 비-unix `allow(dead_code)`·`signal_session` no-op·`serve` · `client.rs` `connect_transport`·`spawn_host_process`.
  `spawn_if_missing=false` 경로는 Windows 에서 `Ok(None)`(호스트 없음)을 돌려준다.
- 파일 머리가 `#![cfg(unix)]` 라 Windows 에서 0건인 `tests/ptyhost_reattach.rs` · `ptyhost_write_backpressure.rs` 를 Windows 에서도 돌게.

## W2 · L-SHELL — 셸 통합 · 심

플랜 항목: `#shell-pwsh` `#shell-linux` `#shell-shim` `#shell-env` `#shell-tests`

- PowerShell 용 OSC 133(명령 시작·끝)·OSC 7(cwd) 스크립트. 기존 zsh/bash 규율을 그대로:
  nonce 없으면 전부 불신, 사용자 rc 를 우리가 대신 source 하지 않는다(ZDOTDIR 우회 금지와 같은 이유).
  설치 위치는 `$PROFILE.CurrentUserAllHosts` 의 관리 블록(`atomic_io::write_managed_block`, 주석 스타일 `#`).
- `shell_integration/mod.rs` 의 기본값 `/bin/zsh`(SHELL 이 없을 때)는 Linux 에서 `/bin/bash`,
  Windows 에서 pwsh 판정으로.
- 심: Windows 는 `oculpm.exe` 복사본(이미 있음)을 실제로 검증, `oculpm.cmd` 가 필요한지 판단.
  AppImage 에서는 `current_exe()` 가 마운트 안을 가리킨다 → `$APPIMAGE` 가 있으면 그것.
- `acp/env.rs` 의 로그인 셸 환경 캡처: Windows 는 셸 캡처 없이 프로세스 환경을 쓰는지,
  Linux 는 `$SHELL -lic` 가 맞는지 확인.
- 테스트: 스크립트 렌더·관리 블록 설치/제거·nonce 규칙이 windows·ubuntu 에서 실행.
  pwsh 는 windows 러너에 기본 설치돼 있다 — 실제 pwsh 에 스크립트를 로드해 OSC 133 이
  출력되는지 단언하는 통합 테스트를 하나 둔다.
- W1 windows 실패(네 몫): `acp::env::tests::search_path_skips_missing_and_empty_segments` — PATH 를 `:` 로 나눠
  `C:\…` 가 깨진다(`std::env::split_paths` 로).

## W2 · L-INTEG — 외부 도구 연동 경로

플랜 항목: `#integ-paths` `#integ-sidecar` `#integ-plugin-bin` `#integ-hooks` `#integ-build-sidecar`

- OS별 설정 파일 위치를 **한 곳**(`oculpm/paths.rs`)에서:
  Claude Desktop `~/Library/Application Support/Claude` / `%APPDATA%\Claude` / `~/.config/Claude`,
  Claude Code `~/.claude`(Windows 도 `%USERPROFILE%\.claude`), Codex `~/.codex`(`CODEX_HOME` 존중).
  홈은 `HOME` 이 아니라 `directories`/`dirs` 판정.
- 사이드카 안정 경로: Windows 는 설치 디렉터리의 `oculpm-mcp.exe`. Linux AppImage 는 기동 때
  `~/.local/share/ocul-pm/bin/oculpm-mcp` 로 복사(해시가 같으면 무접촉)하고 외부 설정엔 그 경로를 쓴다.
- `plugin/oculpm/bin/oculpm-mcp`(sh) 탐색 목록에 Windows(`$LOCALAPPDATA/Programs/Ocul-PM/oculpm-mcp.exe`,
  `$PROGRAMFILES/Ocul-PM/...`)·Linux(`/usr/bin/oculpm-mcp`, `~/.local/share/ocul-pm/bin/oculpm-mcp`) 추가.
  "플러그인 v1 은 macOS 전용" 문구 갱신. Codex 판(`plugin/oculpm-codex`)도 같이.
- 훅(`#hooks-xplat` 이월분): Claude Code 는 Windows 에서 훅을 Git Bash 로 돌린다 — 현재 sh 훅이
  Git Bash 에서 도는지(`date -u`·`mkdir -p`·`printf` 는 있다) 확인. Codex 의 Windows 훅 실행 셸은
  **조사부터**(문서·소스 근거를 보고서에). 필요하면 hooks.json 에 Windows 변형.
- `build-sidecar.mjs`: 이미 `.exe` 를 붙인다 — Windows 러너에서 실제로 돌려 `binaries/oculpm-mcp-x86_64-pc-windows-msvc.exe`
  가 생기는지 portability.yml 에서 확인(잡 추가가 필요하면 보고서에 diff).
- 테스트: 경로 표를 OS별 단위 테스트(windows·ubuntu 러너), `tests/plugin_manifest.rs` 초록,
  `tests/delivery_gate.rs`(sh 훅 실행)가 Windows 에서 Git Bash 로 도는지 또는 명시적 skip + 사유.
- W1 windows 실패(네 몫): `oculpm::mcp::register::tests::codex_register_collapses_legacy_pinned_entries` —
  TOML 기본 문자열 안의 `\` 가 "invalid unicode escape". 픽스처만의 문제인지, **실제로 Windows 경로를 config.toml 에
  쓰는 코드**가 같은 문제를 내는지(리터럴 문자열 `'…'` 또는 이스케이프) 둘 다 확인.
- `tests/delivery_gate.rs` 는 파일 머리가 `#![cfg(unix)]` 라 Windows 에서 0건이다.

## W2 · L-FS — 경로 · 파일 의미론

플랜 항목: `#fs-separators` `#fs-crlf` `#fs-atomic` `#fs-watch` `#fs-git` `#fs-lock` `#fs-symlink-tests`

- `.oculpm` 안에 저장되는 상대경로(일지 `files_touched`, 인덱스, 플랜 journal_ref, diff sidecar)는
  **항상 `/`**. `to_string_lossy()` 로 경로를 문자열화하는 곳을 전수 확인
  (`rg -n "to_string_lossy|display\(\)" src/oculpm src/journal_index.rs src/git`).
- CRLF: git `core.autocrlf=true` 인 Windows 체크아웃에서 frontmatter·관리 블록·plan-log 테이블 파서가
  견디는지. 쓰기는 파일의 기존 EOL 을 보존(`atomic_io::detect_eol` 선례).
- 원자적 쓰기: Windows 에서 대상이 다른 프로세스(에디터·백신)에 열려 있으면 `rename` 이
  `ERROR_SHARING_VIOLATION`/`ACCESS_DENIED` 로 실패한다 — 짧은 재시도·백오프, 끝내 실패하면 에러(조용히 삼키지 않기).
  `write_atomic_new` 의 `hard_link` 경로가 NTFS 에서 도는지.
- 락(`lock.rs`): `ps` 로 보는 프로세스 판정의 Windows 대응(`OpenProcess` + `GetExitCodeProcess`).
- 워처: `notify` 의 Windows 백엔드(ReadDirectoryChangesW) 이벤트 모양 차이(rename 쌍, 대소문자),
  긴 경로(`\\?\`). `watcher_backpressure` 가 windows 에서 도는지.
- git: `core.quotepath`(메모리 — 한국어 경로 8진수), 출력 경로 구분자, `core.autocrlf` 로 인한 가짜 diff.
- W1 이 `PORT-TEST(L-FS)` 로 표시한 심링크 테스트의 Windows 판(정션/심링크 권한 없으면 skip 사유 명시).
- 테스트는 전부 windows·ubuntu 러너에서 실행.
- W1 windows 실패(네 몫, 12건):
  - 구분자: `indexer::walk_tests::gitignore_is_honored_without_a_git_dir` · `vendor_dirs_are_denied_without_any_gitignore`
    (`src\a.ts`), `oculpm::rule_scope::tests::walk_honors_gitignore_and_denies_vendor_dirs`,
    `oculpm::redact::tests::forbidden_absolute_path_matches`(ignore 크레이트 "path is expected to be under the root" 패닉 — unix 절대경로 픽스처)
  - watcher: `oculpm::watcher::tests::{agents_template_change_emits_without_panic, journal_change_emits_without_panic,
    local_history_writes_never_re_trigger_the_watcher, rapid_writes_to_same_file_debounced_to_one}` —
    `\` 가 섞여 emit 분류·자기 억제가 빗나가고 Create/Modify 병합 모양도 다름. `watcher_backpressure::prefilter_never_swallows_what_the_consumer_judges_first`
  - git: `git::tests::nested_repo_below_root_is_diffable`(`diff_patch` 빈 결과)
  - pid 생사: `oculpm::lock::tests::acquire_recovers_immediately_when_holder_pid_is_dead` + a2a 4건
    (`a2a::leases::…a_dead_holder_releases_the_ground_before_its_deadline` · `a2a::registry::…a_dead_pid_is_dead_however_fresh_the_heartbeat` ·
    `…a_live_pid_gone_quiet_for_ages_is_treated_as_recycled` · `mcp::tools::tests::a2a::reading_the_inbox_sweeps_the_dead_and_closes_the_overdue`)
    — 전부 `pid.rs` 하나로 풀린다. `ledger-and-liveness-honesty` 의 "모르면 Unknown" 규칙은 유지(Windows 는 이제 **안다**).
  - mtime: `oculpm::verdict::markers::tests::the_live_trace_is_refreshed_every_time`(`touch_live` 가 mtime 갱신 안 함)

## W2 · L-OS — 나머지 OS 분기

플랜 항목: `#os-compile` `#os-deeplink` `#os-tray-menu` `#os-secrets` `#os-tools` `#os-single-instance`

- W1 인벤토리의 잔여 실패 중 소유 표상 L-OS 것 전부.
- 딥링크: Windows·Linux 는 `oculpm://` 가 **두 번째 인스턴스의 argv** 로 온다. 지금
  `single_instance::init(|app, _argv, _cwd| …)` 가 argv 를 버린다 → argv 에서 URL 을 찾아
  `deeplink::dispatch`. `tauri-plugin-single-instance` 의 `deep-link` feature 검토.
  Linux·Windows 개발 빌드는 런타임 `register_all()` 필요 여부.
- 트레이·메뉴·창: `tray.rs` 의 투명 팝오버(`macOSPrivateApi`)는 비-mac 에서 불투명·위치 규칙,
  `TitleBarStyle::Overlay` 는 mac 한정 확인.
- **`menu.rs` — 비-mac 에서 앱 메뉴를 달지 않는다 (L-UI 합류 뒤 필수, `#os-no-menu`).** 메뉴
  액셀러레이터가 `CmdOrCtrl+W/T` 와 Edit 의 `Ctrl+C/V/X/Z/A` 다. Linux(GTK)는 창 액셀러레이터가
  웹뷰보다 먼저 받아 **터미널의 Ctrl+W 가 페인을 닫고 Ctrl+C 가 SIGINT 대신 복사가 될** 공산이 크다.
  Windows(WebView2)는 반대로 웹뷰 포커스 중 액셀러레이터가 안 들릴 공산이 크다. L-UI 가 이미
  ⌘T/⌘W 를 비-mac 에서 keydown(`useWindowTabKeys`)으로 받고 편집 키는 웹뷰 기본이 처리한다.
  L-UI 가 제안한 diff: `apply()` 첫머리에 `#[cfg(not(target_os = "macos"))] { let _ = (app, lang); return Ok(()); }`.
  그러면 비-mac 의 새 창(⇧⌘N) 키가 없어진다 — 필요하면 `new_window` 커맨드(오케스트레이터 합류 때).
  테스트: 비-mac 에서 메뉴가 붙지 않음을 단언하는 단위 테스트(windows·ubuntu 러너).
- 비밀 저장(`secrets.rs`): Linux 에 Secret Service 가 없으면 **평문 저장 없이** 명확한 에러와
  설정 화면 안내 문구 키(프런트 문구는 L-UI 에 보고).
- 외부 도구: `dap/registry.rs` 의 `xcrun`(mac 전용 → 비-mac 은 PATH 의 `lldb-dap`/`codelldb`),
  `themes.rs` 의 `defaults`(비-mac 은 None — 이미 cfg 인지 확인), `external_editor.rs`·`greenfield.rs`
  Windows 후보 경로 검증, `acp/adapter.rs` 의 `npx`(`npx.cmd`)가 `proc.rs` 로 풀리는지.
- 테스트: 딥링크 argv 파싱 순수 함수 + 단위 테스트, DAP/에디터 후보 경로 표 테스트 — windows·ubuntu 러너.
- W1 windows 실패(네 몫): `acp::recording::tests::candidates_follow_the_shuttle_vocabulary` — `.app/Contents/MacOS` 경로 기대.
- W1 이 찾은 원래부터의 조용한 폴백(D4): `commands/code/import.rs` 비-mac `clipboard_file_paths` 가 빈 Vec,
  `lsp/client.rs` `kill_on_drop` 이 unix 한정(Windows 에서 LSP 자식이 안 정리될 수 있음).
- 실행 확인 필요: `trash`(COM STA 모드)가 tokio 워커 스레드에서 Windows 휴지통 이동을 실제로 하는지 — windows 러너 통합 테스트.
- PATHEXT 는 부모 PATH 기준 — `acp/adapter.rs`(npm/npx)·LSP·DAP 가 자식 PATH 를 바꿔 넘기며 맨 이름을 쓰면 `.cmd` 를 못 찾는다.
- `#![cfg(unix)]` 라 Windows 0건인 통합 테스트 `acp_journal_gate` · `resume_context` · `session_verdict` — Windows 에서도 의미 있게.

## W2 · L-UI — 프런트엔드 플랫폼 추상화

플랜 항목: `#ui-platform` `#ui-shortcuts` `#ui-labels` `#ui-chrome` `#ui-ime` `#ui-tests`

- `src/lib/platform.ts`: OS 판정 단일 창구(`navigator.userAgent` — WebView2 는 `Windows`,
  WebKitGTK 는 `Linux`). `navigator.platform` 4곳 교체. 새 Tauri 플러그인(os) 도입은 하지 않는다.
- 단축키: 매칭은 mac=`metaKey`, 그 외=`ctrlKey` (지금은 `metaKey || ctrlKey` 가 섞여 있다).
  **터미널 포커스 시 셸 키 양보** — Windows/Linux 에서 Ctrl+C/D/K/L/R/U/W/Z 는 셸의 것이다.
  전역 단축키가 이들과 겹치면 터미널 포커스 중엔 Ctrl+Shift 변형만 받는다. 복사/붙여넣기는 Ctrl+Shift+C/V.
  `hooks/useGlobalShortcuts.ts`·`terminalSurface/useTerminalKeys.ts`·`navRegistry.ts` 가 중심.
- 표기: `⌘` 리터럴(476곳, `rg -c "⌘" src`)을 수정키 표기 함수(`modLabel("K")` → `⌘K` / `Ctrl+K`)와
  i18n 치환으로. `⇧⌥⌃` 도 같이. i18n 글로서리 테스트(해요체 강제)를 지킨다.
- 창 크롬: 비-mac 은 네이티브 제목줄 — 트래픽라이트 여백(`TRAFFIC_LIGHT_INSET`)·드래그 영역이 mac 한정인지,
  WebView2 기본 스크롤바 스타일, 폰트 폴백(번들 Pretendard/D2Coding 확인).
- 터미널 IME(`features/terminal/imeBridge.ts`): WKWebView 버그 우회가 Chromium(WebView2)·WebKitGTK 에서
  해가 되지 않는지 — UA 로 갈라야 하는 분기를 찾고 vitest 로 조합 이벤트 시퀀스(Chromium 모양)를 재현.
- 테스트: 세 UA(mac/win/linux)로 단축키 매칭·표기 테이블 vitest. `pnpm lint`(design·i18n 게이트) 초록.
- 백엔드가 줄 에러 문구(예: L-OS 의 Secret Service 안내)는 키만 받아 번역을 넣는다.

---

## W3 · L-PKG — 번들 설정

플랜 항목: `#w3-conf` `#w3-bundles`

- `src-tauri/tauri.windows.conf.json`: NSIS, `installMode: currentUser`, WebView2
  `webviewInstallMode`(embedBootstrapper 권장 — 오프라인 설치 대응), 한국어/영어 설치 언어.
- `src-tauri/tauri.linux.conf.json`: `targets: ["appimage","deb"]`, deb 의존(`libwebkit2gtk-4.1-0` 등).
- `tauri.conf.json` 불변(D3). portability.yml 에 `tauri build` 잡(windows·ubuntu-22.04)과 산출물 업로드.

## W3 · L-E2E — 실기기 대신 도는 끝단 테스트

플랜 항목: `#w3-e2e` `#w3-install-smoke` `#w3-ime-cdp` `#w3-updater-smoke`

- `tauri-driver`(WebDriver) — Windows 는 WebView2 버전에 맞는 `msedgedriver`, Linux 는
  `webkit2gtk-driver` + `xvfb-run`. macOS 는 tauri-driver 미지원이라 대상 아님.
- 시나리오: 기동 → 시작 탭 → 픽스처 프로젝트 추가 → navRegistry 15화면 각각 렌더(에러 경계 0) →
  터미널 열고 `echo 한글-ok` 왕복 → 사이드카 `oculpm-mcp` 로 `journal_write` → 일지 화면에 반영.
  각 단계 스크린샷을 아티팩트로 — **사용자가 기기 없이 눈으로 보는 유일한 창구**다.
- 설치 스모크: NSIS `/S` 설치 → 설치된 exe 실행 → 로그 파일에 기동 줄 → 제거. deb `dpkg -i` · AppImage 실행.
- IME: WebView2 에 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`,
  CDP `Input.imeSetComposition` → `Input.insertText` 로 한글 조합을 흉내 내 터미널에 `한글` 도착 단언.
- 업데이터: 버전 N 설치 → 로컬 HTTP 의 `latest.json`(N+1, 테스트 키 서명) → 업데이트 적용 확인.
- 새 워크플로 `.github/workflows/e2e.yml`, 테스트 코드는 `e2e/`.

## W4 · L-REL — 릴리스 파이프라인

플랜 항목: `#w4-release-matrix` `#w4-latest-json` `#w4-surfaces` (서명은 `#w4-signing-decision` 사용자 결정 뒤)

- `release.yml` 매트릭스에 windows-latest · ubuntu-22.04. **macOS 잡과 검증 단계를 분리** —
  비-mac 실패가 draft 를 막지 않고, 그 플랫폼 항목만 `latest.json` 에서 빠진다(D7).
- 플랫폼별 검증: Windows 서명 시 `signtool verify /pa`, updater `.sig` 존재, Linux AppImage `.sig`.
- `docs/RELEASE.md` 절차 갱신, README ko/en 지원 표(베타), 랜딩 ko/en 다운로드 버튼, CHANGELOG.
  메모리 `release-checklist-three-surfaces` 의 5면을 전부.
