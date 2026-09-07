---
schema_version: 1
type: chore
slug: "release-v2-44-1"
status: done
difficulty: low
created_at: "2026-09-07T17:27:12+09:00"
session_id: "20260907-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
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
related:
  - ref: "20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md"
    kind: "followup"
  - ref: "20260907/Refactors/1644_refactor_serial-ipc-and-floating-promises.md"
    kind: "followup"
tags:
  - "릴리스"
  - "v2.44.1"
  - "mcp-tool"
---
[x] v2.44.1 릴리스 — 다섯 면 전부에 적고 태그를 밀었다

감사 후속 라운드(문자 경계 패닉 · 직렬 IPC)와 병렬 세션의 Today 링 기하 수정을 묶어 패치 릴리스로 냈다.

## 무엇을 했나

버전은 **2.44.1** — 새 기능 없이 수정·경화만이라 패치다.

머지: `fix/hardening-and-optimization-20260907` 의 커밋 3개(내 2 + 병렬 세션 1)를 CI 3잡 초록 확인 후 main 에 fast-forward. 브랜치는 병렬 세션이 이미 정리해 둬서 지울 것이 없었다.

`docs/RELEASE.md` 의 다섯 면:

1. **버전 6파일** — package.json · tauri.conf.json · Cargo.toml · plugin/oculpm · plugin/oculpm-codex · marketplace.json. `Cargo.lock` 도 함께 커밋.
2. **CHANGELOG.md** — `## v2.44.1` 섹션. 태그와 헤더가 정확히 일치해야 릴리스 노트가 빈 채로 안 나간다.
3. **README.md · README.en.md** — 새 `## 🚀 v2.44.1` 을 얹고 v2.44.0 의 🚀 를 뗐다.
4. **랜딩 ko·en 각 6곳** — softwareVersion · nav-ver · ap-new · 다운로드 버튼 2 · CTA eyebrow. `plugin.html` 배지까지 7곳째. 변경 이력 `<li>` 는 새로 추가(수에 안 든다). 기능이 늘지 않은 릴리스라 JSON-LD featureList · FAQ · 벤토 셀은 손대지 않았고, **기존 FAQ 가 거짓이 되지 않는지** 확인했다 — 이번 변경은 전부 수정이라 기존 서술과 충돌하지 않는다.
5. **`node landing/wiki-src/build.mjs`** — 위키 34 · 변경이력 96 · 테마 · 개인정보 · sitemap 41 재생성.

## 검증

- 게이트 전부 직접 확인: typecheck · `pnpm test` 2,406 · lint 6종 · build · `cargo test`(bindings 신선도 포함).
- **태그 전에 main CI 초록 확인** (`run 34098975448` — 프런트 · Rust · cargo-deny 3잡 success). release.yml 은 테스트를 돌리지 않고 번들만 굽기 때문에 이 순서가 규율이다.
- 태그는 `refs/tags/v2.44.1` 단독 푸시 (`--tags` 금지 — 옛 태그 하나가 어긋나면 push 가 통째로 거부되고 워크플로가 아예 안 뜬다).
- 랜딩은 git 연동이 없어 `cd landing && vercel --prod --yes`. 라이브 확인: ko `softwareVersion 2.44.1` · nav-ver v2.44.1 · en 2.44.1 · plugin 배지 v2.44.1 · changelog 앵커 96개.
  - 영문 랜딩은 `/en/` 이 308 리다이렉트라 `curl` 에 `-L` 없이는 빈 값이 나온다. `/en` 으로 확인해야 한다.