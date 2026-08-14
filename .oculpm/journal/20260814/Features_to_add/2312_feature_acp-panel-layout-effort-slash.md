---
schema_version: 1
type: feature
slug: "acp-panel-layout-effort-slash"
status: done
difficulty: medium
created_at: "2026-08-14T23:12:32+09:00"
session_id: "mcp-20260814-231232"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/agent.css"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/ClaudeCodeScreenV2.tsx"
    op: update
  - path: "src/features/chat/acpSlash.ts"
    op: create
  - path: "src/__tests__/acp_slash.test.ts"
    op: create
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "css"
  - "commands"
  - "mcp-tool"
---
[x] 패널 접힘 빈 공간 수정 · Effort 팝오버 · 슬래시 커맨드

## 패널을 닫으면 오른쪽에 빈 땅이 남던 문제

`.acp-layout` 은 flex 인데 대화 컬럼(`.ai-wrap`)에 `flex: 1` 이 없었다. 패널이 사라져도 컬럼이 원래 폭에 머물러 그만큼이 빈 채로 남았다.

토글도 함께 옮겼다. 스레드 위에 떠 있으면 **열림/닫힘에 따라 위치가 달라져** 같은 버튼으로 안 읽힌다 — 툴바에 고정하고 패널 안의 닫기 버튼은 없앴다(토글은 하나여야 한다).

## Effort — 평소엔 값만

점 트랙을 항상 펼쳐 두니 컴포저 바닥에서 가장 시끄러운 물체가 됐는데, 정작 자주 바꾸는 값이 아니다. 평소엔 현재 값만 칩으로 보이고 누르면 트랙이 열린다.

`default` 선택지는 뺐다. 실제 기본이 `xhigh` 라 "Default" 와 "Xhigh" 가 **같은 것을 두 이름으로** 부르는 꼴이고, 고르면 무엇이 되는지 알 수 없다. 현재 값이 `default` 로 와도 사용자에게는 실제 동작인 `xhigh` 로 보인다.

## 슬래시 커맨드

`/` 를 치면 `/plugin` · `/compact` 등 어댑터가 아는 커맨드 목록이 뜬다. 방향키·Enter·Tab·Esc 로 고른다.

목록 조달이 함정이었다: `available_commands_update` 는 **프롬프트 밖**(세션 시작 직후)에 오므로 프롬프트용 싱크로는 잡히지 않는다 — 알림 핸들러에서 상태에 갈무리하고 `acp_commands` 로 조회한다.

파싱은 순수 함수로 뺐다. 슬래시는 **줄 맨 앞**에서만 명령이다 — 문장 중간의 `and/or`, 경로의 `src/lib` 까지 잡으면 목록이 시도 때도 없이 튀어나온다. 정렬도 이름 접두 일치를 설명 일치보다 앞세운다: Enter 가 첫 항목을 고르는데 `/plug` 를 치고 설명에 "plugin" 이 든 다른 명령이 먼저 오면 엉뚱한 게 실행된다.

## 검증

프런트 유닛 8건 신규(슬래시 파싱·정렬·인자 힌트). 게이트: typecheck 0 · **780건(66파일)** · lint 0 · build 0 · 백엔드 569 유닛.

**미확인**: 슬래시 실행 결과는 실측 안 했다 — 목록을 띄우고 텍스트를 넣는 데까지가 이번 범위이고, 어댑터가 `/plugin` 을 실제로 어떻게 처리하는지는 열어 봐야 한다.