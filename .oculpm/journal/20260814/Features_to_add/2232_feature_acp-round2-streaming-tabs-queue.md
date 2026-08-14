---
schema_version: 1
type: feature
slug: "acp-round2-streaming-tabs-queue"
status: done
difficulty: high
created_at: "2026-08-14T22:32:05+09:00"
session_id: "mcp-20260814-223205"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/ClaudeCodeScreenV2.tsx"
    op: create
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/nav_registry.test.ts"
    op: update
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "performance"
  - "design"
  - "session"
  - "ux"
  - "mcp-tool"
---
[x] 스트리밍 재수정·탭 분리·세션 목록·ESC 중단·대기열 — 도그푸딩 2차 반영

## 스트리밍 — 스로틀로는 부족했다

45ms 스로틀 + 행 memo 를 넣었는데도 여전히 끊겨 보인다는 지적. 진짜 원인은 갱신 **빈도**가 아니라 갱신 **비용**이었다: 매 갱신마다 `react-markdown` 이 누적 전체를 다시 파싱하고 `rehype-highlight` 가 코드블록을 재하이라이트한다. 대화가 길수록 한 번의 갱신이 무거워지니 스로틀을 아무리 조여도 뚝뚝 끊긴다.

- **스트리밍 중에는 마크다운을 파싱하지 않는다.** 원문을 `pre-wrap` 으로 그리고, 턴이 끝나면 리치 렌더로 승격한다. `Markdown` 의 Suspense 폴백과 같은 모양이라 전환이 눈에 띄지 않는다.
- 타이머(45ms) → **`requestAnimationFrame`**. 타이머는 화면 갱신과 어긋나 같은 양의 글자도 뭉텅이로 튄다. rAF 는 브라우저가 그리는 리듬과 같다.

## 화면 분리

"에이전트"(프로바이더 채팅)와 "Claude Code"(ACP)를 **별도 화면**으로 갈랐다. 성격이 다르다 — 저쪽은 물어보는 곳이고 이쪽은 시키는 곳이라, 한 화면에서 토글로 오가면 "지금 어느 쪽에 말하고 있나"를 매번 확인해야 한다. 신규 nav 항목은 **배열 끝**에 붙여 기존 ⌘번호를 밀지 않았고, 그 계약을 `nav_registry.test.ts` 에 회귀 방지로 고정했다. 쓰이지 않게 된 `aiMode` 는 제거.

## 설정 컨트롤

`MODE` · `MODEL` · `EFFORT` 를 바깥으로 꺼내 아이콘 트리거 3개로, 나머지(Fast·서브에이전트)는 `⚙` 안으로. 메뉴 행은 **아이콘 + 이름 + 설명** 두 줄이고, 설명은 우리가 지어내지 않고 어댑터가 준 것을 그대로 쓴다(백엔드 `AcpConfigChoice.description` 추가). 모드처럼 결과가 위험할 수 있는 선택은 이름만으로 부족하다 — 권한 모드에는 자물쇠/코드/계획/로켓 아이콘을 붙였다.

채팅에서 매 턴 반복되던 "Claude Agent" 라벨은 제거했다. 답이 하나뿐인 화면에서 이름은 정보가 아니라 소음이다 — 진행 중임은 점 하나로 족하다.

## 세션 목록

**우리가 저장하지 않는다.** Claude Code 가 이미 자기 세션 스토어를 갖고 있고 ACP `session/list`·`session/resume` 가 그걸 열어 준다. 사본을 두면 터미널에서 연 세션과 앱에서 연 세션이 갈라진다.

## 중단과 대기열

- **ESC 로 중단.** 진행 중일 때만 document 에 리스너를 걸어 다른 화면의 ESC(팝오버 닫기)를 뺏지 않는다.
- **대기열**: 작업 중 친 메시지를 모았다가 턴이 끝나면 **하나씩** 보낸다. 어댑터가 `promptQueueing` 을 광고하지만 그쪽에 맡기면 큐가 화면에 안 보이고 취소도 못 한다. 칩으로 드러내고 눌러서 뺄 수 있게 했다. 드레인 effect 에 `drainingRef` 가드가 필요했다 — StrictMode 가 effect 를 두 번 돌려 같은 문장이 두 번 나갈 수 있었다.

## 검증

typecheck 0 · 프런트 756건(61파일) · lint 0 · build 0 · 백엔드 569 유닛. `plugin_json` 실패는 v2.9.0 릴리스가 남긴 기존 드리프트.

**미확인 2건**: ① 스트리밍 체감은 실제 스트림에서 사람이 봐야 한다. ② `session/resume` 가 과거 대화를 `session/update` 로 재생하는지 확인하지 않았다 — 재생한다면 지금은 프롬프트 밖이라 싱크가 없어 **버려진다**. 재개 후 화면을 비우는 현재 동작은 그 가정 위에 있고, 다음 라운드에서 실측이 필요하다.