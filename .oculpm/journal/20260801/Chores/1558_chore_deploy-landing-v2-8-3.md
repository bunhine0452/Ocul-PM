---
schema_version: 1
type: chore
slug: "deploy-landing-v2-8-3"
status: done
difficulty: low
created_at: "2026-08-01T15:58:08+09:00"
session_id: "mcp-20260801-155808"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "landing"
  - "deploy"
  - "vercel"
  - "mcp-tool"
---
[x] 랜딩 배포 — v2.8.1~2.8.3 갱신분이 라이브에 안 나가 있었다 (git 연동 없음)

랜딩이 v2.8.0 인 채로 멈춰 있었다. v2.8.1·2.8.2·2.8.3 릴리스에서 갱신한 랜딩 문구가 main 에는 있었지만 라이브에는 없었다.

## 발생 원인

Vercel 프로젝트 `ocul-pm-landing` 에 **GitHub 연동이 없다**(`vercel project inspect` 에 Git Repository 섹션 자체가 없음). 배포 이력이 전부 CLI 수동(`bunhine0452-6793`)이다. 즉 **main 에 push 해도 랜딩은 나가지 않는다** — 매번 `landing/` 에서 `vercel --prod` 를 직접 돌려야 한다. 앱 릴리스(태그 → `release.yml`)와 달리 자동화가 없다.

## 해결

`cd landing && vercel --prod --yes` — 배포 확인: `softwareVersion 2.8.3` · `v2.8.3 받기` · `v2.5 → v2.8` · 새 CSS(`trigbar::before`, `min(5vw, 6.2vh)`) 모두 반영.

## 남은 위험 (미조치)

- **루트에도 `.vercel/project.json` 이 같은 프로젝트를 가리킨다.** 저장소 루트에서 `vercel --prod` 를 돌리면 랜딩 프로젝트에 저장소 전체가 올라간다. `.vercelignore` 도 없다(`.gitignore` 는 반영되지만 `src-tauri/target` 21GB 가 무시되는지 확인 안 함). 루트 링크를 지우거나 `.vercelignore` 를 두는 편이 안전하다.
- 근본 해결은 Vercel 프로젝트에 GitHub 연동 + Root Directory `landing` 설정. 그러면 릴리스 커밋 push 만으로 랜딩이 함께 나간다.

## 검증

`curl https://oculpm.com/` 및 `/landing.css` 로 버전 문자열·신규 CSS 마커 확인. `vercel ls` 에 29초 전 Production Ready.