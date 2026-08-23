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

## Phase 0 — 지연 로딩 트리 {#p0-tree}
- [x] 숨김 파일 표시 + `.git` 예외 (v2.15.0 선행분) {#hidden-done}
- [ ] `code_dir` — 디렉터리 한 단계만 읽는 커맨드 (파일/폴더 · 크기 · gitignore 여부). 기존 `code_tree` 는 필터 검색용으로 남길지 함께 판단 {#tree-backend}
- [ ] 프런트 — 펼침 시 로드 · 로딩 표시 · 이미 읽은 단계 캐시 · 접었다 펴도 재요청 안 함 {#tree-frontend}
- [ ] gitignore 항목은 흐리게(dim) 구분 — 보이되 "이건 저장소가 무시한다" 를 밝힌다 {#tree-dim}
- [ ] 필터 입력이 지연 로딩과 어긋나지 않게 — 안 읽은 가지의 매치를 어떻게 찾을지 결정 {#tree-filter}

## Phase 1 — 탭과 파일 조작 {#p1-tabs}
- [ ] 탭 바 — 여러 파일 동시 열기. 버퍼 캐시(`codeBuffers`, 20개 상한)는 이미 있으니 UI 만 {#tabs-bar}
- [ ] 탭 상태 영속 — `WorkspaceContext` 경유 (직접 localStorage 금지) {#tabs-persist}
- [ ] 분할 화면 — 좌우 2분할 {#tabs-split}
- [ ] `code_create` / `code_mkdir` / `code_rename` / `code_delete` — 커맨드가 아예 없다. `secure_join` 가드·심링크 이탈 방지는 `code_read` 경로 재사용 {#file-ops-backend}
- [ ] 트리 컨텍스트 메뉴 + 인라인 이름 입력 · 삭제 확인 · 열린 버퍼와의 정합(삭제/이름변경된 파일이 탭에 열려 있을 때) {#file-ops-ui}
- [ ] 드래그로 이동 {#file-ops-dnd}

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
