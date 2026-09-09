---
schema_version: 1
type: refactor
slug: "editor-de-ai-and-monaco-widget-theme"
status: done
difficulty: medium
created_at: "2026-09-09T22:00:39+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/code/monaco/theme.ts"
    op: update
  - path: "src/features/code/monaco/options.ts"
    op: update
  - path: "src/__tests__/monaco_options.test.ts"
    op: update
related: []
tags:
  - "design"
  - "code-screen"
  - "monaco"
  - "de-ai"
  - "mcp-tool"
---
[x] 편집기가 아마추어로 보인 두 자리 — 캡슐 목록과, 테마가 없는 위젯

## 동기

사용자가 파일 트리 행 하나를 스크린샷으로 집어 "AI 스럽다" 고 했다. 그 한 행에 셋이 겹쳐 있었다.

1. **캡슐 목록.** `.code-tree-row` 가 `--radius-s`(7px)를 24px 행에 쓰고, 사이드바가 가로 여백 8px 로 행을 양쪽에서 밀어 놓아, 트리 한 줄이 면(面)이 아니라 **떠 있는 칩**으로 읽혔다. 대시보드의 태그 줄이지 IDE 의 파일 트리가 아니다.
2. **초승달이 된 막대.** `.marked` 의 `box-shadow: inset 2px 0 0 var(--accent)` 가 그 둥근 모서리에 위아래가 깎여, 신호가 아니라 렌더링 사고처럼 보였다. 스크린샷에서 제일 먼저 눈에 걸리는 것이 이것이었다.
3. **폴더가 제일 크게 말한다.** `.code-fico.folder` 가 `color-mix(--accent 40%, --text-3)` 라, 15px 채운 도형이 13px 파일명보다 먼저 읽혔다.

같은 병이 사이드바 전체에 있었다. 아웃라인은 사이드바 여백을 상쇄하려고 `margin: 0 -8px` 를 들고 있었고(여백이 있으니 음수로 되무는 것), 검색 결과 행도 같은 캡슐이었다.

편집기 본체에서는 다른 것이 나왔다. `monaco/theme.ts` 가 정하는 색이 **열 개**뿐이고 나머지는 `inherit: true` 로 base(`vs`/`vs-dark`)에 맡겨져 있었다. `setup.ts` 는 자동완성·⌘F·우클릭 메뉴·피크·이름 바꾸기 기여를 전부 싣는데, 그 위젯들이 전부 VS Code 기본 회색으로 뜬다는 뜻이다 — 아이보리 캔버스 위에 남의 앱 조각이 떠 있고, 프리셋(Solarized·Nord·Dracula)을 고르면 아예 딴 세상이 된다. 위젯은 편집기의 절반이라, 편집면 색만 정하고 위젯을 안 정하면 "테마가 있다" 고 할 수 없다.

## 변경 요약

**1. 사이드바 = 면, 팔레트 = 칩.** 규칙을 하나로 정했다 — *붙박이 목록은 패널 끝에서 끝까지 가는 면, 떠 있는 팔레트만 모서리를 갖는다*. `.code-sidebar` 의 가로 여백을 없애고 트리·아웃라인·검색 결과 행의 `border-radius` 를 0 으로. 그 결과 `.marked` 의 액센트 막대가 깎이지 않는 온전한 2px 사각형이 되고, 패널 왼쪽 끝에 붙어 거터 표시로 제자리를 찾았다. 아웃라인의 `-8px` 음수 마진은 원인이 사라져 같이 지웠다. ⌘K 팔레트(`.code-goto`)와 우클릭 메뉴는 **일부러 그대로 뒀다** — 그건 떠 있는 물건이라 칩이 맞다.

**2. 두 기둥의 머리를 맞췄다.** `.code-sidebar-head` / `.code-search-head` 를 편집기 탭 줄과 같은 34px + 같은 아래선으로. 예전엔 사이드바만 10px 위 여백에 검색칸이 떠 있어 두 기둥이 어긋난 채였다.

**3. 폴더는 중성 회색.** 트리에서 색을 갖는 것은 파일 종류 배지 하나뿐이 됐다 — 회색=담는 것, 색=담긴 것.

**4. Monaco 위젯을 토큰으로 덮었다.** 색 10개 → 120여 개. 자동완성·호버·⌘F·목록·입력칸·메뉴·피크·스크롤바·개요 눈금자·들여쓰기 가이드·괄호 짝 6단·진단·인레이 힌트·diff 까지 전부 앱 토큰에서 나온다. 위젯 *모양*(둥글기·테두리·그림자)도 앱 팝오버 규격으로 `code.css` 에서 맞췄다. **새 색은 하나도 만들지 않았다** — 괄호 짝 6단은 문법 팔레트를, 스크롤바 3단은 CSS 스크롤바와 같은 농도 규칙(`withAlpha`)을 돌려 쓴다.

곁다리로 이 다리에서 결함 둘이 나왔다.

- **알파를 버리고 있었다.** `toHex` 의 rgba 분기가 r·g·b 셋만 집어 돌려줬는데, 이 다리가 굽는 값의 절반은 `color-mix(…, transparent)` 다(활성 줄 5% · 선택 20% · 같은 낱말 12% · 검색 일치 35%). 알파가 곧 그 토큰의 전부인 값들이다. `#rrggbbaa` 로 보존하게 고쳤다.
- **지금 걸린 일치와 나머지 일치가 같은 색이었다.** `findMatchBackground` 와 `findMatchHighlightBackground` 가 둘 다 `--code-search-match` 라, ⏎ 로 다음 일치로 넘어가도 어디로 갔는지 화면이 말해 주지 않았다. 토큰은 처음부터 두 벌(`-match` / `-current`)이었는데 한 벌만 쓰고 있었다.

**5. 죽은 임포트 하나.** `setup.ts` 가 `linkedEditing` 기여를 싣지만 Monaco 기본값이 false 라 아무 일도 안 하고 있었다 — `options.ts` 머리가 경고하는 바로 그 모양이 이미 한 번 일어나 있었다. 켜면서 같은 성격의 셋을 함께 채웠다: `cursorSurroundingLines: 3`(scrolloff — 맨 아랫줄에서 다음 줄이 보인다), `stickyTabStops`(탭 들여쓰기에서 ←/→ 가 탭 한 칸씩), `suggest: { preview, showStatusBar }`(넣기 전에 무엇이 들어갈지 보인다). 넷 다 `monaco_options.test.ts` 가 문다.

## 검증

`pnpm typecheck` · `lint:design`(clean) · `lint:storage` · `lint:bindings` · `lint:filesize` 전부 exit 0. `code_*` + `monaco_*` 33파일 437테스트 통과(옵션 4건 신규), `design_tokens` 포함 34파일 497통과. 이 라운드가 더한 여백 리터럴은 순감(제거 9 : 추가 3)이라 `ramp-space` 예산을 밀지 않는다. 병렬 세션이 같은 워킹트리에서 여백 토큰 라운드를 돌고 있어 `tokens.css`·설정·i18n 은 건드리지 않았다 — 그래서 워드랩 토글은 이번에 넣지 않았다(설정 키가 필요하고, 그 파일들이 지금 저쪽 손에 있다).