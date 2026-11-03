---
schema_version: 1
type: chore
slug: "release-v4-5-0-ext-v0-3-0"
status: done
difficulty: low
created_at: "2026-11-03T09:37:29+09:00"
session_id: "20261103-004"
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
[x] 릴리스: v4.5.0 과 확장 0.3.0 을 같이 낸다

## 변경
사용자 「같이 배포해 이제」(11-03). 같은 날 둘째 판 · 마이너 2주 리듬을 건너뛰는 것을 CHANGELOG v4.5.0 첫 줄에 적었다.
- 앱 v4.5.0: 버전 6파일(bump-version) · Cargo.lock · CHANGELOG · README ko/en 하이라이트 · 랜딩 ko/en(변경 이력 li 최근 넷, featureList, facts 두 칸 → 12칸) · plugin.html 배지 ko/en · build.mjs 재빌드. 커밋 78eb91b0 → main → 태그 v4.5.0.
- 확장 ext-v0.3.0 태그: GitHub Release .vsix · **Open VSX 게시됨**(oculpm.ocul v0.3.0). **VS Marketplace 는 VSCE_PAT 가 비어 건너뜀** — 토큰을 넣고 run 41554001855 를 re-run 하면 게시된다.
- 랜딩 배포는 수동(사용자 `vercel --prod`).

## 검증
- Extension run 41554001855 success (패키징 · 게시), Open VSX 「Published oculpm.ocul v0.3.0」
- 앱 Release run 41553996540 은 이 기록 때 진행 중