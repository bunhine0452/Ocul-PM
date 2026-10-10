//! 판정 D 의 원장 — 데이터만. 판정과 스캐너는 `tests/egress_spawn_ledger.rs`.
//!
//! 항목 하나가 "이 함수가 이것을 띄운다, 그리고 그것은 나가는가" 의 답이다. 새 기동
//! 자리를 붙이면 판정 D1·D2 가 여기로 보낸다.

use super::{Fixtures, Launch, Reach};

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 출시 코드 (D1)
// ─────────────────────────────────────────────────────────────────────────────

const GIT_LOCAL: &str = "git 로컬 하위 명령만 — 네트워크 하위 명령(push·fetch·pull·clone·ls-remote·submodule)은 egress_spawn_ledger.rs 의 git_stays_local_only 가 git 에 닿는 파일 전부에서 막는다. 부분 클론(promisor)의 지연 fetch 는 git::safe 가 GIT_NO_LAZY_FETCH=1 로 끈다(2.44 미만 git 은 이 변수를 모른다).";

pub(super) const APP_LAUNCHES: &[Launch] = &[
    // ── 송출 가능 ──
    Launch {
        path: "acp/adapter.rs",
        func: "install_tree",
        call: "tokio_cmd(npm)",
        reach: Reach::Network("사용자가 Claude Code·Codex 화면에서 어댑터를 처음 설치할 때 — registry.npmjs.org"),
        reason: "`npm ci --ignore-scripts` 가 고정 lockfile(acp-lock/, sha512 무결성)의 패키지만 받는다. 설치 스크립트는 돌지 않고 트리 밖 버전은 lockfile 이 거부한다. npm 은 resolve_binary 가 PATH 에서 찾은 사용자의 것.",
    },
    Launch {
        path: "acp/process.rs",
        func: "start",
        call: "AcpAgentConfig::new(node)",
        reach: Reach::Network("사용자가 신뢰한 프로젝트에서 Claude Code·Codex 화면을 열 때 — 그 CLI 의 제공자(사용자 계정)"),
        reason: "agent-client-protocol 크레이트가 node 로 어댑터를 띄우고, 어댑터가 claude/codex CLI 를 띄운다. 그 CLI 의 제공자 트래픽은 CLAUDE.md 송출 목록의 「Claude Code/Codex inside the app」 이다. 시작 전 trust::require_for_agent.",
    },
    Launch {
        path: "commands/greenfield.rs",
        func: "run_scaffold_cli",
        call: "std_cmd(&cmd)",
        reach: Reach::Network("사용자가 새 프로젝트 마법사에서 스택을 고르고 만들 때 — npm 레지스트리"),
        reason: "마법사 프리셋의 `pnpm create vite` · `npx create-next-app@latest` 가 패키지를 받는다(cargo init·go mod init 은 로컬). 프로그램·인자는 웹뷰가 넘긴다 — 백엔드 허용 목록은 없다.",
    },
    Launch {
        path: "lsp/client.rs",
        func: "start",
        call: "tokio_cmd(binary)",
        reach: Reach::Network("사용자가 신뢰한 프로젝트에서 코드 파일을 열 때 — 언어 서버가 부르는 패키지 매니저"),
        reason: "lsp/registry.rs 표의 서버(rust-analyzer·typescript-language-server·pyright·gopls)를 PATH 에서 찾아 띄운다. 서버 자신이 cargo metadata·go list·타입 자동 받기로 레지스트리에 닿을 수 있다 — 앱이 시키는 것은 분석뿐.",
    },
    Launch {
        path: "dap/client.rs",
        func: "start",
        call: "tokio_cmd(&adapter.program)",
        reach: Reach::Network("사용자가 디버그를 시작할 때 — 디버그 대상은 사용자의 프로그램"),
        reason: "dap/registry.rs 가 찾은 어댑터(lldb-dap·debugpy·dlv)를 띄우고, 어댑터가 사용자의 프로그램을 실행한다. 그 프로그램이 무엇을 보내는지는 사용자의 코드다.",
    },
    Launch {
        path: "ptyhost/env.rs",
        func: "shell_command",
        call: "CommandBuilder::new(shell)",
        reach: Reach::Network("사용자가 터미널에 친 명령"),
        reason: "내장 터미널의 셸 — portable-pty 가 PTY 호스트 안에서 띄운다. 사용자가 치는 것이 무엇이든 돈다. 앱이 셸에 스스로 치는 명령은 없다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "open_url",
        call: "std_cmd(\"open\")",
        reach: Reach::Network("open_url 의 스킴 가드 — http/https/mailto 만, OS 브라우저가 연다"),
        reason: "macOS — 링크를 기본 브라우저에 넘긴다. 앱이 보내는 것이 아니라 사용자의 브라우저가 연다 (egress_inventory A 의 같은 파일 사유).",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "open_url",
        call: "std_cmd(\"xdg-open\")",
        reach: Reach::Network("open_url 의 스킴 가드 — http/https/mailto 만, OS 브라우저가 연다"),
        reason: "Linux — 위와 같다. 인자는 셸을 거치지 않고 그대로 넘긴다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "open_url",
        call: "shell_open(std::ffi::OsStr::new(trimmed))",
        reach: Reach::Network("open_url 의 스킴 가드 — http/https/mailto 만, OS 브라우저가 연다"),
        reason: "Windows — cmd 를 거치지 않고 ShellExecute(opener) 로. `cmd /C start` 는 쿼리의 `&` 뒤를 명령으로 실행했었다.",
    },
    Launch {
        path: "commands/notion.rs",
        func: "open_in_browser",
        call: "std_cmd(\"open\")",
        reach: Reach::Network("사용자가 Notion 연결을 켤 때 — OAuth 동의 페이지를 OS 브라우저로"),
        reason: "macOS — notion.rs 가 조립한 동의 URL 을 브라우저에 넘긴다. 콜백은 127.0.0.1 루프백이 받는다.",
    },
    Launch {
        path: "commands/notion.rs",
        func: "open_in_browser",
        call: "std_cmd(\"xdg-open\")",
        reach: Reach::Network("사용자가 Notion 연결을 켤 때 — OAuth 동의 페이지를 OS 브라우저로"),
        reason: "Linux — 위와 같다.",
    },
    Launch {
        path: "commands/notion.rs",
        func: "open_in_browser",
        call: "shell_open(std::ffi::OsStr::new(url))",
        reach: Reach::Network("사용자가 Notion 연결을 켤 때 — OAuth 동의 페이지를 OS 브라우저로"),
        reason: "Windows — ShellExecute(opener). `cmd /C start` 는 `&state=` 에서 끊겨 state 없이 열렸었다.",
    },
    // ── 창구 ──
    Launch {
        path: "proc.rs",
        func: "std_cmd",
        call: "Command::new(path)",
        reach: Reach::Relay,
        reason: "프로세스 생성 단일 창구 — Windows 에서 PATHEXT 로 찾은 배치 파일의 전체 경로. 부르는 쪽이 전부 이 원장에 있다.",
    },
    Launch {
        path: "proc.rs",
        func: "std_cmd",
        call: "Command::new(program)",
        reach: Reach::Relay,
        reason: "프로세스 생성 단일 창구 — 부르는 쪽이 준 이름 그대로. 부르는 쪽이 전부 이 원장에 있다.",
    },
    Launch {
        path: "proc.rs",
        func: "tokio_cmd",
        call: "std_cmd(program)",
        reach: Reach::Relay,
        reason: "비동기 창구 — std_cmd 를 tokio 의 Command 로 옮길 뿐이다. 부르는 쪽이 전부 이 원장에 있다.",
    },
    Launch {
        path: "proc/detached.rs",
        func: "spawn_detached",
        call: "CreateProcessW(application.as_ptr(), …)",
        reach: Reach::Relay,
        reason: "Windows 분리 기동(bInheritHandles = FALSE) — 부르는 쪽(PTY 호스트 기동)이 이 원장에 있다.",
    },
    Launch {
        path: "commands/open_native.rs",
        func: "shell_open",
        call: "tauri_plugin_opener::open_url(target.to_string_lossy(), …)",
        reach: Reach::Relay,
        reason: "Windows 의 OS 기본 처리기 위임(ShellExecuteExW) — URL 이든 로컬 경로든 부르는 쪽(open_url·Notion·open_native)이 정하고, 각자 이 원장에 있다.",
    },
    // ── 로컬 ──
    Launch {
        path: "git/safe.rs",
        func: "cmd",
        call: "std_cmd(\"git\")",
        reach: Reach::Local,
        reason: GIT_LOCAL,
    },
    Launch {
        path: "git/safe.rs",
        func: "read_local_config",
        call: "std_cmd(\"git\")",
        reach: Reach::Local,
        reason: "`git config --list --show-scope -z` — 저장소 설정을 읽어 필터·드라이버를 끈다. 원격에 닿지 않는다.",
    },
    Launch {
        path: "acp/env.rs",
        func: "capture_login_path",
        call: "tokio_cmd(shell)",
        reach: Reach::Local,
        reason: "로그인·대화형 셸로 PATH 를 한 번 출력받는다. 셸이 읽는 rc 파일은 사용자의 코드다 — 앱이 시키는 것은 printf 하나.",
    },
    Launch {
        path: "acp/env.rs",
        func: "node_version",
        call: "tokio_cmd(node)",
        reach: Reach::Local,
        reason: "`node --version` — 어댑터가 요구하는 Node 버전 확인.",
    },
    Launch {
        path: "commands/greenfield.rs",
        func: "check_cli_available",
        call: "std_cmd(which_cmd)",
        reach: Reach::Local,
        reason: "`which` / `where` — 마법사 프리셋의 CLI 가 설치돼 있는지 PATH 에서 찾는다.",
    },
    Launch {
        path: "commands/greenfield.rs",
        func: "get_cli_version_sync",
        call: "std_cmd(path)",
        reach: Reach::Local,
        reason: "찾은 CLI 의 `--version`. corepack 심이면 첫 실행에 제 본체를 받을 수 있다 — 사용자 도구의 동작이다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "open_in_editor",
        call: "spawn_detached(&cmd_str)",
        reach: Reach::Local,
        reason: "사용자가 설정에 적은 편집기 명령줄에 secure_join 으로 가둔 프로젝트 파일 경로를 끼워 띄운다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "shell_command",
        call: "std_cmd(\"sh\")",
        reach: Reach::Local,
        reason: "편집기 명령줄을 `sh -c` 로 — 명령줄은 사용자의 설정이고 여는 것은 로컬 파일이다(open_in_editor).",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "shell_command",
        call: "std_cmd(\"cmd\")",
        reach: Reach::Local,
        reason: "Windows 의 같은 자리 — `cmd /C` 로 편집기 명령줄을 띄운다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "reveal_in_file_manager",
        call: "std_cmd(\"open\")",
        reach: Reach::Local,
        reason: "macOS `open -R` — 프로젝트 파일을 Finder 에서 선택한 채로.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "reveal_in_file_manager",
        call: "std_cmd(\"xdg-open\")",
        reach: Reach::Local,
        reason: "Linux — 그 파일의 부모 폴더를 파일 관리자로 연다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "reveal_in_file_manager",
        call: "tauri_plugin_opener::reveal_item_in_dir(&abs)",
        reach: Reach::Local,
        reason: "Windows — 탐색기에서 선택(SHOpenFolderAndSelectItems). 로컬 경로다.",
    },
    Launch {
        path: "commands/external_editor.rs",
        func: "quick_look_file",
        call: "std_cmd(\"qlmanage\")",
        reach: Reach::Local,
        reason: "macOS 훑어보기 — 로컬 파일 미리보기.",
    },
    Launch {
        path: "commands/open_native.rs",
        func: "open_native",
        call: "std_cmd(\"open\")",
        reach: Reach::Local,
        reason: "로그 폴더·일지 파일을 OS 기본 앱으로, 그리고 앱이 조립하는 `vscode://oculpm.ocul-pm/open?entry=<로컬 경로>` (설치된 VS Code 확장으로 위임).",
    },
    Launch {
        path: "commands/open_native.rs",
        func: "open_native",
        call: "std_cmd(\"xdg-open\")",
        reach: Reach::Local,
        reason: "Linux — 위와 같다.",
    },
    Launch {
        path: "commands/open_native.rs",
        func: "open_native",
        call: "shell_open(path.as_os_str())",
        reach: Reach::Local,
        reason: "Windows — 위와 같은 대상을 ShellExecute 로.",
    },
    Launch {
        path: "commands/themes.rs",
        func: "read_system_accent",
        call: "std_cmd(\"defaults\")",
        reach: Reach::Local,
        reason: "`defaults read -g AppleAccentColor` — macOS 강조색.",
    },
    Launch {
        path: "dap/registry.rs",
        func: "xcrun_find",
        call: "tokio_cmd(\"xcrun\")",
        reach: Reach::Local,
        reason: "`xcrun --find lldb-dap` — Xcode 도구의 위치만 묻는다.",
    },
    Launch {
        path: "main.rs",
        func: "reexec_with_malloc_tuning",
        call: "std_cmd(exe)",
        reach: Reach::Local,
        reason: "macOS — 자기 자신을 MallocLargeCache=0 으로 다시 exec 한다.",
    },
    Launch {
        path: "mobile_bridge/bind.rs",
        func: "query_tailscale_cli",
        call: "std_cmd(cli)",
        reach: Reach::Local,
        reason: "`tailscale ip -4` — 로컬 데몬에 이 기기의 tailnet 주소를 묻는다. 후보는 같은 파일의 TAILSCALE_CLI_CANDIDATES 상수.",
    },
    Launch {
        path: "mobile_bridge/server.rs",
        func: "start_caffeinate",
        call: "std_cmd(\"/usr/bin/caffeinate\")",
        reach: Reach::Local,
        reason: "폰 브리지가 켜져 있는 동안 Mac 이 잠들지 않게.",
    },
    Launch {
        path: "oculpm/shell_integration/policy.rs",
        func: "probe_once",
        call: "std_cmd(shell_path)",
        reach: Reach::Local,
        reason: "Windows PowerShell `Get-ExecutionPolicy` — -NoProfile 에 업데이트 확인·원격 측정을 끄는 환경 변수(POWERSHELL_UPDATECHECK=Off · POWERSHELL_TELEMETRY_OPTOUT=1)를 준다.",
    },
    Launch {
        path: "pid.rs",
        func: "exe_name",
        call: "std_cmd(\"ps\")",
        reach: Reach::Local,
        reason: "`ps -o comm= -p <pid>` — 락을 쥔 프로세스의 이름(사람에게 보여 줄 표시용).",
    },
    Launch {
        path: "ptyhost/client.rs",
        func: "spawn_host_child",
        call: "spawn_detached(exe, …)",
        reach: Reach::Local,
        reason: "Windows — 같은 실행 파일을 `--pty-host` 로 분리 기동한다. 셸은 그 안에서 뜬다(ptyhost/env.rs).",
    },
    Launch {
        path: "ptyhost/client.rs",
        func: "spawn_host_child",
        call: "std_cmd(exe)",
        reach: Reach::Local,
        reason: "그 밖의 OS — 같은 실행 파일을 `--pty-host` 로. 업데이트에도 살아남는 터미널 호스트다.",
    },
    Launch {
        path: "ptyhost/host/mod.rs",
        func: "command_line_of",
        call: "std_cmd(\"ps\")",
        reach: Reach::Local,
        reason: "`ps` — 터미널 세션의 포그라운드 명령줄 (탭을 닫을 때 「돌고 있는 일」 확인).",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 테스트 범위 (D2)
// ─────────────────────────────────────────────────────────────────────────────

/// 테스트 범위의 기동 자리 — 파일별 사유 하나에 `(함수, 띄우는 것)` 전부.
/// 출시되는 앱에서 돌지 않는다는 것은 이 표의 주장이 아니라 스캐너의 판정이다.
pub(super) const TEST_LAUNCHES: &[Fixtures] = &[
    (
        "git/safe.rs",
        "임시 저장소에서 로컬 git — 저장소 설정이 명령을 못 돌리는지, 기한을 넘긴 자식을 죽이는지(ping·sleep).",
        &[
            ("git", "std_cmd(\"git\")"),
            ("output_kills_a_command_past_its_deadline", "std_cmd(if cfg!(windows) { \"ping\" } else { \"sleep\" })"),
            ("repo_config_cannot_run_commands_through_status_or_diff", "std_cmd(\"git\")"),
        ],
    ),
    ("git/tests.rs", "임시 저장소를 만드는 로컬 git 픽스처.", &[("git", "std_cmd(\"git\")")]),
    ("oculpm/entry_diffs_tests.rs", "임시 저장소를 만드는 로컬 git 픽스처.", &[("git", "std_cmd(\"git\")")]),
    ("oculpm/index/tests.rs", "임시 저장소를 만드는 로컬 git 픽스처.", &[("git_in", "std_cmd(\"git\")")]),
    ("oculpm/manager/tests.rs", "임시 저장소를 만드는 로컬 git 픽스처.", &[("git", "std_cmd(\"git\")")]),
    (
        "oculpm/claude_hooks.rs",
        "앱이 까는 훅 한 줄을 이 OS 의 훅 셸(sh·Git Bash)에서 실제로 돌린다. git 은 Git Bash 위치를 찾는 데만.",
        &[
            ("hook_shell", "Command::new(\"git\")"),
            ("the_installed_command_runs_under_the_platform_hook_shell", "Command::new(hook_shell())"),
        ],
    ),
    (
        "oculpm/shell_integration/live_tests.rs",
        "실제 셸을 PTY 로 띄워 셸 통합 마커를 확인하는 라이브 테스트.",
        &[
            ("base_command", "CommandBuilder::new(program)"),
            ("computed_profile_path_matches_what_the_shell_reports", "std_cmd(&shell)"),
        ],
    ),
    (
        "ptyhost/env.rs",
        "표식이 있을 때만 malloc 환경을 걷는지 — 명령을 만들어 환경만 읽고 띄우지는 않는다.",
        &[("scrubs_only_under_the_marker", "CommandBuilder::new(\"sh\")")],
    ),
    (
        "pid.rs",
        "살아 있는 남의 pid 가 필요한 자리 — 오래 도는 자식(ping·sleep).",
        &[("long_running_child", "std_cmd(\"ping\")"), ("long_running_child", "std_cmd(\"sleep\")")],
    ),
    (
        "instance_lock.rs",
        "단일 인스턴스 판정을 자식 테스트 프로세스(자기 자신)로 — 빈 임시 세션 버스.",
        &[("run_child", "std_cmd(std::env::current_exe().unwrap())")],
    ),
    ("test_links.rs", "Windows 테스트용 폴더 정션(`mklink /J`).", &[("junction", "std_cmd(\"cmd\")")]),
    (
        "proc.rs",
        "창구 자신의 테스트 — 이름 해석·배치 파일 인용·콘솔 출력 캡처(Windows 러너의 npm 심 포함).",
        &[
            ("non_windows_passes_the_program_through", "std_cmd(\"/bin/sh\")"),
            ("non_windows_passes_the_program_through", "std_cmd(\"git\")"),
            ("non_windows_passes_the_program_through", "tokio_cmd(\"git\")"),
            ("windows_batch_shim_resolution_and_quoting", "std_cmd(&resolved)"),
            ("windows_batch_shim_resolution_and_quoting", "std_cmd(resolved)"),
            ("windows_console_child_output_is_captured", "std_cmd(\"cmd\")"),
            ("windows_npm_cmd_shim_runs_by_bare_name", "std_cmd(\"npm\")"),
            ("windows_tokio_child_output_is_captured", "tokio_cmd(\"cmd\")"),
            ("windows_unresolvable_name_is_passed_through", "std_cmd(name)"),
        ],
    ),
    (
        "proc/detached.rs",
        "분리 기동한 자식이 부모의 파이프를 물지 않는지 — 테스트 바이너리 자신을 띄운다.",
        &[
            ("windows_detached_child_does_not_hold_the_parents_pipe", "spawn_detached(&exe, …)"),
            ("windows_detached_child_does_not_hold_the_parents_pipe", "std_cmd(&exe)"),
        ],
    ),
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 웹뷰 (D3)
// ─────────────────────────────────────────────────────────────────────────────

/// `(src/ 기준 경로, 그 쓰임 — 가져오는 이름까지, 분류, 사유)`.
pub(super) const WEB_LAUNCHES: &[(&str, &str, Reach, &str)] = &[(
    "features/settings/OculpmSettings.tsx",
    "import { revealItemInDir } from \"@tauri-apps/plugin-opener\"",
    Reach::Local,
    "설정 화면이 앱 로그 폴더를 파일 관리자에서 연다 — 로컬 경로.",
)];
