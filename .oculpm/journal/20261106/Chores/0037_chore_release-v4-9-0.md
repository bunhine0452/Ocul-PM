---
schema_version: 1
type: chore
slug: "release-v4-9-0"
status: done
difficulty: low
created_at: "2026-11-06T00:37:08+09:00"
session_id: "20261106-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "46e12a9f-7d29-4721-bc44-5366494409bc"
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
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "릴리스"
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.9.0 을 내고 랜딩을 배포했다

## 무엇을
- PR #170 의 CI 3체크가 초록인 것을 확인하고 rebase 머지했다(main ccf4bc1e).
- 그 위에 릴리스 커밋 5e8ae821 을 올렸다.
  - `bump-version.mjs 4.9.0`: 버전 6파일 · 랜딩 ko/en 각 6곳
  - 플러그인 페이지 배지 ko/en, Cargo.lock
  - CHANGELOG `## v4.9.0`: 첫 줄에 「마이너 2주」를 건너뛴 사유(사용자 결정)
  - README ko/en 에 v4.9 절을 넣고 v4.7 은 지난 릴리스 한 줄로 접었다
  - 랜딩 변경 이력 li(v4.5.1 을 빼고 v4.9.0) · featureList 「Claude 에게 보내기」 · 릴리스 수, `build.mjs` 재빌드
- 태그 v4.9.0 을 push 하고 `vercel --prod` 로 랜딩을 배포했다.

## 검증
- release.yml run success: 준비 · 게이트 · macOS 빌드·서명·검증 · 번들 win/linux · 스모크 win/linux · E2E win/linux · 공개
- `releases/latest` = v4.9.0 (앱). latest.json 은 4.9.0, 키 5개(darwin-aarch64 · -app · windows ×2 · linux appimage)
- 공개 직후 몇 분은 GitHub 다운로드 주소가 504 였고, 그 뒤 200 이 됐다. 랜딩 /, /en, /plugin, /changelog 가 v4.9.0 이다
- 설치본에서 눌러 보는 눈 확인은 하지 않았다