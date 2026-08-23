---
oculpm_plan: v1
id: lsp-code-intelligence
title: "코드 인텔리전스 — 코드 화면에 LSP"
status: active
created: 2026-08-21
updated: 2026-08-21
owner: claude-code
---

코드 화면(CodeMirror 6)에 LSP 를 붙여 "에디터" 를 "IDE" 로. VS Code 포크 대신 고른 길 —
근거와 설계는 SSOT: docs/lsp/00-master-plan.md

## 결정

### Decision 1 — VS Code 를 포크하지 않는다 {#no-vscode-fork}

잠금 2026-08-21 · claude-code · Code-OSS 1.135.0 을 실제로 받아 비교한 뒤.

근거: `src/` 만 TS 8,572 파일(ocul-pm 프런트 295의 29배)이라 유지보수가 영원한 리베이스가 된다 ·
`product.json` 의 `extensionsGallery` 가 `null` 이라 마켓플레이스는 MIT 소스에 없고 Open VSX 에는
MS 독점 확장(Pylance·C/C++·Remote-SSH·Dev Containers)이 없다 · Electron 42 는 24MB→200MB대이며
"Tauri, not Electron" 정체성을 뒤집는다 · 무엇보다 이 제품의 해자는 에디터가 아니라 에이전트
중립적 기록층이라, 한 에디터에 묶는 순간 그 성질을 버린다.

대신: 남은 격차인 LSP 를 직접 붙인다. 받아 둔 체크아웃은 참고 자료로만 쓴다.

영향: #lsp-framing #lsp-registry #lsp-client #lsp-editor

### Decision 2 — 위치는 변환하지 않고 통과시킨다 {#position-passthrough}

잠금 2026-08-21 · claude-code.

LSP `Position.character` 는 UTF-16 코드 유닛이고 JS 문자열도 UTF-16 이라 프런트와 LSP 는 이미
같은 단위다. Rust `String` 은 UTF-8 이라 중간에서 오프셋을 계산하면 거기서만 어긋난다 — 특히
한글 주석이 흔한 이 저장소에서. 프런트가 `{line, character}` 를 만들고 Rust 는 통과만 한다.

영향: #lsp-client #lsp-completion #lsp-editor

## Phase 0 — 파이프 {#p0-pipe}
- [x] lsp/framing.rs — Content-Length 코덱 (부분 수신·헤더 분할·잘못된 길이). MCP 의 개행 구분과 다르므로 재사용 불가 {#lsp-framing}
- [x] lsp/registry.rs — 언어→ServerSpec(command·args·root_markers) + 열린 파일에서 위로 올라가는 루트 탐색 {#lsp-registry}
- [x] lsp/client.rs — 프로세스 spawn(acp/env.rs 의 로그인 셸 PATH 재사용) · initialize 핸드셰이크 · 요청 id 상관 · 서버 알림 라우팅 {#lsp-client}
- [x] lsp/state.rs — (project_id, language, root) 키의 서버 인스턴스 관리 + 정리 {#lsp-state}
- [x] commands/lsp.rs — lsp_status / lsp_open / lsp_change / lsp_close / lsp_completion / lsp_stop + lib.rs 등록 + bindings 재생성 {#lsp-commands}
- [x] Channel<LspEvent> — Diagnostics · Status(인덱싱 중·미설치·죽음). 조용히 실패하지 않는 것이 요점 {#lsp-events}
- [x] CodeEditor — @codemirror/lint 진단 밑줄 + @codemirror/autocomplete 완성 소스 (직접 의존으로 추가 완료: pnpm strict layout 이라 호이스팅 안 됨) {#lsp-editor}
- [x] 상태줄 — 서버 상태 표시 (인덱싱 중/준비됨/미설치) {#lsp-statusline}
- [x] 검증 — rust-analyzer 로 실제 src-tauri/ 코드에서 진단·완성 확인 + 게이트 5종 {#lsp-verify}

## Phase 1 — 읽기 기능 {#p1-read}
- [x] 호버 — 타입·문서 툴팁 {#lsp-hover}
- [x] 정의로 이동 — 기존 CodeEditor jumpLine 핸드오프 재사용 {#lsp-definition}

## Phase 2 — 쓰기 기능 {#p2-write}
- [x] 이름 바꾸기 — 서버 WorkspaceEdit 을 code_write 낙관적 잠금과 함께 적용 {#lsp-rename}
- [x] 코드 액션 — quick fix 적용 {#lsp-code-action}

## Phase 3 — 설정 {#p3-config}
- [ ] 설정 화면 — 언어별 켜기/끄기·서버 경로 오버라이드·미설치 안내. **[ide-completion](ide-completion.md) #lsp-settings-screen 으로 이관** (2026-08-23) — 남은 LSP 창구와 한 라운드에 묶는 편이 낫다 {#lsp-settings}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-21T19:49:39+09:00 | #lsp-framing | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | Content-Length 코덱 + 부분 수신 전 경계 테스트 |
| 2026-08-21T19:49:40+09:00 | #lsp-registry | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 워크스페이스 루트 탐색 · 프로젝트 밖 탈출 방지 |
| 2026-08-21T19:49:41+09:00 | #lsp-client | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | acp::env 재사용 · stderr 를 기동 실패 메시지에 |
| 2026-08-21T19:49:42+09:00 | #lsp-state | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 키별 락으로 같은 서버 중복 기동 방지 |
| 2026-08-21T19:49:43+09:00 | #lsp-commands | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 커맨드 6종 + code_read 와 같은 심링크 가드 |
| 2026-08-21T19:49:44+09:00 | #lsp-events | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 진단·상태 이벤트 (조용한 실패 금지) |
| 2026-08-21T19:49:45+09:00 | #lsp-editor | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 진단은 트랜잭션 · 완성 filter:false · 비대상 파일 제외 |
| 2026-08-21T19:49:46+09:00 | #lsp-statusline | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | "분석 중" 을 밝힌다 |
| 2026-08-21T19:49:47+09:00 | #lsp-verify | claude-code | ☐→~ | .oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md | 실 rust-analyzer 3/3 + 게이트 5종 그린. 인앱 육안 확인만 남음 |
| 2026-08-21T22:01:09+09:00 | #lsp-hover | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/2201_feature_lsp-hover-and-definition.md | 세 응답 모양 관용 처리 · 500ms 지연 · 마크다운 렌더러 없이 코드/산문만 구별 |
| 2026-08-21T22:01:10+09:00 | #lsp-definition | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/2201_feature_lsp-hover-and-definition.md | targetSelectionRange 우선(심볼 이름) · 프로젝트 밖은 말해 준다 · F12·⌘클릭 |
| 2026-08-21T22:05:00+09:00 | #lsp-verify | claude-code | ~→x | .oculpm/journal/20260821/Features_to_add/2201_feature_lsp-hover-and-definition.md | 사용자가 앱에서 육안 확인 |
| 2026-08-21T22:16:00+09:00 | #lsp-rename | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/2216_feature_lsp-rename.md | 전부-아니면-전무 적용 · UTF-16→바이트 변환을 edit.rs 한 곳에 · 실서버로 3곳+한글 검증 |
| 2026-08-21T22:26:00+09:00 | #lsp-code-action | claude-code | ☐→x | .oculpm/journal/20260821/Features_to_add/2226_feature_lsp-code-actions.md | 원본 진단을 context 로 · command 전용 제외 · 적용은 rename 과 공용 경로 |
| 2026-08-23T12:20:00+09:00 | #lsp-settings | claude-code | ☐→☐ | .oculpm/journal/20260823/Chores/1215_chore_release-v2-15-0.md | ide-completion #lsp-settings-screen 으로 이관 — Phase 0~2 는 v2.15.0 으로 출시됨 |
<!-- oculpm:plan-log end -->
