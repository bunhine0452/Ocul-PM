---
schema_version: 1
type: feature
slug: "claude-code-theme-file"
status: done
difficulty: high
created_at: "2026-11-15T08:25:40+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/claude_theme.rs"
    op: create
  - path: "src-tauri/src/commands/config.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/__tests__/claude_theme.test.ts"
    op: create
  - path: "src/__tests__/claude_theme_row.test.tsx"
    op: create
  - path: "src/__tests__/settings_status.test.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/settings/ClaudeThemeRow.tsx"
    op: create
  - path: "src/features/terminal/termTheme.ts"
    op: update
  - path: "src/features/theme/claudeTheme.ts"
    op: create
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
related: []
tags:
  - "테마"
  - "theme"
  - "terminal"
  - "quality-round"
  - "mcp-tool"
---
[x] 테마: Claude Code 테마 파일을 터미널 색으로 쓴다

## 추가 기능

사용자 결정(11-15 「테마 파일만 두기」, 계획 quality-round-20261115 #claude-theme). Claude Code 의 기본 색(주황 강조 등)이 Ocul 의 차분한 터미널 위에서 따로 놀던 것 — 앱이 `~/.claude/themes/ocul.json` 하나만 관리하고, 사용자가 Claude 안에서 `/theme` 으로 고른다(Claude Code CHANGELOG: 「Create and switch between named custom themes from /theme, or hand-edit JSON files in ~/.claude/themes/」). Claude 의 `settings.json` 은 건드리지 않는다.

설정의 에이전트 칸에 한 줄 「Claude Code 테마 · ~/.claude/themes/ocul.json · Claude 에서 /theme 으로 고르세요」 + 끄기(끄면 더 쓰지 않고 파일은 지우지 않는다).

## 동작 흐름

1. 프런트 `claudeTheme.ts` 가 지금 터미널 테마에서 `{ name, base: light|dark, overrides }` 를 만든다 — 글자 4.5 · 색 3 대비 바닥을 못 맞추는 키는 빼서 Claude 기본값을 쓰게. 강조는 프로젝트 색이 아니라 앱 기본 강조(파일은 하나, 창은 여럿 — 창마다 다른 내용을 쓰지 않는다). 테마가 바뀌면 300ms 늦춰 부탁.
2. Rust `claude_theme.rs` 가 home 의 `.claude` 가 있을 때만 `themes/` 를 만들고 같은 폴더 임시 파일 → rename 으로 원자적으로 쓴다. 내용이 같으면 쓰지 않는다. 키 · `#rrggbb` 형식을 검증한다.

## 검증

- `cargo test` 1211 passed 0 failed(합류 뒤, 임시 HOME 시험: `.claude` 없으면 아무것도 안 만듦 · 원자적 쓰기 · 같은 내용이면 mtime 그대로 · settings.json 바이트 동일 · 잘못된 색 거절) · clippy · fmt.
- `claude_theme` · `claude_theme_row` 시험 45 passed(강조색 표가 tokens.css 와 같은지 — 합류에서 옮긴 프로젝트 색 값과 어긋난 것을 이 시험이 잡아 고쳤다). 독립 리뷰를 거치지 않았다 — 최종 검수가 따로 본다. 설치본 · 실제 Claude 에서 /theme 으로 골라 보지는 않았다.

## 메모

- 프로젝트 밖에 쓰는 두 번째 파일이다(첫째는 `.vscode/settings.json` 의 제목 막대 색) — CLAUDE.md 에 적었다.