---
schema_version: 1
type: chore
slug: "landing-deploy-notion-relay"
status: done
difficulty: low
created_at: "2026-10-07T11:28:21+09:00"
session_id: "20261007-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/api/notion/oauth/start.ts"
    op: update
  - path: "landing/api/notion/oauth/callback.ts"
    op: update
  - path: "landing/api/notion/oauth/exchange.ts"
    op: create
related: []
tags:
  - "landing"
  - "deploy"
  - "notion"
  - "mcp-tool"
---
[x] 랜딩 배포 — Notion OAuth code 중계(exchange) 프로덕션 반영

## 작업 요약

사용자 요청으로 랜딩을 배포했다 (PR #69 머지 전, 브랜치 워크트리 `../ai-pm-sec/landing` 에서 — 메인 체크아웃에는 이 변경이 아직 없다). 배포 범위는 origin/main 대비 `landing/api/notion/oauth/` 셋(start·callback 수정, exchange 신설)뿐임을 diff 로 확인했다. 워크트리에는 `.vercel` 링크가 없어(gitignore) 메인 체크아웃의 `landing/.vercel/project.json` 을 복사해 기존 프로젝트 `ocul-pm-landing` 에 `vercel --prod --yes` 로 올렸다 — 링크 없이 돌리면 새 프로젝트가 생긴다.

배포 확인(oculpm.com 실측): `exchange` GET 405 · 빈 POST 400 `invalid_code` · `Cache-Control: no-store`. `start` 에 `flow=code` 를 주면 state 에 `"f":"code"` 가 실리고, 안 주면 옛 모양 그대로(설치된 v3.7.0 앱은 그대로 옛 흐름). 홈 200, `softwareVersion` 3.7.0 불변.

## 검증

- 위 실측. 실제 Notion code 왕복은 `flow=code` 를 붙이는 새 앱(이 PR 의 릴리스)으로만 가능 — 플랜 `#notion-token-url` 에 남겼다. 가짜 code 로 exchange 를 부르지는 않았다(Notion 호출을 만들지 않으려고).