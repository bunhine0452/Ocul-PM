---
schema_version: 1
type: chore
slug: "release-v4-5-1"
status: done
difficulty: low
created_at: "2026-11-03T17:35:53+09:00"
session_id: "20261103-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
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
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
related:
  - ref: "20261103/Bugs/1733_bug_fix-updater-recheck-after-reconnect.md"
    kind: "followup"
tags:
  - "릴리스"
  - "release"
  - "updater"
  - "mcp-tool"
---
[x] 릴리스: v4.5.1 업데이트 재확인 패치

## 무엇을
「다시 연결되면 업데이트를 바로 찾는다」 수정(PR #158)을 v4.5.1 패치로 낸다. 사용자 결정(「지금 나 업데이트 가능하게 해줘」) — v4.4.0 · v4.5.0 에 이은 같은 날 셋째 판이라 RELEASE §0-2 를 건너뛰고, 그 이유를 CHANGELOG v4.5.1 첫 줄에 적었다.

## 바꾼 면
- `bump-version.mjs 4.5.1` — 버전 6파일 + 랜딩 ko/en 6곳, Cargo.lock 은 `cargo update --workspace --offline`
- CHANGELOG `## v4.5.1` · README ko/en v4.5 절에 한 줄 · 랜딩 ko/en 「새 판」 제목과 변경 이력 `<li>`(v4.3.1 을 내리고 넷 유지) · plugin.html ko/en 배지
- `node landing/wiki-src/build.mjs` — changelog.html · privacy.html · sitemap 재생성

## 검증
- 코드 수정분은 로컬 typecheck / test(1029) / lint / build 0. 릴리스 커밋은 로컬 게이트 없이 PR CI · release.yml gate 에 맡긴다(메모 규칙)
- 남은 것: 태그 push 뒤 release run 공개, 랜딩 vercel 배포