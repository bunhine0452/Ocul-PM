---
schema_version: 1
type: chore
slug: "release-v4-12-0"
status: done
difficulty: medium
created_at: "2026-11-22T03:54:42+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
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
  - path: "landing/privacy.html"
    op: update
  - path: "landing/wiki/agents.html"
    op: update
  - path: "landing/wiki/settings.html"
    op: update
  - path: "landing/wiki/en/agents.html"
    op: update
  - path: "landing/wiki/en/settings.html"
    op: update
related: []
tags:
  - "릴리스"
  - "v4.12.0"
  - "mcp-tool"
---
[x] 릴리스: v4.12.0 을 준비해 올린다

## 한 일

사용자 지시(11-22 「전부 다 하고 배포까지 도맡아서 해」)로 v4.12.0 을 준비했다. 버전 여섯 파일과 랜딩 두 벌(`bump-version.mjs`), 플러그인 페이지 배지 두 벌, CHANGELOG 의 `## v4.12.0` 절, README 두 벌의 하이라이트(4.11 은 「지난 릴리스」 한 줄로), 랜딩 두 벌의 변경 이력 `<li>`(최근 네 판 유지)와 JSON-LD `featureList`, 생성물 재빌드(`landing/wiki-src/build.mjs`).

「마이너는 2주에 한 번」 을 건너뛰는 판이다(4.11.0 은 11-15) — 사유를 CHANGELOG 그 절 첫 줄에 적었다. `bump-version` 의 두 경고(외부 리뷰 주기 · 확인 날 기록 없음, 눈 확인 27건)도 그 줄에 옮겼다.

## 검증

- `cargo test --locked`(4.12.0 트리): 35개 스위트 전부 `test result: ok` · 합계 1248 passed · 0 failed
- `pnpm typecheck` exit 0 · `pnpm test`: `Tests  2008 passed (2008)` · `pnpm lint` 여섯 게이트 exit 0 · `pnpm build`: `✓ 창 엔트리 CSS 에 핵심 선택자 16개가 모두 있습니다` exit 0 (pnpm 10.34.9)
- 설치본으로 본 것은 없다. 번들은 이 PC 에서 굽지 않는다 — 태그 뒤 GitHub Actions 의 release.yml 이 굽고 검증한다.

## 메모

VS Code 확장은 0.3.1 로 따로 나간다(`ext-v0.3.1`). 랜딩 배포는 릴리스가 공개된 뒤에 한다 — 랜딩의 다운로드 링크가 릴리스 자산을 가리킨다.