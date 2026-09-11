---
oculpm_plan: v1
id: vscode-extension-round
title: "VS Code 확장 — 앱은 Tauri 그대로, 편집은 진짜 VS Code"
status: active
created: 2026-09-11
updated: 2026-09-11
owner: claude-code
---

포크·별도 IDE 를 기각하고(.oculpm/discussion/vscode-extension) 확장 `ocul-pm` 이 같은 .oculpm/*.md 를 옆에서 읽고 쓴다. 방안 A: Node 만·설치된 앱의 oculpm-mcp 재사용·읽기 전용 강등·웹뷰 없음. 모노레포 extension/, engines.vscode ^1.101.0, Open VSX + MS 마켓 이중 게시. 첫 데모 = 에이전트가 journal_write 하면 사이드바에 즉시 뜬다.

## Phase 0 — 스캐폴드와 계약: 확장이 앱 없이도 뜬다 {#scaffold}
- [x] `extension/` 에 `yo code`(generator-code 최신) TypeScript+esbuild 로 스캐폴드 — pnpm 워크스페이스에 편입하되 루트 `pnpm typecheck/test/lint/build` 게이트는 건드리지 않는다. `engines.vscode ^1.101.0`, publisher `oculpm`, 이름 `ocul-pm`. 확인: `cd extension && pnpm compile && pnpm test` 가 exit 0 이고 F5 로 Extension Host 가 뜬다 {#sc-gen}
  - [x] 루트 `pnpm lint` 6게이트가 `extension/` 을 어떻게 볼지 결정 — file-size·eslint 는 포함, storage(localStorage 금지)·i18n·bindings·design 은 스코프 밖으로 명시. 확인: 루트 `pnpm lint` exit 0 {#sc-gen-lint}
  - [x] 확장 LICENSE·README(en, 마켓 리스팅용)·CHANGELOG 를 루트와 분리하지 않고 루트 CHANGELOG 에 `### 확장` 소절로 싣는 규약을 docs/RELEASE.md 에 적는다 {#sc-gen-license}
- [x] `.oculpm` 읽기 계층(`extension/src/oculpm/`)을 순수 함수로 — 일지 경로 규약(`journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md`)·frontmatter(YAML) 파싱·플랜 항목(`- [ ] … ` 뒤 id 앵커, 글리프 6종) 파싱. 확인: 이 저장소의 실제 `.oculpm/` 을 픽스처로 복사한 vitest 가 오늘 일지 수·활성 플랜 항목 수를 앱 Today 화면과 같은 값으로 센다 {#sc-reader}
  - [x] 픽스처 = `src-tauri/tests/` 가 쓰는 `.oculpm` 샘플과 동일 소스에서 복사(중복 스키마 방지) — 규격이 바뀌면 양쪽 테스트가 같이 붉어진다 {#sc-reader-fixture}
  - [x] 플랜 글리프 `[ ] [~] [x] [!] [>] [-]` 6종과 `<!-- oculpm:plan-log -->` 블록을 파싱만 하고 건드리지 않는다 — AGENTS.md §4 를 그대로 인용한 테스트 {#sc-reader-glyph}
- [x] 앱 바이너리 탐색 `findOculpmMcp()` — `/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp` → `~/Applications/…` → 설정 `oculpm.mcpBinaryPath` 순. 없으면 `readOnly=true` 로 활성화하고 상태바에 '읽기 전용 — Ocul-PM 설치' 안내(클릭 → oculpm.com). 확인: 경로를 비운 테스트에서 활성화가 throw 없이 끝나고 커맨드 팔레트에 쓰기 커맨드가 `when: !oculpm.readOnly` 로 숨는다 {#sc-binary}

## Phase 1 — 사이드바: 첫 데모 장면 {#sidebar}
- [x] Activity Bar 컨테이너 `ocul-pm` + TreeView 2개 — '오늘 일지'(날짜→타입 폴더→항목, 최근 7일 접힘)·'활성 플랜'(플랜→Phase→항목, 글리프를 ThemeIcon 으로). 확인: 이 저장소를 열면 오늘 일지와 `monaco-editor-round` 등 활성 플랜이 앱 사이드바와 같은 개수로 뜬다 {#sb-tree}
  - [x] 일지 클릭 → `vscode.open` 으로 .md 를 내장 마크다운 미리보기(`markdown.showPreview`)로, ⌥클릭은 편집기로. 웹뷰 없음 {#sb-tree-open}
  - [x] 컨텍스트 메뉴 — 'Ocul-PM 에서 열기'(`oculpm://open?project=&view=journal&entry=`), '경로 복사'. 확인: 딥링크가 실행 중인 앱의 해당 일지를 연다(deeplink.rs 계약) {#sb-tree-cmds}
- [x] `FileSystemWatcher('**/.oculpm/{journal,planner}/**/*.md')` 로 트리 즉시 갱신 — `.oculpm/index/**` 는 글롭에서 제외(앱 관리 캐시, 폭주 방지), 100ms 디바운스. 확인: Claude Code 가 `journal_write` 한 뒤 1초 안에 트리에 새 항목이 뜬다(수동 시나리오를 EVALS 에) {#sb-watch}
  - [x] 멀티루트 워크스페이스 — 폴더마다 `.oculpm` 유무를 판정해 있는 폴더만 루트 노드로. 확인: `.oculpm` 없는 폴더 하나만 열면 Welcome 뷰('추적 안 됨 — 앱에서 프로젝트 추가')가 뜬다 {#sb-watch-multi}
- [x] 플랜 항목 체크박스(TreeItemCheckboxState) 토글 → `[ ]`↔`[x]` 를 **oculpm-mcp 의 `plan_update`** 로 쓴다(직접 파일 수정 금지 — plan-log·잠금·base_hash 는 서버 규격). 읽기 전용 모드에선 체크박스 비활성 + 이유 툴팁. 확인: 토글 후 앱 플래너 화면이 워처로 같이 바뀌고 plan-log 에 `agent=vscode-ext` 행이 붙는다 {#sb-toggle}
  - [x] 확장 안에 최소 MCP stdio 클라이언트(`@modelcontextprotocol/sdk` Client + StdioClientTransport)로 `plan_status`(hash 취득)→`plan_update(base_hash)` 두 호출. 해시 충돌(병렬 세션)은 토스트로 '다시 읽음' 후 재시도 1회 {#sb-toggle-client}
  - [x] `status: done/archived` 플랜은 토글 자체를 막고 툴팁에 '잠긴 플랜'. 확인: 잠긴 플랜 픽스처에서 체크박스가 안 그려진다 {#sb-toggle-lock}

## Phase 2 — 에이전트 연동: Copilot 이 우리 도구를 본다 {#agents}
- [x] `contributes.mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider('oculpm', …)` 로 워크스페이스 폴더마다 `McpStdioServerDefinition{command: findOculpmMcp(), cwd: folder}` 제공. 확인: 'MCP: List Servers' 에 `oculpm (<폴더명>)` 이 뜨고 Copilot 에이전트 모드에서 `journal_write` 도구가 보인다 {#ag-mcp}
  - [x] 바이너리 없으면 정의를 0개 반환(오류 아님). `onDidChangeMcpServerDefinitions` 는 설정 변경·폴더 추가에 발화 {#ag-mcp-env}
  - [x] AGENTS.md 가 없는 추적 프로젝트에 '기록 규칙 주입' 커맨드 — 앱과 같은 템플릿(`.oculpm/agents/_template.md`) 을 쓰고 확장이 별도 복사본을 갖지 않는다. 확인: 주입 결과가 앱의 AGENTS.md 동기 결과와 바이트 동일 {#ag-mcp-rules}
- [x] Cursor·Antigravity 경로 — `vscode.lm` 미지원 감지(`typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function'`) 시 `.cursor/mcp.json` 에 `oculpm` 키만 머지하는 옵인 커맨드(register.rs 의 규율: 남의 키 보존·파싱 불가 파일 무접촉). 확인: 손상 JSON 픽스처를 절대 덮어쓰지 않는 테스트 {#ag-cursor}
- [-] Copilot 에이전트 세션 실측 — VS Code 가 `.claude/settings.local.json` 훅을 읽어 우리 인박스(`.oculpm/hooks/claude-events.jsonl`)에 SessionStart/Stop 을 append 하는지 확인하고 payload 원문을 `docs/vscode-extension/01-copilot-hook-payload-actual.md` 에 남긴다(camelCase·SessionEnd 부재·session_id 형식). 귀속 수정은 하지 않는다 — 후속 플랜 항목으로 이월 {#ag-copilot-probe}
  - [-] 실측에서 인박스 파서(`claude_hooks.rs`)가 Copilot payload 로 세션을 잘못 열거나 못 닫는 경우가 보이면 그 사례를 같은 문서에 재현 라인으로 적는다 {#ag-copilot-probe-risk}

## Phase 3 — 앱 쪽 반쪽: 왕복과 안내 {#app-side}
- [x] 앱 코드 화면·일지 모달의 'VS Code 로 열기'(external_editor.rs) 가 설치된 확장을 감지하면 `code --goto <path>:<line>` 대신 확장 커맨드 URI(`vscode://oculpm.ocul-pm/open?entry=`) 로 사이드바까지 맞춘다. 확인: 앱에서 일지 열기 → VS Code 트리에서 그 일지가 선택 상태 {#app-editor-open}
- [x] 앱이 `oculpm://open` 의 `view`/`entry` 를 실제로 쓴다 — 지금 `ProjectTab.tsx` 의 `open` 핸들러는 `openProjectTab` 만 하고 둘을 버린다. 확장은 `entry` 에 일지 **절대경로**를 `%20` 인코딩으로 보낸다(`extension/src/deeplink.ts`). 확인: 확장 컨텍스트 메뉴 'Ocul-PM 에서 열기' → 앱이 그 프로젝트 탭의 일지 화면에서 해당 일지를 연다 {#app-deeplink-entry}
- [x] 앱 설정 > 통합에 'VS Code 확장' 행 — 설치 여부(`code --list-extensions | grep oculpm.ocul-pm`)·마켓 링크 2개(MS·Open VSX). 확인: 미설치/설치 두 상태 스냅샷 테스트 {#app-settings}
- [x] `src-tauri/tests/egress_inventory.rs` 원장 — 확장 감지가 새 아웃바운드를 만들지 않음을 확인(로컬 프로세스 호출뿐). 확장 자체의 아웃바운드는 0(마켓 링크는 사용자 클릭). README 프라이버시 문단에 확장 한 줄 추가 {#app-egress}

## Phase 4 — 게시: Open VSX + MS 마켓, 릴리스 6면 {#release}
- [x] `.github/workflows/extension-release.yml` — 태그 `ext-v*` 로 `HaaLeo/publish-vscode-extension` 을 Open VSX(먼저, .vsix 산출) → MS 마켓(같은 .vsix) 순으로 2회. 시크릿 `OPEN_VSX_TOKEN`·`VSCE_PAT` 는 GH secret. 확인: dry-run(`--dry-run`) 잡이 초록 {#rel-ci}
  - [x] Open VSX 네임스페이스 `oculpm` 선등록 + MS publisher `oculpm` 생성(Azure DevOps PAT, Marketplace scope) — 수동 단계를 docs/RELEASE.md 에 체크리스트로 {#rel-ci-ns}
  - [x] `vsce package` 산출물을 앱 릴리스 자산에도 첨부(오프라인 설치 `code --install-extension`). 확인: release.yml 이 .vsix 를 업로드 {#rel-ci-vsix}
- [x] 릴리스 체크리스트 6면째 — docs/RELEASE.md·CHANGELOG `### 확장` 소절·README ko/en '확장' 절·landing ko/en(bento 셀+FAQ '편집기는 왜 VS Code 인가')+`node landing/wiki-src/build.mjs`. 확인: `landing/plugin.html` 류 게이트가 있으면 확장 페이지도 같은 방식으로 누락을 막는다 {#rel-docs}
- [x] 실기기 확인 — 설치본 앱 + 마켓에서 설치한 확장으로 EVALS.md 시나리오 전부(첫 데모·토글 왕복·Copilot 도구 노출·읽기 전용 강등). 결과를 EVALS 기록 표에 적는다 {#rel-eyes}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-11T14:17:33+09:00 | #sc-gen-lint | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1417_feature_vscode-ext-scaffold.md | 루트 eslint 는 extension/** 무시(.vscode-test 크롤 OOM), 7종째 lint:extension 추가. 4게이트는 src/만, filesize 는 ls-files |
| 2026-09-11T14:17:39+09:00 | #sc-gen-license | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1417_feature_vscode-ext-scaffold.md | docs/RELEASE.md §2-1 — 확장 CHANGELOG 없음, 루트 `### 확장` 소절, LICENSE 복사본 |
| 2026-09-11T14:24:04+09:00 | #sc-reader-fixture | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1423_feature_vscode-ext-oculpm-reader.md | Rust 인라인 샘플 2개 → src-tauri/tests/fixtures/*.md (include_str!), vitest 가 같은 파일 읽음 |
| 2026-09-11T14:24:10+09:00 | #sc-reader-glyph | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1423_feature_vscode-ext-oculpm-reader.md | 글리프 6종·첫 {#id}·롤업·plan-log 파싱만 — 쓰기 없음 |
| 2026-09-11T14:28:50+09:00 | #sc-binary | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1428_feature_vscode-ext-binary-readonly.md | 설정→/Applications→~/Applications, readOnly 컨텍스트+상태바, 커맨드 분류 게이트(WRITE 는 아직 0) |
| 2026-09-11T15:49:00+09:00 | #app-deeplink-entry | claude-code | →☐ | .oculpm/journal/20260911/Features_to_add/1548_feature_vscode-ext-sidebar-trees.md | 앱이 view/entry 를 버리는 것을 확장 구현 중 발견 — Phase 3 로 신설 |
| 2026-09-11T15:48:43+09:00 | #sb-tree-open | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1548_feature_vscode-ext-sidebar-trees.md | 클릭→markdown.showPreview, 편집기는 인라인 $(go-to-file)(트리엔 ⌥클릭 없음) |
| 2026-09-11T15:48:49+09:00 | #sb-tree-cmds | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1548_feature_vscode-ext-sidebar-trees.md | oculpm://open 조립(%20 — 앱 percent_decode 는 + 미복원)·경로 복사. 앱이 entry 를 쓰는 건 #app-deeplink-entry |
| 2026-09-11T15:58:01+09:00 | #sb-watch-multi | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1557_feature_vscode-ext-watcher.md | 폴더마다 RelativePattern 워처(index 제외), 미추적 폴더는 Welcome, 첫 일지 create 가 추적 시작 신호 |
| 2026-09-11T17:00:56+09:00 | #sb-toggle-client | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1700_feature_vscode-ext-checkbox-toggle.md | SDK 대신 직접 라인 JSON-RPC(서버와 같은 이유), plan_status→plan_update, 충돌 1회 재시도, OCULPM_AGENT_ID=vscode-ext |
| 2026-09-11T17:01:03+09:00 | #sb-toggle-lock | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1700_feature_vscode-ext-checkbox-toggle.md | checkboxFor: 잠긴 플랜·부모·읽기 전용은 체크박스 없음+이유 툴팁, 서버도 잠긴 플랜 거부(테스트) |
| 2026-09-11T17:06:33+09:00 | #ag-mcp-env | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1706_feature_vscode-ext-mcp-provider.md | 바이너리 없으면 0개, 폴더·설정 변경·재탐색에 onDidChange 발화 |
| 2026-09-11T17:06:38+09:00 | #ag-mcp-rules | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1706_feature_vscode-ext-mcp-provider.md | project_init 의 ensure 시맨틱(sync_active) 재사용 — 같은 Rust 함수라 바이트 동일, 확장은 템플릿 복사본 없음 |
| 2026-09-11T17:10:29+09:00 | #ag-cursor | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1710_feature_vscode-ext-cursor-mcp-json.md | mergeCursorMcpJson 순수(손상 JSON 무접촉·남의 키 보존·멱등), oculpm.mcpProviderApi 컨텍스트로 VS Code 에선 숨김 |
| 2026-09-11T17:11:13+09:00 | #ag-copilot-probe-risk | claude-code | ☐→- |  | 사용자 결정 2026-09-11: Copilot 비중요 — 실측 폐기 |
| 2026-09-11T17:17:07+09:00 | #app-editor-open | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1716_feature_app-open-entry-in-vscode-ext.md | vscode_ext.rs 감지(확장 폴더)+vscode:// URI, 확장 onUri 핸들러+reveal. 코드 화면은 code --goto 유지(일지 전용) |
| 2026-09-11T17:23:22+09:00 | #app-deeplink-entry | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1723_feature_app-deeplink-open-entry.md | open 승인 → trayOpenMain(openNavFor) — 팝오버의 TrayNavigate 경로 재사용, 백엔드 변경 0 |
| 2026-09-11T17:33:17+09:00 | #app-settings | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1733_feature_app-settings-vscode-extension-row.md | vscode_extension_status 커맨드 + VscodeExtensionBlock(머신 전역), 스냅샷 2상태. 판정은 확장 폴더(code CLI 는 PATH 없음) |
| 2026-09-11T17:43:59+09:00 | #app-egress | claude-code | ☐→x | .oculpm/journal/20260911/Chores/1743_chore_vscode-ext-egress-ledger.md | 원장이 마켓 호스트 2개를 잡음→사유 등록. 확장 egress.spec(프리미티브 0·호스트 oculpm.com 뿐). README ko/en 한 줄 |
| 2026-09-11T17:53:07+09:00 | #rel-ci-ns | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1753_feature_vscode-ext-release-workflow.md | RELEASE.md §2-1 수동 체크리스트(네임스페이스 선등록·publisher·PAT 스코프·시크릿 2개). 실제 토큰 발급은 사용자 몫 |
| 2026-09-11T17:53:13+09:00 | #rel-ci-vsix | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1753_feature_vscode-ext-release-workflow.md | release.yml 이 vsce package 후 gh release upload — CI 실증은 다음 v* 태그에서 |
| 2026-09-11T18:01:59+09:00 | #rel-docs | claude-code | ☐→x | .oculpm/journal/20260911/Chores/1801_chore_vscode-ext-release-surfaces.md | v2.48.0 6면 + bump(미커밋·미태그) + extension_docs_surfaces 게이트. 태그·vercel 은 사용자 결정 |
| 2026-09-11T18:15:42+09:00 | #rel-eyes | claude-code | ☐→! |  | 사용자 손 필요 — 마켓 게시(토큰 2개 미발급) 뒤 설치본 앱+확장으로 EVALS 10 시나리오. 그 전엔 로컬 .vsix(0.0.1 빌드) 로 대체 가능 |
| 2026-09-11T12:20:04.095391+00:00 | #rel-eyes | user | !→☐ |  |  |
| 2026-09-11T12:20:04.752009+00:00 | #rel-eyes | user | ☐→~ |  |  |
| 2026-09-11T12:20:06.754506+00:00 | #rel-eyes | user | ~→x |  |  |
<!-- oculpm:plan-log end -->
