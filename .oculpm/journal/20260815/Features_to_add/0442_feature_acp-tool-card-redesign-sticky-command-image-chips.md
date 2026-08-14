---
schema_version: 1
type: feature
slug: "acp-tool-card-redesign-sticky-command-image-chips"
status: done
difficulty: high
created_at: "2026-08-15T04:42:14+09:00"
session_id: "mcp-20260815-044214"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "design"
  - "bug"
  - "tool"
  - "mcp-tool"
---
[x] 도구 카드 재설계(이름·설명 분리, JSON 껍데기·코드펜스 제거) · 지시문 sticky · 컴포저 이미지 칩

## 도구 카드가 껍데기를 보여 주고 있었다

두 가지가 그대로 새고 있었다.

- **`{ "command": …, "description": … }`** — 입력을 통째로 예쁘게 찍고 있었다. 읽고 싶은 건 명령 한 줄인데 JSON 껍데기가 시야를 다 먹는다. 아는 이름(`command`·`pattern`·`file_path`·…)이 있으면 그 값만 꺼낸다. 모르는 모양이면 통째로 — 숨기면 카드가 거짓말을 한다.
- **` ```console `** — 어댑터는 명령 출력을 코드펜스로 감싸 주는데 우리는 `<pre>` 평문으로 그리므로 펜스 기호가 내용인 척 보였다. **전체가 하나의 펜스일 때만** 벗긴다. 중간에 낀 코드블록은 내용이라 건드리면 글이 망가진다.

## 이름과 설명을 갈랐다

예전엔 명령줄 전체가 제목 자리에 들어갔다 — 줄이 길수록 "무슨 도구였나"가 말줄임 뒤로 사라진다. 이름은 짧고 늘 같은 자리에 있어야 훑을 때 걸린다.

도구 이름은 프로토콜 본문에 **없다**. 어댑터가 `_meta.claudeCode.toolName` 으로만 준다 (Bash 는 모델이 적은 `description` 도 `_meta.claudeCode.title` 로 온다). 그 둘을 꺼내 `Bash` + `Full gate run` 으로 나눠 건다.

## 지시문이 위에 붙는다

답이 길어지면 "무엇을 시켰는지"가 화면 밖으로 밀려나, 지금 보는 출력이 어느 지시에 대한 것인지 알 수 없었다. 사용자 턴을 `sticky` 로 만들었다.

**카드가 아니라 턴에 걸어야 한다.** 카드에 걸면 컨테이닝 블록이 카드 자신이라 붙어 있을 구간이 카드 높이뿐이고 — 즉 아무 일도 안 일어난다. 턴에 걸면 컨테이닝 블록이 스레드 전체가 되어 답변이 지나가는 내내 붙어 있고, 다음 지시가 올라오면 같은 `top` 에서 겹치며 자리를 넘겨받는다. 위로 되감으면 앞 지시가 제자리로 돌아온다.

배경은 **불투명**이어야 한다 — 반투명이면 밑으로 지나가는 답변 글자가 지시문에 겹쳐 둘 다 못 읽는다.

## 컴포저 이미지 칩

붙일 때와 보낸 뒤가 다르게 생기면 같은 것인지 매번 다시 확인해야 한다. 대화에 남는 칩과 **같은 컴포넌트**를 쓰고 지우기 X 만 얹었다 — 그래서 컴포저에서도 누르면 크게 열리고 Esc·X 로 닫힌다. X 는 호버할 때만: 늘 떠 있으면 붙인 것마다 삭제 버튼이 줄지어 시끄럽다.

죽은 `.image-chip*` 규칙은 지웠다.

## 곁들여

세션 탭 옆 `+` 를 뺐다 (새 대화는 패널에 이미 있다).

## 검증

typecheck 0 · 프런트 812 · lint 0 · build 0 · 백엔드 581 유닛(입력 추출·펜스 벗기기 4건 추가).