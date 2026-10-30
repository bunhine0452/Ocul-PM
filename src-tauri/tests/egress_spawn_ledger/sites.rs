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
        path: "terminal.rs",
        func: "shell_command",
        call: "CommandBuilder::new(&shell)",
        reach: Reach::Network("사용자가 터미널 탭에서 연 세션 — 친 명령, 또는 「다음」 실행이 쳐 넣는 claude 한 줄"),
        reason: "앱 안 터미널의 셸(macOS·Linux, $SHELL -l) — portable-pty 가 앱 프로세스 안에서 띄운다. 사용자가 치는 것이 무엇이든 돈다. 앱이 스스로 치는 것은 「다음」 실행의 `claude \"$OCULPM_PROMPT\"` 한 줄뿐(사용자가 누른 단추).",
    },
    Launch {
        path: "terminal.rs",
        func: "shell_command",
        call: "CommandBuilder::new(\"powershell.exe\")",
        reach: Reach::Network("사용자가 터미널 탭에서 연 세션 — 친 명령, 또는 「다음」 실행이 쳐 넣는 claude 한 줄"),
        reason: "Windows — 위와 같다(PowerShell, `claude $env:OCULPM_PROMPT`).",
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
        path: "proc/disclaim.rs",
        func: "spawn_disclaimed",
        call: "posix_spawn(&mut pid, …)",
        reach: Reach::Relay,
        reason: "macOS 책임 분리 기동(TCC 책임을 넘기지 않음 · fd 상속 없음) — 부르는 쪽(PTY 호스트 기동)이 이 원장에 있다.",
    },
    Launch {
        path: "commands/open_native.rs",
        func: "shell_open",
        call: "tauri_plugin_opener::open_url(target.to_string_lossy(), …)",
        reach: Reach::Relay,
        reason: "Windows 의 OS 기본 처리기 위임(ShellExecuteExW) — URL 이든 로컬 경로든 부르는 쪽(open_url·open_native)이 정하고, 각자 이 원장에 있다.",
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
        path: "commands/cli_check.rs",
        func: "check_cli_available",
        call: "std_cmd(which_cmd)",
        reach: Reach::Local,
        reason: "`which` / `where` — 에이전트 CLI(claude 등)가 설치돼 있는지 PATH 에서 찾는다.",
    },
    Launch {
        path: "commands/cli_check.rs",
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
        reason: "로그 폴더·일지 파일을 OS 기본 앱으로 — 로컬 경로.",
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
        path: "main.rs",
        func: "reexec_with_malloc_tuning",
        call: "std_cmd(exe)",
        reach: Reach::Local,
        reason: "macOS — 자기 자신을 MallocLargeCache=0 으로 다시 exec 한다.",
    },
    Launch {
        path: "pid.rs",
        func: "exe_name",
        call: "std_cmd(\"ps\")",
        reach: Reach::Local,
        reason: "`ps -o comm= -p <pid>` — 락을 쥔 프로세스의 이름(사람에게 보여 줄 표시용).",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// 원장 — 테스트 범위 (D2)
// ─────────────────────────────────────────────────────────────────────────────

/// 테스트 범위의 기동 자리 — 파일별 사유 하나에 `(함수, 띄우는 것)` 전부.
/// 출시되는 앱에서 돌지 않는다는 것은 이 표의 주장이 아니라 스캐너의 판정이다.
pub(super) const TEST_LAUNCHES: &[Fixtures] = &[
    (
        "terminal_tests.rs",
        "앱 안 터미널의 진짜 PTY 왕복 — /bin/sh 가 읽은 한 줄(한글)을 되돌려 주고 종료 코드 3 으로 끝나는지. 기기 밖에 닿지 않는다.",
        &[("pty_round_trip_output_input_and_exit", "CommandBuilder::new(\"/bin/sh\")")],
    ),
    (
        "terminal_tests.rs",
        "앱 안 터미널의 상태 신호(OSC 7501) 왕복 — /bin/sh 가 탐침을 보내고 받은 답을 확인한 뒤 상태 보고를 찍는다. 기기 밖에 닿지 않는다.",
        &[(
            "program_status_probe_is_answered_and_reports_become_the_session_status",
            "CommandBuilder::new(\"/bin/sh\")",
        )],
    ),
    (
        "terminal_tests.rs",
        "앱 끄기 전 묻기 — 대화형 /bin/sh 를 세션으로 띄워 빈 셸은 안 묻고, sleep 이 앞에 서면 묻는지 본다. 기기 밖에 닿지 않는다.",
        &[("quitting_asks_only_while_a_session_runs_and_not_twice_in_a_row", "CommandBuilder::new(\"/bin/sh\")")],
    ),
    (
        "terminal_tests.rs",
        "업데이트 뒤 잇기 — /bin/sh 가 읽은 한 줄이 `claude --continue` 인지 되돌려 본다(claude 를 띄우지 않는다). 기기 밖에 닿지 않는다.",
        &[("a_resumed_session_types_claude_continue", "CommandBuilder::new(\"/bin/sh\")")],
    ),
    (
        "terminal_tests.rs",
        "업데이트 전 세기 — 대화형 /bin/sh 세 개에서 sleep 이 앞에 서면 도는 세션 · claude 세션으로 세는지 본다. 기기 밖에 닿지 않는다.",
        &[(
            "busy_all_counts_every_window_and_only_claude_sessions_are_resumable",
            "CommandBuilder::new(\"/bin/sh\")",
        )],
    ),
    (
        "proc/disclaim.rs",
        "macOS 책임 분리 기동의 왕복 — /bin/sh 로 종료 코드를 거두고, 없는 경로는 오류로 돌아오는지.",
        &[
            ("a_missing_program_is_an_error_not_a_child", "spawn_disclaimed(Path::new(\"/nonexistent/ocul-pm\"), …)"),
            ("spawns_and_reaps_with_the_exit_code", "spawn_disclaimed(Path::new(\"/bin/sh\"), …)"),
        ],
    ),
    (
        "git/safe.rs",
        "임시 저장소에서 로컬 git — 저장소 설정이 명령을 못 돌리는지, 기한을 넘긴 자식을 죽이는지(ping·sleep). 부분 클론 시험의 원격은 같은 임시 폴더의 다른 저장소다(대조군만 거기에 닿는다).",
        &[
            ("git", "std_cmd(\"git\")"),
            ("output_kills_a_command_past_its_deadline", "std_cmd(if cfg!(windows) { \"ping\" } else { \"sleep\" })"),
            ("partial_clone_lazy_fetch_cannot_run_repo_uploadpack", "std_cmd(\"git\")"),
            ("repo_config_cannot_run_commands_through_status_or_diff", "std_cmd(\"git\")"),
        ],
    ),
    ("git/race_tests.rs", "레인(worktree 여럿에서) 시험용 임시 저장소를 만드는 로컬 git 픽스처.", &[("git", "std_cmd(\"git\")")]),
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
pub(super) const WEB_LAUNCHES: &[(&str, &str, Reach, &str)] = &[
    (
        "features/settings/DataSection.tsx",
        "import { revealItemInDir } from \"@tauri-apps/plugin-opener\"",
        Reach::Local,
        "설정 「데이터」가 앱 로그 폴더를 파일 관리자에서 연다 — 로컬 경로.",
    ),
    (
        "features/settings/ProjectSection.tsx",
        "import { revealItemInDir } from \"@tauri-apps/plugin-opener\"",
        Reach::Local,
        "설정 「이 프로젝트」가 `.oculpm` 폴더를 파일 관리자에서 연다 — 로컬 경로.",
    ),
];
