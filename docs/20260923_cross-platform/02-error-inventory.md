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

## 층 2 — (W1 첫 push 뒤 채운다)
