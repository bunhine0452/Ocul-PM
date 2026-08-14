---
schema_version: 1
type: feature
slug: "acp-session-tabs-title-usage-fix"
status: done
difficulty: high
created_at: "2026-08-15T03:29:54+09:00"
session_id: "mcp-20260815-032954"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/ClaudeCodeScreenV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "session"
  - "ux"
  - "bug"
  - "css"
  - "mcp-tool"
---
[x] 세션 탭 · 상단바 세션 제목 · 사용량 위젯이 안 뜨던 버그 · 레이아웃 흔들림

## 사용량 위젯이 아예 안 뜨던 이유

계기는 **툴바**에 있어 에이전트가 붙기 **전에** 마운트된다. 첫 조회는 거의 항상 "에이전트가 실행 중이 아닙니다" 로 실패하는데, 나는 마운트 시 한 번만 부르고 말았다 — 그래서 영영 안 떴다. 값을 얻을 때까지 3초마다 다시 시도하고, 얻은 뒤에는 값싼 상태 조회로 내려간다.

## 상단바 = 대화 제목

화면 이름은 사이드바가 이미 말하고 있다. 여기서 알고 싶은 건 "무슨 대화를 열어 뒀나"다. 제목은 에이전트가 대화를 보고 **나중에** 붙이므로 `session_info_update` 알림으로 온다 — 백엔드가 갈무리하고(세션이 바뀌면 지운다. 안 지우면 새 대화에 옛 제목이 남는다) 상단바가 4초 주기로 따라간다.

## 세션 탭

**백엔드에 새 개념을 만들지 않았다.** 백엔드는 프로젝트당 연결 하나·활성 세션 하나만 안다. 탭은 그 위에 얹은 프런트 개념이다 — "오가며 보는 대화들"의 목록이고, 전환은 이미 있는 `session/load`(재생 포함)로 그 세션을 다시 여는 것이다. 그래서 상태 하나(`acpTabs`)만 늘었다.

탭이 하나뿐이면 줄을 그리지 않는다 — 고를 것이 없는 탭바는 자리만 먹는다. 활성 표시는 배경색이 아니라 위쪽 accent 선으로 했다(밝은 테마에서 배경색 차이는 거의 안 보인다). 닫기 X 는 활성·호버에서만 뜬다.

## 흔들리던 것들

- **하단바**: effort 값이 "Low"→"울트라코드" 로 바뀔 때마다 칩 폭이 변해 줄 전체가 밀렸다 — 다음에 누르려던 버튼이 손 밑에서 도망간다. 칩 라벨에 최소 폭을 잡았다.
- **effort 팝오버**: 설명 길이에 따라 늘었다 줄어 겨냥하던 점이 움직였다. 세 줄 높이로 고정하고 넘치면 자른다.

## 검증

게이트: typecheck 0 · 프런트 800건 · lint 0 · build 0 · 백엔드 575 유닛 + 통합 전 스위트.

**미확인**: 탭을 여러 개 열어 오가는 흐름은 실제로 눌러 봐야 안다 — 특히 전환 시 `session/load` 재생이 매번 도는 비용(같은 세션을 다시 열면 대화를 통째로 다시 흘려보낸다)이 체감되는지.