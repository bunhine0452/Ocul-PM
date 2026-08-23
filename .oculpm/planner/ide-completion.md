---
oculpm_plan: v1
id: ide-completion
title: "온전한 IDE — VS Code 를 끊기까지"
status: active
created: 2026-08-23
updated: 2026-08-23
owner: claude-code
---

목표는 **사용자가 VS Code 를 열 이유가 없어지는 것**. LSP 로 코드를 이해하는 층은
[lsp-code-intelligence](lsp-code-intelligence.md) 에서 붙였고(v2.15.0), 여기서는
그 위에 **에디터로서 없으면 못 쓰는 것들**을 채운다.

포크는 하지 않는다 — 근거는 lsp-code-intelligence #no-vscode-fork 에서 잠겼다.

## 결정

### Decision 1 — 파일 트리는 지연 로딩으로 간다 {#lazy-tree}

잠금 2026-08-23 · 사용자.

`code_tree` 는 한 번에 전부 걸어 중첩 트리를 통째로 돌려준다. 숨김 파일은 v2.15.0
에서 열었지만(#hidden-done) **gitignore 축은 못 연다** — 이 저장소만 해도 무시를
끄면 114,419 파일(node_modules 27k + target 85k)이라 `MAX_TREE_FILES` 20,000 에
걸려 트리가 통째로 잘린다.

VS Code 탐색기가 gitignore 된 파일을 보여줄 수 있는 것은 **폴더를 펼칠 때 한 단계씩
읽기** 때문이다. 같은 구조로 간다: `.git` 만 빼고 디스크에 있는 것을 전부 보여주되,
한 번에 읽는 것은 펼친 디렉터리 하나뿐.

영향: #tree-backend #tree-frontend #tree-dim

### Decision 2 — 삭제는 휴지통으로 보낸다 {#delete-to-trash}

잠금 2026-08-23 · claude-code.

폴더 삭제는 재귀라 한 번의 오조작으로 잃는 것이 크고, 확인 창 하나로 감당할 무게가
아니다. 앱이 되돌릴 수 없는 삭제를 만들지 않는 것이 원칙이고 되돌리기는 OS 가 이미
잘한다 — `trash` 크레이트로 OS 휴지통에 보낸다. 휴지통이 실패하는 환경(네트워크
볼륨 등)에서는 **영구 삭제로 물러서지 않고** 오류를 그대로 알린다.

영향: #file-ops-backend #file-ops-ui

### Decision 3 — 편집 창을 컴포넌트로 떼어낸다 {#pane-component}

잠금 2026-08-23 · claude-code.

좌우 분할은 "에디터를 두 번 그리는 것"이 아니라 **편집 상태를 두 벌 갖는 것**이다
(버퍼·커서·충돌·LSP 수명이 창마다 따로). 화면이 그것을 배열로 들면 모든 상태가
인덱스로 갈라져 읽을 수 없게 된다. 창을 `CodePane` 으로 두면 React 가 그 갈래를
대신 든다 — `CodeScreenV2` 925줄 → 741(화면) + 742(창).

곁가지 제약: 백엔드 LSP 는 (프로젝트, 파일)로 문서를 하나만 연다. 같은 파일이 양쪽
창에 열리면 **왼쪽 창만** 서버를 붙인다.

영향: #tabs-split #tabs-bar

## Phase 0 — 지연 로딩 트리 {#p0-tree}
- [x] 숨김 파일 표시 + `.git` 예외 (v2.15.0 선행분) {#hidden-done}
- [x] `code_dir` — 디렉터리 한 단계만. 무시 여부는 손으로 판정하지 않고 `max_depth(1)` 걸음이 살려 둔 집합과 대조해 얻는다 (판정 주체를 하나로) {#tree-backend}
- [x] 프런트 — `childrenOf(경로)` 조회. `undefined`(미로드)와 `[]`(빈 폴더)를 구별하는 것이 요점 {#tree-frontend}
- [x] gitignore 항목은 흐리게 + title 로 이유 {#tree-dim}
- [~] 필터는 **전량 걸음을 그대로 남겨** 쓰기로 결정 — 안 읽은 가지의 매치는 지연 로딩으로 못 찾는다. 렌더러는 `flattenToDirMap` 으로 하나 유지. 남은 것: 무시된 파일은 이름으로도 검색되지 않는다 {#tree-filter}
- [x] 인앱 육안 확인 — 큰 폴더 펼침 반응성 · 흐린 표시의 가독성 {#tree-verify}

## Phase 1 — 탭과 파일 조작 {#p1-tabs}
- [x] 탭 바 — 여러 파일 동시 열기. 버퍼 캐시(`codeBuffers`, 20개 상한)는 이미 있으니 UI 만 {#tabs-bar}
- [x] 탭 상태 영속 — `WorkspaceContext` 경유 (직접 localStorage 금지) {#tabs-persist}
- [x] 분할 화면 — 좌우 2분할 {#tabs-split}
- [x] `code_create` / `code_mkdir` / `code_rename` / `code_delete` — 커맨드가 아예 없다. `secure_join` 가드·심링크 이탈 방지는 `code_read` 경로 재사용 {#file-ops-backend}
- [x] 트리 컨텍스트 메뉴 + 인라인 이름 입력 · 삭제 확인 · 열린 버퍼와의 정합(삭제/이름변경된 파일이 탭에 열려 있을 때) {#file-ops-ui}
- [x] 드래그로 이동 {#file-ops-dnd}
- [ ] 인앱 육안 확인 — 드래그 이동 · 우클릭 메뉴 위치 · 분할 폭 (jsdom 이 못 보는 축) {#p1-verify}

## Phase 2 — LSP 나머지 창구 {#p2-lsp-rest}
- [ ] 참조 찾기 (`textDocument/references`) — 결과 패널 {#lsp-references}
- [ ] 심볼 아웃라인 (`documentSymbol`) — 파일 내 구조 + 점프 {#lsp-outline}
- [ ] 워크스페이스 심볼 (`workspace/symbol`) — ⌘K 팔레트에 합류 {#lsp-workspace-symbol}
- [ ] 시그니처 힌트 (`signatureHelp`) — 인자 입력 중 표시 {#lsp-signature}
- [ ] 포맷팅 (`formatting` / `rangeFormatting`) + 저장 시 포맷 옵션 {#lsp-format}
- [ ] 설정 화면 — 언어별 켜기/끄기 · 서버 경로 오버라이드 · 미설치 안내 (lsp-code-intelligence #lsp-settings 를 여기로 이관) {#lsp-settings-screen}
- [ ] git 거터 — 수정/추가/삭제된 줄을 에디터 안에 (LSP 아님, 기존 diff 백엔드 재사용) {#git-gutter}

## Phase 3 — 디버거 (DAP) {#p3-dap}

lsp-code-intelligence 에서 **의도적으로 제외**했던 결정을 사용자가 다시 열었다
(2026-08-23). 가장 큰 덩어리이고, LSP 와 프로토콜이 다르다 — 프레이밍은 같은
`Content-Length` 지만 수명·상태 모델이 완전히 다르다(중단점·스텝·프레임·스코프).

- [ ] 설계 문서 — docs/dap/00-master-plan.md. 어댑터 조달(언어별 debug adapter)·프로토콜·UI 모델을 먼저 못 박는다 {#dap-design}
- [ ] dap/ — 프레이밍 · 어댑터 spawn · 요청 상관 · 이벤트 라우팅 {#dap-pipe}
- [ ] 중단점 — 에디터 거터 토글 + 서버 동기 {#dap-breakpoints}
- [ ] 실행 제어 — 계속/스텝오버/스텝인/스텝아웃 · 호출 스택 · 변수 스코프 {#dap-control}
- [ ] 실행 구성 — 무엇을 어떻게 띄울지 (launch/attach) {#dap-config}

## 하지 않는 것

- **확장 호스트** — 포크를 접은 이유와 같다.
- **서버·어댑터 자동 설치** — 조용히 네트워크를 타고 바이너리를 받는 것은 로컬 우선
  원칙과 맞지 않는다. 미설치는 설치 방법 안내로 끝낸다.

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-23T11:50:00+09:00 | #hidden-done | claude-code | ☐→x | .oculpm/journal/20260823/Bugs/1146_bug_code-tree-hidden-files.md | v2.15.0 선행분 — 숨김 축만, gitignore 축은 지연 로딩 전제 |
| 2026-08-23T12:35:00+09:00 | #tree-backend | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1235_feature_lazy-code-tree.md | code_dir + 무시 판정을 같은 걸음에 위임 · 테스트 3 |
| 2026-08-23T12:35:01+09:00 | #tree-frontend | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1235_feature_lazy-code-tree.md | childrenOf 조회 · 미로드/빈폴더 구별 · 새로고침이 캐시도 버림 |
| 2026-08-23T12:35:02+09:00 | #tree-dim | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1235_feature_lazy-code-tree.md | opacity .45 + title · reduced-motion 대응 |
| 2026-08-23T12:35:03+09:00 | #tree-filter | claude-code | ☐→~ | .oculpm/journal/20260823/Features_to_add/1235_feature_lazy-code-tree.md | 전량 걸음 유지로 결정. 무시된 파일이 검색 안 되는 것은 남음 |
| 2026-08-23T13:05:00+09:00 | #tree-verify | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1235_feature_lazy-code-tree.md | 사용자가 앱에서 확인 |
| 2026-08-23T15:30:00+09:00 | #file-ops-backend | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | code_create/mkdir/rename/delete · resolve_for_mutation 심링크 가드 · 삭제=휴지통 · 테스트 10 |
| 2026-08-23T15:30:01+09:00 | #tabs-bar | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | CodeTabsBar + CodePane 추출. 가운데클릭·× ·우클릭 메뉴 |
| 2026-08-23T15:30:02+09:00 | #tabs-persist | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | WorkspaceContext.codeTabs. 버퍼는 여전히 비영속 — 여는 목록만 되살린다 |
| 2026-08-23T15:30:03+09:00 | #tabs-split | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | 창=상태 한 벌. 창 간 탭 드래그 · 빈 창 자동 접힘 · 같은 파일이면 왼쪽만 LSP |
| 2026-08-23T15:30:04+09:00 | #file-ops-ui | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | 인라인 입력칸 · 삭제 확인이 함께 닫히는 탭·미저장을 먼저 열거 · 버퍼 재키잉 |
| 2026-08-23T15:30:05+09:00 | #file-ops-dnd | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | 트리 행 → 폴더/루트 드롭. 자기 후손으로는 프런트에서 먼저 막는다 |
| 2026-08-23T15:30:06+09:00 | #p1-verify | claude-code | →☐ | .oculpm/journal/20260823/Features_to_add/1530_feature_code-tabs-split-file-ops.md | 신규 — 드래그·메뉴 위치·분할 폭은 사용자 확인 필요 |
<!-- oculpm:plan-log end -->
