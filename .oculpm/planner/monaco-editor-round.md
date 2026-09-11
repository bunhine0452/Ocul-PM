---
oculpm_plan: v1
id: monaco-editor-round
title: "Monaco 이관 — 편집기를 VS Code 급으로"
status: active
created: 2026-09-08
updated: 2026-09-08
owner: claude-code
---

VS Code 대규모 포크(Cursor 방식)를 기각하고 CodeMirror → Monaco 로 간다. SSOT 는 docs/20260908_monaco-editor/00-master-plan.md. 이관 표면은 features/code 13,819줄이 아니라 CodeMirror 를 실제로 만지는 9파일 2,185줄이고, `CodeEditorProps` 가 그대로 이관 계약이라 CodePane(1,800줄) 위로는 무변경이다. 손으로 만든 sticky scroll·signature tooltip·검색 패널이 내장으로 대체되므로 순증이 아니라 순감이다.

## Phase 0 — 스파이크: 붉으면 여기서 멈춘다 {#spike}
- [x] 버리는 브랜치에 Monaco 0.56 을 최소 마운트해 **실기기 WKWebView** 에서 띄운다 — 클릭·선택·스크롤·커서가 정상인가. 실패 사례(#2457·#2432·#1255)는 전부 2021년 macOS 10.15/Safari 13.1 대라 무관할 공산이 크지만 추정으로 넘기지 않는다 {#spike-wkwebview}
  - [x] Monaco 가 요구하는 하한을 확인하고 `tauri.conf.json` 에 `minimumSystemVersion` 을 명시한다 — 지금 값이 아예 없어 Tauri 2 기본값에 맡겨져 있다 {#spike-min-macos}
- [x] **한국어 IME 조합** — 조합 중 커서·중복 입력·조합 취소. 이 저장소는 터미널 xterm 업그레이드에서 IME 로 이미 데었다. 여기서 깨지면 이관 자체를 재고한다 {#spike-ime}
- [x] Vite 워커 배선 — `vite-plugin-monaco-editor` 계열 vs `self.MonacoEnvironment.getWorker` 직접 구현 중 하나를 고르고 **섞지 않는다**. D1 로 `editor.worker` 하나뿐이라 단순해야 정상. ESM 판은 `globalAPI: true` 없이는 전역 monaco 를 안 만든다는 점 확인 {#spike-workers}
- [x] 번들 실측 — 현재 `CodeScreenV2` 청크 335KB 대비 증가분과 **화면 여는 순간의 지연**을 잰다. 언어 워커를 끈 상태(D1)와 켠 상태를 둘 다 재서 D1 의 근거를 숫자로 남긴다 {#spike-bundle}
- [x] 판정 — R1~R3 중 하나라도 붉으면 뒤 Phase 를 쓰지 않고 대안(CodeMirror 기본기 채우기)으로 되돌린다. 결과를 `docs/20260908_monaco-editor/01-spike.md` 에 남긴다 {#spike-verdict}

## Phase 1 — 이식: props 계약을 한 줄도 안 바꾸고 구현만 간다 {#port}
- [x] `CodeEditor.tsx` 를 Monaco 로 다시 쓴다 — `CodeEditorProps` 16개 prop 을 전부 만족시킨다. 언컨트롤드 규약(부모는 초깃값만, 외부 갱신은 key 재마운트)도 유지 — 양방향 동기화가 편집기와 React 상태를 서로 되돌리는 병리는 Monaco 에서도 같다 {#port-shell}
- [x] LSP 공급자 배선 — `onComplete`·`onHover`·`onSignatureHelp` 를 Monaco 의 CompletionItemProvider·HoverProvider·SignatureHelpProvider 로. `lspBridge.ts` 의 변환부는 살리고 CM 타입 의존만 걷는다 {#port-lsp}
  - [x] `diagnostics` → `monaco.editor.setModelMarkers`. 지금처럼 **재구성 없이 트랜잭션으로만** 반영되는지 확인 {#port-diagnostics}
  - [x] F12·⇧F12·F2·⌘.·⇧⌥F·⌘S 를 Monaco action 으로 재등록 — 이동·이름바꾸기·코드액션·포맷의 **실행은 여전히 부모(CodePane)** 가 한다 {#port-commands}
- [x] `jump` one-shot 계약 — 1-based 라인 + UTF-16 `ch`/`len` 선택 + `focus:false`(⇧⌘O 미리 점프가 자기 입력창을 안 뺏는 경로). 매번 새 객체라 같은 줄 재점프도 발화해야 한다 {#port-jump}
- [x] 거터 재작성 — `gitGutter.ts`(HEAD 대비 줄 변경)는 line 데코레이션으로, `breakpointGutter.ts`(1-based DAP 규약·미검증 줄 구분)는 glyph margin 으로 {#port-gutters}
- [x] `diffOriginal` 인라인 비교 — 지금은 `@codemirror/merge` 의 unifiedMergeView(지워진 줄이 빨간 블록으로 끼어들고 청크마다 되돌리기 버튼)다. Monaco 인라인 diff 로 같은 동작을 낸다 {#port-diff}
- [x] 테마 다리 — Monaco 는 `defineTheme` 를 JS 로 받고 CSS 변수를 안 읽는다. `data-theme`/`data-preset` 전환 시 계산된 `--code-*` 12개를 읽어 테마를 다시 정의하는 경로를 만든다 (지금은 리마운트 없이 먹던 것이라 회귀하면 눈에 띈다) {#port-theme}
- [x] 기존 코드 화면 테스트 30개(5,499줄)를 판정자로 삼아 초록으로 만든다 — 계약이 같으므로 테스트를 고쳐야 한다면 그건 계약이 샜다는 신호다 {#port-tests}

## Phase 2 — 회수: 손으로 만든 것을 내장으로 갈아치우고 지운다 {#reclaim}
- [x] `stickyScroll.ts`(229줄) + `stickyModel.ts`(152줄) 삭제 → Monaco 내장 sticky scroll. `stickyMaxLines`·`stickySymbols`·`tabSize` prop 의 뜻을 내장 옵션으로 옮긴다 {#reclaim-sticky}
- [x] `signatureTooltip.ts`(172줄) 삭제 → Monaco 내장 시그니처 위젯 {#reclaim-signature}
- [x] `CodeSearchPanel.tsx`(16KB) 를 Monaco find/replace 위젯으로 대체할 수 있는지 판정 — ⇧⌘F 전역 검색(별도 화면)과는 다른 자리다. 대체 못 하면 이유를 적고 남긴다 {#reclaim-search}
- [x] `codeLang.ts`(137줄) 를 Monarch 언어 id 매핑으로 축소 — `@codemirror/lang-*` 10개와 `legacy-modes` 의존성 제거 {#reclaim-lang}
- [x] `code.css` 의 `.cm-*` 규칙 44개 정리 — 나머지 2,466줄(트리·탭·패널)은 건드리지 않는다 {#reclaim-css}

## Phase 3 — 새 능력: 지금 아예 없는 기본기 {#capabilities}
- [x] 실측으로 **0** 인 것들을 켠다 — 코드 폴딩 · 괄호 매칭 · 자동 괄호 닫기 · 선택 일치 강조 · 입력 시 들여쓰기. 지붕(LSP 17커맨드·DAP)은 올렸는데 바닥이 비어 있던 자리다 {#cap-basics}
- [x] 다중 커서 · 열(블록) 선택 — ⌥클릭 · ⌘D 다음 일치 추가 · ⌥⇧드래그 {#cap-multicursor}
- [x] 미니맵 · 브래킷 쌍 색칠 · 들여쓰기 가이드. 설정에 켜기/끄기를 둘지 판단 (기본값은 켬) {#cap-minimap}
- [x] peek definition/references — 지금은 ⇧F12 가 화면 폭 패널을 그린다. 인라인 peek 이 그 패널을 대체할지, 둘 다 남길지 결정한다 {#cap-peek}
- [x] 시맨틱 토큰 — LSP `semanticTokens` 를 백엔드에 없으면 추가하고 Monaco 에 물린다. 없으면 이 항목은 Monarch 강조로 만족하고 닫는다 {#cap-semantic}

## Phase 4 — 논의 편집기: CodeMirror 의존성 완전 제거 {#discussion}
- [x] **선행 조건** — 병렬 세션의 논의 CAS 손실 수정(`DiscussionScreenV2.tsx` 852줄 · `discussion.rs` · 새 테스트 2개)이 머지될 때까지 시작하지 않는다. 같은 파일을 두 세션이 고치면 한쪽이 조용히 사라진다 {#disc-wait}
- [x] `DiscussionEditor.tsx`(436줄) 를 Monaco 마크다운으로 — placeholder · 히스토리 · 검색 · 마크다운 강조가 지금 CM 에서 오는 것들이다 {#disc-port}
- [x] `package.json` 에서 `@codemirror/*` 18개 + `codemirror` + `@lezer/highlight` 제거. 이 줄이 지워지는 것이 이 라운드의 완료 신호다 {#disc-drop-cm}
- [x] `DiscussionScreenV2.tsx` 파일 크기 래칫 — 병렬 세션이 `conflict.ts`·`useDiscussionSave.ts` 로 쪼개 796줄로 내려놨다(2026-09-08 확인). 편집기 배선을 갈아끼우며 다시 넘기지 않는지만 본다 {#disc-filesize}

## Phase 5 — 에이전트 편집면 (Cursor 의 진짜 차별점) {#agent-surface}
- [x] ⌘K 인라인 편집 — 선택 범위에 지시를 주면 그 자리에서 고쳐 보여 준다. ACP(Claude Code · Codex)가 이미 붙어 있어 전송 경로는 있고, Monaco 의 inline-diff 위젯이 표시를 맡는다 {#agent-cmdk}
- [x] hunk 단위 승인 — 에이전트가 만든 diff 를 편집기 안에서 조각별로 받기/버리기. 지금 `diffOriginal` 이 그리는 청크 되돌리기 버튼의 확장이다 {#agent-hunk}
- [x] 귀속 — ⌘K 로 들어간 편집이 일지·`entry_diffs` 에 **누가 고쳤는지** 남는가. 이 앱의 존재 이유가 기록이라 편집기가 기록을 빠뜨리면 안 된다 {#agent-attribution}
- [>] **Tab 다음-편집 예측은 이 라운드에서 열지 않는다** — 전용 모델 · 지연시간 예산 · 취소 병합 · 오답 비용까지 설계가 따로 필요하다. 여기 항목으로만 남겨 유실을 막는다 (이월은 살아 있는 플랜의 항목으로) {#agent-tab-predict}

## Phase 6 — 마감 {#finish}
- [!] 육안 확인 격자 — 라이트/다크 × 프리셋 5종으로 문법 강조 · 선택색 · 커서 · 미니맵 · sticky · 진단 밑줄. v3-release `{#eyes-hljs}` 가 이미 같은 격자를 요구하고 있어 한 번에 갚는다 {#fin-eyes}
- [!] 성능 재측정 — 대용량 파일(수천 줄) 열기 · 스크롤 · 타이핑 지연. Phase 0 의 숫자와 대조해 `03-performance.md` 에 남긴다 {#fin-perf}
- [x] 게이트 전부 exit 0 직접 확인 — typecheck · test · lint 6종 · build · cargo test. 파일 크기 래칫과 eslint 경고 한계(`--max-warnings`)에 여유가 없으니 함께 본다 {#fin-gates}
- [x] 릴리스 5면 — 버전 6파일 · CHANGELOG · README ko/en · 랜딩 ko/en 각 6곳 + `build.mjs` 재빌드. **회고·문서 삭제(2026-09-08)의 미반영분도 이때 함께 간다** — 그 표면들은 아직 두 화면이 있는 v2.45.2 를 설명하고 있다 {#fin-release}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-08T19:45:27+09:00 | #spike-ime | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | 초록 — textarea·CodeMirror·Monaco 3자 비교에서 결과 완전 동일. 1라운드 붉음은 기대값 오류(조합 중 ←는 IME 확정키) |
| 2026-09-08T19:45:33+09:00 | #spike-workers | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | MonacoEnvironment.getWorker 직접 구현 채택. globalAPI 불필요 확인. 0.56 은 esm/vs 경로가 죽어 monaco-editor/editor/... 로 써야 한다 |
| 2026-09-08T19:45:39+09:00 | #spike-bundle | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | D1 3,864,710B/gzip 995,510 · 여는 지연 221ms. D1 근거 정정: 청크 차이는 99KB뿐이고 진짜는 워커 9.2MB |
| 2026-09-08T19:45:44+09:00 | #spike-verdict | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | R1·R2·R3 초록, R5 노랑 → 이관 진행. 01-spike.md 작성. 미결 2: minimumSystemVersion 값, JSON/TOML 강조 |
| 2026-09-08T19:45:51+09:00 | #spike-min-macos | claude-code | ☐→! | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | 조사 완료 — 하한은 Safari 16 = macOS 13 이고 Vite 타깃이 정한다(Monaco 무관, 지금도 10.13 은 틀림). 값 박기는 macOS 12 이하 공식 포기라 사용자 결정 대기 |
| 2026-09-08T19:51:27+09:00 | #spike-min-macos | claude-code | !→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | minimumSystemVersion=13.0 박음. 하한은 Monaco 가 아니라 Vite 7 기본 타깃 safari16 이 정한다 — 앱은 이미 macOS 13 을 요구하고 있었고 10.13 은 못 지킬 약속이었다 |
| 2026-09-08T20:15:07+09:00 | #port-shell | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | 572→481줄 + monaco/ 4조각. props 16개 무변경, 언컨트롤드 규약 유지 |
| 2026-09-08T20:15:13+09:00 | #port-diagnostics | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | setModelMarkers 로 교체 반영 — 재구성 없음. 길이 0 범위를 한 글자로 넓히는 규칙도 이관 |
| 2026-09-08T20:15:19+09:00 | #port-commands | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | F12·⇧F12·F2·⌘.·⇧⌥F·⌘S 를 addAction 으로 + ⌘클릭은 onMouseDown. 실행은 여전히 부모. i18n 키 6개 추가 |
| 2026-09-08T20:15:25+09:00 | #port-jump | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | 1-based 라인 + ch/len 을 Monaco 열(1-based)로 죄어 반영, focus:false 경로 유지. diff 모드 결함(숨은 편집기로 점프) 자체 발견·수정 |
| 2026-09-08T20:15:31+09:00 | #port-gutters | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | git=line 데코레이션, 중단점=glyph margin. 두 컬렉션을 분리(한 컬렉션이면 git 갱신이 중단점을 지운다). CSS 는 같은 토큰 재사용 |
| 2026-09-08T20:15:37+09:00 | #port-diff | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | renderSideBySide:false 인라인 diff. 구현 완료, 렌더 육안 확인은 fin-eyes 로 |
| 2026-09-08T20:15:43+09:00 | #port-theme | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | --code-* 15개 → defineTheme + data-theme/preset MutationObserver 재정의. 프리셋 격자 육안 확인은 fin-eyes 로 |
| 2026-09-08T20:15:50+09:00 | #port-tests | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/2014_refactor_monaco-port-phase1.md | 189파일 2460개 전부 통과, 테스트 한 줄도 안 고침 = 계약 무유출. 기여목록 자물쇠 테스트 신규 추가 |
| 2026-09-09T19:15:39+09:00 | #reclaim-sticky | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md | 381줄 삭제. defaultModel 을 outlineModel 로 올리고 monaco/symbols.ts(123)가 DocumentSymbolProvider 를 낸다. clamp 는 lib/settings 로. ⇧⌘O 충돌은 onGoToSymbol 로 되돌림 |
| 2026-09-09T19:15:47+09:00 | #reclaim-signature | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md | 172줄 삭제 → 내장 parameterHints. 폭 묶기와 "지금 치는 인자 강조" 두 판단은 .parameter-hints-widget 으로 옮김 |
| 2026-09-09T19:15:54+09:00 | #reclaim-search | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md | 판정 = 대체 불가, 남긴다. Monaco 위젯은 문서 하나, 패널은 프로젝트 전역(code_search)+디스크 직접 치환. 반대로 파일 안 찾기·바꾸기(⌘F·⌥⌘F)는 이관이 공짜로 준 것 — CM 판엔 없었다. 근거는 02-reclaim.md#search-verdict |
| 2026-09-09T19:16:01+09:00 | #reclaim-lang | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md | 137→110줄. 정정: lang-* 는 10개가 아니라 8개만 지울 수 있다 — lang-markdown 은 DiscussionEditor 가 아직 쓴다(Phase 4). legacy-modes 포함 13개 제거. D1a 실행(langExtra.ts JSON·TOML Monarch) + 언어 커버리지 자물쇠 2종 |
| 2026-09-09T19:16:09+09:00 | #reclaim-css | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md | 45규칙 정리 — 지우는 게 아니라 옮기는 것. 진단 밑줄·호버 폭·인자 강조·불투명 스티키·diff 색 토큰을 Monaco 선택자로. 잔재 하나 자체 발견·수정: CodeScreenV2 의 ⌘X/⌘V 가드가 .cm-editor 를 보고 있어 편집기 안 ⌘V 가 트리 붙여넣기로 갔다 |
| 2026-09-09T19:27:03+09:00 | #cap-basics | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md | 폴딩·괄호매칭(always)·자동닫기·선택감싸기·autoIndent full(advanced 는 onEnter 만 본다)·선택일치 강조. 옵션을 monaco/options.ts 순수함수로 떼어 자물쇠 16개를 걸었다 — 켠 줄이 조용히 지워지는 것이 진짜 위험이라. detectIndentation:false + insertSpaces prop 으로 화면과 저장 시 포맷이 같은 값을 보게 함 |
| 2026-09-09T19:27:10+09:00 | #cap-multicursor | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md | multiCursorModifier:"alt" 하나로 ⌥클릭·⌥⇧드래그(열 선택)가 함께 온다. ⌘D 는 multicursor 기여가 준다 — 앱에 ⌘D 쓰는 자리가 없어 안 부딪힘(확인). mergeOverlapping 도 명시 |
| 2026-09-09T19:27:18+09:00 | #cap-minimap | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md | 판정 = 폭을 먹는 것만 설정을 둔다. 미니맵 → codeMinimap(기본 켬, 좌우 분할에서 60~100px 을 본문에서 뺏는다). 브래킷 색칠·들여쓰기 가이드는 설정 없이 항상 켬 — 자리를 안 먹어 끌 이유를 댈 수 없고 아무도 안 바꿀 토글은 소음이다 |
| 2026-09-09T19:27:25+09:00 | #cap-peek | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md | 판정 = 만들지 않고 패널을 남긴다. StandaloneTextModelService.createModelReference() 가 모델이 없으면 거부해 표준 Monaco 로는 파일 밖을 못 본다 — 얻는 것이 "같은 파일 안에서만 되는 peek" 이고 반만 되는 이동은 안 되는 이동보다 나쁘다. 정의·참조 공급자도 같은 이유로 미등록. Phase 5 ⌘K 가 파일 모델 레지스트리를 요구하면 재개 |
| 2026-09-09T19:27:35+09:00 | #cap-semantic | claude-code | ☐→! | .oculpm/journal/20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md | 백엔드에 semanticTokens 없음 확인(커맨드 17개·initialize capability 어디에도). 추가는 가능하나 cargo test 가 bindings.ts 를 재생성하는데 지금 그 파일이 병렬 세션의 미커밋 변경을 들고 있다(sessions_considered·RuleEntry.readonly) — 재생성하면 남의 진행 중 API 가 섞이고 안 하면 내 바인딩이 빠진다. **해제 조건: firing-ledger/rules 작업 머지.** Monarch 로 만족하고 닫지 않는 이유는 이월을 유실 안 하려고 |
| 2026-09-09T19:40:33+09:00 | #disc-wait | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1940_refactor_monaco-discussion-phase4.md | 선행 조건 만족 확인 — 60b66a9(논의 CAS 손실 수정) 머지됨, features/discussion 과 discussion.rs 에 미커밋 변경 없음. 지금 도는 병렬 세션은 firing-ledger/skills 쪽이라 이 파일들과 무관 |
| 2026-09-09T19:40:42+09:00 | #disc-port | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1940_refactor_monaco-discussion-phase4.md | 이음매는 오프셋 하나 — mdEdit.ts 무변경, 환산을 apply 안에 가둠, executeEdits 한 번(실행취소 한 칸). placeholder/히스토리/검색은 내장으로, 마크다운 강조는 markdown-prose 문법을 직접 씀(0.56 은 제목 단계를 다 keyword 로 낸다 = 회귀). 테마는 전역이라 한 벌에 .md-prose 접미사로 가름. discussion_editor.test.tsx 가 판정자 — 본문 무수정 통과 |
| 2026-09-09T19:40:48+09:00 | #disc-drop-cm | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1940_refactor_monaco-discussion-phase4.md | **라운드의 완료 신호** — package.json 에 @codemirror/* · codemirror · @lezer/highlight 가 0개. Phase 2 에서 13개, 여기서 7개. DiscussionEditor 청크 537.97→8.77kB |
| 2026-09-09T19:40:54+09:00 | #disc-filesize | claude-code | ☐→x | .oculpm/journal/20260909/Refactors/1940_refactor_monaco-discussion-phase4.md | DiscussionScreenV2.tsx 799줄 유지 — 이 Phase 는 그 파일을 아예 안 건드렸다(편집기 배선은 DiscussionEditor.tsx 안에서 끝난다). lint:filesize 초록 |
| 2026-09-09T20:09:41+09:00 | #agent-cmdk | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 항목 문구 정정 — ACP 도 inline-diff 위젯도 아니었다. ACP 는 연결·한턴잠금·에이전트 자체 디스크쓰기를 전제해 미저장 버퍼와 싸운다. commands.chat(폴백 체인 포함, 백엔드 커맨드 0 증가)로 가고, 표시는 "먼저 적용하고 검토"(diffOriginal 이 이미 푼 문제를 두 벌 안 만든다). 펜스 걷기·끝개행 맞추기는 순수 모듈 |
| 2026-09-09T20:09:49+09:00 | #agent-hunk | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 버튼이 아니라 토글 — 켜고 끌 때마다 본문이 즉시 다시 계산돼 누르기 전에 결과가 보인다. compose 가 줄 범위(spans)까지 내는 것이 요점(화면이 좌표를 다시 세면 한 줄 밀린 하이라이트). 비교는 chat/lineDiff 재사용 — diff 를 두 벌 만들면 같은 변경이 두 화면에서 다르게 보인다. 전부 끄면 원문 그대로라는 등식을 테스트가 문다 |
| 2026-09-09T20:09:58+09:00 | #agent-attribution | claude-code | ☐→! | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 셋 중 둘 완료. ①entry_diffs 는 이미 된다(만들 것 없음) ②일지 agent — 상태줄 칩 → create_manual_entry(agent={provider,model}, verified_by_user=false. 사람의 확인을 사칭하지 않는다) ③**로컬 히스토리 HistorySource 가 남았다** — 자리는 이미 있는데 ⌘K 편집을 user 로 적는다(code_write 자기-쓰기 쪽지). 고치려면 code_write 인자 추가 → bindings 재생성 → {#cap-semantic} 과 같은 이유로 막힘. **해제 조건: firing-ledger/rules 머지** |
| 2026-09-09T20:10:05+09:00 | #agent-tab-predict | claude-code | ☐→> | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 플랜대로 열지 않았다 — 전용 모델·지연시간 예산·취소 병합·오답 비용이 각각 설계를 요구하고 그 불확실성이 이 라운드를 오염시키면 안 된다. 항목으로 남겨 유실만 막는다 (다음 라운드에서 자기 설계 문서와 함께 열 것) |
| 2026-09-09T20:28:34+09:00 | #fin-gates | claude-code | ☐→x | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 전부 exit 0 — typecheck · test(193파일 2,514) · lint 6종 · build · **cargo test 33스위트 1,587개·경고 0**. 함정 하나: cargo test 를 \|tail 에 물리면 exit 0 이 tail 것이고 합계도 "4스위트 20개" 로 거짓이 된다(gh run watch 와 같은 함정). 덤: cargo test 뒤 bindings.ts 해시 무변화 = 이 라운드가 백엔드 커맨드를 0개 늘렸다. 여유 없음 경고: eslint 정확히 9/9, 래칫은 4번 걸려 4번 갚음 |
| 2026-09-09T20:28:44+09:00 | #eyes-hljs | claude-code | ☐→! | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 사람이 앱을 띄워야 답이 나온다 (설치본 도는 중 dev 빌드 금지 — 락 경합). "나중에 봐야 함" 대신 **걸을 수 있는 목록**을 06-finish.md §eyes 에 적었다: 색(프리셋5×언어7, 특히 직접 쓴 json·toml) · 새로 켠 것 · 심볼 스티키 · **키 9개**(⇧⌘O 가 우리 CodeGoto 인지, 편집기 안 ⌘V 가 트리 붙여넣기로 안 새는지 — 둘 다 실제 회귀였다) · 위젯 · ⌘K 흐름 · 논의 편집기. v3-release {#eyes-hljs} 와 같은 격자 |
| 2026-09-09T20:28:53+09:00 | #fin-perf | claude-code | ☐→! | .oculpm/journal/20260909/Features_to_add/2009_feature_monaco-agent-surface-phase5.md | 절반 완료. **페이로드는 실측**(06-finish.md §perf): CodeScreenV2 335KB→145.08, DiscussionEditor 537.97→8.75(CodeMirror 소멸), 공유 Monaco 3,871.14(gzip 1,001.45), 워커는 editor.worker 273KB 하나뿐(D1 유지 근거), dist 총 16.3MB. **기기 지연(열기·스크롤·타이핑)은 미측정** — Phase 0 하네스가 버리는 브랜치에 있어 절차만 남겼다. 문서명은 03-performance 가 아니라 06-finish §perf (3~5번을 Phase 3~5 문서가 가져갔다) |
| 2026-09-09T20:29:58+09:00 | #fin-release | claude-code | ☐→! |  | **사용자 지시로 대기** (2026-09-09) — 다른 세션이 끝나면 알려 주기로. 손도 안 댔다: 버전 6파일·CHANGELOG·README ko/en·랜딩 ko/en 전부 그대로. 재개 시 순서는 docs/RELEASE.md — 버전 6곳 → 게이트(cargo test 가 Cargo.lock 갱신) → CHANGELOG → README 양쪽 → 랜딩 각 6곳 + plugin.html 배지 둘 → build.mjs → main CI 초록 확인 후 태그. 릴리스 전에 {#eyes-hljs} 격자를 걷는 것이 이 라운드의 성격상 맞다 — 편집기를 통째로 갈았는데 사람이 한 번도 안 봤다 |
| 2026-09-10T19:39:54+09:00 | #cap-semantic | claude-code | !→x | .oculpm/journal/20260910/Features_to_add/1939_feature_monaco-semantic-tokens-and-attribution.md | 해제 조건(firing-ledger 머지) 충족 확인 후 구현. legend 는 initialize 답에 이미 있어 요청 0회 — 데이터와 따로 나른 이유는 Monaco 가 공급자당 getLegend() 를 한 번만 읽어 캐시하기 때문. 함정 셋: 핸드셰이크에 안 알리면 rust-analyzer 가 능력조차 광고 안 함 · standalone 테마는 semanticHighlighting 이 항상 false 라 옵션으로 켜야 함 · 테마 규칙 빠뜨린 종류는 본문색이 되어 켜기 전보다 나빠짐(builtinType·lifetime 포함 15종 추가+커버리지 테스트). full 못 하는 서버엔 안 담. spec.rs 래칫 때문에 lsp/semantic.rs 신설 |
| 2026-09-10T19:40:03+09:00 | #agent-attribution | claude-code | !→x | .oculpm/journal/20260910/Features_to_add/1939_feature_monaco-semantic-tokens-and-attribution.md | 남아 있던 ③ 완료 — code_write 에 by_agent 를 더해 자기-쓰기 쪽지가 손까지 적는다. 저장 창구는 ⌘S 든 ⌘K 든 같은 code_write 라 창구만 보면 둘 다 사람이 된다. 프런트는 "아직 저장 안 함" 집합에 넣고 저장 때 한 번 꺼내 쓴다(한 번 적히고 지워짐 — 안 지우면 이후 저장이 전부 에이전트). 일지 tallies 와 다른 축이라 따로 둠 |
| 2026-09-10T20:27:09+09:00 | #fin-release | claude-code | !→x | .oculpm/journal/20260910/Chores/2026_chore_release-2-46-0.md | v2.46.0 릴리스 — 다섯 면 전부 + 회고·문서 삭제 미반영분 동승. FAQ 가 실제로 거짓이 되어 있었다(「산출물」 답변이 사라진 PR 본문·주간 보고를 계속 약속) → 지금 있는 것으로 재작성. FAQ 는 JSON-LD 와 <details> 두 곳이라 양쪽 고침. 위키 screens.md ⌘번호 표가 2026-09-06 IA 재편 이전에 멈춰 있던 것도 함께 정정. main CI 3잡 초록 확인 후 태그, 랜딩 배포 후 라이브 확인(ko·en 2.46.0 · /wiki/retro 404) |
| 2026-09-11T00:26:48+09:00 | #fin-eyes | claude-code | !→! | .oculpm/journal/20260911/Features_to_add/0026_feature_editor-design-upgrade.md | 편집기 디자인 라운드(미니맵 바탕·크롬/종이 분리·거터 띠·액센트 커서·md 굵기·트리 루트 행)가 격자 항목을 늘렸다 — 미니맵 손잡이·거터 띠·루트 행도 같이 볼 것. 여전히 실기기 미확인 |
| 2026-09-11T00:48:39+09:00 | #fin-eyes | claude-code | !→! | .oculpm/journal/20260911/Features_to_add/0048_feature_editor-ide-round.md | IDE 라운드가 격자에 넷 더 걸었다 — ⌘P 오버레이 · 트리/탭 git 배지(앰버/초록/빨강) · 심볼 브레드크럼 · 상태줄 줄바꿈 토글. 여전히 실기기 미확인 |
<!-- oculpm:plan-log end -->
