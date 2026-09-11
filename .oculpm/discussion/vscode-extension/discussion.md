---
oculpm_discussion: v1
id: vscode-extension
title: "Ocul-PM VS Code 확장 — 앱은 Tauri 그대로, 편집은 진짜 VS Code"
status: resolved
created: 2026-09-11
updated: 2026-09-11
owner: claude-code
---

## 문제 정의

사용자는 "VS Code 의 풀 기능"을 원한다. 2026-09-08 `docs/20260908_monaco-editor/00-master-plan.md` 가 VS Code 포크를 네 가지 이유로 기각했고, 별도 앱(ocul-ide)도 그중 **마켓플레이스 ToS**(MS 마켓플레이스는 MS 제품 외 사용 금지 → Cursor·Windsurf·Trae 전부 Open VSX, Pylance·C/C++·Remote-SSH·Copilot 은 proprietary 라 못 실림)와 **유지비**(1.7GB 워크벤치를 1인이 매주 리베이스 — VS Code 는 2026-03 v1.111 부터 **주간 릴리스**, 현재 1.137)를 그대로 물려받는다. "풀 기능"의 실체가 확장 생태계+proprietary 확장이므로 **100% VS Code 는 VS Code 뿐**이다.

따라서 결정할 것은 "IDE 를 만들까"가 아니라 **VS Code 확장 `ocul-pm` 의 범위·바이너리 전략·저장소 위치·에이전트 연동 깊이**다. 앱(Tauri, macOS aarch64 단일 타깃)은 그대로 두고, 확장은 같은 `.oculpm/*.md`(SSOT) 를 옆에서 읽고 쓴다.

## 환경 조사 (2026-09-11)

- **스캐폴드**: `npm i -g yo generator-code && yo code` → TypeScript + **esbuild** 번들(공식 생성기 옵션). 테스트는 `@vscode/test-cli` + `@vscode/test-electron` (Mocha). 출처: microsoft/vscode-generator-code, code.visualstudio.com testing-extension.
- **engines.vscode 바닥**: MCP 서버 정의 공급자 API(`vscode.lm.registerMcpServerDefinitionProvider` + `contributes.mcpServerDefinitionProviders`)는 **≥1.101**(2025-06). 포크는 upstream 에서 수개월 뒤처지므로 `^1.101.0` 이 포크 호환의 현실적 하한. 출처: code.visualstudio.com/api/extension-guides/ai/mcp.
- **Cursor 는 그 API 를 미지원**(포럼 요청 2026-02-17 시점 미구현) — Cursor 경로는 `.cursor/mcp.json` 파일 기입이 유일. Antigravity/Windsurf(→Devin Desktop) 도 같은 계열로 가정하되 실측 필요.
- **VS Code 에이전트 훅(Preview)**: `.github/hooks/*.json` 외에 **`.claude/settings.json`·`.claude/settings.local.json` 의 Claude Code 훅 형식을 그대로 읽는다**. 이벤트 8종(SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·PreCompact·SubagentStart·SubagentStop·Stop). 차이: `tool_input` 이 camelCase, matcher 는 파싱만 되고 미적용, `SessionEnd` 없음. → 이 저장소의 `claude_hooks.rs` 가 설치하는 `.claude/settings.local.json` 훅(순수 append)이 **Copilot 에이전트 세션에도 이미 발화**한다. 인박스 파서는 미지 필드를 무시하므로 깨지진 않지만, 세션이 `claude-code` 로 귀속된다. 출처: code.visualstudio.com/docs/agent-customization/hooks.
- **웹뷰 UI**: `@vscode/webview-ui-toolkit` 는 2025-01 아카이브(FAST 폐기). 대체는 `vscode-elements`. → 1차는 웹뷰 없이 TreeView + 내장 마크다운 미리보기로 간다.
- **이중 게시**: `@vscode/vsce`(MS, Azure DevOps PAT) + `ovsx`(Open VSX, 네임스페이스 선등록). GitHub Action `HaaLeo/publish-vscode-extension` 을 두 번 호출(Open VSX 먼저 → .vsix 재사용). Open VSX 가 Cursor·VSCodium·Gitpod·code-server·Windsurf 를 먹인다.
- **플랫폼별 VSIX**: `vsce package --target darwin-arm64|win32-x64|linux-x64…` 로 네이티브 바이너리 동봉 가능(1.61+). 앱은 macOS aarch64 만 빌드하므로 확장이 바이너리를 동봉하려면 CI 매트릭스가 새로 는다.

## 재사용 가능한 기존 자산 (저장소 실측)

- `src-tauri/src/bin/oculpm_mcp.rs` → `oculpm-mcp` stdio 바이너리(tauri `externalBin`, `.app/Contents/MacOS/oculpm-mcp`). 도구: journal_write·journal_search·journal_read·plan_status·plan_update·plan_create·project_init·task_*·agent_*·claim_paths.
- `src-tauri/src/oculpm/mcp/register.rs` — `.mcp.json` 머지 + Claude Desktop 등록(우리 키만 만지고 파싱 불가 파일은 안 덮음). 같은 규율을 `.cursor/mcp.json` 에 확장 가능.
- `src-tauri/src/deeplink.rs` — `oculpm://open?project=&view=journal&entry=` (앱 ↔ 확장 왕복의 앱 쪽 절반은 이미 있음).
- `src-tauri/src/commands/external_editor.rs` — `code --new-window "%path"` 로 앱→VS Code 방향은 이미 있음.
- `plugin/oculpm/` — Claude Code 플러그인(hooks.json·MCP·스킬). 확장의 "규칙 주입" 은 AGENTS.md 템플릿(`agents/`)을 그대로 쓴다.

## 후보 해결 방안

### 방안 A — 얇은 확장, 앱 바이너리 재사용 {#opt-thin}
확장은 Node 만: `.oculpm/journal/**`·`planner/*.md` 를 직접 읽어 TreeView(오늘 일지·활성 플랜)·플랜 체크박스 토글·일지 미리보기·`oculpm://` 딥링크. MCP 는 **설치된 앱의 `oculpm-mcp`** 를 찾아 `registerMcpServerDefinitionProvider` 로 등록(없으면 읽기 전용 강등 + 설치 안내). 장점: 일지 쓰기 규격이 한 곳(Rust)에만 있다·CI 증가 0. 단점: 쓰기 기능은 macOS+앱 설치자 한정.

### 방안 B — 플랫폼별 VSIX 에 oculpm-mcp 동봉 {#opt-bundled}
A + `vsce --target` 5종(darwin-arm64/x64, win32-x64, linux-x64/arm64)에 Rust 바이너리 동봉. 장점: 앱 없는 Windows/Linux 사용자도 에이전트 일지 기록이 된다(도달 최대). 단점: Rust 크로스 빌드 매트릭스 신설, 앱 버전과 바이너리 버전 이중화(스키마 변경 시 둘 다 굴려야 함).

### 방안 C — 웹뷰로 앱 화면 이식 {#opt-webview}
일지·플래너 React 청크를 확장 웹뷰로. **기각 추천**: 데이터 접근이 Tauri 커맨드(`bindings.ts`)에 묶여 있어 사실상 재작성이고, 툴킷도 폐기됐다. 편집기 자체가 VS Code 인데 앱 UI 를 그 안에 또 넣을 이유가 없다.

## 토의 / 메모
<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-09-11T14:20:00+09:00 | claude-code | 포크·별도앱 기각 근거를 마켓 ToS·주간 릴리스로 재확인. VS Code 가 .claude/settings 훅을 읽어 Copilot 세션이 이미 인박스로 흘러드는 것이 최대 발견 |
| 2026-09-11T14:32:00+09:00 | kimhyunbin | 4문항 전부 추천안 채택: A(앱 바이너리 재사용)·모노레포 extension/·Copilot 은 실측만·첫 데모=일지가 사이드바에 즉시 |
<!-- oculpm:discussion-log end -->

## 결론

**방안 A 채택** (사용자 결정 2026-09-11) — 얇은 확장, 앱 바이너리 재사용. 근거:
- 일지·플래너 쓰기 규격(frontmatter·잠금·redact)은 Rust 한 곳에만 둔다 — 확장이 규격을 재구현하면 `.oculpm` 스키마 변경마다 두 곳을 굴려야 한다(조사: 방안 B 의 이중 버전 비용).
- 앱은 macOS aarch64 단일 타깃이므로 1차 도달은 같은 사용자층. 앱 없는 환경은 **읽기 전용 강등**으로 가치 0 이 아니다.
- 저장소는 **모노레포 `extension/`** — 규격과 같은 커밋으로 움직이고, 릴리스 체크리스트에 "확장 게시" 6면째를 추가한다.
- Copilot 세션 훅 유입은 1차에 **실측만**(payload 캡처 → `docs/`), 귀속(agent.id=copilot)·`SessionEnd` 대체는 후속 Phase.
- 첫 데모: **에이전트가 `journal_write` 하면 VS Code 사이드바 트리에 즉시 뜨고, 플랜 체크박스 토글이 `.md` 에 반영돼 앱에서도 같이 바뀐다.**
- 웹뷰 없음(툴킷 폐기·조사) — TreeView + 내장 마크다운 미리보기 + 딥링크. `engines.vscode ^1.101.0`(MCP 공급자 API 하한). Cursor 는 그 API 미지원이라 `.cursor/mcp.json` 기입 경로를 별도 항목으로.

## 다음 단계
- [x] 사용자 답변으로 방안 확정 → plan_create {#next-decide}
- [ ] 플랜 `vscode-extension-round` 실행 (Phase 0 스캐폴드부터) {#next-plan}
