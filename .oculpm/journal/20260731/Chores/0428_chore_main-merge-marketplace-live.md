---
schema_version: 1
type: chore
slug: "main-merge-marketplace-live"
status: done
difficulty: low
created_at: "2026-07-31T04:28:41+09:00"
session_id: "mcp-20260731-042841"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "release"
  - "marketplace"
  - "plugin-round"
  - "mcp-tool"
---
[x] main fast-forward 머지 — 마켓플레이스 설치 경로 실활성화

사용자가 `/plugin marketplace add bunhine0452/Ocul-PM` 실패를 보고 — 원인: add 는 **기본 브랜치(main)** 를 클론하는데 marketplace.json·신형 플러그인이 feature 브랜치에만 있었다. plugin-round 브랜치(29커밋, main 대비 0 behind)를 main 으로 fast-forward 머지 후 HTTPS 푸시(SSH 22 차단 우회). release.yml 은 `v*` 태그 트리거뿐이라 main 푸시로 릴리스가 돌지 않음을 사전 확인.

## 검증

- `gh api repos/…/contents/.claude-plugin/marketplace.json` → main 에서 200 (머지 전 404).
- 릴리스 워크플로 미트리거 확인(태그 없음). 로컬은 feature 브랜치로 복귀.