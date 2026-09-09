---
schema_version: 1
type: refactor
slug: "unify-search-input-two-tiers"
status: done
difficulty: medium
created_at: "2026-09-10T00:27:37+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/primitives.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/features/settings/settings.css"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/features/projects/projects.css"
    op: update
  - path: "src/features/projects/ProjectManager.tsx"
    op: update
  - path: "src/features/graph/graph.css"
    op: update
  - path: "src/features/graph/GraphScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeSearchPanel.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/features/skills/SkillShopTab.tsx"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/DiffFileList.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/chat/conversation/SessionPanel.tsx"
    op: update
related: []
tags:
  - "design"
  - "primitives"
  - "search"
  - "gate"
  - "mcp-tool"
---
[x] 검색칸 13벌을 두 단으로 — 감사는 6벌이라 했고, 바닥이 기본값 행세를 하고 있었다

## 동기

`{#unify-search-input}` 은 "검색 입력 6종을 `.search-box` 2단으로" 였다. 실측은 **13벌** — 높이 23·24·26·26·26·28·29·30·30·32·32·60, 곡률 `s`·`m`·`pill` 혼재.

감사가 못 본 둘은 화면 안쪽에 있었다: `.dfl-filter`(변경 화면 파일목록, 26px 알약)와 `.entry-filelist-filter`(일지 항목 파일목록, 23px 알약). 항목 설명의 숫자를 믿기 전에 세어 보는 것이 먼저였다.

정본은 이미 있었다. `.search-box`(30px, primitives.css)를 일지·Today·플래너·검색이 쓰고 있었고, `{#layout-search-toolbar}` 가 남긴 screens.css 주석이 "이 앱에서 검색 필드의 규격은 이미 `.search-box`(30px)" 라고 못 박아 두었다. 할 일은 정본을 찾는 것이 아니라 **정의 자리로 옮겨 적는 것**이었다.

## 변경 요약

**두 단.** 무엇이 고르는지는 높이가 아니라 **앉는 자리**다 — 기본 30px 은 `<Toolbar>`(52px)·페이지 머리처럼 행이 넉넉한 자리, `.sm` 26px 은 사이드바·보조 바·카드 머리처럼 행이 이미 촘촘한 자리. 열한 벌을 접었다:

- 30px — `.cfg-search`(32) · `.pm-search`(32) · `.sk-shop-search`(29, 상자 없이 맨 입력이라 감싸며 돋보기도 얻었다)
- 26px `.sm` — `.gr-search`(알약) · `.code-filter`(26) · `.acp-panel-search`(28, 클래스가 통째로 비어 JSX 에서도 뺐다) · `.ctx-search`(24) · `.diff-search`(24) · `.dfl-filter`(26 알약) · `.entry-filelist-filter`(23 알약) · `.pln-rail-search`(상자를 다시 적고 있었다)

**바닥이 기본값 행세를 하고 있었다.** `.search-box { min-width: 220px }` 은 바닥이라 좁은 툴바에서 줄어들지 못했고, 기본을 쓰는 다섯 자리 중 **넷**이 그것을 아래로 되돌리고 있었다 — Today 200 · 일지 180 · 플래너 레일 0 · 프로젝트 관리자 `flex`. 되돌리는 값이 자리마다 갈리면 그건 호출부의 잘못이 아니라 기본값의 신호다(`{#layout-empty-density}` 와 같은 형태). 바닥을 **기본 폭** `width: 200px; min-width: 0` 으로 바꾸고 넷을 전부 지웠다.

**구성도 하나로.** `.code-filter` 만 돋보기를 `position:absolute` 로 띄우고 입력의 좌우 패딩을 손으로 비워 자리를 만들고 있었다 — 결과는 같아도 구성이 달라서 지우기 버튼도 절대 배치로 따라가야 했다. 셋 다 형제로 폈다.

**접지 않은 둘**, 사유를 코드에 남겼다. `.home-search`(시작 탭 60px)는 바가 아니라 밴드 레이아웃이고 포커스가 밑줄이다 — 상자가 아니라서 단이 없다. `.term-search`(⌘F)는 떠 있는 오버레이 패널이지 바 안의 필드가 아니다.

## 게이트

못 잡을 게이트는 안 세운다. 둘 다 "쓰면 안 되는 것을 썼다" 만 본다.

- **check-design-discipline 규칙 17** (`checkSearchBoxes`) — 이름이 `-search`/`-filter` **로 끝나는** CSS 규칙이 `height` 를 선언하면 위반. TSX 쪽은 `search-box` 를 인라인 치수로 덮으면 위반. 선택자와 여러 줄 여는 태그를 봐야 해서 줄 단위 규칙이 아니라 별도 패스다(규칙 16 이 아홉 번째 자리를 놓친 그 이유). `-clear`·`-ico`·`-count` 는 상자 **안의** 물건이라 안 걸린다.
- **design_ratchets.test.ts** — 두 단이 실제로 존재하는가. 게이트만 있으면 누가 `.sm` 을 지워도 조용히 통과한다(호출부는 그냥 30px 이 된다).

계약을 `design_tokens.test.ts`(733줄)가 아니라 래칫 파일에 얹은 이유는 크기다 — 55줄을 얹으면 800 래칫까지 12줄이 남아 다음 사람이 계약 하나 더할 자리가 없어진다.

## 검증

probe 를 한 형태로만 만들지 않았다 — CSS 한 줄·CSS 여러 줄·JSX 한 줄·JSX 여러 줄 여는 태그·템플릿 className 다섯 형태가 전부 정확한 줄 번호로 잡혔고, `-clear`/`-ico`/`-count` 자식·높이 없는 규칙·`design-ignore` 탈출구·치수 아닌 인라인·`search-box` 아닌 요소 다섯은 통과했다. 래칫 두 계약도 각각 깨뜨려 실패 메시지가 범인을 이름으로 부르는지 확인하고 되돌렸다.

4게이트 각각 exit 0 직접 확인: typecheck · lint(eslint 경고 9, 기준선 그대로 — 늘어난 것처럼 보인 `check-design-discipline.mjs` 의 irregular-whitespace 는 원래 있던 zero-width space 가 내 주석에 밀려 줄 번호만 바뀐 것) · test 196파일/2568(기준선 2566 + 새 계약 2) · build.

`.cfg-search` 는 실측 중에 잡았다 — 206px 레일 안에서 늘어나 있었는데 기본 폭 200px 이 생기면 6px 이 남아 아래 탭들과 정렬선이 어긋난다. 그 자리만 `width: auto` 로 푼다.