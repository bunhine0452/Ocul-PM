---
schema_version: 1
type: bug
slug: "acp-narrow-composer-usage-session-cmdw"
status: done
difficulty: high
created_at: "2026-08-15T04:09:00+09:00"
session_id: "mcp-20260815-040900"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/closeIntent.ts"
    op: create
  - path: "src/__tests__/close_intent.test.ts"
    op: create
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "bug"
  - "css"
  - "window"
  - "shortcut"
  - "mcp-tool"
---
[x] 좁은 폭 컴포저 붕괴 · /usage 가 대화를 만들던 것 · 빈 탭 · ⌘W 안쪽부터 닫기

## `/usage` 가 대화 목록에 대화를 만들고 있었다

계기의 새로고침은 결국 **프롬프트로 `/usage` 를 보내는 것**이다. 두 겹으로 샜다.

1. `ensure_session` 을 쓰고 있었다 — 세션이 없으면 **만든다**. 사용량을 보려고 누른 것이 세션을 하나 파고, 그 세션의 첫 메시지가 `/usage` 라 목록에 "/usage" 라는 대화가 생겼다.
2. 세션이 있어도 그것이 **아직 아무 말도 안 한 세션**이면 같은 일이 일어난다 — 앱을 켜면 빈 세션이 자동으로 열리고 계기의 재시도 루프가 곧장 `/usage` 를 쏜다. 사용자의 첫 질문이 아니라 `/usage` 가 그 대화의 제목이 된다.

그래서 백엔드는 있는 세션에서만 묻고, 프런트는 **한 마디라도 오간 뒤에** 묻는다. 대가로 첫 턴 전에는 계기가 안 뜬다 — 물어볼 곳이 없으니 정직한 상태다.

## 빈 새 창의 "제목 없는 대화"

같은 뿌리다. 앱을 켜면 세션이 하나 자동으로 열리는데 그것까지 탭으로 걸어 두니, 처음 보는 화면에 닫을 수도 없고(마지막 탭) 가리키는 것도 없는 탭이 하나 떠 있었다. 한 마디라도 하면 그때 탭이 생긴다.

## ⌘W — 안쪽부터

브라우저에서 ⌘W 는 늘 **가장 안쪽에 열린 것**을 닫는다. 우리 창도 그렇게 겹쳐 있다: 창 → 프로젝트 탭 → (Claude Code 면) 세션 탭.

Rust 가 곧장 탭을 닫고 있었다. 무엇이 열려 있는지는 화면만 아는 사실이라 판단을 프런트로 넘겼다 — `CloseIntent` 이벤트를 보내고, 프런트의 사슬(`closeIntent.ts`)이 안쪽부터 물어본 뒤 아무도 안 받으면 그때 탭을 닫는다.

사슬을 **사본을 뒤집어** 도는 이유: 처리기가 순회 중에 자기를 뺀다(마지막 세션 탭을 닫으면 더 닫을 것이 없다). 원본을 돌면 그 자리에서 다음 처리기를 건너뛴다 — 테스트로 박아 뒀다.

**대가**: 프런트가 안 듣고 있으면 ⌘W 가 아무 일도 안 한다(창 뜨는 순간의 짧은 구간). 창을 닫는 길은 ⇧⌘W 에 그대로 있고 그쪽은 Rust 가 직접 처리하므로 갇히지는 않는다.

## 좁은 폭에서 하단바가 터지던 것

컴포저 아래 줄이 압착되면서 "7% · $0.30" 이 두 줄로 꺾이고 **보내기 버튼이 카드 밖으로** 밀려났다. `min-width: 0` 이 없으면 flex 자식이 자기 내용만큼 버티다 부모를 넘는다.

클립·중지·보내기는 자리를 지키고 가운데 노브 묶음만 가로로 도망가게 했다 — 툴바 액션 묶음과 같은 수법이다. 사용량 버튼은 `white-space: nowrap` 으로 절대 안 꺾이게.

## 검증

typecheck 0 · 프런트 806(닫기 사슬 4건 추가) · lint 0 · build 0 · 백엔드 전 스위트.

**미확인**: ⌘W 를 세션 탭이 여럿일 때·하나일 때·없을 때 세 경우 다 눌러 봐야 사슬이 의도대로 넘어가는지 안다.