---
schema_version: 1
type: refactor
slug: "remove-hold-tier-screens"
status: done
difficulty: high
created_at: "2026-10-28T22:46:06+09:00"
session_id: "20261028-010"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/commands/llm.rs"
    op: update
  - path: "src-tauri/src/llm/mod.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "docs/PROMISE.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "src/features/terminal"
    op: delete
  - path: "src/features/code"
    op: delete
  - path: "src/features/chat"
    op: delete
  - path: "src-tauri/src/acp"
    op: delete
  - path: "src-tauri/src/lsp"
    op: delete
  - path: "src-tauri/src/ptyhost"
    op: delete
related: []
tags:
  - "simplify"
  - "removal"
  - "terminal"
  - "editor"
  - "acp"
  - "ai-panel"
  - "scope-freeze"
  - "mcp-tool"
---
[x] 보류 등급 제거 — 터미널·PTY 호스트, 코드 편집기·LSP, Claude Code·Codex ACP 화면, AI 패널 채팅을 저장소에서 걷었다 (프런트 -3.6만 줄 · Rust -1.3만 줄)

## 동기
사용자 결정(2026-10-28): "oculpm 에서 필요없는건 덜어내고 더 심플하게 … 공격적으로 가보자. 1번 2번 승인." 실측으로 프런트 11.1만 줄 중 핵심 네 화면이 1.56만(14%), 편집기 1.53만·채팅 셋 1.2만·터미널 0.96만·설정 0.89만(47%). 10월 fix 는 터미널 10·보안 18·핵심 2. 한 사람의 수정 예산이 약속하지 않은 화면에 들어갔다. 다섯 원칙의 자리(기록·증거·계획)만 남기고 에이전트는 사용자의 터미널에서 돌게 한다.

## 변경 요약
- **프런트**: `features/terminal` · `features/code` · `features/chat` · `windows/TerminalWindow` · `TodayTerminal` · 설정 코드·컨텍스트 탭·셸 통합 블록 · `api/{acp,code,codeHistory,context,conversations,lsp,terminal,shellIntegration}` 삭제. 테스트 120여 파일 삭제, 20여 파일 수정. 리치 마크다운(tiptap)은 `features/discussion/richMarkdown/` 로 이동, 논의 편집기의 원문 모드는 Monaco → `textarea`. 검색·브랜치의 「파일 열기」는 외부 편집기 명령으로. Today 「이어서 작업」·플래너 ▶실행·새 프로젝트 마법사 킥오프는 **클립보드 복사**. navRegistry 8행(⌘1~⌘8 전부 번호), 사이드바 두 단, 설정 「표시」 베타 스위치 제거, WorkspaceContext 터미널 조각·code/acp 상태 필드 제거, 단축키 치트시트 터미널·코드 그룹 제거, i18n 키 3,793 → 2,902, screens.css 2,469 → 1,656 줄(런타임 주입 hljs 규칙은 복구), agent.css 삭제.
- **Rust**: `acp/` · `lsp/` · `ptyhost/` · `oculpm/shell_integration/` · `commands/{acp*,code,code_history,lsp,terminal,shell_integration,conversation,context,window/terminal_windows,fsutil}` 삭제. `main.rs --pty-host` 모드, 창 레지스트리의 터미널 창, 세션 복원의 `terminals`, 메뉴의 분리 창 분기, lib.rs 관리 상태 4개·이벤트 3개·커맨드 94개 제거. `commands::llm::chat` 은 코어(요약·롤업·일지 초안·자동화)가 쓰므로 커맨드 속성만 떼고 유지, 스트리밍(`chat_stream`·`ChatEvent`·`forward_sse_lines`)은 제거. Cargo: `portable-pty`·`agent-client-protocol` 제거, `serde_json` 에 `preserve_order` 명시(ACP 크레이트가 켜 주던 피처가 빠져 `.mcp.json` 키 순서가 바뀌던 것). `acp-lock/` 삭제, capabilities `term-*` 제거, egress·spawn·prompt 원장 항목 정리, 통합 테스트 8개 삭제, `plugin_xplat` 의 ACP 경로 테스트 1개 삭제.
- **E2E**: 터미널 3단계(한글 왕복·IME·연타)와 `e2e/lib/{terminal,ime}.mjs` 삭제.
- **표면**: CLAUDE.md(범위 동결·등급·아키텍처) · PROMISE.md 등급표 · README ko/en(화면 목록·⌘번호·지원 등급 4→3·플러그인 안내) · 랜딩 ko/en(콘솔 Act 3 · 격자 셀 32개 · FAQ 7/6 · featureList · 왕복 문장) · 위키 ko/en 10쪽(ai-panel 삭제, claude-code 재작성) · `node landing/wiki-src/build.mjs`.

## 검증
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 148 파일 1,924 통과 · lint 0 errors 2 warnings · built, exit 0.
- `cargo test`(전 스위트) 모두 `test result: ok` · `cargo clippy --all-targets --locked -- -D warnings` 출력 없음 · `cargo fmt --check` 깨끗.
- JSON-LD 두 랜딩 `json.loads` 통과 · `node landing/wiki-src/build.mjs` 30쪽 · sitemap 39 urls.
- git diff: 182 파일, +803 / −14,057 (삭제 파일은 별도).

## 메모
- 설치본 확인은 사용자 몫({#eyes-simplified}): 사이드바 8행 · ⌘1~⌘8 · 「이어서 작업」 클립보드 · 옛 설정 키가 남아도 조용한지.
- 남은 라운드: 스킬 12→5({#skills-5}) · 템플릿 v19 §3 분리({#template-v19}) · 플랜 17→4({#plans-4}) · 훅 상위 3개({#hook-top3}).
- 교훈: 클래스 이름 grep 으로 CSS 를 걷을 때 highlight.js 처럼 **런타임이 붙이는 클래스**는 소스에 없다 — 걷은 선택자 목록을 눈으로 한 번 훑어야 한다. `cd src-tauri && …` 는 병렬 Bash 호출의 cwd 를 바꾼다 — `--manifest-path` 로.