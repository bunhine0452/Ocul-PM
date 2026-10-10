---
schema_version: 1
type: chore
slug: "release-v3-12-0"
status: done
difficulty: low
created_at: "2026-10-10T16:14:16+09:00"
session_id: "20261010-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
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
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
related:
  - ref: "20261010/Features_to_add/0017_feature_terminal-image-link-peek.md"
    kind: "followup"
tags:
  - "release"
  - "mcp-tool"
---
[x] v3.12.0 릴리스 — 터미널의 그림 경로, 올리면 바로 보입니다

## 무엇을

PR #82(터미널 이미지 경로 미리보기)를 v3.12.0 으로 냈다. docs/RELEASE.md 순서대로:

- `bump-version.mjs 3.12.0` — 버전 6파일 + 랜딩 ko·en 각 6곳, plugin.html ko·en 배지는 손으로
- CHANGELOG `## v3.12.0` · README ko/en 하이라이트 · 랜딩 ko/en 변경 이력 `<li>` + JSON-LD featureList 한 줄 (벤토·FAQ 는 건드리지 않음 — 기존 FAQ 와 충돌 문구 없음 확인)
- `node landing/wiki-src/build.mjs` 재빌드 (생성물 변화는 버전 배지뿐)
- 게이트: typecheck · test 3323 · lint · build · cargo test 2032 전부 exit 0 → 커밋 a700e880 → main push → 태그 단독 push
- 랜딩은 **릴리스 공개를 확인한 뒤** 배포 — 먼저 올리면 「v3.12.0 받기」 가 latest(v3.11.0)를 받는 시간이 생긴다

## 검증

- Release run 38030667059 success: 게이트 · macOS 서명·공증 · Windows/Linux 번들·설치 스모크·설치본 E2E · 공개. 자산 10 · 노트 본문 2074자 · latest.json 키 5(darwin-aarch64·-app·linux-x86_64-appimage·windows-x86_64·-nsis) · releases/latest = v3.12.0 (공개 2026-10-10T07:12Z)
- oculpm.com · /en softwareVersion 3.12.0, /changelog 앵커 120개(v3-12-0 포함), /plugin 배지 v3.12.0. vercel 빌드의 api/notion TS 오류는 기존과 같은 비치명
- 남은 것: 설치본 업데이트 뒤 **새 셸에서** Claude Code 이미지 경로 호버 육안 (`{#eyes-terminal}`)