---
schema_version: 1
type: chore
slug: "release-v3-8-0"
status: done
difficulty: medium
created_at: "2026-10-07T12:43:27+09:00"
session_id: "20261007-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
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
  - path: "landing/wiki-src/pages.mjs"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "deploy"
  - "mcp-tool"
---
[x] v3.8.0 릴리스 — 남의 저장소를 열어도 안전하게

## 작업 요약

보안 피드백 라운드(PR #69 → main `efd38f49`)를 v3.8.0 으로 냈다. docs/RELEASE.md 순서 그대로: `bump-version.mjs 3.8.0`(버전 6파일 + 랜딩 ko/en 각 6곳) · plugin.html ko/en 배지(스크립트 밖) · CHANGELOG `## v3.8.0` · README ko/en 하이라이트 · 랜딩 변경 이력 `<li>` ko/en · `build.mjs` 재빌드 → 게이트 → `release: v3.8.0` 커밋 `6d2af80b` → main → 그 커밋 CI 초록 확인 뒤 태그 단독 푸시 → release.yml → 공개 뒤 랜딩 배포.

**릴리스 중 찾은 거짓 주장.** 개인정보 페이지와 랜딩 FAQ(ko/en × JSON-LD·`<details>` 8곳)가 "나가는 연결은 정확히 다섯" 이라고 적고 있었는데 앱 안 Claude Code·Codex 의 어댑터 npm 설치가 빠져 있었다. 위키는 한국어 "여섯", 영어 "셋"으로 서로도 달랐다. 전부 같은 여섯(어댑터 설치를 Claude Code·Codex 항목에 포함)으로 맞췄고 CLAUDE.md 송출 목록도 고쳤다(플랜 `#egress-subprocess` 의 문서 절반).

## 검증

- 로컬 게이트: typecheck · vitest 3270 · lint · build · fmt · clippy · cargo test 1986/0 (`plugin_manifest` 를 unlocked 로 먼저 돌려 Cargo.lock 갱신).
- release.yml run 37564358838 성공(44분): 준비·게이트·macOS 빌드/서명/공증/업데이터 검증·Windows·Linux 번들·설치 스모크·**설치본 E2E(CSP 게이트 포함)**·공개. 자산 10, 본문 3,855자, Latest. `latest.json` 3.8.0 · 키 5(darwin-aarch64·darwin-aarch64-app·windows-x86_64·windows-x86_64-nsis·linux-x86_64-appimage) · URL 전부 v3.8.0.
- 랜딩 실측: ko·en softwareVersion·nav-ver 3.8.0, plugin 배지 ko/en, changelog 앵커 115(v3.8.0 포함), 개인정보·FAQ "여섯", Notion exchange 405 유지. (`/en/` 은 308 → `/en` — curl 은 `-L` 로 볼 것.)
- 미확인: 설치본 자동 업데이트 3.7.0 → 3.8.0, macOS 육안(`#eyes-security-round`), 새 앱으로 실제 Notion 왕복(`#notion-token-url`).