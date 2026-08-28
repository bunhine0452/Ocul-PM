---
schema_version: 1
type: feature
slug: terminal-command-blocks
status: done
difficulty: superhigh
created_at: "2026-08-28T21:30:56+09:00"
session_id: "manual-20260828-213056"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src/features/terminal/commandBlocks.ts"
    op: create
  - path: "src/features/terminal/TerminalBlockMenu.tsx"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/lib/journalCompose.ts"
    op: update
  - path: "src/features/oculpm/ManualEntryModalV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/terminal_command_blocks.test.ts"
    op: create
  - path: "src/__tests__/agent_detect.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - "20260828/Features_to_add/2111_feature_terminal-agent-control-room.md"
  - "20260828/Features_to_add/1949_feature_terminal-visual-identity.md"
tags: [terminal, warp, xterm, journal, planner, osc133]
---

[x] 명령 블록 — 터미널에서 일어난 일이 기록의 원재료가 된다

## 추가 기능

터미널 정체성 라운드 Phase 3. Warp 의 블록을 xterm 위에 올리되, **마지막 두
줄이 ocul-pm 것**이다.

- **거터 캡슐** — 명령마다 왼쪽 여백에 상태 색 막대. 초록(0) · 빨강(비0) ·
  액센트 맥동(실행 중) · 회색(셸이 종료코드를 안 실어 보냄).
- **overview ruler** — 스크롤백 전체의 실패 지점이 오른쪽 띠에 점으로 찍힌다.
  300줄 로그 어디서 깨졌는지 스크롤바만 보고 안다.
- **⌘↑ / ⌘↓ 블록 점프** — 다음 프롬프트까지 스크롤바를 끌지 않는다.
- **스티키 헤더** — 긴 출력을 스크롤하는 동안 "지금 보는 게 어느 명령의 출력인가"
  가 위에 고정된다.
- **블록 액션 팝오버** — 명령 복사 · 출력 복사 · 프롬프트에 채우기 ·
  **일지로 남기기** · **플래너에 붙이기**.

## 동작 흐름

`registerMarker`(스크롤을 따라다니는 버퍼 앵커) + `registerDecoration`(그 줄에
붙는 DOM) 은 xterm 5.5 코어에 있다 — VS Code 의 명령 장식과 같은 길이다.

**앵커는 OSC 133;A 에서 잡되 `C`(실행)가 와야 블록이 된다.** 빈 프롬프트에서
Enter 만 쳐도 A 는 오므로, 그때마다 캡슐을 그리면 거터가 아무 의미 없는 점으로
채워진다. `A` 를 놓친 세션(리플레이 중간부터 붙은 경우)에는 줄을 지어내지 않고
그 명령을 건너뛴다.

**모르는 것을 초록으로 칠하지 않는다**는 규칙이 거터에도 그대로 온다. 셸이
종료코드를 안 실어 보내면(`exitCode === null`) 성공이 아니라 `unknown` 이고,
캡슐은 흐린 회색이다. 성공으로 그리면 실패를 놓친다.

레이아웃을 건드리지 않으려는 노력이 두 군데 더 있다:
- `.term-screen` 의 **왼쪽 패딩만 항상 7px 더** 준다. 블록이 생길 때 늘리면
  cols 가 바뀌며 셸이 화면을 다시 그린다.
- `overviewRulerWidth` 는 **생성 시 한 번만** 정한다. 나중에 켜면 같은 일이 난다.

스티키 헤더는 **React 를 거치지 않는다** — 스크롤마다 상태를 올리면 초당 수십 번
페인 트리가 재렌더된다. DOM 노드 하나를 만들어 `textContent` 만 바꾼다. 블록
목록도 마찬가지로 React 상태가 아니라 `onReady` 로 넘기는 명령형 손잡이(`BlockApi`)다.

### 일지·플래너로 잇는 고리

여기가 이 라운드 전체의 목적이다. Warp 의 블록 액션은 공유·재실행이 목적이지만,
ocul-pm 에서 터미널은 **기록의 원재료**다.

- **일지로 남기기** — `journalCompose` 에 씨앗(title/body)을 실어 보내면 작성기가
  명령줄·종료코드·소요시간·**출력 꼬리 40줄**로 미리 채워진 채 열린다. 출력을
  통째로 넣지 않는 이유: 빌드 로그 3천 줄이 일지가 되면 아무도 안 읽고 디스크에
  영구히 남는다. 잘렸다고 본문에 적는다. 코드펜스는 출력 안 백틱보다 길게 만든다.
- **플래너에 붙이기** — 활성 계획 → 단계를 고르면 `plan_apply_edit(add_item)` 으로
  명령줄이 항목 제목이 되어 들어간다. 단계를 몰래 고르지 않는다.

**"재실행"은 넣지 않았다.** 계획 항목에는 있었지만, 스크롤백에서 고른 명령을
눈으로 확인하지 않고 바로 돌리는 것이 `rm -rf` 를 두 번 하는 방법이다. 프롬프트에
채우기만 하고 Enter 는 사람이 친다 — 디스패치 프리필과 같은 규약이고, 라벨도
"프롬프트에 채우기"로 정직하게 적었다.

## 검증

- vitest 17건 신설(`terminal_command_blocks.test.ts`) — 좌표 계산과 문구 조립이
  전부다: 이동 경계에서 제자리를 안 돌려줌 · 출력 범위(중간/마지막/빈 범위/모르는
  id) · `exitCode === null` 이 초록이 아님 · 긴 출력 꼬리 자르기 · 출력에 백틱
  세 개가 있어도 코드펜스가 안 깨짐 · 출력이 비면 펜스를 안 만듦 · 실행 중이면
  종료코드를 지어내지 않음.
- 전체 스위트 그린 — 120파일 1,416건. typecheck · lint · build 전부 exit 0.
- **육안 확인** — 실제 CSS 목업으로 거터 캡슐(성공·실패·실행 중), 스티키 헤더,
  액션 팝오버를 확인했다. 캡슐이 프롬프트 글자를 덮지 않는 것까지 봤다.
- **남은 확인**: 실제 xterm 에서 마커 줄이 스크롤백을 따라 정확히 붙어 있는지,
  overview ruler 가 10px 폭에서 읽히는지는 실기기에서만 확정된다.

## 메모

전체 스위트를 최대 병렬로 돌리면 `acp_conversation_seams.test.tsx` 가 간헐적으로
깨진다 — 실타이머 `waitFor` 가 CPU 경합에 밀리는 것이다(이 머신에서 Claude 세션
둘이 동시에 도는 중). `--maxWorkers=2` 로는 120파일 1,416건 전부 통과하고, 파일
단독 실행도 통과한다. 이번 변경과 무관한 기존 취약점이라 손대지 않았다.

`journalCompose.consumeManualEntryRequest()` 가 `boolean` → `ManualEntrySeed | null`
로 바뀌었다. 소비처는 `JournalScreenV2` 하나이고, 기존 테스트 단언 두 줄을 함께
고쳤다.
