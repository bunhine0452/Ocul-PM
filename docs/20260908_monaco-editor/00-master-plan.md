# Monaco 이관 — 편집기를 VS Code 급으로

> **SSOT.** 이 폴더가 이 라운드의 정본이다. 플랜은
> [`.oculpm/planner/monaco-editor-round.md`](../../.oculpm/planner/monaco-editor-round.md).
> 코드가 문서를 이긴다 — 어긋나면 코드가 맞고 이 문서를 고친다.

## 왜 포크가 아닌가

출발점은 "편집기를 Cursor·Antigravity 급으로" 였고, 첫 후보는 VS Code 대규모
포크(`/Users/kimhyunbin/Desktop/source_code_of_the_world/vscode`, `code-oss-dev`
1.137.0, 1.7GB)였다. **기각했다.** 네 가지가 각각 단독으로도 치명적이다.

1. **Tauri 를 버려야 한다.** VS Code 워크벤치(`src/vs/workbench`)는 라이브러리가
   아니라 Electron 애플리케이션이다. 렌더러의 node integration, main/renderer
   프로세스 모델, 네이티브 모듈(node-pty · @vscode/ripgrep · spdlog ·
   native-watchdog)을 전제한다. WKWebView 에 못 올린다. 포크는 곧 **앱 전체를
   Electron 으로 재작성**이다 — Rust 113,729줄은 사이드카로 밀려나고 TS 133,906줄
   (16화면)은 VS Code 의 DI/contribution 체계로 다시 이식된다. 번들 ~25MB → ~250MB.
2. **마켓플레이스를 못 쓴다.** MS 마켓플레이스 ToS 는 마이크로소프트 제품 외
   사용을 금지한다 — Cursor · Windsurf · Trae 전부 Open VSX 로 간다. Pylance ·
   C/C++ · C# · Remote-SSH 는 proprietary 라 못 가져온다. "VS Code 급"의 실체가
   확장 생태계인데, 포크로 얻는 것은 **바로 그 부분이 빠진 VS Code** 다.
3. **유지비.** VS Code 는 매달 릴리스한다. 워크벤치를 건드린 포크의 리베이스는
   Anysphere 가 전담 팀을 두는 일이다. 이 저장소는 1인이 굴린다.
4. **제품이 뒤집힌다.** Cursor 는 편집기가 제품 전부다. Ocul-PM 은 "에이전트가 한
   일을 기록하는 로컬 우선 PM"이고 편집기는 그중 한 화면이다. 포크하면 일지·
   플래너·논의·변경·그래프가 확장으로 강등되고 제품의 중심이 남의 코드베이스가 된다.

**Monaco 는 이 넷을 하나도 내지 않는다.** VS Code 의 **에디터 위젯 그 자체**이고
(`microsoft/monaco-editor`, 현재 0.56.0, MIT, npm), Tauri·Rust 백엔드·`lsp_*`
17개 커맨드를 전부 그대로 둔 채 갈아끼울 수 있다.

그리고 Cursor 의 **실제** 차별점(⌘K 인라인 편집 · Tab 다음-편집 예측 · hunk 단위
승인)은 VS Code 에 **없는** 것이라 포크해도 직접 만들어야 한다. 이 앱은 ACP 로
Claude Code · Codex 가 이미 붙어 있어 그 재료를 갖고 있다.

## 실측 — 이관 표면은 13.8k 줄이 아니다

`features/code/` 는 13,819줄이지만 **CodeMirror 를 실제로 만지는 곳은 9파일
2,185줄**이다. 나머지는 트리·탭·버퍼·문제 패널·디버그처럼 편집기 위에 얹힌 층이라
이관과 무관하다.

| 파일 | 줄 | 이관 후 |
|---|---|---|
| `code/CodeEditor.tsx` | 572 | **다시 쓴다** (props 계약은 그대로) |
| `discussion/DiscussionEditor.tsx` | 436 | **다시 쓴다** (마크다운) |
| `code/stickyScroll.ts` | 229 | **삭제** — Monaco 내장 |
| `code/lspBridge.ts` | 198 | 변환부만 남기고 CM 타입 제거 |
| `code/signatureTooltip.ts` | 172 | **삭제** — Monaco 내장 |
| `code/codeLang.ts` | 137 | Monarch 언어 id 매핑으로 축소 |
| `code/breakpointGutter.ts` | 99 | glyph margin 데코레이션으로 재작성 |
| `code/gitGutter.ts` | 86 | line 데코레이션으로 재작성 |
| `code/stickyModel.ts` | 152 | **삭제** 후보 (내장이 대체하면) |

`code.css` 2,510줄 중 `.cm-*` 규칙은 **44개**뿐이다 — 나머지는 트리·탭·패널이라
그대로 산다.

**이관은 순증이 아니라 순감이다.** 손으로 만든 sticky scroll · signature tooltip ·
검색 패널이 Monaco 내장으로 대체된다.

## 지금 편집기에 없는 것 (이관이 공짜로 주는 것)

LSP 17개 커맨드와 DAP 디버거는 있는데 CodeMirror 기본기가 비어 있다. 실측:

```
foldGutter / codeFolding      0        multipleSelections   0
bracketMatching               0        closeBrackets        0
indentOnInput                 0        highlightSelectionMatches 0
```

Monaco 는 이것들에 더해 미니맵 · 브래킷 쌍 색칠 · peek definition · 시맨틱 토큰 ·
인라인 diff · find/replace 위젯 · 다중 커서 · 열 선택을 **기본으로** 들고 온다.

## 결정

### D1 — Monaco 내장 언어 워커는 끈다 {#d1-no-language-workers}

Monaco 는 TS/JS · JSON · CSS · HTML 의 IntelliSense 를 자체 웹 워커로 제공한다.
**켜지 않는다.**

- 이미 `lsp_*` 커맨드 17개와 실서버(rust-analyzer · tsserver …)가 붙어 있다.
  켜면 완성·호버·진단이 **두 벌** 붙어 서로를 덮는다.
- ~~번들이 ~2MB 늘어난다 (TS 언어 서비스가 통째로 실린다).~~
  **정정 (Phase 0 실측)** — 여는 청크 차이는 **99KB(gzip 22KB)** 뿐이다. 진짜 차이는
  워커 파일 쪽 **9.2MB**(`ts.worker` 혼자 7.03MB)이고 그마저 지연 로드다. 즉 이 근거는
  "여는 순간의 번들"이 아니라 **`.dmg` 페이로드**로 다시 읽어야 한다.
  → [`01-spike.md`](01-spike.md#d1-정정)
- 문법 강조는 **Monarch** 가 워커 없이 한다 — 강조만 얻고 지능은 LSP 단일 소스로.

`editor.worker` 하나만 남긴다 (Monaco 코어가 요구하는 기본 서비스).

⚠️ **`editor.api` 만 임포트하면 안 된다.** 0.56 에는 `editor.all.js` 가 없고 기여
(contribution) 목록이 `editor.main.js` 안에 인라인으로 있다. `editor.api` 만 부르면
폴딩·검색·다중커서·sticky·괄호매칭이 하나도 등록되지 않는다. 올바른 형태는
`editor.api` + **기여 74개** + Monarch 언어, `languages/features/*` 만 제외.

#### D1a — JSON·TOML 은 Monarch 를 직접 쓴다 {#d1a-json-toml}

Monaco 0.56 의 Monarch 문법 84종에 **`json` 이 없고**(워커를 쓰는 `vs/language/json`
서비스 전용) **`toml` 은 아예 없다**. 지금 편집기는 `@codemirror/lang-json` ·
`legacy-modes/mode/toml` 로 둘 다 강조하므로 그대로 두면 회귀다.

**결정(2026-09-08): Monarch 문법 둘을 직접 작성한다** (각 30~50줄). 워커 0개 규약이
깨지지 않고 TOML 까지 함께 해결된다. `json.worker` 를 예외로 켜는 안은 기각 —
+404KB 에 완성·진단 이중화를 막는 배선이 또 붙고 TOML 은 여전히 무채색이다.

**완료 (Phase 2)** — `monaco/langExtra.ts`. `monaco_contributions.test.ts` 가
"우리가 직접 든 것은 json·toml 뿐이고 그 둘은 정말 0.56 에 없다" 를 문다.
→ [`02-reclaim.md`](02-reclaim.md#d1a-done)

### D2 — props 계약은 그대로 둔다 {#d2-same-contract}

`CodeEditorProps`(572줄 파일의 상단 75줄)는 이미 잘 정의된 이음매다 —
`initialText` · `jump` · `diagnostics` · `onComplete` · `onHover` ·
`onGoToDefinition` · `onRename` · `onCodeActions` · `onReferences` · `onFormat` ·
`onSignatureHelp` · `stickyMaxLines` · `gitChanges` · `diffOriginal` ·
`breakpoints` · `onToggleBreakpoint`.

**이 인터페이스를 한 줄도 바꾸지 않고 구현만 갈아끼운다.** 그러면 `CodePane.tsx`
(1,800줄)와 그 위 전부가 무변경이고, 회귀 범위가 파일 하나로 좁혀진다.

**Phase 1 에서 지켜졌다** (테스트 2,451개가 한 줄도 안 고치고 통과). D2 는 그
회귀 범위를 좁히는 **장치**였고 목적은 거기서 끝난다 — Phase 2 는 `onGoToSymbol`
하나를 늘렸다. 심볼 공급자가 켜는 Monaco 내장 ⇧⌘O 가 우리 `CodeGoto` 를 가리는
것을 막는 자리다. → [`02-reclaim.md`](02-reclaim.md#shadow-quick-outline)

언컨트롤드 규약("마운트 후엔 부모가 초깃값만 주고, 외부 갱신은 key 재마운트")도
그대로 간다 — 양방향 동기화가 편집기와 React 상태를 서로 되돌리게 만드는 고전적
버그의 근원이라는 판단은 Monaco 에서도 유효하다.

### D3 — 런타임 플래그 없이 브랜치에서 한 번에 {#d3-no-flag}

이음매가 파일 하나라 두 편집기를 동시에 싣는 비용(번들 2벌 · 테마 2벌 · 키맵 2벌)
이 병행의 이득보다 크다. 브랜치에서 갈아끼우고 게이트로 잠근다.

### D4 — 논의 편집기도 함께 옮긴다 {#d4-discussion-too}

`DiscussionEditor.tsx` 는 마크다운용 CodeMirror 다. 함께 옮겨 **CodeMirror 의존성을
완전히 끊는다** — 테마·키맵·검색 위젯이 한 벌이 된다.

**완료 (Phase 4).** 테마가 한 벌이 되면서 하나 배웠다: Monaco 의 테마는 **전역**
이라 두 편집기가 서로 다른 테마를 동시에 못 쓴다. 그래서 규칙을 한 테마에 싣고
`.md-prose` 접미사로 갈랐다. → [`04-discussion.md`](04-discussion.md#one-theme)

⚠️ **충돌 주의**: 2026-09-08 현재 병렬 세션이 논의 화면(`DiscussionScreenV2.tsx` ·
`discussion.rs`)의 CAS 손실 수정을 미커밋으로 들고 있다. 이 Phase 는 **그 작업이
머지된 뒤에** 시작한다.

### D5 — 에이전트 편집면은 같은 플랜의 뒷 Phase {#d5-agent-surface}

⌘K 인라인 편집과 hunk 단위 승인은 Monaco 가 안정된 뒤 같은 플랜에서 잇는다.
Monaco 의 inline-diff 위젯과 ACP(Claude Code · Codex)가 재료다.
**Tab 다음-편집 예측은 별도 항목**으로 남긴다 — 전용 모델 · 지연시간 예산 ·
취소 병합까지 설계가 따로 필요하고, 그 불확실성이 이관 일정을 오염시키면 안 된다.

## 위험

### R1 — WKWebView {#r1-wkwebview}

Monaco 의 WKWebView 실패 사례는 **전부 2021년경**이다: 0.22.0 이 macOS 10.15 이하에서
로드 실패([#2457](https://github.com/microsoft/monaco-editor/issues/2457)), Safari
13.1 미디어쿼리 이벤트 문제([#2432](https://github.com/microsoft/monaco-editor/issues/2432)),
WebKit 컨트롤에서 마지막 줄만 클릭되던
것([#1255](https://github.com/Microsoft/monaco-editor/issues/1255)). 개발기는
macOS 26.6.2 라 무관할 가능성이 높지만 **추정으로 넘기지 않는다** — Phase 0 의
스파이크가 실기기에서 답한다.

~~`tauri.conf.json` 에 `minimumSystemVersion` 이 **없다** (Tauri 2 기본값이 적용된다).~~

**해결 (2026-09-08): `"minimumSystemVersion": "13.0"` 을 박았다.** 하한을 정하는 것은
Monaco 가 아니라 **우리 Vite 타깃**이었다 — Vite 7 기본값 `baseline-widely-available`
에 `safari16` 이 들어 있어, Monaco 와 무관하게 **이 앱은 이미 macOS 13 을 요구하고
있었다**. Tauri 기본값 10.13 은 지키지 못할 약속이었고, 그 사용자는 설치에 성공한 뒤
흰 화면을 봤다. Monaco 소스의 `static {}`(524곳, Safari 16.4)은 esbuild 가 전부
낮추므로 구속 조건이 아니다. 낮출 수 없는 것은 런타임 API(`Object.hasOwn` · `.at` ·
`findLast`, Safari 15.4)뿐이다. → [`01-spike.md`](01-spike.md#r1-minmacos)

### R2 — 한국어 IME {#r2-ime}

이 저장소는 IME 회귀로 이미 데었다 (터미널 xterm 5.3→5.5 릴리스 검증). WKWebView 의
조합 이벤트는 Chrome 과 다르게 움직인다. **Phase 0 에서 한글 입력을 먼저 본다** —
여기서 깨지면 이관 자체를 재고한다.

### R3 — 워커 · Vite {#r3-workers}

Monaco 는 ESM + 웹 워커다. Vite 에서는 `vite-plugin-monaco-editor` 계열을 쓰거나
`self.MonacoEnvironment.getWorker` 를 직접 구현한다 — **둘을 섞으면 안 된다.**
0.22.0 이후 ESM 판은 `globalAPI: true` 가 없으면 전역 `monaco` 를 만들지 않는다.
D1 로 워커가 `editor.worker` 하나뿐이라 설정이 단순해진다.

`tauri.conf.json` 의 `csp` 는 `null` 이라 워커 로드를 막지 않는다
(v3-release `{#webview-csp}` 가 이 사실을 이미 기록했다) — CSP 를 켜는 날 워커
출처를 함께 넣어야 한다.

### R4 — 테마 {#r4-theme}

지금은 `.cm-*` 클래스가 `--code-*` 변수를 참조해 `data-theme`/`data-preset` 전환이
**리마운트 없이** 먹는다. Monaco 는 테마를 JS API(`defineTheme`)로 받고 CSS 변수를
직접 읽지 않는다. 그래서 전환 시 계산된 변수값을 읽어 `defineTheme` 을 다시 부르는
다리가 필요하다. 프리셋 5종 × 라이트/다크를 전부 봐야 한다
(v3-release `{#eyes-hljs}` 와 같은 격자).

### R5 — 번들 {#r5-bundle}

현재 `CodeScreenV2` 청크는 335KB. Monaco 코어는 그보다 크다. 이미 lazy 청크라
안 여는 사용자에게는 비용이 안 가지만, **여는 순간의 지연**은 측정해서
`03-performance` 에 남긴다. D1 로 언어 워커를 빼는 것이 이 항목의 가장 큰 레버다.

## Phase 요약

플랜의 정본은 `.oculpm/planner/monaco-editor-round.md` 다. 여기서는 순서의 이유만
적는다.

- **Phase 0 스파이크** — 버리는 코드로 WKWebView·IME·워커·번들을 먼저 답한다.
  R1~R3 이 여기서 붉으면 뒤 Phase 를 안 쓴다.
- **Phase 1 이식** — `CodeEditorProps` 를 만족하는 Monaco 구현. 계약이 같으므로
  기존 테스트가 그대로 판정자다.
- **Phase 2 회수** — 손으로 만든 sticky/signature 를 내장으로 갈아치우고 삭제.
  검색 패널은 **자리가 달라 대체 불가**로 닫았다 (프로젝트 전역 vs 문서 하나).
  → [`02-reclaim.md`](02-reclaim.md)
- **Phase 3 새 능력** — 지금 없는 기본기(폴딩·다중커서·미니맵·peek)를 켠다.
- **Phase 4 논의 편집기** — 병렬 세션 머지 후. CodeMirror 의존성 제거.
  **완료** — `@codemirror/*` 와 `@lezer/highlight` 가 `package.json` 에서 사라졌다.
  → [`04-discussion.md`](04-discussion.md)
- **Phase 5 에이전트 편집면** — ⌘K · hunk 승인.
- **Phase 6 마감** — 육안 확인 격자 · 릴리스 5면.
