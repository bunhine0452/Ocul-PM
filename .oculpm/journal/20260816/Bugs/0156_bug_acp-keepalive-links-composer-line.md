---
schema_version: 1
type: bug
slug: "acp-keepalive-links-composer-line"
status: done
difficulty: high
created_at: "2026-08-16T01:56:53+09:00"
session_id: "mcp-20260816-015653"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpBusyBus.ts"
    op: create
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/lib/externalLinks.ts"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/external_links.test.ts"
    op: create
  - path: "src/__tests__/acp_working_indicator.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "acp"
  - "claude-code"
  - "ui"
  - "perf"
  - "keep-alive"
  - "mcp-tool"
---
[x] 화면을 옮기면 세션이 끊기던 것 · 링크가 앱 안에서 열리던 것 · 하단바 두 줄

Claude Code 화면(ACP)을 실제로 쓰며 나온 버그 네 갈래를 한 번에 잡았다.

## 발생 원인

**1. 다른 화면으로 가면 세션이 `[Request interrupted by user]` 로 끝났다.**
`ShellV2` 의 라우터가 화면을 삼항으로 갈랐다 — 뷰가 바뀌면 `ClaudeCodeScreenV2` 가
**언마운트**된다. 그런데 이 화면의 대화 기록(`transcripts`)·진행 상태(`busy`)·스트림
채널은 전부 컴포넌트 상태다. 헐리는 순간 흐르던 답이 쓰일 자리가 사라지고, 돌아오면
새 마운트가 `session/load` 로 디스크를 다시 읽는다. 아직 안 끝난 턴은 디스크에 없으니
재생분에는 중단 표시만 남는다. 다른 화면들은 상태의 원본이 디스크에 있어 다시 읽으면
그만이지만, 여기는 **지금 벌어지는 일**이라 다시 읽을 원본이 없다.

**2. 링크가 앱 안에서 열렸다.** 마크다운이 만든 앵커는 그냥 `<a href="https://…">` 라
웹뷰가 그 자리에서 이동해 버린다. 웹뷰에는 뒤로 가기가 없어 앱이 통째로 그 페이지가
되고 돌아올 길이 없다.

**3. 창을 좁히면 컴포저 하단바가 두 줄이 됐다.** `.composer-knobs` 가
`flex-wrap: wrap` 이었다 — 2026-08-15 에 "가로 스크롤이 팝오버를 자른다"를 피하려고
고른 방어인데, 노브들의 자연 폭 합(약 420px)이 흔한 창 폭을 넘어서 **평소 모습**이
돼 버렸다 (실측: 스크린샷의 컴포저는 약 444 CSS px).

**4. 스트리밍이 버벅였다.** `openSession` 의 의존성에 `transcripts` 가 있어 글자 한
덩어리마다 새로 만들어지고, 그 아이덴티티가 `send` → 큐 배출 effect → 툴바까지 타고
흘렀다. 여기에 `groupTurns(turns)` 를 렌더마다 다시 돌려 `TurnRow` 의 memo 를 무의미하게
만들었고, 닫혀 있어도 마운트된 채인 지난 대화 패널이 글자마다 목록 전체를 다시 조정했다.

## 해결 방법

- **Claude Code 화면만 언마운트하지 않는다.** 라우터 아래에 keep-alive 블록을 두고
  보일 때 `display:contents`, 아닐 때 `none`. 처음 들어가기 전에는 마운트하지 않아
  안 쓰는 사용자에게 어댑터 기동 비용을 지우지 않는다. 살아 있음과 보임이 갈라졌으므로
  ESC 중단과 4초 설정 되읽기는 `getClientRects()` 로 **보일 때만** 동작하게 막았다
  (⌘W 사슬이 쓰던 잣대와 같다).
- **사이드바에 돌고 있는 세션 수와 도는 고리**를 붙였다 (`acpBusyBus` — 메모리 버스,
  WorkspaceContext 로 올리면 localStorage 로 내려가 재시작 때 "작업 중"이 되살아난다).
- **바깥 링크는 창마다 한 번 문서에 건 가드**가 `open_url` 로 넘긴다 (버블 단계 —
  문서 뷰어처럼 자기 링크를 직접 처리하는 화면의 손을 뺏지 않는다). 백엔드 `open_url`
  은 `mailto:` 도 받도록 넓혔다.
- **하단바는 한 줄을 지키고 글자를 줄인다.** 컨테이너 쿼리 4단(620/500/430/370) —
  모드와 effort 는 아이콘이 색·모양으로 값을 말하므로 먼저 접고, 아이콘이 반짝이
  하나뿐인 모델 이름을 마지막까지 남긴다.
- **성능**: `transcriptsRef` 로 `openSession` 아이덴티티 고정, `groupTurns` memo,
  `SessionPanel`·`AcpSessionTabs`·`AcpUsageMeter` memo + 안정적인 props.
- 덤으로 **스크롤 납치**를 고쳤다 — 바닥 근처(64px)에 있을 때만 따라간다. 답이 흐르는
  동안 위로 올려 앞의 도구 카드를 읽는 것이 이제 가능하다. 숨은 동안에는 레이아웃이
  없어 `scrollTop` 이 0 에 머물므로, 돌아오는 순간을 `ResizeObserver` 로 잡아 바닥을
  다시 잡는다.

## 검증

`pnpm typecheck` / `pnpm lint` / `pnpm test`(76파일 894개) / `pnpm build` / `cargo test`
모두 exit 0. 새 테스트 11개 — 바깥 링크 가드 7개(http·mailto·auxclick·앵커 안쪽 요소·
상대경로 비간섭·이미 처리된 이벤트·해제), 사이드바 작업 표시 4개(없을 때·시작/종료·
탭 여럿 중복 방지·Claude Code 줄에만). keep-alive 와 컨테이너 쿼리는 jsdom 에 레이아웃이
없어 자동 검증 밖 — 실제 앱에서 눈으로 확인이 남아 있다.