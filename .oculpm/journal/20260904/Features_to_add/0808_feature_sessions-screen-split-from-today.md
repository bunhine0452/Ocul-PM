---
schema_version: 1
type: feature
slug: "sessions-screen-split-from-today"
status: done
difficulty: high
created_at: "2026-09-04T08:08:07+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/sessions/SessionsScreenV2.tsx"
    op: create
  - path: "src/features/sessions/SessionCard.tsx"
    op: create
  - path: "src/features/sessions/SessionLedger.tsx"
    op: create
  - path: "src/features/sessions/sessionModel.ts"
    op: create
  - path: "src/features/sessions/useSessionBoard.ts"
    op: create
  - path: "src/features/sessions/sessionAttention.ts"
    op: create
  - path: "src/contexts/workspaceState.ts"
    op: create
  - path: "src/__tests__/sessions_screen.test.tsx"
    op: create
  - path: "src/features/today/A2aCard.tsx"
    op: delete
  - path: "src/__tests__/a2a_card.test.tsx"
    op: delete
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src-tauri/src/oculpm/a2a/groups.rs"
    op: update
  - path: "docs/a2a/00-master-plan.md"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/nav_registry.test.ts"
    op: update
  - path: "src/__tests__/file_size_ratchet.test.ts"
    op: update
related: []
tags:
  - "a2a"
  - "ui"
  - "ux"
  - "sessions"
  - "mcp-tool"
---
[x] 세션 묶기가 Today 에서 나와 제 화면을 가졌다

## 추가 기능

사용자 보고로 시작했다: **"세션을 그냥 묶는다는 게 내가 원하던 설계가 아니다. 지금도 한 프로젝트에 세션 넷을 쓰는데 넷이 서로 다른 일을 한다."**

그 말이 맞았다. 묶기는 Today 의 「함께 일하는 중」 카드 안에 체크박스 줄로 있었고, 한 줄에 적히는 것은 `Claude Code · 터미널 · @agentclientprotocol/claude-agent-acp` 가 전부였다. 같은 provider 세션이 넷이면 원장이 주는 이름은 전부 `claude-code-term-<pid>` 다 — 사용자는 **무엇을 고르는지 모른 채** 골라야 했다.

- Today 에서 A2A 카드를 통째로 걷어내고 `A2aCard.tsx` 를 지웠다.
- 새 화면 「세션」(`features/sessions/`) — 사이드바 AI 면 맨 뒤. ⌘번호는 안 밀린다.
- 두 단 보드: 왼쪽 묶이지 않은 세션, 오른쪽 팀 레인 + 「새 팀」 자리. 드래그로 넣고 빼고, 체크박스와 대상 선택으로도 같은 일이 끝난다.

## 동작 흐름

이 라운드의 진짜 과제는 묶기가 아니라 **구별**이었다. 카드 한 장에 다섯 가지 사실을 겹쳐 그린다 — 각각은 약하지만 겹치면 사람이 알아본다:

| 무엇 | 언제 듣는가 |
|---|---|
| 별명 | 가장 강하다. 처음엔 없다 |
| 등록 이름 | `agent_register` 에 `name` 을 준 세션만. 패키지 이름은 이름이 아니라고 보고 버린다 |
| 표면 · pid | 앱 안인가 터미널인가, 어느 프로세스인가 |
| **잡은 구역** | 이름이 없을 때 제일 잘 듣는다 — *무엇을 하고 있는가* 이므로 |
| 마지막 활동 | 방금 친 세션이 어느 것인지 사용자는 안다. 그래서 새 것부터 세운다 |

다섯이 다 같으면 기계가 줄 수 있는 사실은 끝난다. 그 자리에서 사람이 별명을 붙인다 — `acpNames` 와 같은 성격이라 **원장에 쓰지 않고** 워크스페이스에 둔다. 카드는 프로세스가 죽으면 사라지는 휘발성 사실이고, 거기에 사용자의 말을 섞으면 지워도 되는지 아무도 모르게 된다.

## 이유

마스터플랜 D4 는 "사이드바 항목을 늘리지 않는다" 였다. 그것을 D8 로 뒤집으면서 **무엇이 달랐는지**를 문서에 적었다: D4 가 옳았던 것은 *읽기 전용 상태*다 — "지금 누가 붙어 있나" 는 오늘 무슨 일이 있었나의 일부라 곁눈으로 보면 된다. 묶기는 아니다. 넷 중 둘을 고르는 것은 작정하고 앉아서 하는 일이고, 목적을 갖고 가는 곳은 목적지여야 한다.

D4 가 걱정한 비용(화면마다 keep-alive·배지·종료 확인을 또 한 벌)은 **배지 하나**로 갚았다. 승인 대기는 기다린다고 안 풀리고 사람이 눌러야 풀리는 일이라 Today 에서 빠지면 안 보일 위험이 있었는데, Claude Code·Codex 항목이 이미 쓰는 그 사이드바 배지를 그대로 달았다. keep-alive 도 종료 확인도 없다 — 이 화면은 프로세스를 붙잡지 않는다.

**드래그만으로 만들지 않았다.** 끌기는 빠른 길이지 유일한 길이 아니다. 카드마다 체크박스가 있고 행동 줄에서 대상(새 팀·기존 팀)을 골라 키보드만으로 끝난다. axe 0 위반을 테스트가 문다.

## 걸린 함정

**빈 보드가 제일 어려웠다.** 실측해 보니 이 저장소에 등록된 세션은 앱 안 ACP 패널 둘뿐이었다 — 사용자의 터미널 세션 넷은 `agent_register` 를 안 불러 목록에 아예 없었다. Today 카드는 그럴 때 **아무 것도 안 그렸고**(혼자 일하면 숨긴다) 그래서 아무도 이 사실을 몰랐다. 목적지가 된 지금은 반대다: "없습니다" 만 적으면 사용자는 기능이 고장 났다고 읽는다. 왜 안 보이고 무엇을 하면 보이는지를 같은 자리에서 말하고, 칠 명령을 복사할 수 있게 뒀다.

**파일 크기 래칫이 옳았다.** 별명 필드 하나를 `WorkspaceState` 에 더하려다 `WorkspaceContext.tsx`(1463줄 천장)에 막혔다. 주석을 줄여 우회하는 대신 `workspaceDefaults.ts` 가 만든 선례를 따라 상태 인터페이스(246줄)를 `workspaceState.ts` 로 떼어냈다 — 컨텍스트는 1478 → 1236줄이 됐고, 소비처는 재수출 덕에 한 줄도 안 고쳤다. 게이트가 "필드가 하나 늘 때마다 이 파일이 길어질 이유가 없다"고 말한 것이 맞았다.

**두 곳이 다른 곳을 가리키면 안 된다.** `groups::refusal` 이 거절 사유에 "Today 의 「함께 일하는 중」에서 묶어 주세요" 라고 적고 있었다. 화면을 옮겼으면 그 문장도 옮겨야 한다 — 안 그러면 에이전트가 사용자를 없는 곳으로 보낸다.

**실패해도 고른 것을 버리지 않는다.** 처음 구현은 묶기가 거절돼도 선택을 비웠다. 넷 중 둘을 골라 놓고 오류 문장 하나 읽은 뒤 처음부터 다시 고르는 일이 된다 — 쓰기 헬퍼가 성공 여부를 돌려주고, 실패하면 화면을 그대로 둔다.

## 병렬 세션과 부딪히지 않으려고

다른 세션들이 지금 `mcp/tools.rs`·`frontmatter.rs`·`session.rs`·`watcher.rs`·`TrayPopover.tsx` 안에서 작업 중이라, 우리가 만든 그 기능으로 **구역을 먼저 잡고** 시작했다(`claim_paths` 두 번: 화면·내비·i18n·CSS·테스트, 그리고 아이콘·README). `pnpm lint:filesize` 는 지금 붉지만 **전부 그쪽 진행 중 작업**이고 내 파일은 하나도 없다.

## 검증

`pnpm typecheck` 0 · `pnpm test` **164 files 2151 passed**(신설 19: 빈 보드 안내 · pid/구역 구별 · 별명 · 체크 묶기 · 이름 묶기 · 새 팀 드롭 · 레인 드롭 · 빼기 드롭 · 셋에서 하나 빼기 · 통째 풀기 · 승인 · 임대 놓기 · 판정 불가/자칭 · 거절 시 선택 보존 · axe · 모델 5) · `pnpm lint:storage`·`lint:i18n`·`lint:bindings`·`lint:design` 0 · `pnpm build` 0 · `cargo check` 0.

**릴리스 표면은 손대지 않았다.** README ko/en 과 랜딩의 "Today 의 「함께 일하는 중」" 문구는 **과거 버전(v2.37.0·v2.38.0) 릴리스 노트**라 고치면 역사가 거짓이 된다. 다음 릴리스 노트에서 옮기도록 플랜에 남겼다 (`sessions-screen#release-surfaces`).