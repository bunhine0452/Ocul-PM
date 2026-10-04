---
schema_version: 1
type: chore
slug: "release-v3-7-0"
status: done
difficulty: low
created_at: "2026-10-04T23:45:19+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
related: []
tags:
  - "release"
  - "mcp-tool"
---
[x] v3.7.0 릴리스 — 세션 화면을 걷고, 끊긴 곳을 잇다 (macOS · Windows · Linux 공개 + 랜딩 배포)

## 무엇을
PR #68(A2A 제거 + 완성도 감사) 머지 뒤 docs/RELEASE.md 다섯 면 그대로 릴리스.

- 버전 6파일 + 랜딩 ko/en 6곳(`bump-version.mjs 3.7.0 --title-*`) + plugin 페이지 ko/en 배지
- CHANGELOG `## v3.7.0` · README ko/en 하이라이트 · 랜딩 ko/en 변경 이력 `<li>` · `build.mjs` 재빌드
- 게이트: typecheck · vitest 3,262 · lint · build · cargo test 1,964/0 → 커밋 8ad2ae98 · 태그 v3.7.0 단독 푸시
- Release run 37202335518: gate(태그 커밋 CI success) → macOS 서명·공증·검증 → Windows·Linux 번들·스모크·E2E 전부 초록 → 공개
- 랜딩 `vercel --prod` (landing/ 에서, 프로젝트 ocul-pm-landing) — 공개 **뒤에** 배포해 다운로드 링크가 죽지 않게

## 검증
- 릴리스: draft=false · releases/latest=v3.7.0 · 자산 10 · 노트 2,699자 · latest.json 3.7.0, 키 5개(darwin 2 · windows 2 · linux-appimage)가 실제 자산을 가리킴
- 라이브: oculpm.com · /en softwareVersion 3.7.0, 다운로드 버튼 v3.7.0, /plugin v3.7.0 에 걷어낸 MCP 도구 0건, /changelog 앵커 114, /report-card 200