---
schema_version: 1
type: chore
slug: "release-3-0-0"
status: done
difficulty: low
created_at: "2026-09-11T23:27:13+09:00"
session_id: "20260911-013"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "e844171e-1cc7-43d6-92e2-254120fb4e99"
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
related: []
tags:
  - "release"
  - "3.0.0"
  - "landing"
  - "mcp-tool"
---
[x] v3.0.0 릴리스 — 검수 릴리스, 6면 전부 · 랜딩 배포 · 태그는 main CI 초록 뒤

v3-release 플랜의 마지막 코드 항목 `{#release-300-2}`. 다른 세션이 오늘 오후 main 을 2.48.0 으로 올려 둔 상태라, 3.0.0 은 그 위에서 6면을 다시 올리는 일이었다.

## 동기

3.0 의 정의는 「2.42~2.48 이 쌓은 실기기 미확인 21건을 눈으로 갚는다」였고 오늘 그게 끝났다(육안 원장 27건 중 pass 24 · fail 1→수정 · skip 2). 릴리스 노트도 그 사실을 그대로 — 새 기능 목록이 아니라 **검수 릴리스**라고 말한다.

## 변경 요약

- `node scripts/bump-version.mjs 3.0.0 --title-ko/--title-en` 로 버전 6파일 + 랜딩 ko/en 각 6곳. 스크립트가 제목 앞에 `vX.Y.Z — ` 를 붙이므로 제목에 「3.0 —」 를 또 넣으면 NEW 배지가 「v3.0.0 — 3.0 — …」 가 된다 → 손으로 뺐다. `landing/plugin.html`·`en/plugin.html` 의 `nav-ver` 는 스크립트 밖이라 sed.
- CHANGELOG `## v3.0.0`(릴리스 노트 소스): 검수 릴리스 서술 + 신원 줄·압축 줄·영어 모드 + 고친 것 넷(ACP 위 Today 툴바 · 빈 마법사 초안 · ACP 제목 · 회색 버튼 0). README ko/en 🚀 섹션은 그 요약, 2.48.0 은 🚀 없는 `##` 로 강등. 랜딩 `<li>` ko/en.
- `node landing/wiki-src/build.mjs` 로 changelog/privacy/themes/sitemap 재생성.
- 게이트: 릴리스 워크트리(`864a920` 기준)에서 `cargo test --no-fail-fast` 0 failed(`plugin_manifest` 가 6파일 동기 확인, `Cargo.lock` 갱신) · clippy `-D warnings` · fmt · `typecheck` 0 · `test` 216파일 2708건 · `lint` 6게이트 · `build`. `landing_pages.test` 가 「CHANGELOG 맨 위 == package.json」과 changelog.html 앵커를 잰다.
- 커밋 `087a4d7`(임시 인덱스, 17파일) → 푸시. **태그는 main CI 초록을 본 뒤** — release.yml 은 테스트 없이 번들만 굽는다.
- 랜딩: `.vercel` 링크는 주 워크트리에만 있어(gitignore) 릴리스 워크트리의 `landing/` 에 복사해 `vercel --prod --yes`. 라이브 확인: `oculpm.com` · `/en/`(308→) 둘 다 `data-version>v3.0.0`, `/shots/en/01-today.jpg` 200.

## 메모

- Vercel 빌드 로그에 `api/notion/oauth/callback.ts` 의 TS2580(`Buffer`/`process` 타입 없음) 4줄이 뜬다 — 7월 31일 이후 안 건드린 함수이고 esbuild 는 타입을 안 보므로 배포는 되며, 라이브 `/api/notion/oauth/start` 가 자기 가드(`400 invalid port/state`)로 답한다. 3.0 블로커 아님. `landing/` 에 `@types/node` 를 devDependency 로 두면 로그가 깨끗해진다 — 후속.
- `eyes-tcc-desktop` 은 3.0.0 설치 뒤 `tccutil reset SystemPolicyAppData com.kimhyunbin.ocul-pm` 하고 보는 항목이라 열어 둔다.