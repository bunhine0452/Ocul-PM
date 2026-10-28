---
oculpm_plan: v1
id: simplify-round-20261028
title: "덜어내기 라운드 — 보류 등급 전부·터미널 제거, 스킬 12→5, 템플릿 §3 분리, 플랜 17→4"
status: active
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

사용자 결정(2026-10-28): "oculpm 에서 필요없는건 덜어내고 더 심플하게 만들어야할거같아. 지금은 무겁지 않아? … 공격적으로 가보자. 1번 2번 3번 4번 5번 승인할게." 실측: 프런트 11.1만 줄 중 핵심 네 화면 1.56만(14%), 편집기 1.53만·채팅 셋 1.2만·터미널 0.96만·설정 0.89만(47%); Rust ACP 6.4천·PTY 호스트 5.8천·LSP 3.5천; 10월 fix 는 보안 18·터미널 10·색인 5·워처 4·핵심 2. 에이전트가 받는 쪽은 템플릿 5,147자(§3 파일 규격이 절반), 활성 플랜 17/미완 154, 스킬 12(겹침). 남는 문장: 「에이전트는 당신 터미널에서, 기록·증거·계획은 여기서」. LLM 어댑터(llm/)는 요약·롤업·플랜·스킬 승격이 쓰므로 남기고 AI 패널 채팅 화면만 걷는다.

## 결정

### Decision 1 — 보류 등급 네 화면 + 터미널을 걷는다 {#d-remove-hold}
잠금 2026-10-28 · claude-code (사용자 승인 1·2번). 근거: 범위 동결(10-08)·PROMISE.md 등급표가 「다음 분기 fix 상위면 걷기 후보」라 했고, 사용자가 분기를 기다리지 않고 지금 걷기로 했다. 영향: #rm-terminal #rm-code #rm-acp #rm-ai-panel #rm-rust #rm-surfaces

**완료 조건:** 앱에 화면이 Today · 작업 일지 · 변경 · 플래너 · 검색 · 논의 · 브랜치 · 스킬 · 설정만 남고(터미널·편집기·Claude Code·Codex·AI 패널·분리 터미널 창·PTY 호스트·LSP·ACP 코드가 저장소에서 사라지며 Today 「이어서 작업」은 클립보드/외부 터미널로), 플러그인 스킬이 5개, 템플릿 v19 가 §3 을 journal-spec.md 로 빼 3,500자 안이고, 활성 플랜이 4개 이하이며 미완 항목이 살아 있는 플랜으로 옮겨져 유실 0, 랜딩·README·PROMISE.md·CLAUDE.md 가 그 모양과 일치한다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && (cd src-tauri && cargo test && cargo clippy --all-targets --locked -- -D warnings) && node -e "const n=require('fs').readdirSync('plugin/oculpm/skills').length; if(n>5) process.exit(1)"

## 1·2 — 보류 등급 + 터미널 제거 (앱) {#p-remove}
- [x] 터미널 — features/terminal · windows/TerminalWindow · TodayTerminal(이어서 작업 → 클립보드 복사) · 도크 · term-* 창 · 설정 블록(ShellIntegration) · 테스트 ~40 · xterm 의존 {#rm-terminal}
- [x] 코드 편집기 + LSP — features/code · 설정 CodeSettings · 일지 열기는 외부 편집기(open_in_editor) 로 · 논의 편집기가 쓰는 리치 마크다운 공용부는 discussion/ 또는 lib/ 로 이동 · monaco 의존 · 테스트 ~45 {#rm-code}
- [x] Claude Code · Codex 화면 + ACP — features/chat 의 두 ACP 표면 · 설정 Claude/Codex 플러그인·MCP 블록은 유지 여부 판단(플러그인 설치 안내는 핵심 경로라 유지) · acp/ · commands/acp · agent-client-protocol 의존 · acp-lock · 테스트 ~30 {#rm-acp}
- [x] AI 패널 채팅 — AiPanelScreenV2 · chat/chat_stream/chat_message_* 커맨드 · ⌘\\ 단축키. llm/ 어댑터·키 설정·모델 목록은 요약·롤업이 쓰므로 유지 {#rm-ai-panel}
- [x] Rust 정리 — ptyhost/ · lsp/ · acp/ · commands/{terminal,code,lsp,acp} · main.rs --pty-host 모드 · 관리 상태 4개 · collect_commands · capabilities term-* · egress 원장·spawn 원장 항목 · trust 모듈 중 LSP/ACP 전용 · Cargo 의존 · bindings 재생성 {#rm-rust}
- [x] 표면 일치 — navRegistry(⌘ 번호 당김) · 사이드바 3단 · ⌘K · 설정 「표시」 베타 숨김 스위치 제거 · i18n 키 정리 · CSS · e2e 시나리오 · CLAUDE.md 등급표 · PROMISE.md · README ko/en · 랜딩 ko/en 베타 셀·FAQ·featureList · plugin.html {#rm-surfaces}

## 3 — 스킬 12→5 {#p-skills}
- [ ] 남김: next · redteam · inception(project-inception 과 합침) · help · oculpm-journal. 걷음: self-audit · run-evals · tdd-workflow · standup · board · project_init · project-inception. plugin_manifest 예산 테스트·plugin.html·README·next 의 board 참조 갱신, codex 플러그인 동일 {#skills-5}

## 4 — 템플릿 v19 §3 분리 {#p-template}
- [ ] §3 일지 파일 규격을 .oculpm/agents/journal-spec.md(ko/en) 로 빼고 템플릿은 「도구가 없을 때만 그 파일을 읽어라」 한 줄. 예산 ko 3,500 · en 4,800 으로 내림, agents 테스트·동기화·업그레이드 경로(spec 파일 생성) {#template-v19}

## 5 — 플랜 17→4 {#p-plans}
- [ ] 끝난 라운드 플랜 닫기 — 남은 미완(사용자 몫 16 포함)은 살아 있는 플랜(eyes-backlog 하나 + 이 플랜)으로 옮긴 뒤 닫는다, 유실 0 을 grep 으로 확인 {#plans-4}
- [ ] 훅 plan-context.sh — 최근 갱신(frontmatter updated) 상위 3개 플랜만 싣기, plugin_hook_no_plan 테스트 {#hook-top3}

## 확인 날 — 눈으로 {#p-eyes}
- [ ] [사용자] 설치본에서 사이드바가 9행이고 ⌘1~⌘9 가 맞는지, Today 「이어서 작업」이 클립보드로 가는지, 옛 설정 키(터미널·편집기·ACP)가 남아도 앱이 조용한지 {#eyes-simplified}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-28T22:47:57+09:00 | #rm-terminal | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | features/terminal·TerminalWindow·TodayTerminal·도크·term-* 창·ShellIntegration 블록·xterm 의존·테스트 삭제, 이어서 작업은 클립보드 |
| 2026-10-28T22:48:23+09:00 | #rm-code | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | features/code·CodeSettings·monaco 삭제, richMarkdown → discussion/, 논의 원문 모드 textarea, 파일 열기는 외부 편집기, CSP blob:/frame/worker 닫음 |
| 2026-10-28T22:48:37+09:00 | #rm-acp | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | features/chat ACP 표면·acp/·commands/acp*·agent-client-protocol·acp-lock 삭제, 플러그인·MCP 설치 블록은 유지, Doctor 의 ACP 행 제거 |
| 2026-10-28T22:49:04+09:00 | #rm-ai-panel | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | AiPanelScreenV2·ContextTab·conversation/context 커맨드·chat_stream 삭제, ⌘\ 단축키 제거, llm/ 어댑터·chat() 은 코어가 쓰므로 유지 |
| 2026-10-28T22:49:39+09:00 | #rm-rust | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | acp/·lsp/·ptyhost/·shell_integration/·commands 9개 모듈·--pty-host·관리 상태 4·이벤트 3·커맨드 94 제거, Cargo 의존 2 제거 + serde_json preserve_order 명시, 원장 3개·CSP 정리, 통합 테스트 8 삭제, bindings 재생성 |
| 2026-10-28T22:50:22+09:00 | #rm-surfaces | claude-code | ☐→x | .oculpm/journal/20261028/Refactors/2246_refactor_remove-hold-tier-screens.md | navRegistry 8행 · 사이드바 두 단 · 설정 표시 베타 스위치 제거 · i18n 3,793→2,902 · CSS 2,469→1,656 · e2e 터미널 단계 삭제 · CLAUDE.md·PROMISE.md·README ko/en·랜딩 ko/en·위키 ko/en 10쪽·wiki build |
<!-- oculpm:plan-log end -->
