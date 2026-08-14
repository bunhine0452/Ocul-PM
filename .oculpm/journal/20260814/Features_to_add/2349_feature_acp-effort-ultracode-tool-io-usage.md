---
schema_version: 1
type: feature
slug: "acp-effort-ultracode-tool-io-usage"
status: done
difficulty: high
created_at: "2026-08-14T23:49:34+09:00"
session_id: "mcp-20260814-234934"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
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
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpTurns.ts"
    op: update
  - path: "src/features/chat/ClaudeCodeScreenV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_turns.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ultracode"
  - "tool-call"
  - "usage"
  - "ux"
  - "mcp-tool"
---
[x] 울트라코드를 effort 안으로 · 도구 IN/OUT 펼치기 · 툴바 사용량 계기

## 울트라코드 — 별도 토글이 잘못이었다

사용자 지적: "울트라코드도 effort 에 있어 원래". 맞다. 앞 라운드에서 나는 어댑터 소스의 "keyword opt-in" 문구를 근거로 **별도 토글**을 만들었는데, 사용자 쪽 Claude Code 는 그 자리를 effort 슬라이더의 **최상위 단계**로 두고 "Ultracode - xhigh + workflows" 라고 설명한다. 컨트롤이 둘이면 어느 쪽이 진짜인지 알 수 없다 — 토글을 걷어내고 effort 안으로 접었다.

어댑터가 주는 이름은 `max` 이고 설명은 비어 있어서(실측), 라벨만 우리가 "울트라코드"로 맞춘다. 키워드는 버리지 않고 **최상위 effort 를 고른 상태에 묶었다**: effort 값은 프로토콜로, 키워드는 CLI 의 opt-in 게이트로 간다. 어느 쪽이 실제로 먹는지 단정할 수 없으니 둘 다 보낸다 — 키워드 부착은 멱등이라 손해가 없다.

**effort 팝오버가 고를 때마다 움직이던 것**도 고쳤다. 폭을 내용에 맞췄더니 "Low"→"울트라코드" 로 바뀔 때마다 커졌다 작아지며 **누른 자리가 이동**했다. 고정 폭 + 오른쪽 정렬로 못 박았다.

## 도구 카드에 IN/OUT

`raw_input` · `raw_output` · `content` 를 통째로 버리고 있었다. 이제 카드를 눌러 펼치면 들어간 것과 나온 것이 보인다. 기본은 접힘 — 도구 출력은 수백 줄이 예사라 다 펼쳐 두면 정작 읽어야 할 답변이 아래로 밀린다.

- `raw_input` 이 객체면 **예쁘게 찍는다.** Bash 의 `{"command":"ls -la"}` 를 한 줄 JSON 으로 보여 주면 카드가 읽히지 않는다.
- 20k 자 상한. 도구 출력은 수 MB 도 나오는데 화면에도 IPC 에도 통째로 올릴 이유가 없다. **잘렸다는 사실은 꼬리표로 남긴다** — 조용히 자르면 출력이 거짓말이 된다.
- 부분 갱신에서 `null` 은 "안 왔다"이지 "비었다"가 아니다. 이미 받은 입력을 지우면 완료된 카드의 IN 이 사라진다.

## 툴바 사용량 계기

한도가 남아 있는지는 작업을 시작하기 **전에** 알아야 하는 정보라 툴바에 상주시킨다. 클릭하면 막대와 초기화 시각, 새로고침 버튼.

두 가지가 설계를 갈랐다.

1. **한도는 한 번에 한 종류씩 온다.** 그래서 백엔드가 `rateLimitType` 별로 **누적**한다 — 덮어쓰면 마지막 한 줄만 남아 세션·주간·Fable 이 영영 함께 보이지 않는다.
2. `_meta` 는 확장 지점이라 벤더가 자리를 옮길 수 있다. 그래서 키 이름(`_claude/rateLimit`)이 아니라 **모양**(`utilization` 을 가진 객체)으로 재귀 탐색한다. 중첩돼 있어도 찾는다.

아직 못 본 한도는 **그리지 않는다** — 0% 로 그리면 "여유롭다"는 거짓말이 된다.

새로고침은 정직하게 로컬 재조회다. ACP 에 사용량 조회 메서드가 없어서, 숫자는 턴이 돌 때마다 오는 `usage_update` 로만 갱신된다(최신을 원하면 `/usage` 를 보내면 되고 그것도 결국 한 턴이다).

## 검증

백엔드 유닛 4건 신규(입력 렌더링·상한 표시·`_meta` 모양 탐색·빈 meta), 프런트 2건 신규(입력 보존). 게이트: typecheck 0 · 프런트 **791건** · lint 0 · build 0 · 백엔드 **573 유닛**.

**미확인**: 최상위 effort 가 실제로 workflows 를 켜는지는 실측하지 않았다 — 켜고 한 번 시켜 보면 툴콜 카드에 워크플로가 나타나는지로 즉시 드러난다.