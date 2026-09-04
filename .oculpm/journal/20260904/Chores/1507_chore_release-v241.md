---
schema_version: 1
type: chore
slug: "release-v241"
status: done
difficulty: medium
created_at: "2026-09-04T15:07:27+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
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
related: []
tags:
  - "release"
  - "v241"
  - "mcp-tool"
---
[x] v2.41.0 릴리스 — 게이트 전수·5면 반영·태그·랜딩 배포

플랜 `v241-errors-first` Phase `release-241`.

## 게이트 전수

로컬에서 각각 직접 확인해 exit 0: `typecheck` · `lint`(6종 — eslint 포함) · `test` · `build` · `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test` · `cargo test --test plugin_manifest`(플러그인 3파일 버전 동기 강제) · `cargo-deny check advisories bans sources licenses`.

CI 는 PR·main 양쪽에서 세 잡 전부 `success`. **판정은 잡 단위 `conclusion` 으로 했다** — 중간에 릴리스 푸시가 앞 run 을 밀어내 Rust 잡이 `cancelled` 로 끝난 run 이 하나 있었고, 그건 성공이 아니다.

## 릴리스 표면

`docs/RELEASE.md` 대로 전부: **버전 6파일** · `CHANGELOG.md`(태그와 같은 헤더 = 릴리스 노트 자동 소스) · `README.md`+`README.en.md`(이전 최신 섹션의 🚀 는 제거) · **랜딩 ko/en 각 6곳**(`softwareVersion`·`nav-ver`·`ap-new` NEW 배지·다운로드 버튼 2곳·CTA eyebrow) + `landing/plugin.html` 배지 + `node landing/wiki-src/build.mjs` 재빌드(위키 34쪽·changelog 92릴리스·themes·privacy·sitemap 41 URL).

랜딩 JSON-LD 4블록이 편집 전후 모두 파싱됨을 확인했다.

## 태그와 배포

태그는 **단독으로** `git push origin refs/tags/v2.41.0`(`--tags` 금지). `release.yml` 이 macOS aarch64 를 빌드·서명해 릴리스를 만들었다 — **로컬 빌드는 하지 않았다**.

## 검증

- 릴리스: 에셋 **4개**(`.dmg`·`.app.tar.gz`·`.sig`·`latest.json`) · 본문 2,759자 · draft 아님.
- 다운로드 링크 `Ocul-PM_2.41.0_aarch64.dmg` → **HTTP 200**.
- `https://oculpm.com/` → `softwareVersion: 2.41.0`, nav 배지 `v2.41.0`. `/en` → `2.41.0`. `/changelog` 에 v2.41.0 앵커.

## 메모

두 가지를 기록해 둔다.

1. **`vercel` 은 `/opt/homebrew/bin` 에 없다** — fnm 노드 경로(`~/.local/share/fnm/node-versions/<ver>/installation/bin/vercel`)에 있다. 배포는 반드시 `landing/` 에서 — 루트에서 돌리면 저장소 전체가 올라간다.
2. **이 플랜의 `{#release-surfaces}` 항목 문구가 "버전 3파일" 로 틀려 있었다.** `docs/RELEASE.md` 는 6파일이고 실제 릴리스는 6파일로 했다. 플랜을 만들 때 내가 잘못 적었다.

앱은 여전히 실행하지 못했다 — 육안 확인 13건은 `v3-release {#eyes}` 에 남아 있고, 이제 `.dmg` 로 확인할 수 있다.