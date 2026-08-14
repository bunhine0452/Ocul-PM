---
schema_version: 1
type: feature
slug: "acp-toolbar-tabs-claude-mark-local-commands"
status: done
difficulty: high
created_at: "2026-08-15T03:51:06+09:00"
session_id: "mcp-20260815-035106"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/ClaudeMark.tsx"
    op: create
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/ClaudeCodeScreenV2.tsx"
    op: update
  - path: "src/features/chat/acpSlash.ts"
    op: update
  - path: "src/features/chat/useDismiss.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/__tests__/acp_slash.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "ux"
  - "bug"
  - "css"
  - "icon"
  - "session"
  - "mcp-tool"
---
[x] 상단바=세션 탭 · 진짜 Claude 마크 · /continue·/rc · 세션 이름바꾸기·삭제 · 사용량 위젯 클리핑

## 사용량 위젯: 상태는 바뀌는데 화면이 없었다

클릭하면 `open` 은 정상적으로 true 가 됐다. 카드가 안 보인 건 계기가 앉아 있는 `.toolbar-actions` 에 좁은 창 방어용 `overflow-x: auto / overflow-y: hidden` 이 걸려 있어서다 — 그 안에서 `position: absolute` 로 아래에 펼치면 **통째로 잘린다**. 부모 클리핑을 벗어나는 방법은 포털뿐이라 `document.body` 로 띄우고 위치는 버튼을 재어 넣는다.

포털은 곧바로 두 번째 문제를 만든다: 카드가 DOM 상 `wrapRef` 바깥이라 **카드 안을 눌러도 "바깥 클릭"** 으로 읽혀 자기가 자기를 닫는다(새로고침 버튼이 안 먹는다). `useDismiss` 에 "밖에 있지만 안으로 쳐야 하는 조각" 인자를 열었다.

## 상단바 = 세션 탭

"Claude Code / Claude Code 를 앱 안에서 구동" 을 지웠다. 화면 이름은 사이드바가 이미 말하고, 설명은 처음 한 번 읽고 나면 창에서 제일 좋은 자리를 차지만 한다. 대신 **열어 둔 대화들**을 건다 — 상단바에서 알고 싶은 것은 "이 화면이 무엇인가"가 아니라 "나는 어느 대화에 있는가"다.

툴바를 `ClaudeCodeScreenV2` → `AcpConversation` 으로 내렸다. 탭이 필요한 것(목록·현재 세션·열기·새로 만들기)이 전부 대화 컴포넌트 안에 있어서, 위에서 그리려면 상태를 통째로 끌어올리거나 신호선(usageBus 같은)을 새로 놓아야 했다. 툴바를 내리는 쪽이 상태도 신호선도 안 늘리고, 화면이 폴링하던 `acp_session_title` 왕복도 지웠다.

## 진짜 Claude 마크

`docs/claude.webp`(1280px) 를 이진화 → Moore 외곽선 추적 → RDP(ε=2.2px, 111점) 로 벡터화해 24 뷰박스 SVG 로 넣었다. 래스터를 그냥 쓰지 않은 이유는 사이드바 18px·시작 화면 26px·레티나까지 한 장으로는 어디선가 반드시 뭉개기 때문이고, 벡터라야 `currentColor` 로 다른 아이콘들의 활성/비활성 상태를 그냥 따라간다 — 주황 정사각형을 통째로 얹으면 사이드바에서 혼자 스티커가 된다. 브랜드 주황은 로고를 로고답게 보일 자리(시작 화면·활성 탭)에만 쓴다.

**닫힌 곡선 RDP 함정**: 처음 시도가 111점이 아니라 2점으로 붕괴했다. 시작점=끝점이라 모든 점의 수선거리가 0 이 된다. 시작점에서 가장 먼 점으로 반을 갈라 각각 단순화해야 한다.

## `/continue` 와 `/rc`

둘 다 어댑터가 광고하는 명령이 **아니다**. 그냥 보내면 Claude 가 평문으로 읽고 원격 조종에 대해 설명하기 시작한다 — 명령을 친 사람이 가장 원하지 않는 결과다.

- `/continue` = 최근 대화 열기. **지금 열려 있는 것은 후보에서 뺀다** — 이 명령을 치는 이유가 "여기 말고 아까 거기"이기 때문이고, 앱을 켜면 자동으로 열리는 빈 세션이 목록에 실리든 안 실리든 이 규칙이면 양쪽 다 원하는 결과가 나온다.
- `/rc` = ACP 에 대응 요청이 없다(원격 조종은 CLI 가 계정과 짝을 맺는 기능). 잡아서 "터미널의 claude 에서 쓰라"고 안내한다.

앱이 처리하는 명령을 `LOCAL_COMMANDS` 한 곳에 적고 메뉴와 처리기가 같은 목록을 본다 — 안 그러면 `/` 를 눌러도 안 보이고, 쳐 봐야 아무 일도 안 일어난 것처럼 보인다. 어댑터가 같은 이름을 광고하기 시작하면 **어댑터가 이긴다**(우리 설명이 남아 거짓말하지 않게).

## 세션 이름바꾸기·삭제

- **삭제**는 진짜다 — `session/delete` 가 프로토콜에도 어댑터에도 있다. 새 커맨드 `acp_delete_session`.
- **이름바꾸기는 프로토콜에 없다.** 그래서 이름표를 우리가 들고(`acpNames`) 화면에서만 우리 이름이 이긴다. 이 이름은 이 컴퓨터를 벗어나지 않는다 — 다른 기기나 CLI 에서 같은 대화를 열면 에이전트가 붙인 원래 제목이 보인다.

삭제는 한 번 더 묻는다(되돌릴 수 없고 X 가 탭 닫기와 생김새가 같다). 지금 보는 대화를 지웠으면 새 대화를 연다.

## 곁다리

`plugin.json`/`marketplace.json` 버전이 2.8.5 에 멈춰 있어 `plugin_manifest` 테스트가 빨간 채로 있었다(v2.9.0 릴리스 때 스탬프 누락). 2.9.0 으로 맞췄다 — 이번 작업과 무관하지만 게이트를 막고 있었다.

## 검증

typecheck 0 · 프런트 802 · lint 0 · build 0 · 백엔드 14 스위트 전부 ok.

**미확인**: `/continue` 로 세션을 오갈 때 매번 도는 `session/load` 재생 비용, 그리고 `session/delete` 가 실제 디스크의 대화까지 지우는지는 눌러 봐야 안다.