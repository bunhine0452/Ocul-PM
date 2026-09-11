---
schema_version: 1
type: feature
slug: "vscode-ext-scaffold"
status: done
difficulty: low
created_at: "2026-09-11T14:17:23+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/package.json"
    op: create
  - path: "extension/src/extension.ts"
    op: create
  - path: "extension/src/test/extension.test.ts"
    op: create
  - path: "extension/esbuild.js"
    op: create
  - path: "extension/eslint.config.mjs"
    op: create
  - path: "extension/README.md"
    op: create
  - path: "extension/LICENSE"
    op: create
  - path: "extension/icon.png"
    op: create
  - path: "eslint.config.js"
    op: update
  - path: "package.json"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "scaffold"
  - "ci"
  - "mcp-tool"
---
[x] VS Code 확장 스캐폴드 — extension/ 별도 패키지, 루트 게이트 7종째 lint:extension

## 추가 기능

플랜 `vscode-extension-round` Phase 0 `{#sc-gen}` — `generator-code@1.12.0` 으로 TypeScript+esbuild 스캐폴드(`yo code -t=ts --bundler=esbuild --pkgManager=pnpm`)를 `extension/` 에 넣었다. publisher `oculpm`, id `ocul-pm`, `engines.vscode ^1.101.0`(MCP 공급자 API 하한 — 생성기 기본 `^1.137.0` 을 내렸고 `@types/vscode` 도 같이 `^1.101.0`), 활성화 `workspaceContains:.oculpm/journal`. Hello World 대신 커맨드 하나 `ocul-pm.openWebsite`(`openExternal`, 사용자 클릭만 — 아웃바운드 0 규칙).

## 동작 흐름

- **워크스페이스로 묶지 않았다**(플랜 문구는 "워크스페이스 편입"이었으나 목적은 "루트 게이트 무변경"): `pnpm-workspace.yaml` 을 새로 만들면 루트 락파일·호이스팅이 바뀌어 `tauri dev` 경로에 위험이 든다. 별도 패키지 + 별도 락파일이 그 목적을 구조적으로 만족한다. CI 에 `pnpm install --frozen-lockfile`(working-directory: extension) 한 단계 추가.
- **루트 `eslint .` 가 힙 4GB 를 넘겨 죽었다** — `extension/.vscode-test/**`(테스트용 VS Code 통째)를 기어 들어갔다. 루트 eslint 는 `extension/**` 를 무시하고, 루트 `pnpm lint` 에 7종째 `lint:extension`(`pnpm -C extension check-types && lint`)을 붙여 확장은 자기 설정으로 린트한다. storage·i18n·bindings·design 4게이트는 `src/` 만 걷고, filesize 는 `git ls-files` 라 확장 소스를 이미 본다(`.gitignore` 로 `dist/out/.vscode-test` 제외) — `{#sc-gen-lint}`.
- `extension/CHANGELOG.md` 는 루트를 가리키는 한 줄, LICENSE 는 루트 복사본, 규약을 `docs/RELEASE.md` §2-1 에 적었다 — `{#sc-gen-license}`.

## 검증

- `cd extension && pnpm compile && pnpm test` exit 0 — `@vscode/test-cli` 가 VS Code stable 을 받아 Extension Host 에서 2 테스트(활성화·커맨드 등록) 통과.
- 루트 `pnpm typecheck` · `pnpm test`(205 파일 2652) · `pnpm build` · `pnpm lint:js`(경고 4=상한) · `pnpm lint:extension` 전부 exit 0. `pnpm lint:filesize` 는 **다른 세션의 WIP**(`manager/lifecycle.rs` 834줄·`manager/tests.rs` 2332줄)로 붉다 — 이 작업과 무관.
- F5 는 `extension/.vscode/launch.json`(생성기 산출)로 `extension/` 폴더를 열었을 때 동작 — 손으로 누르진 않았고 위 test-cli 실행이 같은 Extension Host 경로를 증명한다.