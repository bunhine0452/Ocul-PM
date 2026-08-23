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

### Decision 4 — 포맷은 디스크가 아니라 버퍼를 다듬는다 {#format-buffer}

잠금 2026-08-23 · claude-code.

이름 바꾸기·코드 액션은 **열려 있지 않은 파일까지** 고치므로 디스크에 적용하고
미저장 버퍼를 금지했다. 포맷은 반대다 — 편집 중인 한 파일이 대상이라 저장을
강요할 이유가 없다. 백엔드가 버퍼 텍스트를 받아 편집을 적용해 돌려주고, 저장
여부는 여전히 사용자가 정한다 (저장 시 포맷은 그 위에 얹힌다).

전제: 호출 전에 디바운스를 건너뛰고 버퍼를 서버에 밀어 넣어야 한다
(`flushText`). 서버가 아는 문서가 뒤처져 있으면 편집 오프셋이 어긋난다.

영향: #lsp-format

### Decision 5 — 거터는 git diff 가 아니라 HEAD↔버퍼 비교다 {#gutter-vs-buffer}

잠금 2026-08-23 · claude-code.

`git diff` 는 디스크를 본다. 거터는 **저장하기 전에** 무엇을 고쳤는지 보여야
쓸모가 있으므로 HEAD 블롭만 git 에서 가져오고 비교는 `similar` 로 한다
(이미 있는 의존성). 지움+삽입이 붙어 있으면 "수정" 한 덩어리로 접고, 지워진
줄은 화면에 없으므로 남은 앞 줄에 표식을 붙인다.

영향: #git-gutter

### Decision 6 — DAP 는 순서를 가정하지 않는다 {#dap-no-order}

잠금 2026-08-23 · claude-code. 근거는 실측 (docs/dap/00-master-plan.md #no-order).

명세는 `initialize` → `initialized` → 설정 → `configurationDone` 으로 읽히지만,
`lldb-dap` 을 실제로 띄워 보니 **같은 어댑터가 실행마다 다른 순서로 답했다**
(`initialized` 가 `launch` 응답 앞에 오기도, 뒤에 오기도 했다). 순차 스크립트로
짜면 그중 절반에서 영영 멈춘다.

→ 세션은 이벤트 구동 상태 기계다. `launch` 는 응답을 기다리지 않고 보내고,
`initialized` 는 **이미 왔는지까지 보는 걸쇠**로 기다린다.

영향: #dap-pipe #dap-control

### Decision 7 — 어댑터 조달은 전략을 값으로 든다 {#dap-procurement}

잠금 2026-08-23 · claude-code.

언어 서버는 넷 다 PATH 위 실행 파일이었지만 디버그 어댑터는 그런 것이 오히려
적다: `lldb-dap` 은 Xcode 툴체인 안(`xcrun -f`), `debugpy` 는 파이썬 모듈,
`dlv` 는 하위 명령이다. 레지스트리가 `command: &str` 하나로는 부족해
`Path`/`Xcrun`/`Module`/`Subcommand` 를 값으로 든다.

자동 설치는 여전히 하지 않는다 (LSP 와 같은 결정) — 미설치는 안내로 끝낸다.

영향: #dap-pipe #dap-more-adapters

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
- [x] 인앱 육안 확인 — 드래그 이동 · 우클릭 메뉴 위치 · 분할 폭 (jsdom 이 못 보는 축) {#p1-verify}

## Phase 2 — LSP 나머지 창구 {#p2-lsp-rest}
- [x] 참조 찾기 (`textDocument/references`) — 결과 패널 {#lsp-references}
- [x] 심볼 아웃라인 (`documentSymbol`) — 파일 내 구조 + 점프 {#lsp-outline}
- [x] 워크스페이스 심볼 (`workspace/symbol`) — ⌘K 팔레트에 합류 {#lsp-workspace-symbol}
- [x] 시그니처 힌트 (`signatureHelp`) — 인자 입력 중 표시 {#lsp-signature}
- [x] 포맷팅 — 문서 전체 + 저장 시 포맷 + 선택 영역(`rangeFormatting`, ⇧⌥F 에 선택이 있을 때) {#lsp-format}
- [x] 설정 화면 — 언어별 켜기/끄기 · 서버 경로 오버라이드 · 미설치 안내 (lsp-code-intelligence #lsp-settings 를 여기로 이관) {#lsp-settings-screen}
- [x] git 거터 — 수정/추가/삭제된 줄을 에디터 안에 (LSP 아님, 기존 diff 백엔드 재사용) {#git-gutter}
- [x] 인앱 육안 확인 — 시그니처 툴팁 위치 · 거터 색 · 참조 패널 높이 · 아웃라인이 트리와 나눠 갖는 비율 {#p2-verify}

## Phase 3 — 디버거 (DAP) {#p3-dap}

lsp-code-intelligence 에서 **의도적으로 제외**했던 결정을 사용자가 다시 열었다
(2026-08-23). 가장 큰 덩어리이고, LSP 와 프로토콜이 다르다 — 프레이밍은 같은
`Content-Length` 지만 수명·상태 모델이 완전히 다르다(중단점·스텝·프레임·스코프).

- [x] 설계 문서 — docs/dap/00-master-plan.md. 어댑터 조달(언어별 debug adapter)·프로토콜·UI 모델을 먼저 못 박는다 {#dap-design}
- [x] dap/ — 프레이밍 · 어댑터 spawn · 요청 상관 · 이벤트 라우팅 {#dap-pipe}
- [x] 중단점 — 에디터 거터 토글 + 서버 동기 {#dap-breakpoints}
- [x] 실행 제어 — 계속/스텝오버/스텝인/스텝아웃 · 호출 스택 · 변수 스코프 {#dap-control}
- [~] 실행 구성 — launch 최소형(언어·실행 파일·인자·첫 줄 정지) 완료. attach 와 구성 영속(launch.json 격)은 미구현 {#dap-config}
- [ ] debugpy · dlv 왕복 검증 — 이 기계에 없어 조달 경로만 넣고 실제 세션은 못 돌렸다 (docs/dap PR-DAP1) {#dap-more-adapters}
- [x] 인앱 육안 확인 — 거터 클릭 반응 · 패널 높이 · 변수 트리 펼침 {#p3-verify}

## Phase 4 — 프로덕션급 다듬기 {#p4-polish}

사용자 요청 (2026-08-23): "각 파일 확장자에 맞게 아이콘 + 아마추어 같은
디자인·UX 를 cursor·vscode 급으로."

- [x] 확장자별 파일 아이콘 — v2: 공식 로고(TS/JS 사각형·파이썬 뱀·리액트 원자·러스트 기어·Vue·MD) + 상자 없는 색 글자 + 성질 아이콘. 모노그램 배지는 사용자 피드백으로 폐기 {#file-icons}
- [x] 트리 정렬·가이드 — 파일 행 캐럿 자리 확보(라벨 정렬), VS Code 식 들여쓰기 가이드, 폴더 열림/닫힘 아이콘 {#tree-polish}
- [x] 탭 다듬기 — 활성 탭을 편집면과 한 몸으로(같은 바탕+상단 액센트), 미저장 점/닫기 × 한 슬롯 {#tabs-polish}
- [x] 브레드크럼 — 경로 조각 클릭 → 트리에서 펼침 {#breadcrumbs}
- [x] 상태줄 — LSP 색점 · EOL(LF/CRLF) · 세그먼트화 {#statusbar-polish}
- [x] 잔손질 — 툴바 고스트 버튼 · 가는 스크롤바 · 필터 지우기 · 빈 상태 단축키 치트시트 · 메뉴 마감 {#chrome-polish}
- [x] 에이전트 변경 가시화 — 일지 칩(파일→일지 역조회) + 인라인 비교(HEAD/일지별, unifiedMergeView + 패치 역적용) {#agent-diff}
- [x] 패널 드래그 리사이즈 — 참조·디버그 패널 높이 조절 (다음 후보) {#panel-resize}
- [x] 인앱 육안 확인 — 배지 색 라이트/다크 가독성 · 가이드 선 정렬 · 활성 탭 모양 {#p4-verify}
- [x] 탭 키보드 UX — ⌘W 탭 닫기(닫기 사슬 합류) · ⌃Tab/⇧⌘]·[ 순환 · ⇧⌘T 재열기 · ⌘N 새 파일 · 메뉴 단축키 힌트 {#tab-keys}

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
| 2026-08-23T20:45:00+09:00 | #lsp-references | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | 파일별 묶음 + 줄 원문 미리보기 · ⇧F12 · 편집 영역 아래 전체 폭 패널 |
| 2026-08-23T20:45:01+09:00 | #lsp-outline | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | 계층/평면 응답을 평면+depth 로 통일 · 사이드바 접이식 · 커서 위치 표시 |
| 2026-08-23T20:45:02+09:00 | #lsp-workspace-symbol | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | ⌘K 「심볼」 그룹. 이미 떠 있는 서버에만 묻는다(running_clients) |
| 2026-08-23T20:45:03+09:00 | #lsp-signature | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | CM6 StateField 툴팁. 인자 구간은 UTF-16 오프셋으로 백엔드가 통일 |
| 2026-08-23T20:45:04+09:00 | #lsp-format | claude-code | ☐→~ | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | 문서 전체 + 저장 시 포맷. rangeFormatting 은 미구현 |
| 2026-08-23T20:45:05+09:00 | #lsp-settings-screen | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | 설정 코드 탭 — 상태·켜기/끄기·경로 오버라이드·설치 안내. 바꾸면 서버 정리 |
| 2026-08-23T20:45:06+09:00 | #git-gutter | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | HEAD 블롭 ↔ 버퍼를 similar 로. 지움+삽입=수정, 삭제는 앞 줄에 |
| 2026-08-23T20:45:07+09:00 | #p2-verify | claude-code | →☐ | .oculpm/journal/20260823/Features_to_add/2045_feature_lsp-phase2-and-git-gutter.md | 신규 — 툴팁 위치·거터 색·패널 높이는 사용자 확인 필요 |
| 2026-08-23T21:30:00+09:00 | #dap-design | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | docs/dap/00-master-plan.md — lldb-dap 실측 뒤에 작성 (순서·pathFormat·조달) |
| 2026-08-23T21:30:01+09:00 | #dap-pipe | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | framing 공용화 + protocol/registry/client/session/state. 실제 lldb-dap 왕복 2건 |
| 2026-08-23T21:30:02+09:00 | #dap-breakpoints | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | 거터 클릭 토글 · 못 거는 줄은 속 빈 원 · 저장소는 세션보다 오래 산다 |
| 2026-08-23T21:30:03+09:00 | #dap-control | claude-code | ☐→x | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | 계속/스텝3/중지 · 호출 스택(밖 프레임 흐리게) · 변수 지연 트리 · 콘솔 |
| 2026-08-23T21:30:04+09:00 | #dap-config | claude-code | ☐→~ | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | launch 최소형만. attach·구성 영속은 미구현 |
| 2026-08-23T21:30:05+09:00 | #dap-more-adapters | claude-code | →☐ | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | 신규 — debugpy·dlv 미설치라 왕복 미검증 |
| 2026-08-23T21:30:06+09:00 | #p3-verify | claude-code | →☐ | .oculpm/journal/20260823/Features_to_add/2130_feature_dap-debugger.md | 신규 — 거터 클릭·패널 높이·변수 펼침은 사용자 확인 필요 |
| 2026-08-23T23:05:00+09:00 | #file-icons | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | FileIcon.tsx — 판정 순수함수(파일명>확장자) + 테스트 6 |
| 2026-08-23T23:05:01+09:00 | #tree-polish | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | 캐럿 자리 확보로 라벨 정렬 · 가이드 gradient · 폴더 열림 상태 |
| 2026-08-23T23:05:02+09:00 | #tabs-polish | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | bg-content 연결 + 상단 액센트 + 점/× 슬롯 |
| 2026-08-23T23:05:03+09:00 | #breadcrumbs | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | 폴더 조각 → revealDir(필터 걷고 조상 펼침) |
| 2026-08-23T23:05:04+09:00 | #statusbar-polish | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | LSP 색점(펄스는 reduced-motion 대응) · EOL 표시 |
| 2026-08-23T23:05:05+09:00 | #chrome-polish | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | 고스트 툴바 · 오버레이 스크롤바 · 빈 상태 치트시트 |
| 2026-08-23T23:05:06+09:00 | #p4-verify | claude-code | →☐ | .oculpm/journal/20260823/Features_to_add/2305_feature_code-ide-visual-polish.md | 신규 — 배지 색·가이드·탭 모양은 눈이 판정 |
| 2026-08-23T23:35:00+09:00 | #file-icons | claude-code | x→x | .oculpm/journal/20260823/Features_to_add/2335_feature_real-icons-and-agent-diff.md | v2 재작성 — 배지 폐기, 공식 로고+Seti 글자. 판정 테스트 8 |
| 2026-08-23T23:35:01+09:00 | #agent-diff | claude-code | →x | .oculpm/journal/20260823/Features_to_add/2335_feature_real-icons-and-agent-diff.md | 일지 칩·인라인 비교(HEAD/일지). 역적용은 엄격 실패. 테스트 19 |
| 2026-08-24T00:20:00+09:00 | #p1-verify | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | 사용자가 앱에서 확인 (2026-08-24) |
| 2026-08-24T00:20:01+09:00 | #p2-verify | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | 사용자가 앱에서 확인 |
| 2026-08-24T00:20:02+09:00 | #p3-verify | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | 사용자가 앱에서 확인 |
| 2026-08-24T00:20:03+09:00 | #p4-verify | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | 사용자가 앱에서 확인 (아이콘 v2 포함) |
| 2026-08-24T00:20:04+09:00 | #panel-resize | claude-code | ☐→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | 드래그+키보드, codePanelHeight 영속. 드래그 중 로컬/놓으면 영속 |
| 2026-08-24T00:20:05+09:00 | #lsp-format | claude-code | ~→x | .oculpm/journal/20260824/Features_to_add/0020_feature_ide-finishing-round.md | rangeFormatting — 선택 있으면 범위만. specta 인자 한계로 구조체 파라미터 |
| 2026-08-24T01:35:00+09:00 | #tab-keys | claude-code | →x | .oculpm/journal/20260824/Features_to_add/0135_feature_code-tab-keyboard-ux.md | 신규 완료 — ⌘W 는 closeIntent 사슬, 나머지는 화면 keydown. 테스트 11 |
<!-- oculpm:plan-log end -->
