---
schema_version: 1
type: refactor
slug: "optimize-dead-code-sweep"
status: done
difficulty: high
created_at: "2026-11-01T15:49:28+09:00"
session_id: "20261101-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "d8b38fb5-2ed4-4f05-8ab6-4ca7b916800b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CLAUDE.md"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/src/commands/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/commands/cli_check.rs"
    op: delete
  - path: "src-tauri/src/commands/config.rs"
    op: update
  - path: "src-tauri/src/commands/diagnostics.rs"
    op: update
  - path: "src-tauri/src/commands/diagnostics/platform.rs"
    op: delete
  - path: "src-tauri/src/commands/git.rs"
    op: update
  - path: "src-tauri/src/commands/index_usage.rs"
    op: delete
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/db/projects.rs"
    op: update
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/src/db/tests.rs"
    op: update
  - path: "src-tauri/src/framing.rs"
    op: delete
  - path: "src-tauri/src/git/changelog.rs"
    op: delete
  - path: "src-tauri/src/git/gutter.rs"
    op: delete
  - path: "src-tauri/src/git/history.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/status.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/conversations.rs"
    op: delete
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/chain.rs"
    op: delete
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/content_lang.rs"
    op: update
  - path: "src-tauri/src/oculpm/first_record.rs"
    op: delete
  - path: "src-tauri/src/oculpm/framing.rs"
    op: delete
  - path: "src-tauri/src/oculpm/history.rs"
    op: delete
  - path: "src-tauri/src/oculpm/history_tests.rs"
    op: delete
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/resume.rs"
    op: delete
  - path: "src-tauri/src/oculpm/transcript.rs"
    op: delete
  - path: "src-tauri/src/oculpm/verdict/collect.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/proc.rs"
    op: update
  - path: "src-tauri/src/proc/detached.rs"
    op: delete
  - path: "src-tauri/src/proc/disclaim.rs"
    op: delete
  - path: "src-tauri/src/text.rs"
    op: update
  - path: "src-tauri/src/trust.rs"
    op: delete
  - path: "src-tauri/tests/egress_spawn_ledger.rs"
    op: update
  - path: "src-tauri/tests/egress_spawn_ledger/sites.rs"
    op: update
  - path: "src-tauri/tests/oculpm_history.rs"
    op: delete
  - path: "src-tauri/tests/project_delete_cache.rs"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/api/git.ts"
    op: update
  - path: "src/api/settings.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/features/oculpm/evidenceInbox.ts"
    op: delete
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/shell/useShellNav.ts"
    op: update
  - path: "src/features/terminal/termStore.ts"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/agentColor.ts"
    op: update
  - path: "src/i18n/index.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/filePath.ts"
    op: update
  - path: "src/lib/hljs.ts"
    op: update
  - path: "src/lib/journalCompose.ts"
    op: delete
  - path: "src/lib/nativeDrag.ts"
    op: update
  - path: "src/lib/resumeIntent.ts"
    op: delete
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/lib/workday.ts"
    op: update
  - path: "src-tauri/migrations/044_drop_dead_feature_tables.sql"
    op: create
  - path: "src/lib/hljsCommon.ts"
    op: create
related: []
tags:
  - "최적화"
  - "optimization"
  - "dead-code"
  - "migration"
  - "mcp-tool"
---
[x] 최적화: 죽은 코드 7.8천 줄과 빈 표를 걷었다

## 동기
설치본 실측(로그 집계·DB dbstat)과 「호출자 0」 스캔으로 4.0 이후 남은 짐을 찾았다. 현재 판 로그(10-31·11-01)는 경고 0 이라, 대상은 번들 중복·쓰기만 하는 경로·빈 표·죽은 코드다. 스캔은 `pub` 을 잠시 `pub(crate)` 로 바꾼 사본에 앱·MCP 진입점을 lib 루트로 붙여 컴파일러 dead_code 경고를 받는 방식(재수출이 가리는 것까지 연쇄로 잡힌다). macOS 컴파일 기준이라 Windows/Linux 전용 경로(`links_in_argv`·`refresh_stable_sidecar`)는 텍스트 grep 으로 다시 확인해 남겼다.

## 변경 요약
- **로컬 히스토리 쓰기 제거** — 워처가 파일 변경마다 전문 스냅샷을 `.oculpm/index/history/` 에 쓰는데 읽는 곳이 0 (3.x 편집기와 함께 사라짐). 이 저장소만 328MB 누적. `oculpm/history.rs`·히스토리 갈래(`Lane::History`)·`HistoryState` 를 걷었다. 이미 쌓인 폴더는 지우지 않는다.
- **highlight.js 문법 두 벌 → 한 벌** — `highlight.js/lib/common`(ESM 껍데기가 CJS 문법을 묾)과 lowlight(ESM 문법)이 같은 37개 문법을 따로 실었다. pnpm override 로 판을 하나로, `lib/hljsCommon.ts` 가 lowlight 와 같은 ESM 파일을 들인다. 마크다운+diff 하이라이트 480KB → 329KB (gzip 154 → 102KB).
- **직접 의존 `reqwest` 제거** — 코드 사용 0. 우리가 켠 기능이 끌어오던 aws-lc-rs·aws-lc-sys(cmake C 빌드)·h2·quinn 등 12 크레이트가 Cargo.lock 에서 빠졌다. 업데이터는 공급자가 없으면 스스로 ring 을 설치한다(updater.rs 579).
- **migration 044** — 코드가 읽지도 쓰지도 않는 표 18개 DROP(대화·토론·자동화·옛 체인지로그·컨텍스트 발화·회상 …). `mobile_devices`·`project_overviews` 는 남김. 설치본 사본에 적용 + VACUUM: 57.0MB → 42.3MB, foreign_key_check·integrity_check ok. `PROJECT_CACHE_TABLES` 도 맞췄다.
- **죽은 Rust 모듈** — `framing.rs`(LSP·PTY 호스트) · `trust.rs`(LSP·ACP) · `git/changelog.rs` · `git/gutter.rs` · `oculpm/{chain,framing,transcript,first_record,resume}.rs` · `cache/conversations.rs` · `proc/{detached,disclaim}.rs` · 훅 설치기(`claude_hooks` install/uninstall — 플러그인 hooks.json 이 맡음).
- **죽은 커맨드 13개** — open_devtools · oculpm_index_usage/clear_diffs · claude_hooks_status · diagnostics_report · settings_get · git_graph · git_head_status_brief · git_line_changes · check_cli_available · first_record_ledger · resume_digest · resume_dispatch_prompt.
- **프런트** — 보내는 쪽이 없는 요청 버스 셋(새 일지 `journalCompose`·이어서 작업 `resumeIntent`·검증 칸 `evidenceInbox`)과 그 수신부, 죽은 파사드 메서드, 아이콘 수십 개, 편집기 시절 설정·도크 상수.
- 남긴 것: `shim.rs` 설치기(「oculpm 이름으로 실행 = CLI」 테스트 픽스처), verdict 마커 쓰기 쪽(테스트 시뮬레이션), 테스트가 붙잡은 작은 헬퍼.

## 검증
- `cargo test --locked --no-fail-fast` 1065 통과 · 0 실패 (044 마이그레이션 테스트 추가). `cargo clippy --all-targets --locked -D warnings`·`cargo fmt --check` 통과.
- `pnpm typecheck` · `pnpm test`(982 통과) · `pnpm lint` · `pnpm build` 모두 exit 0.