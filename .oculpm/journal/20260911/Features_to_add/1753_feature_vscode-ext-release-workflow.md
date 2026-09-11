---
schema_version: 1
type: feature
slug: "vscode-ext-release-workflow"
status: done
difficulty: medium
created_at: "2026-09-11T17:53:00+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/extension-release.yml"
    op: create
  - path: ".github/workflows/release.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "extension/.vscodeignore"
    op: update
  - path: "extension/src/uriHandler.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
related: []
tags:
  - "ci"
  - "release"
  - "vscode"
  - "extension"
  - "mcp-tool"
---
[x] 확장 게시 파이프라인 — extension-release.yml(dry-run 패키징 → Open VSX → 마켓), 앱 릴리스에 .vsix 첨부, 수동 단계 문서

## 추가 기능

플랜 `vscode-extension-round` `{#rel-ci}` + 하위 2.
- **`extension-release.yml`** — 잡 `package`(PR `extension/**`·`workflow_dispatch`·태그 전부): `pnpm test:unit` → `pnpm package`(check-types×2·eslint·esbuild prod) → `vsce package --no-dependencies` → `vsce ls` → 아티팩트. 이것이 dry-run. 태그면 `ext-v<ver>` ↔ `package.json` 버전 일치를 먼저 검사(마켓은 같은 버전 재게시를 막아 되돌릴 수 없다). 잡 `publish`(`ext-v*` 만): **같은 .vsix** 를 `HaaLeo/publish-vscode-extension@v2` 로 Open VSX → MS 마켓, 둘은 `if: always()` 로 독립, `skipDuplicate`.
- **`release.yml`**(`{#rel-ci-vsix}`): tauri-action 뒤에 확장 패키징 + `gh release upload … --clobber` 로 `.vsix` 를 앱 릴리스 자산에 첨부(오프라인 `code --install-extension`).
- **docs/RELEASE.md §2-1**(`{#rel-ci-ns}`): 태그 플로 명령 3줄 + 한 번만 하는 수동 체크리스트 — Open VSX 로그인·Publisher Agreement·토큰·**네임스페이스 `oculpm` 선등록**(`ovsx create-namespace`, 없으면 첫 게시 실패)·`OPEN_VSX_TOKEN`; MS publisher `oculpm`·Azure DevOps PAT(All orgs, Marketplace→Manage)·`VSCE_PAT`·만료 캘린더; dispatch 로 초록 확인; 리스팅 육안. 토큰은 저장소에 적지 않는다.

## 동작 흐름

- `vsce package --no-dependencies` 를 쓰는 이유: pnpm node_modules 는 vsce 의 `npm list` 수집과 안 맞고, 런타임 의존(yaml)은 esbuild 가 dist 에 접었다. 로컬에서 실제 .vsix 를 만들어 검증 — 처음엔 `pnpm-lock.yaml`·`tsconfig.vitest.json`·`vitest.config.*`·찌꺼기 `vitest.config.mjs(.map)` 까지 13파일이 실렸다 → `.vscodeignore` 보강 후 **7파일 125KB**(package.json·icon·README·LICENSE·CHANGELOG·activity.svg·dist/extension.js).
- 덤으로 잡은 플레이크: URI 핸들러가 "이 창에 없는 프로젝트" 경고를 **await** 해서 버튼 있는 메시지가 사용자가 닫을 때까지 resolve 되지 않았다 → 테스트가 15초 타임아웃(직전엔 창 전환에 자동 닫혀 우연히 통과). fire-and-forget 으로 고치니 mocha 전체가 17초→2초.

## 검증

- 워크플로 3개 YAML 파싱 OK(잡 `package,publish` / `build` / `frontend,rust,deps`). 로컬 `vsce package`·`vsce ls` 성공. **CI 의 dry-run 초록은 푸시 뒤 확인** — 아직 커밋·푸시 전이다.
- `cd extension && pnpm test` 2회 연속 exit 0(vitest 27·mocha 9), 루트 `lint:extension` OK.