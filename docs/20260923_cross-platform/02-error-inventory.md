# 이식성 오류 인벤토리

`portability.yml` 실행에서 나온 오류를 **층(layer)** 단위로 적는다. 컴파일 오류는 앞 층이
막으면 뒤 층이 안 보이므로, 한 번의 실행으로 전수가 나오지 않는다 — 층을 걷어낼 때마다
여기에 다음 층을 덧붙이고 담당 레인을 배정한다. 진행 상태는 플랜 `cross-platform-port` 가 갖는다.

## 층 1 — W0 첫 실행 (2026-09-23, run 35871385421, 기준 `origin/main` c89dd1cd)

### windows-latest · Rust

| 위치 | 오류 | 원인 | 담당 |
|---|---|---|---|
| 의존성 `trash-5.2.6/src/windows.rs:278` | E0070 | 크레이트가 일부러 넣은 컴파일 에러 — `coinit_*` feature 가 하나는 있어야 하는데 우리 `default-features = false` 가 기본 `coinit_apartmentthreaded` 까지 껐다 | W1 (`features = ["coinit_apartmentthreaded"]`) |

이것이 의존성 단계에서 막아 **우리 크레이트의 오류는 하나도 보이지 않았다.** 층 2 가 진짜 인벤토리다.

### ubuntu-22.04 · Rust

| 위치 | 오류 | 원인 | 담당 |
|---|---|---|---|
| `src/commands/window/lifecycle.rs:155` | E0599 `hidden_title` 없음 | `WebviewWindowBuilder::hidden_title` 은 macOS 전용 | W1 (cfg), 비-mac 동작은 L-OS `#os-tray-menu` |
| `src/commands/window/terminal_windows.rs:46` | 같음 | 같음 | 같음 |
| `src/commands/external_editor.rs:15` | 경고 → clippy `-D warnings` 오류 | 비-mac 에서 `Stdio` 미사용 import | W1 |

lib 컴파일에서 멈춰 테스트 타깃·bin 의 오류와 테스트 실행 결과는 층 2 로 넘어간다.

### windows-latest · 프런트 (typecheck · vitest · build)

- typecheck **성공**, build(`tsc && vite build && check-critical-css`) **성공**.
- vitest: 2,766건 중 **36건 실패** (10파일).

| 원인 | 테스트 | 처리 |
|---|---|---|
| **CRLF 체크아웃** — `core.autocrlf=true` 로 텍스트가 CRLF 로 풀려 `\n` 을 가정한 정규식·frontmatter 파서가 어긋난다 | `plugin_docs_sync`(frontmatter description 없음 ×5) · `skills_catalog`(content 가 frontmatter 로 시작 ×26) · `skills_gallery_v2` · `design_tokens` 모달 크롬 정규식 | W0 `.gitattributes`(`* text=auto eol=lf`, 커밋 38c7dee3) — 테스트를 고치지 않는다 |
| 스위트 로드 실패 `SyntaxError: Invalid or unexpected token` | `bump_version` · `file_size_policy` · `file_size_ratchet` · `i18n_lint_scanner` · `theme_schema` | `.gitattributes` 뒤 재확인 — CRLF 가 아니면 L-UI |
| **테스트 코드가 `\` 경로를 만든다** | `ime_guard`(`lib\ime.ts:34`) · `design_tokens` 색 리터럴 화이트리스트(예외 목록은 `/` 키) | L-UI — 경로를 `/` 로 정규화 |

`.gitattributes` 는 앱에도 중요하다: 같은 CRLF 가 `include_str!` 로 박히는 템플릿(셸 통합
스크립트 · AGENTS.md 템플릿)에 들어가 Windows 빌드가 CRLF bash 스크립트를 출하할 뻔했다.

## 층 2 — W1 이 층을 걷어낸 뒤 (2026-09-24, run 35881210465, `port/w1-base` 70fa5c8d)

W1 이 드러난 순서대로 고친 것: trash COM feature → `hidden_title` mac 한정 · 미사용 import → ptyhost Unix
소켓 `cfg(unix)` + 스텁 → **Linux 링크**(사전 빌드 ONNX Runtime 이 glibc 2.38+ `__isoc23_strto*` 를 불러
22.04 에서 링크 실패 → `glibc_compat.rs`, D11) → **Windows 테스트 실행 파일이 기동 즉시 0xc0000139**(tauri-build 가
Common Controls v6 매니페스트를 bin 에만 실음 → `build.rs` 가 MSVC 에서 링커로 모든 실행 파일에).

| OS | check | clippy | test |
|---|---|---|---|
| ubuntu-22.04 | 초록 | 초록 | **초록** — 1,827 통과 · 0 실패 · 16 무시 |
| windows-latest | 초록 | 초록 | 컴파일 초록, 실행 1,609+ 통과 · **19 실패** · 크래시 0 |

### windows 실행 실패 19건 → 레인

| 레인 | 테스트 | 요지 |
|---|---|---|
| L-FS | `indexer::walk_tests::{gitignore_is_honored_without_a_git_dir, vendor_dirs_are_denied_without_any_gitignore}` · `oculpm::rule_scope::tests::walk_honors_gitignore_and_denies_vendor_dirs` | 결과 경로에 `\` |
| L-FS | `oculpm::redact::tests::forbidden_absolute_path_matches` | ignore 크레이트 패닉 — unix 절대경로 픽스처 |
| L-FS | `oculpm::watcher::tests::{agents_template_change_emits_without_panic, journal_change_emits_without_panic, local_history_writes_never_re_trigger_the_watcher, rapid_writes_to_same_file_debounced_to_one}` · `watcher_backpressure::prefilter_never_swallows_what_the_consumer_judges_first` | `\` 로 emit 분류·자기 억제 빗나감, Create/Modify 병합 모양 |
| L-FS | `git::tests::nested_repo_below_root_is_diffable` | `diff_patch` 빈 결과 |
| L-FS | `oculpm::lock::tests::acquire_recovers_immediately_when_holder_pid_is_dead` · a2a 4건(`leases`·`registry` ×2·`mcp::tools::tests::a2a`) | Windows pid 생사가 Unknown — `pid.rs` 로 |
| L-FS | `oculpm::verdict::markers::tests::the_live_trace_is_refreshed_every_time` | `touch_live` mtime 미갱신 |
| L-SHELL | `acp::env::tests::search_path_skips_missing_and_empty_segments` | PATH 를 `:` 로 분리 |
| L-INTEG | `oculpm::mcp::register::tests::codex_register_collapses_legacy_pinned_entries` | TOML 기본 문자열의 `\` |
| L-OS | `acp::recording::tests::candidates_follow_the_shuttle_vocabulary` | `.app/Contents/MacOS` 기대 |

### Windows 에서 0건으로 도는 통합 테스트 (파일 머리 `#![cfg(unix)]`)

`ptyhost_reattach` · `ptyhost_write_backpressure`(L-PTY) · `delivery_gate`(L-INTEG) ·
`acp_journal_gate` · `resume_context` · `session_verdict`(L-OS). "실패 0" 이 "검증됨" 이 아니다 — 각 레인이 Windows 판을 둔다.

### W1 이 찾은 원래부터의 조용한 폴백 (D4 후보 → L-OS)

`commands/code/import.rs` 비-mac `clipboard_file_paths` 빈 Vec · `lsp/client.rs` `kill_on_drop` unix 한정.
