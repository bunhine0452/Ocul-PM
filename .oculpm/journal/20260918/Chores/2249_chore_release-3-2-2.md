---
schema_version: 1
type: chore
slug: "release-3-2-2"
status: done
created_at: "2026-09-18T22:49:01+09:00"
session_id: "20260918-004"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
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
related:
  - ref: "20260918/Bugs/2059_bug_tab-close-reentry-lsp-gate.md"
    kind: "followup"
tags:
  - "release"
  - "v3.2.2"
  - "landing"
  - "release-gate"
  - "mcp-tool"
---
[x] v3.2.2 릴리스 — 버그 헌팅 17건, 5면 갱신, 게이트 파이프라인 3회째 통과

## 작업 내용

docs/RELEASE.md 순서대로. 버그 헌팅 5라운드 커밋(531c5d08) + 이전 세션 잔여(플랜 4개 done 잠금·9/15 일지, e9ad11bd) 위에 릴리스 커밋 350c83cc.

- `node scripts/bump-version.mjs 3.2.2 --title-ko … --title-en …` — 버전 6파일 + 랜딩 ko/en 각 6곳. 스크립트가 남긴 `v3.2.1` 은 변경 이력 `<li>` 만(정상).
- CHANGELOG `## v3.2.2` (증상 → 변화 서술형, 한국어 파일명·config 결손 키를 굵게 앞세우고 나머지 15건은 묶음), README ko/en 최상단 하이라이트, 랜딩 ko/en 변경 이력 `<li>`, `plugin.html`·`en/plugin.html` nav-ver 배지, `node landing/wiki-src/build.mjs` (changelog·themes·privacy·sitemap 41 url).
- §0 게이트 전부 exit 0: cargo test(Cargo.lock 갱신) · typecheck · vitest 2740 · lint 6게이트 · build.
- push main → CI run 35347328292 세 잡 success 확인 **후** 태그 단독 push → release run 35348133338: 게이트 success → build(약 35분: 컴파일·서명·공증) → 검증 → draft 해제. `isDraft=false`, 자산 5개(.dmg · .app.tar.gz · .sig · latest.json · .vsix), 노트 1,892자, `releases/latest/download/latest.json` version=3.2.2 · signature 404자.
- 랜딩은 CI 와 병렬로 `cd landing && vercel --prod --yes` — oculpm.com / oculpm.com/en softwareVersion 3.2.2, changelog 앵커 `v3-2-2` 확인 (`/en/` 는 308 → `/en` 으로 따라가야 한다).

## 검증

- GitHub: release run 전 단계 success, 릴리스 공개·latest.json 3.2.2
- 라이브: `curl -sL https://oculpm.com/ | grep softwareVersion` → 3.2.2 (ko·en 둘 다), changelog 앵커 109개
- 미확인(실기기): 설치본 자동 업데이트 3.2.1 → 3.2.2 — 다음 앱 실행 때 배너로 확인