---
schema_version: 1
type: chore
slug: "release-v4-4-0"
status: done
difficulty: low
created_at: "2026-11-03T02:49:46+09:00"
session_id: "20261103-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "6fc3a353-b7f3-424c-8f8a-3203b542643e"
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
related: []
tags:
  - "릴리스"
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.4.0 을 낸다

## 변경 요약
v4.4.0 — 프로젝트 색 · ⌘W 세션부터 · 일하는 세션 닫기 확인 · ⇧⌘[ ] · 터미널 글자 크기 · ⌘O 거르기 (PR #154). 버전 6곳 · CHANGELOG · README ko/en · 랜딩 ko/en(변경 이력 · featureList · facts · 플러그인 배지 둘) · build.mjs, 태그 커밋 51fe8600. 랜딩은 사용자가 `vercel --prod` 로 배포(oculpm.com).

GitHub macOS arm64 러너 부족으로 두 번 취소됐다 — main CI 의 Rust 잡(러너 못 잡음) → `gh run rerun --failed` 로 초록, 릴리스 run 의 macOS 잡도 같은 이유로 취소 → 실패 잡만 다시 돌려 통과. 태그는 옮기지 않았다.

## 검증
- Release run 41484138478 success — macOS 빌드 · 서명 · 검증, Windows · Linux 번들 · 설치 스모크 · E2E, 공개(draft=false)
- 설치본 육안 확인은 아직