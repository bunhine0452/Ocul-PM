---
schema_version: 1
type: feature
slug: "terminal-session-color-and-workload-visibility"
status: done
difficulty: medium
created_at: "2026-09-04T08:48:13+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/sessionColors.ts"
    op: create
  - path: "src/features/terminal/TerminalSessionMenu.tsx"
    op: create
  - path: "src/features/terminal/useSessionColorMenu.tsx"
    op: create
  - path: "src/features/tray/TraySessions.tsx"
    op: create
  - path: "src/__tests__/session_colors.test.ts"
    op: create
  - path: "src/components/AgentMark.tsx"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/terminal/railModel.ts"
    op: update
  - path: "src/features/terminal/TerminalRail.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/paneDrop.ts"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_rail.test.ts"
    op: update
  - path: "src/__tests__/terminal_agent_mode.test.ts"
    op: update
related: []
tags:
  - "terminal"
  - "ui"
  - "codex"
  - "parallel-agents"
  - "mcp-tool"
---
[x] 터미널마다 색을, 카드에 일감 수를, Codex 에 제 아이콘을

## 추가 기능

사용자가 셋을 요청했는데 전부 같은 자리를 가리켰다 — **에이전트를 여럿 띄웠을 때 레일이 그걸 말해 주지 않는다.**

### 1. 세션 정체 색

카드 넷이 전부 같은 회색이고 이름도 다 `claude` 라, 어느 것이 무엇인지 가르는 값이 화면에 하나도 없었다. 카드 오른쪽 클릭 → 색 고르기(`TerminalSessionMenu`)를 붙이고, **왼쪽 띠와 페인 테두리**가 그 색을 물게 했다. 카드만 칠하면 정작 터미널을 보고 있는 동안에는 아무 표시가 없다.

- 저장은 hex 가 아니라 **색 이름**이다 (`@/lib/sessionColors`). 실제 색은 `--term-*` 토큰이 정하므로 라이트/다크·프리셋 다섯 벌을 그대로 따라간다 — hex 를 저장하면 다크에서 고른 색이 라이트에서 안 보이고, 그 순간 고른 사람이 틀린 게 된다.
- 팔레트에서 **초록·노랑을 뺐다.** 초록은 완료(ok), 노랑은 기다림(waiting)이 이미 쓰고 있어 정체 색으로 주면 "끝났나?"와 "나를 부르나?"가 매번 헷갈린다.
- CSS 는 `var(--sess, var(--accent))` 로 읽는다 — 색을 안 고른 세션은 예전 모습 그대로이고, 기본값을 두 곳에 적지 않는다.

### 2. 일감 수 가시성

원인은 카드가 **포커스된 페인 하나만** 보고 있던 것이었다. 4분할해 에이전트를 넷 띄워도 나머지 셋은 카드 어디에도 없었다. `railModel` 이 이제 탭 전체를 세어 `runningCount`·`waitingCount` 를 낸다.

- 펼침: 배지가 `2/4 실행 중` 으로 바뀐다 (도는 게 없으면 예전처럼 `페인 4`).
- **접힘**: 아이콘 왼쪽 아래 모서리에 개수 배지. 도는 게 여럿이면 액센트 색, 그냥 열려만 있으면 회색이다. 상태 점(오른쪽 위)과 대각으로 갈라 뒀다 — 32px 폭에서 같은 모서리에 둘을 붙이면 서로의 링을 갉아 하나의 얼룩으로 읽힌다.
- 기다림 판정도 탭 전체가 됐다. 옆 페인의 에이전트가 부르는데 다른 페인을 보고 있으면 아무도 알려주지 않았다.
- 시계(`useSecondTick`)도 모든 페인을 본다. 포커스된 것만 보면 옆 페인의 경과·기다림 판정이 초를 못 받아 멎은 것처럼 보인다.

### 3. Codex 아이콘

`CodexMark` 는 이미 있었는데 `AgentMark` 가 그리로 보내지 않아, 터미널 레일·상태 필에서 Claude 는 자기 로고이고 Codex 만 중립 글리프(`Cpu`)로 떨어졌다. 라우팅을 붙였다. 덤으로 `AcpSessionTabs` 가 **모든** 세션 탭에 Claude 마크를 박고 있던 것도 고쳤다 — Codex 대화 탭에 Claude 로고가 붙어 있었다. 마크를 고르는 자리가 둘이 되면 한쪽만 새 어댑터를 알게 되므로 `AgentMark` 의 라우팅 표를 그대로 쓰게 했다.

## 동작 흐름

색은 `TerminalTab.color` 로 워크스페이스 상태에 얹혀 프로젝트별 키에 영속된다. 카드가 `--sess` 를 인라인으로 물고, 페인도 같은 값을 문다. 메뉴의 상태·배선은 `useSessionColorMenu` 가 소유한다 — `TerminalSurface` 가 이미 한계를 한참 넘어 있었고, 이 기능은 화면의 다른 어떤 상태와도 얽히지 않는다.

## 검증

`pnpm typecheck` 무오류, `pnpm test` 2187 통과, design·korean·storage 린트와 **파일 크기 래칫** 전부 통과, `cargo test` 1266 통과, `cargo clippy --all-targets -- -D warnings` 무경고, `cargo fmt --check` 클린.

새 테스트: `session_colors.test.ts`(5건 — 상태색과 안 겹침·토큰 참조·모르는 값 방어·안 고른 세션엔 스타일 없음), `terminal_rail.test.ts` 에 "탭 전체의 일감" 3건(도는 페인 전부 세기·통합이 꺼져도 페인 수는 앎·옆 페인이 부르면 카드가 대신 말함).

남은 실패 4건(`code_screen_tabs.test.tsx`)은 다른 세션이 지금 고치고 있는 `features/code` 쪽이다. **실기기 확인은 못 했다** — 설치본이 도는 중이라 dev 빌드를 띄우면 락이 경합한다.