---
schema_version: 1
type: chore
slug: "vscode-extension-inception"
status: done
difficulty: medium
created_at: "2026-09-11T14:03:48+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/discussion/vscode-extension/discussion.md"
    op: create
  - path: ".oculpm/planner/vscode-extension-round.md"
    op: create
  - path: "EVALS.md"
    op: create
  - path: ".claude/rules/vscode-extension.md"
    op: create
related: []
tags:
  - "vscode"
  - "extension"
  - "inception"
  - "design"
  - "mcp-tool"
---
[x] VS Code 확장 인셉션 — 별도 IDE 기각, 방안 A 확정, 5 Phase 플랜

## 작업 내용

사용자 질문 "ocul-ide 를 VS Code 급 별도 앱으로 만드는 건 에바인가, VS Code 풀 기능을 쓰고 싶다" 에 대해 project-inception 스킬로 조사→대화→설계 시드 4종을 냈다.

- **기각 근거 재확인**: 별도 앱도 2026-09-08 포크 기각 사유 중 마켓 ToS(MS 마켓은 MS 제품 외 금지 → 포크는 전부 Open VSX, Pylance·Remote-SSH·Copilot 은 proprietary)와 유지비(VS Code 는 2026-03 v1.111 부터 **주간 릴리스**, 현재 1.137)를 그대로 물려받는다. "풀 기능"의 실체가 확장 생태계라 100% VS Code 는 VS Code 뿐 → 답은 확장.
- **조사 결과**: `yo code` TS+esbuild, `@vscode/test-cli`; MCP 서버 정의 공급자 API(`vscode.lm.registerMcpServerDefinitionProvider`) ≥1.101; **Cursor 는 그 API 미지원**(2026-02 시점) → `.cursor/mcp.json` 경로 별도; 웹뷰 툴킷 2025-01 폐기; 이중 게시는 `HaaLeo/publish-vscode-extension` 2회 호출.
- **최대 발견**: VS Code 에이전트 훅(Preview)이 **`.claude/settings.local.json` 의 Claude Code 훅 형식을 그대로 읽는다**. 이 저장소의 `claude_hooks.rs` 가 설치하는 순수-append 훅이 Copilot 에이전트 세션에도 이미 발화해 인박스로 들어오고 있다(camelCase·SessionEnd 없음·`claude-code` 로 오귀속). 1차는 실측만.
- **사용자 결정 4건**(전부 추천안): 방안 A(설치된 앱의 `oculpm-mcp` 재사용, 없으면 읽기 전용 강등) · 모노레포 `extension/` · Copilot 은 실측만 · 첫 데모=에이전트가 journal_write 하면 사이드바에 즉시.
- **산출물**: discussion(resolved) · 플랜 `vscode-extension-round` 5 Phase 29항목 · `EVALS.md` 스위트 `vscode-ext` 10 시나리오 · `.claude/rules/vscode-extension.md`(paths: extension/**).

## 검증

- 플랜 파일은 `plan_create` 가 생성(hash 9bd84629…), discussion 은 `.oculpm/agents/discussion-spec.md` 규격(frontmatter·{#opt-id}·managed log 블록) 준수.
- 주의: `.claude/` 가 gitignore 라 규칙 파일은 로컬 전용 — 공유하려면 `.claude/rules/` 를 예외로 풀어야 한다(미결정, 사용자 판단).