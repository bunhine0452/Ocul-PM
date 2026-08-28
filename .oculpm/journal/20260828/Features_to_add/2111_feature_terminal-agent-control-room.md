---
schema_version: 1
type: feature
slug: terminal-agent-control-room
status: done
difficulty: high
created_at: "2026-08-28T21:11:10+09:00"
session_id: "manual-20260828-211110"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/terminal/agentMode.ts"
    op: create
  - path: "src/features/terminal/TerminalAgentPill.tsx"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalRail.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/railModel.ts"
    op: update
  - path: "src/features/terminal/useAgentRuns.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_agent_mode.test.ts"
    op: create
  - path: "src/__tests__/terminal_rail.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - "20260828/Features_to_add/1949_feature_terminal-visual-identity.md"
tags: [terminal, agent-workflow, cmux, osc133, xterm]
---

[x] 에이전트 관제탑 — 어느 세션이 나를 기다리는지 보인다

## 추가 기능

터미널 정체성 라운드 Phase 2. Phase 1 이 "무엇이 돌고 무엇이 깨졌는지"를 보이게
했다면, 이번엔 **"어느 놈이 지금 나를 기다리는지"** 다. 에이전트를 서너 개 띄워
놓으면 그것만이 알고 싶은 것이다.

- **에이전트 모드 감지** — alt-screen(전체화면 TUI) 진입/이탈을 `buffer.onBufferChange`
  로 잡고, 셸 통합이 알려준 명령줄에서 `detectAgent` 가 고른 에이전트와 합쳐 판정한다.
- **"내 입력 대기"** — 근거 두 가지를 **다르게** 표시한다. `term.onBell` 이 울리고
  그 뒤로 출력이 없으면 "입력을 기다립니다"(확실), alt-screen 인데 출력이 20초
  멎으면 "입력 대기로 보입니다 (추정)".
- **레일 대기 배지** — "N개가 기다립니다". 누르면 대기 중인 세션으로 가고, 여러
  개면 누를 때마다 다음 것으로 돈다.
- **페인 위 에이전트 알약** — 이름·상태·경과 시간. 평소엔 아이콘 + 시간만, 포커스·
  호버·기다림에서 펼쳐진다.
- **끝난 실행 카드** — 세션 카드 안에 "Claude Code · 12분 / 일지 남기기" 가 남는다.

## 동작 흐름

**셸 통합만으로는 안 되는 이유**가 이번 작업의 출발점이다. OSC 133 은 "명령이
돌고 있다"까지만 안다. `claude` 는 한 번 뜨면 몇 시간이고 같은 명령으로 남아
있어서, 그 안에서 생각 중인지 내 대답을 기다리는지는 명령 경계로 알 수 없다.

그래서 페인에서 **셸 통합과 독립인 신호**를 하나 더 받는다 (`PaneSignal`):
alt-screen 여부 · 마지막 BEL 시각 · 마지막 출력 시각. `agentMode.deriveAgentState`
(순수)가 셸 상태와 이 신호를 합쳐 판정한다.

정직성이 이 기능의 전부다:
- 셸 통합이 없으면 alt-screen 만 보고 **아무것도 지어내지 않는다**. `less` 도
  alt-screen 이다 — 판정은 `shell.running` + `detectAgent` 를 통과해야 시작한다.
- 벨은 프로그램이 직접 부른 것이라 확실하고, "조용하다"는 추정이다. 둘을 같은
  배지로 그리면 "기다린다"는 표시를 아무도 안 믿게 되므로 문구를 갈랐다.
- alt-screen 이 아니면 아무리 조용해도 추정하지 않는다 (그냥 오래 도는 명령일
  수 있다). 출력이 한 번도 없었으면(`lastOutputAt === 0`) 방금 뜬 것뿐이다.

성능 쪽 결정 셋:

1. **출력 시각은 1초로 묶어 발행**한다 (청크마다면 초당 수백 번). alt-screen
   전환과 벨은 상태를 뒤집는 사건이라 **즉시** 보낸다.
2. **판정과 1초 시계를 소비하는 작은 컴포넌트 안에 가둔다** — `TerminalAgentPill`
   과 레일이 각자 돌린다. `TerminalSurface` 에서 하면 매초 페인 트리 전체가
   다시 그려진다. 대신 두 곳이 **같은 순수 함수**를 부르므로 어긋나지 않는다.
3. **에이전트 표시는 레이아웃을 건드리지 않는다.** 처음엔 페인 위에 얇은 헤더를
   붙이려 했는데, 헤더가 생기면 페인 높이가 줄고 → xterm 이 refit 하고 → PTY 가
   resize 되어 에이전트가 뜨고 질 때마다 TUI 가 통째로 다시 그려진다. 절대 위치
   알약으로 갔다.

**레일을 정렬하지 않는다**는 결정도 여기에 있다. 카드가 스스로 자리를 바꾸면
누르려던 자리에 다른 세션이 와 있게 된다. 목록 순서는 그대로 두고 "가는 길"만
준다 — 그게 대기 배지다.

## 검증

- vitest 15건 신설(`terminal_agent_mode.test.ts`) — 거짓 양성을 특히 촘촘히 덮었다:
  통합 없는 세션은 alt-screen 만으로 판정 안 함 · `less` 는 에이전트가 아님 ·
  벨 유예 안/밖의 출력 · 유휴 문턱 직전/직후 · alt-screen 아닐 때는 추정 안 함 ·
  출력이 한 번도 없으면 추정 안 함 · 기다림이 실행 중 톤을 덮되 타이머는 계속 돎 ·
  추정과 확실이 다른 문구 · `waitingItems` 가 순서를 바꾸지 않음.
- 전체 스위트 그린 — 119파일 1,399건. typecheck · lint · build 전부 exit 0.
- **육안 확인** — 실제 `screens.css`/`tokens.css` 목업으로 대기 카드(노랑 왼쪽
  테두리 + 옅은 바탕), 대기 배지, 페인 위 알약(평소 축소 ↔ 기다릴 때 펼침),
  기다림 띠, 두 줄로 접힌 끝난-실행 카드를 확인했다.
- **남은 확인**: 실제 앱에서 Claude Code 를 띄워 **벨이 실제로 울리는지**와
  20초 문턱이 적당한지는 실기기에서만 확정된다. 설치본이 도는 중이라 보류했다
  (플래너 `#p1-manual-verify` 와 같은 조건).

## 메모

`anyRunning` 을 지웠다. 기다림 판정이 시간이 흐르는 것만으로 바뀌게 되면서 레일이
고정된 `now` 로 카드를 만들 수 없게 됐고, 시계를 켤지는 셸 상태만 보고 정하게
바뀌어 소비처가 사라졌다.

토스트와 카드를 **둘 다** 남겼다. 토스트는 다른 화면에 있을 때 닿고, 카드는
터미널로 돌아왔을 때 아직 거기 있다. 하나는 알림이고 하나는 손잡이다 — 토스트만
두면 자리를 비운 사이 사라지고, 카드만 두면 도크를 닫아 둔 사람에게는 아무 일도
일어나지 않는다.
