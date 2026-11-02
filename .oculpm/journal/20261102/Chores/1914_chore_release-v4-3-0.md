---
schema_version: 1
type: chore
slug: "release-v4-3-0"
status: done
difficulty: low
created_at: "2026-11-02T19:14:16+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
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
  - "릴리스"
  - "release"
  - "landing"
  - "mcp-tool"
---
[x] 릴리스: v4.3.0 을 내고 랜딩을 배포했다

## 무엇을 했나
v4.3.0 을 냈다. 확인 날 없는 마이너다(4.2.0 이틀 뒤, 사용자 결정 11-02). 사유는 CHANGELOG 그 절 첫 줄에 적었다.
- **다섯 면**: 버전 6파일 + Cargo.lock(`cargo update --workspace --offline`), CHANGELOG `## v4.3.0`(Unreleased 두 고침을 흡수), README ko/en(v4.3 하이라이트, v4.2 는 한 줄로 압축, 터미널 「⌘\ 나란히」 문구 정정), 랜딩 ko/en(featureList +4, 작은 것들 10칸, 변경 이력 최근 네 판, 플러그인 페이지 배지), `node landing/wiki-src/build.mjs`.
- 커밋 `2b129db6` → `git push origin main` → 태그 `v4.3.0` 단독 push. 로컬 게이트는 돌리지 않았다(릴리스 규칙 — CI 와 release.yml 게이트가 본다).
- 랜딩 배포는 사용자가 `! cd landing && vercel --prod --yes` 로 했다. 작업 트리가 PR #146 가지였으므로 새 첫 문장과 플러그인 입구가 함께 나갔다.

## 검증
- release run 41421090449 의 모든 잡이 success 다: 게이트 · macOS 빌드·서명·검증 · windows/linux 번들 · 설치 스모크 · 설치본 E2E · 공개. `gh release view v4.3.0`: draft=false, 자산 9.
- `curl` 로 oculpm.com 과 /en 을 확인했다: `softwareVersion` 4.3.0, 새 h1, `cmd two is-primary`. /changelog 에 v4.3.0 이 있다.
- 남은 것: 같은 날 새 공지 RUSTSEC-2026-0429(zip 4.6.1, 업데이터의 Windows 의존)를 PR #147 로 main 에서 닫았다. 하지만 이미 나간 v4.3.0 설치본에는 옛 zip 이 들어 있다. 다음 패치 릴리스에 싣는다.