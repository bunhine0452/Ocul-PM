// PR-ACP1 — 통합 테스트(tests/acp_handshake.rs)가 env/adapter 를 직접 쓴다.
pub mod acp;
mod ast;
mod commands;
// W5-PR8 — `db` and `oculpm` are made public so `src-tauri/tests/`
// integration tests can drive the manager directly with a temp DB. None
// of the other modules are needed at the integration layer.
pub mod dap;
pub mod db;
mod embedding;
mod error;
// LSP·DAP 공용 Content-Length 프레이밍 (docs/dap/00-master-plan.md #framing-shared).
pub mod framing;
// `git::diff_patch` is exercised by the `local_diff` integration suite (PR11).
pub mod git;
// 메인 화면 집계 — `home_brief` 통합 테스트가 `crate::home::collect` 를 직접 부른다.
pub mod home;
mod indexer;
mod llm;
pub mod lsp;
mod notion;
pub mod oculpm;
mod mobile_bridge;
mod secrets;
mod menu;
mod tray;

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

    // Resolve `<app_data>/logs` via the same `directories` crate Tauri uses
    // underneath app_data_dir(). On macOS this is
    // `~/Library/Application Support/com.kimhyunbin.ai-pm/logs/`.
    let log_dir = directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm")
        .map(|p| p.data_dir().join("logs"));

    let stdout_layer = fmt::layer().with_target(true).with_thread_ids(false);

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
    chat, chat_message_append, chat_message_list, chat_stream, clear_project_index,
    conversation_create, conversation_delete, conversation_list, conversation_rename,
    conversation_set_context,
    // W5 — action proposal apply-state
    record_conversation_action, list_conversation_actions, create_project, delete_project, rename_project, set_project_appearance, db_health,
    index_project, list_projects, project_stats,
    // C2 — 스킬 카탈로그: 결정적 스택 감지 (LLM 0 · 네트워크 0)
    detect_stack,
    // 메인 화면(프로젝트 선택) 단일 집계 — IPC 1회 · SQL 6문
    home_brief,
    search_chunks, search_text, search_symbols, secret_delete, secret_has, secret_set, secret_verify, select_project_folder, settings_get,
    settings_set, settings_get_all, settings_set_many, app_info, clear_all_data,
    // Planner Upgrade (PR-PLN 0/1/5) — file-based Plan read + write + AI/migration
    plan_dispatch_prompt, plan_list, plan_get, plan_item_history, plan_create, plan_apply_edit,
    plan_ai_refresh, plan_migrate_goals, plan_recent_updates, plan_set_status,
    plan_rename, plan_delete,
    get_file_symbols, get_code_graph, get_change_impact, get_file_calls,
    apply_menu_language,
    open_devtools, open_project_tab, new_start_tab, set_tab_project, close_tab,
    activate_tab, reorder_tabs, detach_tab, get_window_tabs, list_open_project_ids,
    open_terminal_window, close_terminal_window, list_terminal_windows,
    read_project_file, read_file_range,
    // 코드 화면 — 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md)
    code_tree, code_dir, code_read, code_write,
    // 코드 화면 — 전역 검색·치환 (#project-search)
    code_search, code_search_replace,
    // 코드 화면 — 파일 조작 (.oculpm/planner/ide-completion.md #file-ops-backend)
    code_create, code_mkdir, code_rename, code_delete,
    // 코드 화면 — 일지 연동 + HEAD 비교 (ide-completion #agent-diff)
    code_file_entries, code_head_content,
    // 코드 인텔리전스 — LSP (docs/lsp/00-master-plan.md)
    lsp_status, lsp_open, lsp_change, lsp_close, lsp_completion, lsp_hover,
    lsp_definition, lsp_rename, lsp_code_actions, lsp_apply_code_action, lsp_stop,
    // Phase 2 — 참조·아웃라인·워크스페이스 심볼·시그니처·포맷팅
    lsp_references, lsp_document_symbols, lsp_workspace_symbols, lsp_signature_help, lsp_format,
    // 디버거 (DAP) — docs/dap/00-master-plan.md
    dap_adapters, dap_session, dap_start, dap_stop, dap_control,
    dap_toggle_breakpoint, dap_breakpoints, dap_all_breakpoints, dap_clear_breakpoints,
    dap_stack, dap_scopes, dap_variables,
    // 문서(docs) 뷰어 — docs/ 트리 + 마크다운 읽기 + 이미지 자산
    docs_tree, docs_read, docs_asset,
    // 문제 해결(Discussion) — 읽기(PR-DISC 0) + 쓰기(PR-DISC 1) + 첨부(2) + 승격(4)
    discussion_list, discussion_get,
    discussion_create, discussion_write, discussion_read_raw, discussion_set_status,
    discussion_rename, discussion_delete,
    discussion_attach, discussion_attach_via_dialog, discussion_asset, discussion_detach,
    discussion_promote_to_plan,
    start_pty_session, attach_pty_session, write_to_pty, pty_foreground_command,
    resize_pty, kill_pty_session,
    // 터미널 셸 통합 (OSC 133/7) — 사용자 rc 에 비활성 한 줄 설치/제거
    shell_integration_status, shell_integration_install, shell_integration_uninstall,
    git_log, git_graph, git_status, git_head_status_brief, git_line_changes,
    reindex_paths, compute_diff, diff_binary_preview, resnapshot_paths, git_uncommitted_changes,
    git_last_commit_changes, open_in_editor, open_url,
    // G2 — Project Overview + Daily Brief
    get_project_overview, generate_project_overview, refresh_project_overview_if_stale,
    update_project_overview, daily_brief,
    // G4 — Greenfield (W6)
    save_blueprint, get_blueprint, list_blueprints, delete_blueprint,
    check_cli_available, create_greenfield_project, generate_seed_goals,
    // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
    oculpm_init, oculpm_get_status, oculpm_get_config, oculpm_set_config,
    oculpm_start_session_manual, oculpm_end_session_manual, oculpm_agent_run_signal,
    oculpm_list_sessions, oculpm_get_file_changes,
    oculpm_watcher_start, oculpm_watcher_stop, oculpm_watcher_take_over,
    oculpm_list_journal_entries, oculpm_get_journal_entry, oculpm_get_entry_diffs,
    oculpm_group_changes, oculpm_set_journal_verified, oculpm_search_entities,
    oculpm_workday_brief,
    oculpm_reindex_cache, oculpm_create_manual_entry, oculpm_update_entry_meta,
    oculpm_coerce_entry_on_disk,
    oculpm_agents_sync_active, oculpm_agents_detect, oculpm_agents_get_master_template,
    oculpm_agents_check_master_upgrade, oculpm_agents_apply_master_upgrade,
    oculpm_compare_layers, oculpm_get_log_dir, oculpm_log,
    oculpm_update_entry_body, oculpm_open_entry_in_editor,
    // W5-PR5 — Overview stats
    oculpm_overview_stats,
    // F5 — git-history backfill
    oculpm_backfill_from_git,
    // F4 — 회고/인사이트 (+ PR-CI6 eval 추이, defer 원장)
    retro_signals, get_retro, generate_retro, retro_dispatch_prompt, eval_signals, defer_signals,
    // v2 U10 (C1) — 스탠드업·PR 본문·주간 보고
    oculpm_generate_summary,
    // C2 — 일지 내보내기
    oculpm_export_digest,
    // 스킬 관리 — 프로젝트/전역 Claude Code 스킬(.claude/skills) CRUD·토글·복사
    skills_list, skills_read, skills_save, skills_delete, skills_set_enabled, skills_copy,
    // PR-CI3 — 규칙 허브 (CLAUDE.md·.claude/rules CRUD + Cursor 미러 번역)
    rules_list, rules_read, rules_save, rules_delete, rules_sync_translations,
    // PR-CI4 — 실패→규칙 승격 (결정적 후보 + 옵인 LLM 초안; 저장은 rules_save 승인 경로만)
    rule_candidates, rule_draft_generate,
    // 반복 절차→스킬 승격 (CI4 미러; 저장은 skills_save 승인 경로만)
    skill_candidates, skill_draft_generate,
    // PR-ACP1 — ACP 어댑터 런타임 (진단·설치·프로세스 수명)
    acp_diagnose, acp_install_adapter, acp_start, acp_stop, acp_status, acp_prompt, acp_cancel,
    acp_permission_respond, acp_set_config_option,
    acp_pick_files, acp_list_files, acp_new_session, acp_list_sessions, acp_load_session, acp_commands,
    acp_delete_session,
    acp_select_session, acp_usage, acp_refresh_usage, acp_options, acp_session_title,
    // PR-CI0 — Claude Code 훅 브리지 (settings.local.json 설치/제거/상태)
    claude_hooks_status, claude_hooks_install, claude_hooks_uninstall,
    // H3b — 플러그인 SessionEnd 의 "일지 없이 끝난 세션" 신호 소비 (Today 카드)
    journal_missing_signals,
    // PR-CI2 — oculpm-mcp 서버 등록 (.mcp.json / Claude Desktop 원클릭)
    mcp_status, mcp_register, mcp_unregister,
    claude_plugin_status, mcp_desktop_status, mcp_desktop_register, mcp_desktop_unregister,
    // PR-CI7 — Notion 내보내기 (키체인 토큰 + REST 페이지 생성)
    notion_status, notion_verify_token, notion_oauth_start, notion_set_parent, notion_export,
    // 모바일 브리지 (.oculpm/planner/mobile-bridge.md #mb0-axum)
    mobile_bridge_start, mobile_bridge_stop, mobile_bridge_status,
    mobile_bridge_pairing_begin, mobile_bridge_devices, mobile_bridge_revoke_device,
};
// v2.3.0 메뉴바 (docs/menubar/00-master-plan.md)
use crate::tray::{tray_apply_settings, tray_hide_popover, tray_open_main};
use crate::db::Db;
use crate::embedding::Embedder;

/// Build the specta Builder with every command + event registered. Extracted
/// so the W5-PR3 `export_bindings` test can regenerate `src/lib/bindings.ts`
/// without spawning the full Tauri runtime. Each call returns a fresh Builder
/// (the `.export(...)` consumes `self`).
fn build_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        db_health,
        settings_set,
        settings_get,
        settings_get_all,
        settings_set_many,
        app_info,
        clear_all_data,
        secret_set,
        secret_has,
        secret_delete,
        secret_verify,
        chat,
        chat_stream,
        select_project_folder,
        list_projects,
        create_project,
        delete_project,
        rename_project,
        set_project_appearance,
        project_stats,
        // C2 — 스킬 카탈로그: 결정적 스택 감지
        detect_stack,
        home_brief,
        index_project,
        search_chunks,
        search_text,
        search_symbols,
        get_file_symbols,
        get_code_graph,
        get_change_impact,
        get_file_calls,
        clear_project_index,
        // Planner Upgrade (PR-PLN 0/1) — file-based Plan read + write
        plan_list,
        plan_get,
        plan_item_history,
        plan_create,
        plan_apply_edit,
        plan_dispatch_prompt,
        plan_ai_refresh,
        plan_migrate_goals,
        plan_recent_updates,
        plan_set_status,
        plan_rename,
        plan_delete,
        // M2-3 — Chat history
        conversation_create,
        conversation_list,
        conversation_rename,
        conversation_set_context,
        conversation_delete,
        chat_message_append,
        chat_message_list,
        record_conversation_action,
        list_conversation_actions,
        // M5 — Window & File Operations
        open_devtools,
        // 크롬식 탭 (v2.9.0) — 창 = 탭 집합(시작 탭 + 프로젝트 탭).
        // 레지스트리는 Rust 소유 (전역 유일성·PTY 정리·떼어내기 심판).
        open_project_tab,
        new_start_tab,
        set_tab_project,
        close_tab,
        activate_tab,
        reorder_tabs,
        detach_tab,
        get_window_tabs,
        list_open_project_ids,
        // 터미널 도크 — 셸을 자기 창으로 떼어내기 (2026-08-15)
        open_terminal_window,
        close_terminal_window,
        list_terminal_windows,
        // 앱 메뉴 — 프런트가 해석한 UI 언어를 알려 주면 라벨을 다시 만든다
        apply_menu_language,
        read_project_file,
        read_file_range,
        // 코드 화면 — 파일 트리 + 읽기/쓰기
        code_tree,
        code_dir,
        code_read,
        code_write,
        // 코드 화면 — 전역 검색·치환
        code_search,
        code_search_replace,
        // 코드 화면 — 파일 조작
        code_create,
        code_mkdir,
        code_rename,
        code_delete,
        code_file_entries,
        code_head_content,
        lsp_status,
        lsp_open,
        lsp_change,
        lsp_close,
        lsp_completion,
        lsp_hover,
        lsp_definition,
        lsp_rename,
        lsp_code_actions,
        lsp_apply_code_action,
        lsp_references,
        lsp_document_symbols,
        lsp_workspace_symbols,
        lsp_signature_help,
        lsp_format,
        dap_adapters,
        dap_session,
        dap_start,
        dap_stop,
        dap_control,
        dap_toggle_breakpoint,
        dap_breakpoints,
        dap_all_breakpoints,
        dap_clear_breakpoints,
        dap_stack,
        dap_scopes,
        dap_variables,
        lsp_stop,
        // 문서(docs) 뷰어
        docs_tree,
        docs_read,
        docs_asset,
        // 문제 해결(Discussion) — PR-DISC 0/1/2/4
        discussion_list,
        discussion_get,
        discussion_create,
        discussion_write,
        discussion_read_raw,
        discussion_set_status,
        discussion_rename,
        discussion_delete,
        discussion_attach,
        discussion_attach_via_dialog,
        discussion_asset,
        discussion_detach,
        discussion_promote_to_plan,
        // Terminal
        start_pty_session,
        attach_pty_session,
        write_to_pty,
        pty_foreground_command,
        resize_pty,
        kill_pty_session,
        // 터미널 셸 통합 (OSC 133/7)
        shell_integration_status,
        shell_integration_install,
        shell_integration_uninstall,
        // M7 — Git / GitHub
        git_log,
        git_graph,
        git_status,
        git_head_status_brief,
        git_line_changes,
        // Lite-W6 PR6 — LocalDiffView backend
        reindex_paths,
        compute_diff,
        diff_binary_preview,
        resnapshot_paths,
        git_uncommitted_changes,
        git_last_commit_changes,
        open_in_editor,
        open_url,
        // G2 — Project Overview + Daily Brief
        get_project_overview,
        generate_project_overview,
        refresh_project_overview_if_stale,
        update_project_overview,
        daily_brief,
        // G4 — Greenfield (W6)
        save_blueprint,
        get_blueprint,
        list_blueprints,
        delete_blueprint,
        check_cli_available,
        create_greenfield_project,
        generate_seed_goals,
        // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
        oculpm_init,
        oculpm_get_status,
        oculpm_get_config,
        oculpm_set_config,
        oculpm_start_session_manual,
        oculpm_end_session_manual,
        oculpm_agent_run_signal,
        oculpm_list_sessions,
        oculpm_get_file_changes,
        oculpm_watcher_start,
        oculpm_watcher_stop,
        oculpm_watcher_take_over,
        oculpm_list_journal_entries,
        oculpm_get_journal_entry,
        oculpm_get_entry_diffs,
        oculpm_group_changes,
        oculpm_set_journal_verified,
        oculpm_search_entities,
        oculpm_workday_brief,
        oculpm_reindex_cache,
        oculpm_create_manual_entry,
        oculpm_update_entry_meta,
        oculpm_coerce_entry_on_disk,
        oculpm_agents_sync_active,
        oculpm_agents_detect,
        oculpm_agents_get_master_template,
        oculpm_agents_check_master_upgrade,
        oculpm_agents_apply_master_upgrade,
        oculpm_compare_layers,
        oculpm_get_log_dir,
        oculpm_log,
        oculpm_update_entry_body,
        oculpm_open_entry_in_editor,
        // W5-PR5 — Overview stats
        oculpm_overview_stats,
        // F5 — git-history backfill
        oculpm_backfill_from_git,
        // F4 — 회고/인사이트 (+ PR-CI6 eval 추이)
        retro_signals,
        oculpm_generate_summary,
        get_retro,
        generate_retro,
        retro_dispatch_prompt,
        eval_signals,
        defer_signals,
        // C2 — 일지 내보내기
        oculpm_export_digest,
        // 스킬 관리 — 프로젝트/전역 Claude Code 스킬(.claude/skills)
        skills_list,
        skills_read,
        skills_save,
        skills_delete,
        skills_set_enabled,
        skills_copy,
        // PR-CI3 — 규칙 허브
        rules_list,
        rules_read,
        rules_save,
        rules_delete,
        rules_sync_translations,
        // PR-CI4 — 실패→규칙 승격
        rule_candidates,
        rule_draft_generate,
        // 반복 절차→스킬 승격 (CI4 미러)
        skill_candidates,
        skill_draft_generate,
        // PR-ACP1 — ACP 어댑터 런타임
        acp_diagnose,
        acp_install_adapter,
        acp_start,
        acp_stop,
        acp_status,
        acp_prompt,
        acp_cancel,
        acp_permission_respond,
        acp_set_config_option,
        acp_pick_files,
        acp_list_files,
        acp_new_session,
        acp_list_sessions,
        acp_load_session,
        acp_commands,
        acp_usage,
        acp_refresh_usage,
        acp_options,
        acp_session_title,
        acp_delete_session,
        acp_select_session,
        // PR-CI0 — Claude Code 훅 브리지
        claude_hooks_status,
        claude_hooks_install,
        claude_hooks_uninstall,
        // H3b — "일지 없이 끝난 세션" 신호 (Today 카드)
        journal_missing_signals,
        // PR-CI2 — oculpm-mcp 서버 등록
        mcp_status,
        mcp_register,
        mcp_unregister,
        mcp_desktop_status,
        claude_plugin_status,
        mcp_desktop_register,
        mcp_desktop_unregister,
        // PR-CI7 — Notion 내보내기
        notion_status,
        notion_oauth_start,
        notion_verify_token,
        notion_set_parent,
        notion_export,
        // v2.3.0 메뉴바
        tray_open_main,
        tray_hide_popover,
        tray_apply_settings,
        // 모바일 브리지 (#mb0-axum)
        mobile_bridge_start,
        mobile_bridge_stop,
        mobile_bridge_status,
        mobile_bridge_pairing_begin,
        mobile_bridge_devices,
        mobile_bridge_revoke_device,
    ])
    .events(collect_events![
        // .oculpm/ subsystem (W1-PR2)
        // 디버거 (DAP)
        crate::commands::dap::DapSessionChanged,
        crate::commands::dap::DapOutputEmitted,
        crate::commands::dap::DapBreakpointsChanged,
        crate::oculpm::spec::OculpmSessionStarted,
        crate::oculpm::spec::OculpmSessionEnded,
        crate::oculpm::spec::OculpmFileChanged,
        crate::oculpm::spec::OculpmJournalAdded,
        crate::oculpm::spec::OculpmJournalUpdated,
        crate::oculpm::spec::OculpmIntegrityWarning,
        crate::oculpm::spec::OculpmPlanReconciled,
        crate::oculpm::spec::OculpmWatchYielded,
        crate::oculpm::spec::OculpmAgentDrift,
        crate::oculpm::spec::OculpmAgentsTemplateChanged,
        crate::oculpm::spec::OculpmJournalPathChanged,
        // 계획 · 논의 파일이 디스크에서 바뀌면 해당 화면이 즉시 다시 읽는다
        crate::oculpm::spec::OculpmDataChanged,
        // v2.3.0 메뉴바 — 팝오버 → 프로젝트 창 딥링크
        crate::tray::TrayNavigate,
        // 크롬식 탭 — 창별 탭 구성 + 런처의 "열림" 배지
        crate::commands::window::WindowTabsChanged,
        crate::commands::window::CloseIntent,
        crate::commands::window::ProjectWindowsChanged,
        crate::commands::window::TerminalWindowsChanged,
        // 코드 인텔리전스 — 진단·서버 상태 (docs/lsp/00-master-plan.md)
        crate::lsp::state::LspDiagnosticsPublished,
        crate::lsp::state::LspServerStateChanged,
        // 설정 변경 브로드캐스트 — 모든 창 + 상단바가 테마·언어를 다시 읽는다
        crate::commands::config::SettingsChanged,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_logging();

    let builder = build_specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            // tray 팝오버 창은 위치를 트레이 클릭이 결정 — 상태 복원 제외.
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[crate::tray::TRAY_WINDOW])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // --- macOS: titleBarStyle Overlay + hidden title (MASTER-GUIDE §6.2) ---
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            let app_data = app.path().app_data_dir()?;
            let db_path = app_data.join("ocul-pm.db");
            let db = tauri::async_runtime::block_on(Db::open(db_path))
                .expect("failed to open database");
            app.manage(db);
            // Pin the embedding model cache to an absolute, writable dir. The
            // packaged .app runs with CWD `/`, so fastembed's relative default
            // would fail to retrieve `onnx/model.onnx`.
            let embed_cache = app_data.join("fastembed_cache");
            app.manage(Embedder::new(app.handle().clone(), embed_cache));
            app.manage(crate::commands::terminal::PtyState::default());
            // PR-ACP1 — ACP 어댑터 레지스트리 (프로젝트당 1 연결).
            app.manage(crate::acp::AcpState::default());
            // PR-LSP0 — 언어 서버 레지스트리 ((프로젝트, 언어, 워크스페이스 루트)당 1).
            app.manage(crate::lsp::state::LspState::default());
            app.manage(crate::dap::state::DapState::default());
            // 크롬식 탭 — 창 → 프로젝트 탭 집합 레지스트리 (전역 유일성 심판)
            app.manage(crate::commands::window::WindowTabs::default());
            // .oculpm/ subsystem (W1-PR6)
            app.manage(crate::oculpm::manager::OculpmManager::new());
            app.manage(crate::mobile_bridge::server::MobileBridgeState::default());

            // v2.3.0 메뉴바 — 트레이 아이콘 + 팝오버 (Db manage 이후여야 함:
            // 설정 조회가 Db state 를 쓴다).
            #[cfg(desktop)]
            crate::tray::init(app)?;

            // `tauri.conf.json` 이 만든 첫 창을 레지스트리에 편입한다 — 이제
            // 특별한 "런처 창" 은 없고, 시작 탭 하나를 문 평범한 탭 창이다.
            // 창 닫기 훅(포커스 추적·탭 정리·마지막 창 판정)도 여기서 붙는다.
            crate::commands::window::adopt_first_window(app.handle());

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
            tauri::RunEvent::ExitRequested { .. } => {
                if let Some(manager) =
                    app_handle.try_state::<crate::oculpm::manager::OculpmManager>()
                {
                    manager.shutdown_all_blocking();
                }
                // 모바일 브리지 — oneshot 만 보내면 axum 이 graceful 로 내려간다.
                if let Some(bridge) =
                    app_handle.try_state::<crate::mobile_bridge::server::MobileBridgeState>()
                {
                    bridge.stop();
                }
            }
            // macOS: Dock 아이콘 클릭 / "모두 앞으로 가져오기".
            //
            // 창을 다 닫아도 앱은 살아 있는데(트레이·메뉴바가 있으므로 종료하지
            // 않는다), 이 이벤트를 안 받으면 Dock 을 눌러도 **아무 일도 안 난다** —
            // 사용자 눈에는 앱이 죽은 것이고, 메뉴바로 들어가는 길밖에 안 남는다.
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

