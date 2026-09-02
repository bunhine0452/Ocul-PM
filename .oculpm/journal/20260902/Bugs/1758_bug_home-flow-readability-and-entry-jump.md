---
schema_version: 1
type: bug
slug: "home-flow-readability-and-entry-jump"
status: done
difficulty: medium
created_at: "2026-09-02T17:58:32+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/entryJump.ts"
    op: create
  - path: "src/__tests__/home_flow.test.tsx"
    op: create
  - path: "src/features/onboarding/home/tiles.tsx"
    op: update
  - path: "src/features/onboarding/home/homeModel.ts"
    op: update
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/windows/StartTab.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/__tests__/start_screen.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "home"
  - "ui"
  - "navigation"
  - "dogfooding"
  - "mcp-tool"
---
[x] 오늘의 흐름 — 행을 눌러도 그 일지로 가지 않던 문제 · 4줄 벽을 2줄로

## 발생 원인

메인 화면 "오늘의 흐름"에 두 가지 문제가 있었다 (사용자 도그푸딩 지적).

**① 클릭이 일지로 가지 않는다.** `FlowTile` 은 행 클릭에 `onOpenProject(p)` 만 불렀다 —
`it.relative_path` 를 손에 쥐고도 버렸다. 프로젝트만 열리고, 고른 항목은 화면 어디에도
나타나지 않았다. 배달 경로가 없었던 게 근본 원인이다: 행을 누르면 시작 탭이 **그 자리에서**
프로젝트 탭으로 승격하므로(`set_tab_project`), 누르는 순간에는 셸이 아직 없어 콜백을 넘길
곳이 없고 마운트 직후 이벤트를 쏘면 리스너가 붙기 전이라 유실된다.

**② 한 항목이 네 줄을 먹는다.** 왼쪽에 시각 기둥이 서고 오른쪽에 유형·제목·프로젝트가
각자 한 줄씩 쌓였다. 세 가지 글자 크기가 줄마다 바뀌어서 "무엇이 제목인지"를 매번 다시
찾아야 했고, 기둥이 가져간 폭(약 34px) 때문에 제목은 거의 항상 두 줄로 접혔다.

## 해결 방법

**클릭 — `lib/entryJump.ts` (신규).** `createIntentSlot` 의 끈적 플래그로 승격 사이를 건넌다.
시작 탭이 `requestEntryJump(projectId, path)` 를 걸고 프로젝트를 열면, ① 새로 마운트되는 셸은
`consumeEntryJump` 로 회수하고 ② 같은 창에 이미 떠 있던 탭은 `onEntryJump` 구독으로 받는다.
payload 에 프로젝트 id 를 실어 **받는 쪽이 거른다** — 창 전역 CustomEvent 라 거르지 않으면
엉뚱한 탭이 남의 일지를 연다. 셸은 기존 `journalOpenEntry` 핸드오프에 그대로 연결했다.
한계: 창을 넘지 못한다 (대상이 다른 창에 열려 있으면 백엔드가 그 창을 포커스하고 요청은 남는다).

**가독성 — 행 하나 = 제목 한 덩이 + 곁줄 한 줄.** 시각 기둥을 걷어내 폭을 제목에 주고,
유형·프로젝트·시각을 흐린 한 줄로 모았다 (시각은 오른쪽 끝 고정 · tabular-nums 로 줄맞춤).
제목만 진하게(13px/500, 2줄 클램프) 남으니 눈이 세로로 제목만 훑는다. 항목 사이에는 실선
하나 — 제목이 접히는 목록에서는 여백만으로 경계가 서지 않는다. 클래스는 `hg-`(격자) 옆의
`hf-`(흐름) 로 접두를 맞췄다.

곁들여 고친 것 둘:
- **어제 것을 오늘로 읽던 문제** — 피드는 날짜로 자르지 않고 최신 N건을 가져오는데
  (`home.rs` Q4) 시각만 적어서 헤더의 "오늘 38건" 아래 전부 오늘 일로 보였다.
  `dayLabel()` 로 오늘이 아닌 항목에만 `9/1` 을 붙인다 (언어 안 타는 숫자).
- `FEED_MAX` 8 → 10 (백엔드가 이미 12건을 보낸다). 행이 짧아진 만큼 레일을 채운다.

## 검증

- 4게이트 전부 exit 0 — typecheck · test(156 파일 1999건) · lint 4종 · build.
- 신규 `src/__tests__/home_flow.test.tsx` 8건: 행 클릭이 `(project, relative_path)` 로 열리는지,
  어제 항목에만 날짜가 붙는지, `dayLabel` 경계값, entryJump 의 1회 소비·프로젝트 필터링.
- 라이트/다크 정적 프리뷰를 실제 토큰·CSS 로 렌더해 눈으로 확인 (설치본이 도는 중이라 dev 빌드 대신).