---
schema_version: 1
type: chore
slug: "release-3-2-1"
status: done
difficulty: low
created_at: "2026-09-17T20:50:19+09:00"
session_id: "20260917-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "290a8fb0-9f4c-49fa-920f-30e191ab7dbf"
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
  - path: "landing/privacy.html"
    op: update
  - path: "landing/themes.html"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "changelog"
  - "mcp-tool"
---
[x] v3.2.1 릴리스 — 메뉴바 클릭과 지운 폴더 (5면 갱신 · 게이트→draft→검증→공개 2회째 통과 · 랜딩 배포)

## 변경 요약

패치 릴리스 — 오늘 고친 두 버그(macOS 27 트레이 왼쪽 클릭 · Finder 삭제 후 루트 부활)를 내보냈다.

- 버전 6파일 + 랜딩 ko/en 각 6곳은 `node scripts/bump-version.mjs 3.2.1 --title-ko … --title-en …`. `landing/plugin.html`·`en/plugin.html` 의 `nav-ver` 는 손으로.
- `CHANGELOG.md` `## v3.2.1`(증상 → 무엇이 바뀌었나), README ko/en 상단 하이라이트, 랜딩 ko/en 변경 이력 `<li>`. 기능 추가가 없어 JSON-LD·FAQ·벤토는 손대지 않았다. `node landing/wiki-src/build.mjs` 로 changelog/privacy/themes 재빌드.
- 커밋 둘: `ba07b93b fix(tray,watcher)` + `3af7612e release: v3.2.1`. main 푸시 → 태그 단독 푸시 → `cd landing && vercel --prod --yes`.

## 검증

- 게이트 4종(typecheck/test/lint/build) + `cargo test`(34 suite 전부 ok) exit 0 직접 확인.
- Release run 35214216516: gate 가 main CI(35214212517, 3잡 초록)를 6분 기다렸다 통과 → build 32분 → 서명·공증·업데이터 검증 → 공개. `gh release view v3.2.1`: draft=false, 노트 932자, 자산 5개(.dmg · .app.tar.gz · .sig · latest.json · .vsix). `releases/latest/download/latest.json` → version 3.2.1, url 이 `releases/download/v3.2.1/` 실자산.
- 라이브: oculpm.com `softwareVersion` 3.2.1(ko·en), `/changelog` 에 `id="v3.2.1"` 앵커. 설치본 3.2.0 의 자동 업데이트 제안은 사용자 육안 대기.