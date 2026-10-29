// clippy 게이트(2026-08-30, CI 가 `-D warnings`): 구조를 바꿔야 풀리는 두 가지만
// 크레이트 수준에서 허용한다 — 인자 8~9개인 Tauri 커맨드(lsp·acp)와 LSP
// 클라이언트의 콜백 타입. 나머지 경고는 전부 고쳤다.
// `json!` 도구 스키마(plan_create)가 커져 기본 128 을 넘었다 (2026-10-27, done_when).
#![recursion_limit = "512"]
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

// PR-ACP1 — 통합 테스트(tests/acp_handshake.rs)가 env/adapter 를 직접 쓴다.
pub mod app_error;
// diff 기준선 스냅샷 동기 — 4.0 에서 걷은 코드 색인의 남은 한 조각.
pub mod baseline;
mod commands;
// W5-PR8 — `db` and `oculpm` are made public so `src-tauri/tests/`
// integration tests can drive the manager directly with a temp DB. None
// of the other modules are needed at the integration layer.
pub mod db;
// `oculpm://` 딥링크 — 파싱만 한다 (무확인 실행 0, Phase 6).
pub mod deeplink;
mod error;
// LSP·PTY 호스트 공용 Content-Length 프레이밍.
pub mod framing;
// `git::diff_patch` is exercised by the `local_diff` integration suite (PR11).
pub mod git;
// AppHandle 없이 앱 데이터 폴더(Tauri app_data_dir 과 같은 규칙) — 로그·CLI·MCP 캐시.
pub mod app_dirs;
// 메인 화면 집계 — `home_brief` 통합 테스트가 `crate::home::collect` 를 직접 부른다.
pub mod home;
// single-instance 등록 + Linux 폴백 잠금 — D-Bus 가 없거나 주소를 못 읽을 때
// (#os-single-instance-dbus · #os-dbus-addr-panic).
mod instance_lock;
pub mod oculpm;
// 신뢰할 수 없는 상대 경로의 관문 — 어휘 + 링크 (보안 피드백 2차).
mod path_guard;
pub mod pid;
// PTY 호스트 — 터미널 세션을 앱 프로세스 밖으로 (#pty-host). pub 인 이유:
// main.rs 의 `--pty-host` 분기와 통합 테스트가 직접 부른다.
mod menu;
// 프로세스 생성 단일 창구 (크로스플랫폼 D5) — pub 인 이유: main.rs 의 re-exec 도
// 이 창구를 지난다 (clippy.toml 이 그 밖의 `Command::new` 를 막는다).
pub mod proc;
// 앱 안 터미널 (4.0 다시) — 세션은 앱 프로세스 안에, 창·앱과 함께 끝난다.
pub mod program_status;
pub mod terminal;
pub mod text;
// 코드 실행 신뢰 — 언어 서버·앱 안 에이전트가 같은 문을 쓴다 (review-2026-10-09).
pub mod trust;
// 테스트 전용 링크 도우미 — 경로 탈출 가드 테스트가 Windows 에서도 돈다 (크로스플랫폼 W2).
#[cfg(test)]
mod test_links;

use std::path::PathBuf;
use std::sync::OnceLock;

use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// W4 dogfooding follow-up (2026-05-26) — `oculpm_get_log_dir` returns this so
/// the Settings UI can reveal it in Finder. Set once during `setup_logging`
/// before any project-level code runs. `OnceLock` keeps the read lock-free on
/// the hot path (every "로그 폴더 열기" click).
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Path to the directory containing rotating `oculpm.log.YYYY-MM-DD` files.
/// Returns `None` if logging was initialised stdout-only (test runs).
pub fn log_dir() -> Option<&'static PathBuf> {
    LOG_DIR.get()
}

/// Initialise dual-output tracing: stdout (for `tauri dev`) + daily-rotated
/// file under `<data_dir>/logs/`. Falls back to stdout-only when the data dir
/// can't be created. Idempotent — calling twice silently keeps the first init.
///
/// We init this before `tauri::Builder` so any boot-time errors (db open,
/// plugin registration) also land in the file. Path is captured in `LOG_DIR`
/// so the `oculpm_get_log_dir` command can return it without re-deriving.
fn setup_logging() {
    use tracing_subscriber::{fmt, EnvFilter};

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    // `<app_data>/logs` — Tauri `app_data_dir()` 과 같은 폴더(`app_dirs`). 예전
    // `ProjectDirs` 는 Windows·Linux 에서 딴 폴더였다 (#paths-projectdirs-mismatch).
    let log_dir = crate::app_dirs::app_data_dir().map(|d| d.join("logs"));

    // stdout 도 ANSI 를 끈다 — fmt 레이어는 스팬 필드를 **한 번만** 포맷해 스팬
    // 확장에 캐시하고(`FormattedFields`, 필드 포매터 타입별), 같은 포매터를 쓰는
    // 뒤 레이어는 그걸 재사용한다. stdout 이 색을 켜면 그 색이 파일에도 실린다
    // (`connection{\x1b[1mname\x1b[0m=…}`, 2026-09-14 로그 실측 18줄).
    let stdout_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_ansi(false);

    match log_dir.as_ref().and_then(|d| {
        std::fs::create_dir_all(d).ok()?;
        Some(d.clone())
    }) {
        Some(dir) => {
            // Daily rotation so the file stays grep-friendly. Non-blocking
            // writer keeps the watcher's hot path off disk-flush latency.
            // v2 U5 — retention 상한 14개(2주): 일별 로그가 무한 누적되던 것을
            // 회전 시점에 오래된 파일부터 정리. 빌더 실패 시 기존 무제한
            // daily 로 폴백(로깅이 앱을 못 죽인다).
            let appender = tracing_appender::rolling::RollingFileAppender::builder()
                .rotation(tracing_appender::rolling::Rotation::DAILY)
                .filename_prefix("oculpm.log")
                .max_log_files(14)
                .build(&dir)
                .unwrap_or_else(|_| tracing_appender::rolling::daily(&dir, "oculpm.log"));
            // Leak the guard intentionally — we want the writer to live for
            // the whole process lifetime. Dropping it would flush + close the
            // file, silently dropping later logs.
            let (non_blocking, guard) = tracing_appender::non_blocking(appender);
            Box::leak(Box::new(guard));

            let file_layer = fmt::layer()
                .with_target(true)
                .with_ansi(false)
                .with_writer(non_blocking);

            let _ = tracing_subscriber::registry()
                .with(env_filter)
                .with(stdout_layer)
                .with(file_layer)
                .try_init();
            let _ = LOG_DIR.set(dir.clone());
            tracing::info!(
                target: "oculpm::boot",
                log_dir = %dir.display(),
                "[FLOW] tracing initialised — stdout + daily-rotated file"
            );
        }
        None => {
            let _ = tracing_subscriber::registry()
                .with(env_filter)
                .with(stdout_layer)
                .try_init();
            tracing::warn!(
                target: "oculpm::boot",
                "[FLOW] tracing file appender unavailable — stdout only"
            );
        }
    }
}

use crate::commands::{
    app_info,
    apply_menu_language,
    // v3-surface — 브랜치 축 (파생 전용, 로컬 git 만 읽는다)
    check_cli_available,
    // PR-CI0 — Claude Code 훅 브리지 (settings.local.json 설치/제거/상태)
    claude_hooks_status,
    claude_plugin_status,
    // 바깥 터미널의 Claude 기다림 (Notification 훅, #notify-hook)
    claude_waiting,
    claude_waiting_dismiss,
    // 코드 화면 — 파일 조작 (.oculpm/planner/ide-completion.md #file-ops-backend)
    // 코드 화면 — 일지 연동 + HEAD 비교 (ide-completion #agent-diff)
    // 코드 화면 — 로컬 히스토리 (docs/20260902_vscode-borrows/06-local-history.md)
    // 코드 화면 — 전역 검색·치환 (#project-search)
    // 코드 화면 — 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md)
    close_window,
    codex_mcp_register,
    codex_mcp_status,
    codex_mcp_unregister,
    codex_plugin_status,
    compute_diff,
    create_project,
    db_compact,
    db_health,
    delete_project,
    diagnostics_report,
    diff_binary_preview,
    // first-record-loop — 대화별 첫 일지 귀속 원장 (Today 첫 기록 카드)
    first_record_ledger,
    // G2 — Project Overview + Daily Brief
    get_window_project,
    git_graph,
    git_head_status_brief,
    git_last_commit_changes,
    git_line_changes,
    git_log,
    git_status,
    git_uncommitted_changes,
    // 메인 화면(프로젝트 선택) 단일 집계 — IPC 1회 · SQL 6문
    home_brief,
    // 설치 형식 — 업데이터 키 선택과 deb 안내 (크로스플랫폼 L-UPD #upd-target-missing)
    install_kind,
    // H3b — 플러그인 SessionEnd 의 "일지 없이 끝난 세션" 신호 소비 (Today 카드)
    journal_missing_signals,
    list_open_project_ids,
    list_projects,
    // Phase 2 — 참조·아웃라인·워크스페이스 심볼·시그니처·포맷팅
    // 코드 인텔리전스 — LSP (docs/lsp/00-master-plan.md)
    mcp_register,
    // PR-CI2 — oculpm-mcp 서버 등록 (.mcp.json / Claude Desktop 원클릭)
    mcp_status,
    mcp_unregister,
    // {#related-ui} — 후보를 원본 frontmatter 에 잇는다
    oculpm_add_related,
    oculpm_agent_run_signal,
    oculpm_agents_apply_master_upgrade,
    oculpm_agents_check_master_ahead,
    oculpm_agents_check_master_upgrade,
    oculpm_agents_detect,
    oculpm_agents_sync_active,
    // F5 — git-history backfill
    oculpm_backfill_from_git,
    oculpm_coerce_entry_on_disk,
    oculpm_compare_workday,
    oculpm_create_manual_entry,
    oculpm_current_session,
    oculpm_end_session_manual,
    oculpm_export_digest,
    // journal-scale-round {#hotspot-query} — 파일별 bug/error 재발 신호
    oculpm_file_hotspots,
    // C2 — 일지 내보내기
    oculpm_get_config,
    oculpm_get_entry_diffs,
    oculpm_get_file_changes,
    oculpm_get_journal_entry,
    oculpm_get_log_dir,
    oculpm_get_status,
    oculpm_group_changes,
    // journal-scale-round {#index-usage} — index/ 사용량 조회 + diff 정리
    oculpm_index_clear_diffs,
    oculpm_index_usage,
    // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
    oculpm_init,
    oculpm_list_journal_entries,
    oculpm_list_journal_entries_page,
    oculpm_list_sessions,
    oculpm_log,
    oculpm_open_entry_in_editor,
    // best-results-round {#scorecard-cmd} — Today 「약속 성적표」
    oculpm_promise_scorecard,
    // W5-PR5 — Overview stats
    oculpm_reindex_cache,
    oculpm_search_entities,
    oculpm_search_journal,
    oculpm_set_config,
    oculpm_set_journal_verified,
    oculpm_set_journal_verified_bulk,
    oculpm_start_session_manual,
    // {#related-suggest} — 공유 파일·플랜 항목·제목으로 고른 관련 후보
    oculpm_suggest_related,
    // {#tag-merge} — 태그 어휘 통계와 A→B 일괄 병합
    oculpm_tag_merge,
    oculpm_tag_stats,
    oculpm_update_entry_body,
    // journal-scale-round {#velocity} — 주당 일지 속도 + 플랜 완료 ETA
    oculpm_velocity,
    oculpm_watcher_start,
    oculpm_watcher_stop,
    oculpm_watcher_take_over,
    oculpm_workday_brief,
    open_devtools,
    open_in_editor,
    open_project_nav,
    open_project_window,
    open_url,
    plan_apply_edit,
    plan_create,
    // Planner Upgrade (PR-PLN 0/1/5) — file-based Plan read + write + AI/migration
    plan_dispatch_prompt,
    plan_get,
    plan_list,
    plan_locked_open,
    plan_log,
    // Osaurus 라운드 Phase 4 — 테마 파일화 · 프로젝트 바인딩
    quick_look_file,
    read_project_file,
    // W5 — action proposal apply-state
    // first-record-loop Phase 2 — 이어하기 자료 (Today 이어하기 카드)
    resume_digest,
    resume_dispatch_prompt,
    // F4 — 회고/인사이트 (+ PR-CI6 eval 추이, defer 원장)
    reveal_in_file_manager,
    save_window_session,
    select_project_folder,
    set_window_project,
    settings_get,
    settings_get_all,
    settings_set,
    settings_set_many,
    today_digest,
};
// 비-mac 의 「새 창」(Ctrl+Shift+N) — 메뉴의 새 창과 같은 생성 함수 (#os-new-window).
use crate::commands::new_window::new_window;
use crate::commands::terminal::{
    term_close, term_end_window, term_list, term_open, term_overview, term_resize, term_write,
};

/// Build the specta Builder with every command + event registered. Extracted
/// so the W5-PR3 `export_bindings` test can regenerate `src/lib/bindings.ts`
/// without spawning the full Tauri runtime. Each call returns a fresh Builder
/// (the `.export(...)` consumes `self`).
fn build_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            db_health,
            db_compact,
            settings_set,
            settings_get,
            settings_get_all,
            settings_set_many,
            app_info,
            select_project_folder,
            list_projects,
            create_project,
            delete_project,
            // 컨텍스트 경제학 (Phase 5) — 회상 통계 · 프로젝트 지시문
            home_brief,
            // Planner Upgrade (PR-PLN 0/1) — file-based Plan read + write
            plan_list,
            plan_locked_open,
            plan_get,
            plan_log,
            plan_create,
            plan_apply_edit,
            plan_dispatch_prompt,
            today_digest,
            term_open,
            term_write,
            term_resize,
            term_close,
            term_list,
            term_overview,
            term_end_window,
            // M2-3 — Chat history
            // M5 — Window & File Operations
            open_devtools,
            // 창 하나 = 프로젝트 하나 (4.0) — 레지스트리는 Rust 소유 (전역 유일성 심판).
            open_project_window,
            set_window_project,
            get_window_project,
            open_project_nav,
            list_open_project_ids,
            close_window,
            // 업데이트 재시작을 건너 창을 되살린다 (재시작 직전 저장)
            save_window_session,
            // 터미널 도크 — 셸을 자기 창으로 떼어내기 (2026-08-15)
            // 앱 메뉴 — 프런트가 해석한 UI 언어를 알려 주면 라벨을 다시 만든다
            apply_menu_language,
            read_project_file,
            // 코드 화면 — 파일 트리 + 읽기/쓰기
            // 코드 화면 — 전역 검색·치환
            // 코드 화면 — 파일 조작
            // 코드 화면 — 로컬 히스토리
            oculpm_index_usage,
            oculpm_index_clear_diffs,
            // Terminal
            // 터미널 셸 통합 (OSC 133/7)
            // M7 — Git / GitHub
            git_log,
            git_graph,
            git_status,
            git_head_status_brief,
            git_line_changes,
            // v3-surface — 브랜치 축
            // Lite-W6 PR6 — LocalDiffView backend
            compute_diff,
            diff_binary_preview,
            git_uncommitted_changes,
            git_last_commit_changes,
            open_in_editor,
            open_url,
            // 터미널 파일 링크 ⌘클릭 메뉴 (2026-09-07)
            reveal_in_file_manager,
            quick_look_file,
            // 외부 CLI 탐침 (Today 첫 기록 카드)
            check_cli_available,
            // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
            oculpm_init,
            oculpm_get_status,
            oculpm_get_config,
            oculpm_set_config,
            oculpm_start_session_manual,
            oculpm_end_session_manual,
            oculpm_agent_run_signal,
            oculpm_current_session,
            oculpm_list_sessions,
            oculpm_get_file_changes,
            oculpm_watcher_start,
            oculpm_watcher_stop,
            oculpm_watcher_take_over,
            oculpm_list_journal_entries,
            oculpm_list_journal_entries_page,
            oculpm_get_journal_entry,
            oculpm_get_entry_diffs,
            oculpm_suggest_related,
            oculpm_add_related,
            oculpm_group_changes,
            oculpm_set_journal_verified,
            oculpm_set_journal_verified_bulk,
            oculpm_search_entities,
            oculpm_search_journal,
            oculpm_tag_stats,
            oculpm_tag_merge,
            oculpm_workday_brief,
            oculpm_reindex_cache,
            oculpm_create_manual_entry,
            oculpm_coerce_entry_on_disk,
            oculpm_agents_sync_active,
            oculpm_agents_detect,
            oculpm_agents_check_master_ahead,
            oculpm_agents_check_master_upgrade,
            oculpm_agents_apply_master_upgrade,
            oculpm_compare_workday,
            oculpm_export_digest,
            oculpm_get_log_dir,
            oculpm_log,
            oculpm_update_entry_body,
            oculpm_open_entry_in_editor,
            // F5 — git-history backfill
            oculpm_backfill_from_git,
            // journal-scale-round {#hotspot-query} — Today 「반복 수정 파일」 카드
            oculpm_file_hotspots,
            // journal-scale-round {#velocity} — Today 「작업 속도」 카드
            oculpm_velocity,
            // best-results-round {#scorecard-cmd} — Today 「약속 성적표」 카드
            oculpm_promise_scorecard,
            // C2 — 일지 내보내기
            // PR-ACP1 — ACP 어댑터 런타임
            // v3-record-integrity {#mcp-missing-visible} — 기록 도구 부착 결과
            // PR-CI0 — Claude Code 훅 브리지
            claude_hooks_status,
            claude_waiting,
            claude_waiting_dismiss,
            // H3b — "일지 없이 끝난 세션" 신호 (Today 카드)
            journal_missing_signals,
            // first-record-loop — 첫 기록 원장 (Today 첫 기록 카드)
            first_record_ledger,
            // first-record-loop Phase 2 — 이어하기 자료
            resume_digest,
            resume_dispatch_prompt,
            // PR-CI2 — oculpm-mcp 서버 등록
            mcp_status,
            mcp_register,
            mcp_unregister,
            codex_mcp_status,
            codex_mcp_register,
            codex_mcp_unregister,
            codex_plugin_status,
            claude_plugin_status,
            // 비-mac 「새 창」 (#os-new-window)
            new_window,
            // 베타 버그 리포트 — 「진단 정보 복사」 (#w5-report)
            diagnostics_report,
            // 설치 형식 (크로스플랫폼 L-UPD #upd-target-missing)
            install_kind,
        ])
        .events(collect_events![
            // .oculpm/ subsystem (W1-PR2)
            crate::oculpm::spec::OculpmSessionStarted,
            crate::oculpm::spec::OculpmSessionEnded,
            crate::oculpm::spec::OculpmFileChanged,
            crate::oculpm::spec::OculpmJournalAdded,
            crate::oculpm::spec::OculpmJournalUpdated,
            crate::oculpm::spec::OculpmIntegrityWarning,
            crate::oculpm::spec::OculpmWatchYielded,
            crate::oculpm::spec::OculpmAgentDrift,
            crate::oculpm::spec::OculpmJournalPathChanged,
            // 워크데이 넘김 — 폴링 대신 (Phase 4)
            crate::oculpm::spec::OculpmWorkdayChanged,
            // 계획 · 논의 파일이 디스크에서 바뀌면 해당 화면이 즉시 다시 읽는다
            crate::oculpm::spec::OculpmDataChanged,
            // 창 하나 = 프로젝트 하나 — 창의 프로젝트 + 시작 창의 「열림」 표시
            crate::commands::window::WindowProjectChanged,
            // 딥링크 → 프로젝트 창 목적지
            crate::commands::window::WindowNavigate,
            crate::commands::window::ProjectWindowsChanged,
            // 설정 변경 브로드캐스트 — 모든 창 + 상단바가 테마·언어를 다시 읽는다
            crate::commands::config::SettingsChanged,
            // 딥링크 — 프런트가 확인 시트를 띄운다 (Phase 6 #deep-link)
            crate::deeplink::DeepLinkReceived,
            // 앱 안 터미널 — 어디서든 세션 · 상태가 바뀜 / 도는 세션이 있는 창을 닫으려 함
            crate::commands::terminal::TermSessionsChanged,
            crate::commands::terminal::TermCloseAsked,
            // 바깥 터미널의 Claude 기다림이 바뀜 — 오늘이 다시 읽고 창이 뒤면 알린다
            crate::oculpm::claude_waiting::ClaudeWaitingChanged,
            // 도움말 › 처음 쓰는 법 — 포커스된 창이 안내 모달을 연다
            crate::menu::TourRequested,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 패닉을 **로그로 끌어낸다.**
///
/// 번들 앱의 stderr 는 아무도 보지 않는다. 그래서 태스크 안에서 터진 패닉은
/// 흔적 없이 사라졌고, 2026-08-29 에는 그것이 "닫기 버튼이 아무 일도 안 한다"
/// 로만 보였다 — 비동기 커맨드가 `block_on` 으로 패닉하면 태스크가 죽고,
/// 프런트의 프라미스는 영영 안 풀리며, 로그에는 한 줄도 남지 않는다.
///
/// 기본 훅은 그대로 이어서 부른다 (개발 빌드의 stderr·백트레이스 유지).
fn install_panic_logger() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "-".to_string());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(문자열이 아닌 payload)".to_string());
        tracing::error!(
            target: "panic",
            location = %location,
            thread = %std::thread::current().name().unwrap_or("-"),
            "[FLOW] 패닉: {message}"
        );
        previous(info);
    }));
}

pub fn run() {
    setup_logging();
    install_panic_logger();

    let builder = build_specta_builder();

    // 개발 빌드의 편의 — 실패해도 앱은 떠야 한다. 경로가 CWD 상대라, 디버그
    // 바이너리를 Finder 나 다른 디렉터리에서 띄우면 `../src/lib` 가 없거나
    // 읽기 전용이다 (2026-09 로그: "Read-only file system" 패닉 2회). 바인딩은
    // `cargo test` 가 어차피 다시 낸다.
    #[cfg(debug_assertions)]
    if let Err(e) = builder.export(Typescript::default(), "../src/lib/bindings.ts") {
        tracing::warn!(
            error = %e,
            "[FLOW] bindings.ts 내보내기 실패 — 개발 빌드 편의 기능이라 계속 뜬다 (cargo test 가 다시 낸다)"
        );
    }

    // 제일 먼저 — 두 번째 인스턴스는 여기서 끝나고, 첫 인스턴스는 창을 앞으로.
    // Linux 는 플러그인이 세션 D-Bus 에 기댄다 — 버스가 없으면 조용히 꺼지고, 주소를
    // 못 읽으면 기동 중 패닉한다. `register` 가 주소를 먼저 대 보고(못 읽으면 건너뛴다)
    // 바로 뒤에 잠금 파일로 두 번째 인스턴스를 막는다 (`instance_lock`).
    let tauri_builder =
        crate::instance_lock::register(tauri::Builder::default(), |app, argv, _cwd| {
            crate::commands::window::show_main(app);
            // Windows·Linux 의 딥링크는 **두 번째 인스턴스의 인자**로 온다 — 그
            // 프로세스는 여기서 끝나므로 첫 인스턴스가 건진다 (macOS 는 Apple Event).
            #[cfg(not(target_os = "macos"))]
            for url in crate::deeplink::links_in_argv(&argv) {
                crate::deeplink::dispatch(app, &url);
            }
            #[cfg(target_os = "macos")]
            let _ = argv;
        });
    let app = tauri_builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // `oculpm://` — 웹에서 앱으로 오는 유일한 길. 플러그인은 URL 을
        // 나르기만 하고, 무엇을 할지는 확인 시트가 정한다 (무확인 실행 0).
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            // 판·설치 형식 한 줄 — 업데이트 뒤 새 판이 떴는지는 이 줄로만 읽힌다.
            crate::commands::install_kind::log_install_kind_at_boot(&app.package_info().version);

            // --- macOS: titleBarStyle Overlay + hidden title (MASTER-GUIDE §6.2) ---
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            let app_data = app.path().app_data_dir()?;
            // 남은 세션 심을 걷는다 (플랜 `session-shim-cli`). 앱이 막 떴으니
            // 도는 세션은 하나도 없다 — 디스크에 남은 토큰은 전부 지난 실행이
            // 정리 경로를 못 지나가고 죽은 흔적이고, 그대로 두면 다음 세션이
            // 남의 신원을 주울 수 있다.
            let swept = crate::oculpm::shim::sweep(&app_data, &[]);
            if swept > 0 {
                tracing::info!("남은 세션 심 {swept}개를 정리했습니다");
            }
            // Linux AppImage: oculpm-mcp 를 마운트 밖 안정 자리로 (D10 · #integ-sidecar).
            // 다른 앱 설정이 그 사본을 가리키므로 업데이트 뒤 기동마다 새로 고친다 —
            // 내용이 같으면 무접촉. 그 밖의 설치(macOS · Windows · deb)는 Ok(None).
            #[cfg(target_os = "linux")]
            std::thread::spawn(
                || match crate::oculpm::mcp::register::refresh_stable_sidecar() {
                    Ok(Some(path)) => {
                        tracing::info!(path = %path.display(), "AppImage 사이드카 안정 사본 확인")
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!(error = %e, "AppImage 사이드카 안정 사본 실패"),
                },
            );
            // 못 열면 크래시 대신 이유를 보이고 「새로 시작 / 종료」 를 묻는다.
            let db = crate::db::startup::open_or_ask(&app_data);
            app.manage(db);
            // 4.0 — 코드 색인·의미 검색을 걷었다. 3.x 가 받아 둔 임베딩 모델 캐시
            // (`fastembed_cache`, 모델 하나 90MB 남짓)는 이제 아무도 읽지 않으니 기동 때
            // 걷는다 — 블로킹 IO 라 세터 밖에서. 없으면 아무 일도 없다.
            {
                let dir = app_data.join("fastembed_cache");
                std::thread::spawn(move || {
                    if dir.is_dir() {
                        match std::fs::remove_dir_all(&dir) {
                            Ok(()) => {
                                tracing::info!(dir = %dir.display(), "옛 임베딩 모델 캐시를 걷었다")
                            }
                            Err(e) => tracing::warn!(error = %e, "옛 임베딩 모델 캐시 걷기 실패"),
                        }
                    }
                });
            }
            // 로컬 히스토리의 출처 판정 — `code_write` 가 쪽지를 남기고 워처가
            // 소비한다 (사람이 저장했나, 에이전트가 썼나).
            app.manage(crate::oculpm::history::HistoryState::default());
            // 창 → 프로젝트 레지스트리 (전역 유일성 심판)
            app.manage(crate::commands::window::WindowProjects::default());
            app.manage(crate::terminal::TermSessions::default());
            app.manage(crate::oculpm::claude_waiting::ClaudeWaitingState::default());
            // .oculpm/ subsystem (W1-PR6)
            app.manage(crate::oculpm::manager::OculpmManager::new());

            // `tauri.conf.json` 이 만든 첫 창을 시작 창으로 레지스트리에 편입한다.
            // 창 닫기 훅(포커스 추적·정리·마지막 창 판정)도 여기서 붙는다.
            crate::commands::window::adopt_first_window(app.handle());

            // 딥링크 수신 — 앱이 이미 떠 있을 때 오는 URL 을 받는다.
            // `dispatch` 는 파싱에 실패하면 아무 일도 하지 않는다.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        crate::deeplink::dispatch(&handle, url.as_str());
                    }
                });
                // Windows·Linux 에서 링크로 **처음** 뜬 경우 — 링크가 이 프로세스의
                // 인자다. 플러그인은 그것을 이 리스너가 붙기 전(플러그인 초기화)에
                // 흘려보내므로 여기서 다시 건진다.
                #[cfg(not(target_os = "macos"))]
                {
                    // `args()` 는 UTF-8 이 아닌 인자에서 패닉한다 — 기동 경로라 손실 변환으로.
                    let argv: Vec<String> = std::env::args_os()
                        .map(|a| a.to_string_lossy().into_owned())
                        .collect();
                    for url in crate::deeplink::links_in_argv(&argv) {
                        crate::deeplink::dispatch(app.handle(), &url);
                    }
                }
                // AppImage 는 설치 관리자가 없어 스킴을 등록해 줄 이가 없다 — 앱이
                // `~/.local/share/applications` 에 처리기를 적는다 (deb 는 패키지가 한다).
                // `xdg-mime` 등을 기다리므로 기동 경로 밖에서.
                #[cfg(target_os = "linux")]
                if app.env().appimage.is_some() {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle.deep_link().register_all() {
                            tracing::warn!(error = %e, "AppImage 딥링크 스킴 등록 실패");
                        }
                    });
                }
            }

            // 업데이트로 우리가 끊은 재시작이라면 그때 열려 있던 창을 되살린다.
            // 스냅숏이 없으면(=사용자가 직접 끈 앱) 아무 일도 안 한다 — 첫 창은
            // 그대로 시작 창으로 남는다.
            crate::commands::window::restore_session(app.handle());

            // 추적 중인 **모든** 프로젝트 감시 시작 (2026-08-12 사용자 결정).
            // 예전에는 watcher 가 탭 수명에 묶여 있어, 탭을 안 연 프로젝트는
            // 에이전트가 일해도 세션이 생성조차 되지 않았다 — 상단바가
            // "하나만 감지" 하던 이유. 백그라운드에서 순차·간격 시작한다.
            crate::commands::window::start_background_watchers(app.handle());

            // 그 감시가 **조용히 죽는 것**을 막는 감독관 (2026-08-23). 워처는
            // 락 경합(다른 인스턴스)으로 아예 못 뜨거나, 처리 루프가 죽어도
            // "돌고 있음" 으로 남을 수 있었다 — 둘 다 사용자에게는 "AI 가 일지를
            // 써도 화면이 안 바뀐다" 로 똑같이 보이고, 앱 재시작 말고는 복구가
            // 없었다. 감독관이 1분마다 확인하고 되살린다.
            crate::oculpm::supervisor::spawn(app.handle());

            // 앱 메뉴 — `⌘W` 를 "창 닫기" 에서 "탭 닫기" 로 되찾는다.
            // 기본 언어(ko)로 먼저 세우고, 프런트가 마운트하면서 해석된 UI
            // 언어를 `apply_menu_language` 로 알려 주면 다시 만든다 (Rust 는
            // 프런트의 i18n 사전도 OS 로케일도 읽지 않는다).
            let handle = app.handle().clone();
            if let Err(e) = crate::menu::apply(&handle, "ko") {
                tracing::warn!(target: "menu", error = %e, "메뉴 생성 실패");
            }
            handle.on_menu_event(|app, event| {
                crate::menu::handle_event(app, event.id().as_ref());
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // .oculpm/ subsystem (W1-PR7): release every project's lock on graceful
    // shutdown. RAII via `LockGuard::drop` is the safety net if the
    // best-effort sync drain here loses a race.
    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                // 사용자가 끄려 했고(`code` 없음 — ⌘Q) 도는 터미널 세션이 있으면 멈추고 묻는다.
                // 확인하면 창이 프로세스 플러그인으로 다시 끈다(`code` 가 있어 여기를 지난다).
                if let Some(terms) = app_handle.try_state::<crate::terminal::TermSessions>() {
                    if code.is_none() {
                        if let Some((label, alive)) = terms.ask_before_quit() {
                            api.prevent_exit();
                            use tauri_specta::Event;
                            if let Some(win) = app_handle.get_webview_window(&label) {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            let _ = crate::commands::terminal::TermCloseAsked { alive, quit: true }
                                .emit_to(app_handle, label.as_str());
                            return;
                        }
                    }
                    // 터미널 세션 — 고아 셸을 남기지 않는다.
                    terms.close_all();
                }
                if let Some(manager) =
                    app_handle.try_state::<crate::oculpm::manager::OculpmManager>()
                {
                    manager.shutdown_all_blocking();
                }
            }
            // macOS: Dock 아이콘 클릭 / "모두 앞으로 가져오기".
            //
            // 창을 다 닫아도 macOS 에서는 앱이 살아 있는데(마지막 창은 숨기기만 한다 —
            // `commands::window` 의 `exits_on_last_window_close`), 이 이벤트를 안 받으면
            // Dock 을 눌러도 **아무 일도 안 난다** — 사용자 눈에는 앱이 죽은 것이다.
            //
            // 창이 하나라도 살아 있으면 앞으로 가져오기만 하고, 하나도 없으면
            // 새로 연다 (macOS 의 표준 동작).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                use tauri::Manager as _;
                let existing: Vec<_> = app_handle
                    .webview_windows()
                    .into_iter()
                    .filter(|(label, _)| crate::commands::window::is_app_window(label))
                    .map(|(_, window)| window)
                    .collect();

                if existing.is_empty() {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::commands::window::new_window_inner(&handle).await;
                    });
                } else {
                    for window in existing {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod bindings_export_test {
    use super::*;

    /// Regenerate `src/lib/bindings.ts` whenever `cargo test` runs.
    ///
    /// The normal path goes through `pub fn run()` which we can't trigger
    /// from a unit test (it spins up the Tauri runtime). Keeping this as a
    /// test means bindings stay in sync without a hand-managed `pnpm
    /// bindings:gen` script — the CI / dev loop already runs `cargo test`.
    #[test]
    fn export_bindings_typescript() {
        let builder = build_specta_builder();
        builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/lib/bindings.ts",
            )
            .expect("export bindings");
    }
}
