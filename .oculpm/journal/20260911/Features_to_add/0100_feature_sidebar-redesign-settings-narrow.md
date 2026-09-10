---
schema_version: 1
type: feature
slug: "sidebar-redesign-settings-narrow"
status: done
difficulty: medium
created_at: "2026-09-11T01:00:49+09:00"
session_id: "20260911-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/settings/settings.css"
    op: update
related: []
tags:
  - "sidebar"
  - "design"
  - "settings"
  - "container-query"
  - "mcp-tool"
---
[x] 사이드바 리디자인 — 활자 머리·섹션 척추·발 한 줄, 그리고 좁은 설정 화면이 망가지던 버그

## 추가 기능

**사이드바 (shell.css · Sidebar.tsx)** — 세 층이 전부 상자이던 것을 활자와 선으로 바꿨다.

1. **머리는 활자다.** 흰 카드 + 액센트 타일 대신 프로젝트 이름이 사이드바의 제목(`--fs-7` bold, `--track-tight`), 그 아래 mono 경로가 부제. 8px 액센트 정사각 마크(`.proj-mark`) 하나가 "프로젝트" 라고 말하고, 전환 가능함은 오른쪽 셰브론 + hover 틴트가 말한다. 브랜드 줄(접기 버튼)은 `--ctl-3` 한 단으로 조여 머리 위 빈 띠를 없앴다.
2. **묶음은 척추를 가진다.** 섹션 라벨이 오른쪽으로 hairline 을 끌고(`.nav-section-label::after`), 그 아래 행들은 왼쪽 1px 척추(`.nav-rows::before`, `--sep-strong`)에 매달린다. 활성 표시자(3px 액센트 막대)는 그 척추 **위에** 앉는다 — "지금 여기" 가 색이 아니라 트랙 위의 위치로 읽힌다. 행은 척추에서 7px 물러나 hover 틴트가 척추를 덮지 않는다. `.nav-branches` 가 이미 쓰던 border-left 문법의 일반화라 어휘가 하나도 늘지 않았다. 아이콘 18→15, 행 패딩 `clamp(4px, 0.6vh, 8px)`.
3. **발은 동사의 줄이다.** 「터미널 도크」만 라벨(⌘J·켜짐 상태)을 갖고, 테마·설정은 30px 아이콘 칸(`.nav-util--icon`)으로 오른쪽에 선다. 세 행 → 한 줄로 60px 을 되찾았고, {#sidebar-verbs} 가 말한 "이 둘은 목적지가 아니다" 가 모양으로 보인다. 라벨은 `.nav-sr` 로 남아 보조기술·기존 테스트(`getByText("다크 모드")`, 발의 버튼 셋)에는 그대로 읽힌다. 도크 아이콘은 `SquareTerminal` → `PanelBottom` — 「터미널」행과 같은 아이콘을 쓰고 있었다.

DOM 계약(머리/스크롤/발 3층 · `.side-nav-scroll` 안에 `.nav-item` 전부 · `flex: none` 블록)은 그대로라 sidebar_scroll/sidebar_a11y/acp_working_indicator 가 수정 없이 통과한다. 새 i18n 키 없음.

## 동작 흐름 — 설정 좁은 폭 버그

`settings.css` 의 `.cfg` 가 **자기 자신에게** `container-type: inline-size; container-name: cfg` 를 갖고 있었다. 컨테이너 질의는 조상만 보므로 `@container cfg (max-width: 720px)` 안의 `.cfg { flex-direction: column }` 은 영영 안 걸리고, 자식 규칙(`.cfg-rail { width: 100% }`)만 걸렸다. 그 반쪽 적용이 "좁아지면 망가진다" 의 정체: 레일이 100% 를 먹은 채 row 로 남아 본문(`.cfg-main`)이 0px 로 사라졌다 (하네스 실측: 760px 에서 railW 702 · mainW 0).

- `SettingsPanel.tsx` 에 껍데기 `.cfg-shell` 을 두고 컨테이너를 거기로 옮겼다. 이제 720 이하에서 레일이 위로 눕는다.
- 눕힌 레일은 **줄바꿈**한다 (`flex-wrap`) — 예전 `overflow-x: auto` + 숨긴 스크롤바는 2026-09-09 재설계가 없앤 바로 그 병("열두 탭 중 대여섯만 보인다")을 좁은 폭에서 되살리고 있었다.

## 검증

- vitest DOM 덤프 + 실제 빌드 CSS 하네스(Chrome, 설치본이 돌고 있어 dev 빌드 대신)로 라이트/다크 사이드바(활성 터미널 · 에이전트 갈래 펼침 · 도크 켜짐 · hover ⌘힌트)와 설정 12탭 × 400/560/760/1000px 를 봤다. 수정 뒤 12탭 × 4폭 전부에서 상자 밖으로 넘치는 요소 0, `.cfg` 가 720 이하에서 column.
- 병렬 세션 WIP(터미널 i18n 키 · TerminalSurface)로 공유 트리의 typecheck/build 가 붉어, 이 라운드의 4파일만 얹은 임시 worktree 에서 typecheck · lint(6게이트) · test(203 파일 2622건) · build 전부 exit 0 확인.
- 실기기(WKWebView)·프리셋 5종은 안 봤다 → v3-release `{#eyes-sidebar-scroll}` 에 메모로 이월.