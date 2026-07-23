---
schema_version: 1
type: chore
slug: "changelog-readme-v2-3-1-backfill"
status: done
difficulty: low
created_at: "2026-07-24T04:13:35+09:00"
session_id: "mcp-20260724-041335"
agent:
  id: "claude-code"
  version: "Opus 4.8 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "changelog"
  - "readme"
  - "release"
  - "badge"
  - "mcp-tool"
---
[x] v2.3.1 변경 이력·README 반영 + 다운로드 배지 badgen 전환

## 동기

v2.3.1 이 태그·릴리스는 됐지만 (1) CHANGELOG 에 `## v2.3.1` 섹션이 없어 release.yml 의 awk 추출이 빈 "What's new" 를 게시했고, (2) README hero 가 아직 v2.3.0 에 멈춰 있어 최신 버전이 노출되지 않았다. 또 다운로드 배지가 shields.io 의 "Unable to select next GitHub token from pool" 오류로 숫자 대신 에러를 렌더했다.

## 변경 요약

- **CHANGELOG.md** — `## v2.3.1` 섹션 추가(자정 넘김 시 '오늘' 자동 롤오버 버그 수정: 메인 창 workday 워처 + 메뉴바 팝오버 로컬-자정 트리거 + 경계 넘김 테스트). release.yml 의 `## vX.Y.Z` 추출 규격과 일치.
- **README.md** — hero 제목 `v2.3.0 → v2.3.1`, 하단에 v2.3.1 패치 노트 1줄 추가.
- **README.en.md** — 버전 hero 는 없어 배지만 조정.
- **다운로드 배지(양 README)** — shields.io `github/downloads/…/total` → badgen `github/assets-dl`(이미 정상 동작 중인 tag 배지와 동일 서비스)로 전환해 토큰 풀 오류 우회.
- **게시된 GitHub 릴리스 v2.3.1** — `gh release edit --notes-file` 로 빈 릴리스 노트를 워크플로 템플릿과 동일 본문으로 백필.

## 검증

- `curl badgen …/assets-dl` → `downloads: 13` (에러 아닌 실수치 반환), tag 배지 → `latest tag: v2.3.1` 확인.
- `gh release view v2.3.1` 로 릴리스 노트 본문 채워짐 확인.
- README hero 제목·노트가 v2.3.1 로 정합(sed 확인).