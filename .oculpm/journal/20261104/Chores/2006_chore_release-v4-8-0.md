---
schema_version: 1
type: chore
slug: "release-v4-8-0"
status: done
difficulty: low
created_at: "2026-11-04T20:06:26+09:00"
session_id: "20261104-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2d22bf7f-6405-4d02-807b-8e7aa8da8901"
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
related: []
tags:
  - "릴리스"
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.8.0 을 낸다

## 무엇을 했나

사용자 지시(11-04, 「한국어로 말해 릴리즈해」)로 v4.8.0 을 냈다. 같은 날 셋째 판이라 bump 스크립트가 경고했고(확인 날 기록 없음, 눈 확인 26건), 사용자 결정으로 그대로 냈다.

- **담은 것:**
  - #166: 시작 창 다시 그림 · 창 정리 2~6 · 좁은 창 이름
  - #167: 앱 아이콘 아홉 가지
  - #168: 터미널의 줄 넘긴 이미지 경로 · 누르면 Finder
  - #169: 윗줄을 재서 접기 · 위 색 띠 걷기
- **릴리스 커밋 `4a01321b`:**
  - 버전 6파일 · Cargo.lock 을 올렸다.
  - CHANGELOG 를 썼다.
  - README ko/en 에 v4.8 절을 새로 쓰고, v4.6 은 「지난 릴리스」 한 줄로 내렸다.
  - 랜딩 ko/en: featureList 한 줄을 더했다. 옛 「창 N개 나란히 놓기」 문구는 「창 정리」 로 고쳤다. 벤토는 「창을 오가고, 정리하고」, 릴리스 `<li>` 는 넷을 유지했다.
  - plugin.html nav-ver 를 올렸다. `wiki-src/build.mjs` 로 changelog · privacy 를 다시 구웠다.
- **CI · 태그:** CI 통과(run 41814915903) 뒤 태그 `v4.8.0` 을 붙였다.

## 막힌 것

- 릴리스 run 41815336221 의 빌드 · 서명 · 번들 · 설치 스모크 · 설치본 E2E 는 모두 통과했다. 마지막 「공개」 잡이 GitHub API **HTTP 502** 로 두 번 실패했다. 처음은 draft 해제, 다시 돌렸을 때는 자산 올리기였다.
- githubstatus 는 그때 Minor Service Outage 였다(Pull Requests 부분 장애, Git · Actions 느림). 오늘 SSH 푸시 거부 · `gh pr merge` 의 「Merge already in progress」 도 같은 장애로 보인다. 푸시는 HTTPS + gh 자격으로, 머지는 REST `PUT /pulls/N/merge` 로 우회했다.
- 5분 간격으로 `gh run rerun --failed` 를 다시 걸었고, 두 번째 시도에서 공개됐다.

## 검증
- `releases/latest` 는 v4.8.0 이다(draft=false, 자산 9개).
- latest.json 은 version 4.8.0 이고 플랫폼 다섯이 들어 있다: darwin-aarch64 · darwin-aarch64-app · linux-x86_64-appimage · windows-x86_64 · windows-x86_64-nsis.
- 랜딩은 사용자가 `vercel --prod` 로 올렸고, oculpm.com 의 softwareVersion 은 4.8.0 이다.