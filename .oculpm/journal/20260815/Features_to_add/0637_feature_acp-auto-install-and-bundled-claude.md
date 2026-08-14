---
schema_version: 1
type: feature
slug: "acp-auto-install-and-bundled-claude"
status: done
difficulty: medium
created_at: "2026-08-15T06:37:51+09:00"
session_id: "mcp-20260815-063751"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "setup"
  - "onboarding"
  - "mcp-tool"
---
[x] Claude Code 는 어댑터가 들고 온다 — 첫 실행에 자동 설치, 사용자가 깔 것은 Node 뿐

## 잘못 알고 있었다

`claude` 는 사용자가 시스템에 따로 깔아야 하는 줄 알고 PATH 만 뒤지고 있었다. 그래서 진단이 "Claude Code 없음"이라 말하고, `ready` 도 그걸 조건에 넣고 있었다.

실은 **어댑터가 들고 온다.** `claude` 는 `@anthropic-ai/claude-agent-sdk` 의 플랫폼별 선택적 의존성으로 딸려 오는 **네이티브 바이너리**다 (`claude-agent-sdk-darwin-arm64/claude`). 어댑터도 `CLAUDE_CODE_EXECUTABLE` 이 없으면 그 경로를 집는다.

즉 어댑터를 깔면 Claude Code 도 함께 깔린다. **사용자가 따로 설치할 것은 Node 뿐이다.**

진단이 그것을 먼저 보게 고쳤다. 시스템 `claude` 를 먼저 보면, 딸려 온 것으로 멀쩡히 도는 사용자에게 "Claude Code 를 설치하세요"라고 거짓말을 하게 된다. 설정에서도 둘을 구분해 보여 준다 — 할 일이 다르다.

## 첫 실행에 자동 설치

어댑터가 없으면 "설정에서 설치하세요"라고 돌려보내고 있었다. 그 버튼을 찾아 누르는 것 말고 선택지가 없는 안내였다 — 물어볼 것이 없으면 그냥 해야 한다.

`acp_start` 가 없으면 깐다. **어댑터는 우리 것**이라 그래도 된다: 앱 데이터 안에만 깔리고 시스템을 건드리지 않는다.

**Node 는 안 깐다.** 런타임을 말없이 시스템에 심는 것은 사용자의 nvm/fnm 설정과 부딪히고(그 때문에 로그인 셸 PATH 해석기를 따로 두고 있다), 무엇보다 묻지 않고 할 일이 아니다. Node 만 없으면 그것만 말한다.

## 남는 것: 로그인

인증은 우리가 하지 않는다. 어댑터 너머의 CLI 가 `~/.claude` 의 자격을 그대로 쓴다 — 한 번도 로그인한 적이 없으면 첫 프롬프트에서 그쪽 오류가 온다. 앱 안에 로그인 화면을 두려면 ACP 의 `authMethods` 를 태워야 하는데 이 어댑터는 그걸 광고하지 않는다(빈 배열).

## 검증

typecheck 0 · 프런트 835 · lint 0 · build 0 · 백엔드 581 유닛 + 전 스위트.

**미확인**: 깨끗한 머신(어댑터 미설치)에서 첫 실행이 실제로 자동으로 깔고 뜨는지는 그 상태를 만들어 봐야 안다 — 지금 개발 머신에는 이미 깔려 있다.