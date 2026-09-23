---
schema_version: 1
type: chore
slug: "release-v3-5-0"
status: done
difficulty: low
created_at: "2026-09-23T18:18:45+09:00"
session_id: "mcp-20260923-181845"
agent:
  id: "claude-code"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "release"
  - "changelog"
  - "landing"
  - "readme"
  - "parallel-sessions"
  - "mcp-tool"
---
[x] v3.5.0 배포 — 버그 헌팅 결과와 소개 면 편집을 5면에 싣는다

## 동기

병렬 3세션 버그 헌팅 결과(8갈래)와, 다른 세션(ai-pm-08)이 워킹트리에 남긴 README·랜딩 편집(first-record-loop P3)을 함께 배포한다. 사용자 요청: "배포할 때는 다른 작업물이 한 작업도 있을 거야 함께 배포해줘."

## 합류 전 정리

로컬 `main` 이 origin 보다 **48 커밋 뒤**였고 워킹트리에 두 세션의 미커밋분이 섞여 있었다. `refs/backup/wip-20260922-sync` 로 스냅샷을 찍고(임시 GIT_INDEX_FILE + commit-tree), 로컬 5 커밋은 origin 에 다른 해시로 이미 있으므로 `rebase --onto origin/main` 으로 **WIP 커밋 하나만** 옮겼다 — 충돌 0. 거기서 확인 대화상자 리디자인(다른 세션 작업)과 앱이 동기한 AGENTS 템플릿 13·플래너 상태를 두 커밋으로 갈랐다.

## 5면

- 버전 6파일 (`bump-version.mjs 3.5.0`) + Cargo.lock
- `CHANGELOG.md` `## v3.5.0` — 링크·IME·지운 프로젝트·설정 크래시를 증상 서술형으로
- `README.md` / `README.en.md` 하이라이트 4줄 (v3.4.0 섹션은 🚀 를 떼고 아래로)
- 랜딩 ko/en 각 6곳 + 변경 이력 `<li>` + featureList 1줄 + 벤토 3셀
- `landing/plugin.html` · `landing/en/plugin.html` 배지, `build.mjs` 재빌드(위키 32 · changelog 112 릴리스 · themes · privacy · sitemap 41)

## 검증

`typecheck` · `test`(239파일 2,846건) · `lint`(6게이트) · `build` · `cargo fmt/clippy/test`(36 스위트) 전부 exit 0 직접 확인. `plugin_manifest`(12) · `landing_pages`+`bump_version`(11) 별도 확인. JSON-LD 4블록 `json.loads` 통과. 버전 문자열 전수 grep — 남은 `v3.4.0` 은 변경 이력 `<li>` 뿐.

## 남은 것

태그 푸시(release.yml 이 gate→build→서명·공증 검증→draft 해제), `cd landing && vercel --prod`. 로컬 빌드는 하지 않는다.