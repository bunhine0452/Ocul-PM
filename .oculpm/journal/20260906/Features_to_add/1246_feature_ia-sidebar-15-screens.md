---
schema_version: 1
type: feature
slug: "ia-sidebar-15-screens"
status: done
difficulty: high
created_at: "2026-09-06T12:46:11+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/components/NavRemapNotice.tsx"
    op: create
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/styles/nav-ia.css"
    op: create
  - path: "src/styles/index.css"
    op: update
  - path: "src/__tests__/nav_registry.test.ts"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
  - path: "src/__tests__/acp_working_indicator.test.tsx"
    op: update
related: []
tags:
  - "v3-surface"
  - "ia"
  - "shell"
  - "sidebar"
  - "shortcuts"
  - "mcp-tool"
---
[x] 사이드바가 정리된다 — 17화면에서 15로, 매일 쓰는 것이 번호를 갖는다

전면 리디자인은 `v3-round` 에서 기각됐다. 대신 **매일 보이는 면 하나**를 지렛대로 쓴다 — 사이드바(IA 재편 안 A, 17화면 → 15).

## 추가 기능

**에이전트 한 행.** Claude Code · Codex · 세션은 셋 다 "에이전트에게 시키는 곳"인데 사이드바에서 세 줄을 먹었다. `NavEntry.children` 을 더해 한 행이 셋을 대표하게 했다. 화면은 **하나도 없애지 않았다** — `uiV2View` 값 셋이 그대로 살아 있고 컴포넌트도 두 벌 keep-alive 그대로다. 세션은 혼자 쓰면 영구 빈 화면인 행이라(붙어 있는 에이전트가 하나뿐이면 묶을 것이 없다) 특히 접을 값어치가 있었다.

**참고 그룹으로 강등.** 논의·문서를 새 `ref` 그룹으로 내리고 ⌘번호를 회수했다. 이 저장소 실측으로 논의 4건 vs 일지 537건이고, `docs/` 가 없는 프로젝트에서 ⌘9(문서)는 **영구 빈 화면**이었다. 행은 남긴다 — 번호만 회수한다.

**재명명 셋.** Diff→변경 · 코드 검색→검색 · 코드→편집기 (영문은 Code→Editor). 옛 이름은 ⌘K 별칭에 남는다 (v2.17.0 선례).

## 동작 흐름

- 배지는 갈래를 **합산**한다. 행을 하나로 줄였다고 "Codex 가 승인을 기다린다"가 사라지면 안 된다. 합산 자리와 갈래를 그리는 자리가 같은 `counts(id)` 를 쓴다 — 표를 두 벌 두면 한쪽만 고치는 날이 온다.
- 형제는 **그 면에 들어와 있을 때만** 펼쳐진다(`.subnav.vertical`). 늘 펼치면 셋을 하나로 줄인 뜻이 없고, 아예 안 보이면 Codex 로 가는 길이 ⌘K 뿐이 된다.
- ⌘K 팔레트는 `NAV_DESTINATIONS`(갈래로 펼친 목록)를 싣는다. **접기가 곧 숨기기가 되면 세션 화면은 도달 불가능해진다.** 부모 「에이전트」 자체는 목적지가 아니고, 합친 이름은 세 갈래의 별칭에 들어간다.
- ⌘번호는 여전히 배열 앞 10개에 자동 부여된다. 새 순서에서 **⌘1 오늘 · ⌘2 일지 · ⌘4 플래너는 뜻이 그대로**고 나머지 일곱이 바뀐다. 치트시트·팔레트는 같은 배열에서 파생되므로 저절로 맞다.
- `NavRemapNotice` 가 사이드바 맨 위에 **1회** 안내한다. 자리를 사이드바로 고른 이유는 둘 — 바뀐 것이 여기 있고, 릴리스 노트 카드와 달리 GitHub 에 닿지 않아도 뜬다. **첫 설치에는 뜨지 않는다**: 옛 번호를 본 적 없는 사람에게 "바뀌었어요"는 거짓말이라 What's-new 카드가 세운 규율을 그대로 따랐고, 이전 설치 여부는 `lastSeenVersion` 이 비어 있지 않은지로 판정한다.

CSS 를 `shell.css` 가 아니라 새 `nav-ia.css` 에 둔 것은 같은 라운드의 방언 수렴 레인이 `shell.css` 를 통째로 손보는 중이어서다 — 같은 파일을 두 방향에서 고치면 둘 다 잃는다. 규칙 자체는 `shell.css` 의 nav 블록에 속하므로 다음 정리 때 접어 넣어도 좋다. `NavRemapNotice` 가 `useSaveSetting` 대신 `useOptionalSettings` + `reportRejection` 을 쓰는 것도 같은 종류의 이유다 — 그 훅은 프로바이더가 없으면 throw 하는데 사이드바는 설정 컨텍스트 없이도 렌더된다(분리 창·테스트).

## 검증

`pnpm typecheck` · `pnpm test`(178파일 2,331건) · `pnpm lint`(eslint 61 = 래칫 그대로) · `pnpm build` 전부 exit 0. 계약 테스트를 다시 썼다: 그룹별 개수(5/4/3/2=14행) · ⌘번호 앞 10칸 고정 · **뜻이 그대로인 번호 셋** · 참고 화면은 번호 없음 · 갈래 셋이 다 살아 있음 · 팔레트 목적지에 codex·sessions 존재 · **설정 말고는 도달 불가능한 화면이 없음**(`UI_V2_VIEWS` 와 대조). 배지 합산도 "Claude 와 Codex 가 함께 돌면 2" 로 못 박았다.

육안 확인이 남는다: 낮은 창에서 갈래가 펼쳐졌을 때 사이드바 스크롤·페이드 · 접힌 오버레이에서의 갈래 목록 · 재배정 안내가 실제 업데이트 뒤 1회만 뜨는지.