---
schema_version: 1
type: bug
slug: "terminal-ime-and-quality-round"
status: done
difficulty: high
created_at: "2026-07-30T18:00:11+09:00"
session_id: "mcp-20260730-180011"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/imeBridge.ts"
    op: create
  - path: "src/features/terminal/termTheme.ts"
    op: create
  - path: "src/features/terminal/tabTitle.ts"
    op: create
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/__tests__/terminal_quality_round.test.ts"
    op: create
related: []
tags:
  - "terminal"
  - "xterm"
  - "ime"
  - "webgl"
  - "theme"
  - "font"
  - "mcp-tool"
---
[x] 내장 터미널 한글 IME 조합 파괴 수정 + 렌더·폰트·테마 품질 라운드

사용자 보고: "내장 터미널이 아직도 한국어가 제대로 안 쳐짐. 그리고 터미널 퀄리티가 맘에 들지 않음."
증상 확인 결과 **자음·모음이 한 글자로 합쳐지지 않고 낱자로 확정되며, 모음이 자주 유실**. 2026-07-16 LANG 로케일 보장, 2026-07-20 D2Coding 선두 폭 정합으로도 잡히지 않았다.

(스타일 변경도 함께 있었다: `src/styles/tokens.css`, `src/styles/screens.css`, `src/App.css`, `package.json` — 일지 files_touched 정책상 목록에서 제외.)

## 발생 원인

서로 다른 원인 4개가 겹쳐 있었다.

**1. IME — xterm CompositionHelper 가 조합 중 textarea 를 움직인다 (핵심)**

`compositionupdate` 마다 `updateCompositionElements()` 가 숨은 textarea 의 `left/top/width/height` 를 다시 쓰고 `setTimeout(0)` 으로 한 번 더 쓴다. WebKit 은 **조합 중인 textarea 의 지오메트리가 바뀌면 조합 컨텍스트를 리셋**하므로, 낱자마다 `compositionend` 가 튀어 따로 확정됐다.
모음 유실은 `_handleAnyTextareaChanges()` 가 `setTimeout(0)` + 문자열 diff(`newValue.replace(oldValue, "")`)로 입력을 추정하는 알려진 버그(xterm.js #5887, #5894). Chromium(Electron)에서는 두 경로 모두 무해해 VS Code 등에선 드러나지 않고, WKWebView 에서만 터진다.

**2. 글리프 폭 — 번들 폰트 서브셋 구멍**

`D2Coding-subset.woff2` 커버리지를 fontTools 로 실측: ASCII 95/95, 한글 11172/11172, Box Drawing 128/128 은 있으나 **Block Elements 0/32 (█▀▄░▒▓) · Geometric Shapes 0/96 (●■▶◆) · Dingbats 0/192 (✓✗) · Braille 0/256** 이 통째로 비었다. 셀 폭은 선두 폰트 D2Coding 기준 0.5em 인데 빠진 글리프만 폴백(0.6em)으로 새면서 그 줄 전체가 밀렸다 — Claude Code 배너 아트와 박스 테두리가 어긋나 보이던 원인. 원본 D2Coding(.ttc)에는 전부 0.5em 로 존재하므로 서브셋 생성 시 범위 누락이다.

**3. 테마 — 하드코딩 다크 한 벌**

xterm 테마가 `TerminalInstanceImpl` 의 `TERM_THEME` 상수였고 터미널 크롬 CSS 도 `#101014`/`#16161c`/`#26262e` 리터럴이라, 라이트·Solarized·Sepia 를 골라도 터미널만 새까맣게 남았다.

**4. 단축키 충돌**

`useGlobalShortcuts` 가 ⌘1~⌘9·⌘0 을 화면 이동에 쓰는데 터미널도 ⌘0 을 글자 크기 초기화로 잡고 있었다. 두 리스너 모두 `window` 라 `preventDefault()` 만으로는 서로를 막지 못해, 터미널에서 ⌘0 을 누르면 **초기화와 화면 이탈이 동시에** 일어났다.

## 해결 방법

**IME (`src/features/terminal/imeBridge.ts` 신설)** — 조합 처리를 xterm 에게서 회수했다.

- `compositionstart/update/end` 를 컨테이너에서 **캡처 단계**로 가로채 `stopPropagation()`. textarea 에 걸린 xterm 리스너까지 내려가지 않으므로 CompositionHelper 는 조합 사실 자체를 모르고, 따라서 textarea 를 건드리지 않는다.
- 조합 미리보기는 `.term-ime` 오버레이로 커서 위치에 직접 그린다.
- 확정 문자열은 `compositionend` 의 `data` 를 그대로 `term.input()` 으로 보낸다 — diff 추정 없음.
- `attachCustomKeyEventHandler` 가 조합 중 keydown(`isComposing` / `keyCode 229` / `key "Process"`)에 false 를 돌려 xterm 이 `preventDefault()` 하지 못하게 막는다.
- 조합 중 Enter 는 Terminal.app 처럼 "확정 + 실행"이 되도록 확정 직후 CR 을 잇고, WebKit 이 Enter keydown 을 한 번 더 흘릴 때를 위해 50ms 중복 방지 창을 둔다. `blur` 에서 조합 플래그를 반드시 푼다(갇히면 전 키가 먹통).

**폰트** — 서브셋을 다시 만드는 대신 역할을 나눴다. 라틴·기호·박스문자는 그 범위를 전부 0.6021em 로 커버하는 **Menlo** 가 맡고, `D2Coding Term` 이라는 별도 `@font-face` 를 `unicode-range` 로 한글/전각에만 적용한다. D2Coding 한글은 1.0em 이라 Menlo 두 셀(1.2042em)에 못 미치므로 `size-adjust: 120.4%` 로 폭을 맞춘다. 폰트 파일과 번들 크기는 그대로.

**렌더러** — WebGL 로 승격(`@xterm/addon-webgl`, 지연 로드 별도 청크 110KB). DOM 렌더러는 실제 텍스트 레이아웃을 쓰기 때문에 폴백 글리프 폭 차이가 줄 전체로 누적되지만, WebGL 은 셀 단위로 그려 밀림이 전파되지 않는다. 출력이 많을 때의 버벅임도 함께 해소. 미지원·컨텍스트 소실 시 `dispose()` 로 DOM 렌더러 복귀.

**테마 (`termTheme.ts` 신설)** — 색의 SSOT 를 `tokens.css` 의 `--term-*` 로 옮겼다. 표면·커서·선택은 기존 테마 토큰을 물려받고 ANSI 16색만 라이트/다크 가족별로 정의한다. `<html>` 의 `data-theme`/`data-preset`/`data-accent` 를 MutationObserver 로 관찰해 테마 전환을 실시간 반영. 터미널 크롬 CSS 의 하드코딩 다크도 전부 토큰으로 교체.

**기능 보강**

- 검색: `decorations` 로 전체 일치 하이라이트 + `onDidChangeResults` 기반 "3/17" 카운터(일치 없음·한계 초과 표시 포함), 닫을 때 하이라이트 정리.
- 탭 자동 이름: 셸 OSC 0/2 제목을 `tabTitle.ts` 가 정규화(`kim@mac: ~/src/ai-pm` → `ai-pm`). 사용자가 직접 지은 이름은 기본 라벨 패턴 검사로 보존 — `TerminalTab` 스키마 변경 없음.
- ⌘L 화면 지우기(⌘K 는 전역 팔레트가 선점), 글자 크기 초기화를 ⌘0 → ⇧⌘0 으로 이동해 전역 네비게이션 충돌 해소.
- 스크롤백 5,000 → 20,000줄.

## 검증

- `pnpm typecheck` / `pnpm test`(34파일 225건) / `pnpm lint` / `pnpm build` 전부 exit 0.
- 신규 `terminal_quality_round.test.ts` 17건 통과 — 탭 제목 정규화·자동 이름 보존 규칙·검색 카운터 포맷·테마 토큰 파생과 폴백·검색색 #RRGGBB 강제.
- 폰트 커버리지와 advance 는 fontTools 로 원본·서브셋을 직접 실측해 근거를 확보(추정 아님).
- **미검증(사용자 확인 필요): 실기기에서의 실제 한글 조합 타이핑.** WKWebView 조합 이벤트와 GPU 컨텍스트는 jsdom 에서 재현할 수 없어 자동 검증 범위 밖이다.