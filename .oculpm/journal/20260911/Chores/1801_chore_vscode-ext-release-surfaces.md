---
schema_version: 1
type: chore
slug: "vscode-ext-release-surfaces"
status: done
difficulty: medium
created_at: "2026-09-11T18:01:52+09:00"
session_id: "20260911-010"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "extension/README.md"
    op: update
  - path: "src/__tests__/extension_docs_surfaces.test.ts"
    op: create
related: []
tags:
  - "release"
  - "docs"
  - "landing"
  - "vscode"
  - "extension"
  - "mcp-tool"
---
[x] 릴리스 6면 준비 — v2.48.0 CHANGELOG/README ko·en/랜딩 ko·en(bento·FAQ·이력)/버전 bump/문서 게이트

## 작업 내용

플랜 `vscode-extension-round` `{#rel-docs}` — 릴리스 체크리스트 전면(6면째 포함)에 확장을 적었다. **태그·푸시·vercel 은 하지 않았다** — 릴리스 자체는 사용자 결정.

- **CHANGELOG** `## v2.48.0`(확장이 헤드라인, 앱 왕복·설정 행·연결 목록 2곳) + `### 확장`(0.1.0 첫 게시·1.101+·읽기 전용·`ext-v0.1.0`·.vsix 첨부).
- **README ko/en** — 「세 가지처럼 보이지만」 아래 `### 🧩 VS Code 확장` 절 + `## 🚀 v2.48.0` 하이라이트(🚀 는 v2.47.0 에서 옮김).
- **랜딩 ko/en 각각** — JSON-LD `featureList` 맨 앞, FAQ(JSON-LD Question + `<details>`) 「VS Code 안에서도 쓸 수 있나요?」, bento 셀(그리드 **끝**에 — 앞에 넣으면 `reveal/d1/d2` 스태거 주기가 통째로 밀린다), 변경 이력 `<li>`. `node landing/wiki-src/build.mjs` 로 changelog.html·sitemap 재생성.
- **버전 bump** — `scripts/bump-version.mjs 2.48.0`(6파일 + 랜딩 ko/en 6곳) + `plugin.html`/`en/plugin.html` 배지 + `Cargo.lock`. `landing_pages.test` 가 「CHANGELOG 맨 위 == package.json 버전」을 강제해 CHANGELOG 섹션만 먼저 쓰면 붉어지므로 함께 올렸다(미커밋, 되돌릴 수 있음). 확장 `package.json` 0.1.0.
- **게이트 신설** `extension_docs_surfaces.test.ts` — README ko/en·랜딩 ko/en·CHANGELOG 에 `oculpm.ocul-pm`, 랜딩 양쪽에 FAQ(HTML+JSON-LD)·bento·JSON-LD 파싱, `extension/package.json` 의 **모든 커맨드·설정 키가 `extension/README.md` 에 문서화**(plugin_manifest 의 커맨드 누락 게이트와 같은 방식). README 에 커맨드 9·설정 2 표 추가.

## 검증

`extension_docs_surfaces`·`landing_pages`·`bump_version`·`landing_themes`·`plugin_docs_sync` vitest 70+ 통과, `cargo test --test plugin_manifest` 12 통과, JSON-LD 파싱 OK, bento 스태거 주기(…d1, d2, reveal) 확인.