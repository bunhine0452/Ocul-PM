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
- [ ] `CodeEditor.tsx` 를 Monaco 로 다시 쓴다 — `CodeEditorProps` 16개 prop 을 전부 만족시킨다. 언컨트롤드 규약(부모는 초깃값만, 외부 갱신은 key 재마운트)도 유지 — 양방향 동기화가 편집기와 React 상태를 서로 되돌리는 병리는 Monaco 에서도 같다 {#port-shell}
- [ ] LSP 공급자 배선 — `onComplete`·`onHover`·`onSignatureHelp` 를 Monaco 의 CompletionItemProvider·HoverProvider·SignatureHelpProvider 로. `lspBridge.ts` 의 변환부는 살리고 CM 타입 의존만 걷는다 {#port-lsp}
  - [ ] `diagnostics` → `monaco.editor.setModelMarkers`. 지금처럼 **재구성 없이 트랜잭션으로만** 반영되는지 확인 {#port-diagnostics}
  - [ ] F12·⇧F12·F2·⌘.·⇧⌥F·⌘S 를 Monaco action 으로 재등록 — 이동·이름바꾸기·코드액션·포맷의 **실행은 여전히 부모(CodePane)** 가 한다 {#port-commands}
- [ ] `jump` one-shot 계약 — 1-based 라인 + UTF-16 `ch`/`len` 선택 + `focus:false`(⇧⌘O 미리 점프가 자기 입력창을 안 뺏는 경로). 매번 새 객체라 같은 줄 재점프도 발화해야 한다 {#port-jump}
- [ ] 거터 재작성 — `gitGutter.ts`(HEAD 대비 줄 변경)는 line 데코레이션으로, `breakpointGutter.ts`(1-based DAP 규약·미검증 줄 구분)는 glyph margin 으로 {#port-gutters}
- [ ] `diffOriginal` 인라인 비교 — 지금은 `@codemirror/merge` 의 unifiedMergeView(지워진 줄이 빨간 블록으로 끼어들고 청크마다 되돌리기 버튼)다. Monaco 인라인 diff 로 같은 동작을 낸다 {#port-diff}
- [ ] 테마 다리 — Monaco 는 `defineTheme` 를 JS 로 받고 CSS 변수를 안 읽는다. `data-theme`/`data-preset` 전환 시 계산된 `--code-*` 12개를 읽어 테마를 다시 정의하는 경로를 만든다 (지금은 리마운트 없이 먹던 것이라 회귀하면 눈에 띈다) {#port-theme}
- [ ] 기존 코드 화면 테스트 30개(5,499줄)를 판정자로 삼아 초록으로 만든다 — 계약이 같으므로 테스트를 고쳐야 한다면 그건 계약이 샜다는 신호다 {#port-tests}

## Phase 2 — 회수: 손으로 만든 것을 내장으로 갈아치우고 지운다 {#reclaim}
- [ ] `stickyScroll.ts`(229줄) + `stickyModel.ts`(152줄) 삭제 → Monaco 내장 sticky scroll. `stickyMaxLines`·`stickySymbols`·`tabSize` prop 의 뜻을 내장 옵션으로 옮긴다 {#reclaim-sticky}
- [ ] `signatureTooltip.ts`(172줄) 삭제 → Monaco 내장 시그니처 위젯 {#reclaim-signature}
- [ ] `CodeSearchPanel.tsx`(16KB) 를 Monaco find/replace 위젯으로 대체할 수 있는지 판정 — ⇧⌘F 전역 검색(별도 화면)과는 다른 자리다. 대체 못 하면 이유를 적고 남긴다 {#reclaim-search}
- [ ] `codeLang.ts`(137줄) 를 Monarch 언어 id 매핑으로 축소 — `@codemirror/lang-*` 10개와 `legacy-modes` 의존성 제거 {#reclaim-lang}
- [ ] `code.css` 의 `.cm-*` 규칙 44개 정리 — 나머지 2,466줄(트리·탭·패널)은 건드리지 않는다 {#reclaim-css}

## Phase 3 — 새 능력: 지금 아예 없는 기본기 {#capabilities}
- [ ] 실측으로 **0** 인 것들을 켠다 — 코드 폴딩 · 괄호 매칭 · 자동 괄호 닫기 · 선택 일치 강조 · 입력 시 들여쓰기. 지붕(LSP 17커맨드·DAP)은 올렸는데 바닥이 비어 있던 자리다 {#cap-basics}
- [ ] 다중 커서 · 열(블록) 선택 — ⌥클릭 · ⌘D 다음 일치 추가 · ⌥⇧드래그 {#cap-multicursor}
- [ ] 미니맵 · 브래킷 쌍 색칠 · 들여쓰기 가이드. 설정에 켜기/끄기를 둘지 판단 (기본값은 켬) {#cap-minimap}
- [ ] peek definition/references — 지금은 ⇧F12 가 화면 폭 패널을 그린다. 인라인 peek 이 그 패널을 대체할지, 둘 다 남길지 결정한다 {#cap-peek}
- [ ] 시맨틱 토큰 — LSP `semanticTokens` 를 백엔드에 없으면 추가하고 Monaco 에 물린다. 없으면 이 항목은 Monarch 강조로 만족하고 닫는다 {#cap-semantic}

## Phase 4 — 논의 편집기: CodeMirror 의존성 완전 제거 {#discussion}
- [ ] **선행 조건** — 병렬 세션의 논의 CAS 손실 수정(`DiscussionScreenV2.tsx` 852줄 · `discussion.rs` · 새 테스트 2개)이 머지될 때까지 시작하지 않는다. 같은 파일을 두 세션이 고치면 한쪽이 조용히 사라진다 {#disc-wait}
- [ ] `DiscussionEditor.tsx`(436줄) 를 Monaco 마크다운으로 — placeholder · 히스토리 · 검색 · 마크다운 강조가 지금 CM 에서 오는 것들이다 {#disc-port}
- [ ] `package.json` 에서 `@codemirror/*` 18개 + `codemirror` + `@lezer/highlight` 제거. 이 줄이 지워지는 것이 이 라운드의 완료 신호다 {#disc-drop-cm}
- [ ] `DiscussionScreenV2.tsx` 파일 크기 래칫 — 병렬 세션이 `conflict.ts`·`useDiscussionSave.ts` 로 쪼개 796줄로 내려놨다(2026-09-08 확인). 편집기 배선을 갈아끼우며 다시 넘기지 않는지만 본다 {#disc-filesize}

## Phase 5 — 에이전트 편집면 (Cursor 의 진짜 차별점) {#agent-surface}
- [ ] ⌘K 인라인 편집 — 선택 범위에 지시를 주면 그 자리에서 고쳐 보여 준다. ACP(Claude Code · Codex)가 이미 붙어 있어 전송 경로는 있고, Monaco 의 inline-diff 위젯이 표시를 맡는다 {#agent-cmdk}
- [ ] hunk 단위 승인 — 에이전트가 만든 diff 를 편집기 안에서 조각별로 받기/버리기. 지금 `diffOriginal` 이 그리는 청크 되돌리기 버튼의 확장이다 {#agent-hunk}
- [ ] 귀속 — ⌘K 로 들어간 편집이 일지·`entry_diffs` 에 **누가 고쳤는지** 남는가. 이 앱의 존재 이유가 기록이라 편집기가 기록을 빠뜨리면 안 된다 {#agent-attribution}
- [ ] **Tab 다음-편집 예측은 이 라운드에서 열지 않는다** — 전용 모델 · 지연시간 예산 · 취소 병합 · 오답 비용까지 설계가 따로 필요하다. 여기 항목으로만 남겨 유실을 막는다 (이월은 살아 있는 플랜의 항목으로) {#agent-tab-predict}

## Phase 6 — 마감 {#finish}
- [ ] 육안 확인 격자 — 라이트/다크 × 프리셋 5종으로 문법 강조 · 선택색 · 커서 · 미니맵 · sticky · 진단 밑줄. v3-release `{#eyes-hljs}` 가 이미 같은 격자를 요구하고 있어 한 번에 갚는다 {#fin-eyes}
- [ ] 성능 재측정 — 대용량 파일(수천 줄) 열기 · 스크롤 · 타이핑 지연. Phase 0 의 숫자와 대조해 `03-performance.md` 에 남긴다 {#fin-perf}
- [ ] 게이트 전부 exit 0 직접 확인 — typecheck · test · lint 6종 · build · cargo test. 파일 크기 래칫과 eslint 경고 한계(`--max-warnings`)에 여유가 없으니 함께 본다 {#fin-gates}
- [ ] 릴리스 5면 — 버전 6파일 · CHANGELOG · README ko/en · 랜딩 ko/en 각 6곳 + `build.mjs` 재빌드. **회고·문서 삭제(2026-09-08)의 미반영분도 이때 함께 간다** — 그 표면들은 아직 두 화면이 있는 v2.45.2 를 설명하고 있다 {#fin-release}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-08T19:45:27+09:00 | #spike-ime | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | 초록 — textarea·CodeMirror·Monaco 3자 비교에서 결과 완전 동일. 1라운드 붉음은 기대값 오류(조합 중 ←는 IME 확정키) |
| 2026-09-08T19:45:33+09:00 | #spike-workers | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | MonacoEnvironment.getWorker 직접 구현 채택. globalAPI 불필요 확인. 0.56 은 esm/vs 경로가 죽어 monaco-editor/editor/... 로 써야 한다 |
| 2026-09-08T19:45:39+09:00 | #spike-bundle | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | D1 3,864,710B/gzip 995,510 · 여는 지연 221ms. D1 근거 정정: 청크 차이는 99KB뿐이고 진짜는 워커 9.2MB |
| 2026-09-08T19:45:44+09:00 | #spike-verdict | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | R1·R2·R3 초록, R5 노랑 → 이관 진행. 01-spike.md 작성. 미결 2: minimumSystemVersion 값, JSON/TOML 강조 |
| 2026-09-08T19:45:51+09:00 | #spike-min-macos | claude-code | ☐→! | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | 조사 완료 — 하한은 Safari 16 = macOS 13 이고 Vite 타깃이 정한다(Monaco 무관, 지금도 10.13 은 틀림). 값 박기는 macOS 12 이하 공식 포기라 사용자 결정 대기 |
| 2026-09-08T19:51:27+09:00 | #spike-min-macos | claude-code | !→x | .oculpm/journal/20260908/Features_to_add/1945_feature_monaco-phase0-spike.md | minimumSystemVersion=13.0 박음. 하한은 Monaco 가 아니라 Vite 7 기본 타깃 safari16 이 정한다 — 앱은 이미 macOS 13 을 요구하고 있었고 10.13 은 못 지킬 약속이었다 |
<!-- oculpm:plan-log end -->
