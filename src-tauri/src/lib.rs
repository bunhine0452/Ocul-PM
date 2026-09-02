// clippy 게이트(2026-08-30, CI 가 `-D warnings`): 구조를 바꿔야 풀리는 두 가지만
// 크레이트 수준에서 허용한다 — 인자 8~9개인 Tauri 커맨드(lsp·acp)와 LSP
// 클라이언트의 콜백 타입. 나머지 경고는 전부 고쳤다.
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

// PR-ACP1 — 통합 테스트(tests/acp_handshake.rs)가 env/adapter 를 직접 쓴다.
pub mod acp;
pub mod app_error;
mod ast;
mod commands;
// 선언적 설정 — plan/apply 두 모듈을 UI·CLI·MCP 가 공유한다 (Phase 6).
pub mod config;
// W5-PR8 — `db` and `oculpm` are made public so `src-tauri/tests/`
// integration tests can drive the manager directly with a temp DB. None
// of the other modules are needed at the integration layer.
pub mod dap;
// `oculpm://` 딥링크 — 파싱만 한다 (무확인 실행 0, Phase 6).
pub mod db;
pub mod deeplink;
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
// PTY 호스트 — 터미널 세션을 앱 프로세스 밖으로 (#pty-host). pub 인 이유:
// main.rs 의 `--pty-host` 분기와 통합 테스트가 직접 부른다.
mod menu;
mod mobile_bridge;
pub mod plugins;
pub mod ptyhost;
mod secrets;
// 테마 파일화 (Osaurus 라운드 Phase 4) — 스키마·검증·앱데이터 저장소
pub mod themes;
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
    acp_cancel,
    acp_commands,
    acp_delete_session,
    // PR-ACP1 — ACP 어댑터 런타임 (진단·설치·프로세스 수명)
    acp_diagnose,
    acp_install_adapter,
    acp_list_files,
    acp_list_sessions,
    acp_load_session,
    acp_new_session,
    acp_options,
    acp_permission_respond,
    acp_pick_files,
    acp_prompt,
    acp_refresh_usage,
    acp_select_session,
    acp_session_title,
    acp_set_config_option,
    acp_start,
    acp_status,
    acp_stop,
    acp_usage,
    activate_tab,
    app_info,
    apply_menu_language,
    attach_pty_session,
    // Osaurus 라운드 Phase 1 — 스케줄 자동화 (정의 CRUD·기록·지금 실행)
    automation_cancel,
    automation_create_seed,
    automation_delete,
    automation_list,
    automation_overview,
    automation_run_now,
    automation_runs,
    automation_save,
    automation_seeds,
    automation_set_enabled,
    begin_tear_off,
    cancel_tear_off,
    chat,
    chat_message_append,
    chat_message_list,
    chat_stream,
    check_cli_available,
    claude_hooks_install,
    // PR-CI0 — Claude Code 훅 브리지 (settings.local.json 설치/제거/상태)
    claude_hooks_status,
    claude_hooks_uninstall,
    claude_plugin_status,
    clear_all_data,
    clear_project_index,
    close_tab,
    close_terminal_window,
    code_asset,
    code_clipboard_files,
    // 코드 화면 — 파일 조작 (.oculpm/planner/ide-completion.md #file-ops-backend)
    code_create,
    code_delete,
    code_dir,
    // 코드 화면 — 일지 연동 + HEAD 비교 (ide-completion #agent-diff)
    code_file_entries,
    code_head_content,
    code_import,
    code_mkdir,
    code_read,
    code_rename,
    // 코드 화면 — 전역 검색·치환 (#project-search)
    code_search,
    code_search_replace,
    // 코드 화면 — 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md)
    code_tree,
    code_write,
    compute_diff,
    conversation_create,
    conversation_delete,
    conversation_list,
    conversation_rename,
    conversation_set_context,
    create_greenfield_project,
    create_project,
    daily_brief,
    // 디버거 (DAP) — docs/dap/00-master-plan.md
    dap_adapters,
    dap_all_breakpoints,
    dap_breakpoints,
    dap_clear_breakpoints,
    dap_control,
    dap_scopes,
    dap_session,
    dap_stack,
    dap_start,
    dap_stop,
    dap_toggle_breakpoint,
    dap_variables,
    db_compact,
    db_health,
    defer_signals,
    delete_blueprint,
    delete_project,
    detach_tab,
    // C2 — 스킬 카탈로그: 결정적 스택 감지 (LLM 0 · 네트워크 0)
    detect_stack,
    diff_binary_preview,
    discussion_asset,
    discussion_attach,
    discussion_attach_via_dialog,
    discussion_create,
    discussion_delete,
    discussion_detach,
    discussion_get,
    // 문제 해결(Discussion) — 읽기(PR-DISC 0) + 쓰기(PR-DISC 1) + 첨부(2) + 승격(4)
    discussion_list,
    discussion_promote_to_plan,
    discussion_read_raw,
    discussion_rename,
    discussion_set_status,
    discussion_write,
    docs_asset,
    docs_read,
    // 문서(docs) 뷰어 — docs/ 트리 + 마크다운 읽기 + 이미지 자산
    docs_tree,
    drop_tear_off,
    eval_signals,
    firing_rebuild,
    // AD-1 — 발동 원장 (transcript 기반 규칙 주입·스킬 발동 계측)
    firing_rescan,
    firing_stats,
    generate_project_overview,
    generate_retro,
    generate_seed_goals,
    get_blueprint,
    get_change_impact,
    get_code_graph,
    get_file_calls,
    get_file_symbols,
    // G2 — Project Overview + Daily Brief
    get_project_overview,
    get_retro,
    get_window_tabs,
    git_graph,
    git_head_status_brief,
    git_last_commit_changes,
    git_line_changes,
    git_log,
    git_status,
    git_uncommitted_changes,
    // 메인 화면(프로젝트 선택) 단일 집계 — IPC 1회 · SQL 6문
    home_brief,
    index_project,
    // H3b — 플러그인 SessionEnd 의 "일지 없이 끝난 세션" 신호 소비 (Today 카드)
    journal_missing_signals,
    kill_pty_session,
    list_app_windows,
    list_blueprints,
    list_conversation_actions,
    list_open_project_ids,
    list_projects,
    list_terminal_windows,
    llm_reachability,
    lsp_apply_code_action,
    lsp_change,
    lsp_close,
    lsp_code_actions,
    lsp_completion,
    lsp_definition,
    lsp_diagnostics_snapshot,
    lsp_document_symbols,
    lsp_format,
    lsp_hover,
    lsp_open,
    // Phase 2 — 참조·아웃라인·워크스페이스 심볼·시그니처·포맷팅
    lsp_references,
    lsp_rename,
    lsp_signature_help,
    // 코드 인텔리전스 — LSP (docs/lsp/00-master-plan.md)
    lsp_status,
    lsp_stop,
    lsp_workspace_symbols,
    mcp_desktop_register,
    mcp_desktop_status,
    mcp_desktop_unregister,
    mcp_register,
    // PR-CI2 — oculpm-mcp 서버 등록 (.mcp.json / Claude Desktop 원클릭)
    mcp_status,
    mcp_unregister,
    mobile_bridge_devices,
    mobile_bridge_pairing_begin,
    mobile_bridge_revoke_device,
    // 모바일 브리지 (.oculpm/planner/mobile-bridge.md #mb0-axum)
    mobile_bridge_start,
    mobile_bridge_status,
    mobile_bridge_stop,
    move_tab_to_window,
    new_start_tab,
    notion_export,
    notion_oauth_start,
    notion_set_parent,
    // PR-CI7 — Notion 내보내기 (키체인 토큰 + REST 페이지 생성)
    notion_status,
    notion_verify_token,
    oculpm_agent_run_signal,
    oculpm_agents_apply_master_upgrade,
    oculpm_agents_check_master_ahead,
    oculpm_agents_check_master_upgrade,
    oculpm_agents_detect,
    oculpm_agents_get_master_template,
    oculpm_agents_sync_active,
    // F5 — git-history backfill
    oculpm_backfill_from_git,
    oculpm_coerce_entry_on_disk,
    oculpm_compare_layers,
    oculpm_compare_workday,
    oculpm_create_manual_entry,
    oculpm_current_workday,
    oculpm_end_session_manual,
    // C2 — 일지 내보내기
    oculpm_export_digest,
    // v2 U10 (C1) — 스탠드업·PR 본문·주간 보고
    oculpm_generate_summary,
    oculpm_get_config,
    oculpm_get_entry_diffs,
    oculpm_get_file_changes,
    oculpm_get_journal_entry,
    oculpm_get_log_dir,
    oculpm_get_status,
    oculpm_group_changes,
    // .oculpm/ subsystem (W1-PR6 + W2-PR6 + W3-PR3)
    oculpm_init,
    oculpm_list_journal_entries,
    oculpm_list_sessions,
    oculpm_log,
    oculpm_open_entry_in_editor,
    // W5-PR5 — Overview stats
    oculpm_overview_stats,
    oculpm_reindex_cache,
    oculpm_search_entities,
    oculpm_set_config,
    oculpm_set_journal_verified,
    oculpm_start_session_manual,
    oculpm_update_entry_body,
    oculpm_update_entry_meta,
    oculpm_watcher_start,
    oculpm_watcher_stop,
    oculpm_watcher_take_over,
    oculpm_workday_brief,
    open_devtools,
    open_in_editor,
    open_project_tab,
    open_terminal_window,
    open_url,
    plan_ai_refresh,
    plan_apply_edit,
    plan_create,
    plan_delete,
    // Planner Upgrade (PR-PLN 0/1/5) — file-based Plan read + write + AI/migration
    plan_dispatch_prompt,
    plan_get,
    plan_item_history,
    plan_list,
    plan_migrate_goals,
    plan_recent_updates,
    plan_rename,
    plan_set_status,
    // Osaurus 라운드 Phase 4 — 테마 파일화 · 프로젝트 바인딩
    project_instructions_get,
    project_instructions_set,
    project_stats,
    pty_foreground_command,
    read_file_range,
    read_project_file,
    recall_forget,
    recall_reset,
    recall_top,
    recall_touch,
    // W5 — action proposal apply-state
    record_conversation_action,
    refresh_project_overview_if_stale,
    reindex_paths,
    rename_project,
    reorder_tabs,
    resize_pty,
    resnapshot_paths,
    retro_dispatch_prompt,
    // F4 — 회고/인사이트 (+ PR-CI6 eval 추이, defer 원장)
    retro_signals,
    // PR-CI4 — 실패→규칙 승격 (결정적 후보 + 옵인 LLM 초안; 저장은 rules_save 승인 경로만)
    rule_candidates,
    rule_draft_generate,
    rules_delete,
    // PR-CI3 — 규칙 허브 (CLAUDE.md·.claude/rules CRUD + Cursor 미러 번역)
    rules_list,
    rules_read,
    rules_save,
    // AD-6 — 규칙 다이어트 (결정적 범위 감사 + 승인형 백업 저장)
    rules_save_with_backup,
    rules_scope_audit,
    rules_sync_translations,
    // G4 — Greenfield (W6)
    save_blueprint,
    save_window_session,
    search_chunks,
    search_symbols,
    search_text,
    secret_delete,
    secret_has,
    secret_set,
    secret_verify,
    select_project_folder,
    set_project_appearance,
    set_project_theme,
    set_tab_project,
    settings_get,
    settings_get_all,
    settings_set,
    settings_set_many,
    shell_integration_install,
    // 터미널 셸 통합 (OSC 133/7) — 사용자 rc 에 비활성 한 줄 설치/제거
    shell_integration_status,
    shell_integration_uninstall,
    // 반복 절차→스킬 승격 (CI4 미러; 저장은 skills_save 승인 경로만)
    skill_candidates,
    skill_draft_generate,
    skills_copy,
    skills_delete,
    // 스킬 관리 — 프로젝트/전역 Claude Code 스킬(.claude/skills) CRUD·토글·복사
    skills_list,
    skills_read,
    skills_save,
    skills_set_enabled,
    // AD-5 — 트리거 교정 (안 걸리는 스킬의 description 재작성 초안)
    skills_trigger_rewrite,
    start_pty_session,
    system_accent,
    tab_drag_end,
    tab_drag_over,
    tab_drop_hint,
    theme_delete,
    theme_export,
    theme_import,
    theme_import_url,
    theme_list,
    theme_save,
    update_project_overview,
    write_to_pty,
};
// 선언적 설정 (Phase 6) — UI 진입점. planner/applier 는 crate::config 에 있다.
use crate::commands::declarative_config::{
    config_apply, config_export, config_export_to_file, config_plan, config_read_file,
};
// 플러그인 번들 임포트 (Phase 6) — 가드·분류·배치는 crate::plugins 에 있다.
use crate::commands::plugins::{plugin_import, plugin_list, plugin_pick_bundle, plugin_remove};
// 대화 임포트 (Phase 7) — 어댑터·일지화는 crate::oculpm::import 에 있다.
use crate::commands::import::{
    conversation_import_run, conversation_import_scan, conversation_pick_export,
};
// v2.3.0 메뉴바 (docs/menubar/00-master-plan.md)
use crate::db::Db;
use crate::embedding::Embedder;
use crate::tray::{tray_apply_settings, tray_hide_popover, tray_open_main};

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
            // 테마 파일화 (Phase 4) — 목록·저장·삭제·가져오기/내보내기·시스템 강조색
            theme_list,
            theme_save,
            theme_delete,
            theme_import,
            theme_import_url,
            theme_export,
            system_accent,
            set_project_theme,
            // 선언적 설정 (Phase 6) — 내보내기·계획·적용. 계획은 아무것도 쓰지
            // 않고, 적용은 다시 계획해 남은 diff 로 결론을 낸다.
            config_export,
            config_export_to_file,
            config_read_file,
            config_plan,
            config_apply,
            // 플러그인 번들 임포트 (Phase 6) — 미리보기(dry)와 설치가 같은 문.
            plugin_pick_bundle,
            plugin_import,
            plugin_list,
            plugin_remove,
            // 대화 임포트 (Phase 7) — 스캔은 오프라인·무과금, 실행만 Core Model.
            conversation_pick_export,
            conversation_import_scan,
            conversation_import_run,
            // 오프라인 표시 (Phase 7) — 프로브가 아니라 마지막 관측을 읽는다.
            llm_reachability,
            // 컨텍스트 경제학 (Phase 5) — 회상 통계 · 프로젝트 지시문
            recall_top,
            recall_touch,
            recall_forget,
            recall_reset,
            project_instructions_get,
            project_instructions_set,
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
            // 창 간 탭 드래그 (다시 붙이기) — 겨누기 · 인덱스 회신 · 이동 · 정리
            tab_drag_over,
            tab_drop_hint,
            tab_drag_end,
            begin_tear_off,
            drop_tear_off,
            cancel_tear_off,
            // 드래그의 키보드·메뉴 등가물 — 창을 골라 옮기기
            move_tab_to_window,
            list_app_windows,
            get_window_tabs,
            list_open_project_ids,
            // 업데이트 재시작을 건너 창·탭을 되살린다 (재시작 직전 저장)
            save_window_session,
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
            code_asset,
            code_write,
            code_import,
            code_clipboard_files,
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
            lsp_diagnostics_snapshot,
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
            oculpm_agents_check_master_ahead,
            oculpm_agents_check_master_upgrade,
            oculpm_agents_apply_master_upgrade,
            oculpm_compare_layers,
            oculpm_compare_workday,
            oculpm_current_workday,
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
            // AD-6 — 규칙 다이어트
            rules_scope_audit,
            rules_save_with_backup,
            // PR-CI4 — 실패→규칙 승격
            rule_candidates,
            rule_draft_generate,
            // 반복 절차→스킬 승격 (CI4 미러)
            skill_candidates,
            skill_draft_generate,
            // AD-5 — 트리거 교정
            skills_trigger_rewrite,
            // AD-1 — 발동 원장
            firing_rescan,
            firing_stats,
            firing_rebuild,
            // Osaurus 라운드 Phase 1 — 스케줄 자동화
            automation_list,
            automation_overview,
            automation_runs,
            automation_seeds,
            automation_save,
            automation_delete,
            automation_set_enabled,
            automation_create_seed,
            automation_run_now,
            automation_cancel,
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
            crate::oculpm::spec::OculpmJournalPathChanged,
            // 워크데이 넘김 · Claude Code 세션 변화 — 폴링 대신 (Phase 4)
            crate::oculpm::spec::OculpmWorkdayChanged,
            crate::acp::session::AcpSessionChanged,
            // 계획 · 논의 파일이 디스크에서 바뀌면 해당 화면이 즉시 다시 읽는다
            crate::oculpm::spec::OculpmDataChanged,
            // v2.3.0 메뉴바 — 팝오버 → 프로젝트 창 딥링크
            crate::tray::TrayNavigate,
            // 크롬식 탭 — 창별 탭 구성 + 런처의 "열림" 배지
            crate::commands::window::WindowTabsChanged,
            crate::commands::window::CloseIntent,
            crate::commands::window::NewTabIntent,
            crate::commands::window::ProjectWindowsChanged,
            crate::commands::window::TerminalWindowsChanged,
            crate::commands::window::TabDragOver,
            crate::commands::window::TabDragLeave,
            crate::commands::window::TearOffSettled,
            // 코드 인텔리전스 — 진단·서버 상태 (docs/lsp/00-master-plan.md)
            crate::lsp::state::LspDiagnosticsPublished,
            crate::lsp::state::LspServerStateChanged,
            // 설정 변경 브로드캐스트 — 모든 창 + 상단바가 테마·언어를 다시 읽는다
            crate::commands::config::SettingsChanged,
            // 테마 파일·프로젝트 바인딩 변경 — 갤러리와 적용 경로가 다시 읽는다
            crate::commands::themes::ThemesChanged,
            // 자동화 실행 시작/종료 — 「실행 중…」과 인라인 Stop (Phase 3)
            crate::commands::automation::AutomationRunChanged,
            // 딥링크 — 프런트가 확인 시트를 띄운다 (Phase 6 #deep-link)
            crate::deeplink::DeepLinkReceived,
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

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/lib/bindings.ts")
        .expect("Failed to export typescript bindings");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // `oculpm://` — 웹에서 앱으로 오는 유일한 길. 플러그인은 URL 을
        // 나르기만 하고, 무엇을 할지는 확인 시트가 정한다 (무확인 실행 0).
        .plugin(tauri_plugin_deep_link::init())
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
            let db =
                tauri::async_runtime::block_on(Db::open(db_path)).expect("failed to open database");
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
            // 자동화 잡 러너 — 프로세스 하나에 1개. 동시 1건은 프로젝트별이
            // 아니라 전역이다 (배경 과금의 총량을 사람이 예측할 수 있게).
            app.manage(crate::oculpm::automation::runner::AutomationRunner::default());
            // 워처 자동화 허브 — 정착 타이머와 두 초안 경로의 중복 키가 여기 산다
            // (Phase 2). 워처는 매 fs 이벤트마다 이 상태를 두드리므로 러너와
            // 마찬가지로 프로세스에 하나다.
            app.manage(crate::oculpm::automation::watchers::WatcherAutomationHub::new());
            app.manage(crate::mobile_bridge::server::MobileBridgeState::default());

            // v2.3.0 메뉴바 — 트레이 아이콘 + 팝오버 (Db manage 이후여야 함:
            // 설정 조회가 Db state 를 쓴다).
            #[cfg(desktop)]
            crate::tray::init(app)?;

            // `tauri.conf.json` 이 만든 첫 창을 레지스트리에 편입한다 — 이제
            // 특별한 "런처 창" 은 없고, 시작 탭 하나를 문 평범한 탭 창이다.
            // 창 닫기 훅(포커스 추적·탭 정리·마지막 창 판정)도 여기서 붙는다.
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
            }

            // 업데이트로 우리가 끊은 재시작이라면 그때 열려 있던 창·탭을
            // 되살린다. 스냅숏이 없으면(=사용자가 직접 끈 앱) 아무 일도 안
            // 한다 — 첫 창은 그대로 시작 탭 하나로 남는다.
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
            // 스케줄 집행 루프 — 감독관과 같은 자리에 상주시킨다. 프로젝트별
            // `[automation] schedules` 가 꺼져 있으면 정의를 읽지도 않는다.
            crate::oculpm::automation::scheduler::spawn(app.handle());
            // 정착 드라이버 — 시계가 아니라 **마감 시각**을 보고 잔다. 창이
            // 없으면 5초마다 깨어 정의를 다시 읽는다.
            crate::oculpm::automation::watchers::spawn(app.handle());

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
                // ACP 어댑터(node + 손자 claude) — 여기서 안 내리면 tao 의
                // `process::exit` 뒤에 고아로 남는다. 최대 1초 기다린다.
                if let Some(acp) = app_handle.try_state::<crate::acp::AcpState>() {
                    acp.stop_all_blocking();
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
