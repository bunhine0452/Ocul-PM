---
schema_version: 1
type: chore
slug: "release-v4-2-0"
status: done
difficulty: low
created_at: "2026-10-31T01:25:47+09:00"
session_id: "20261031-001"
agent:
  id: "claude-code"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "package.json"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.2.0 을 내고 랜딩을 배포했다

## 변경 요약
사용자 결정(10-31 「레드팀 점검 후 4.2.0」)대로 진행했다.
- 레드팀이 세 계획(`orca-bench` · `beyond-orca` · `narrow-window`)에서 반례 셋을 찾았고, 사용자가 「셋 다 고치고 4.2.0」 을 골랐다. 고친 것은 PR #139.
- 릴리스 커밋은 PR #140 (`cf349b85`)이다: 버전 6파일 + Cargo.lock, CHANGELOG v4.2.0, README ko/en, 랜딩 ko/en(버전 · 변경 이력 · featureList · 벤토 둘 · FAQ 하나 · plugin.html 판), 위키 단축키 ⌘\.
- 리듬 예외(4.1.0 하루 뒤 · 확인 날 없음 · 육안 확인 25건 대기 · 외부 리뷰 주기 지남)는 CHANGELOG v4.2.0 첫 줄에 적었다.
- 태그 `v4.2.0` → release.yml run 41085195733 → 공개. 그 뒤 `landing/` 에서 `vercel --prod --yes` 로 oculpm.com 에 배포했다.

## 검증
- `gh run view 41085195733` → conclusion success (게이트 · macOS 빌드 서명 검증 · 번들 linux/windows · 설치 스모크 · E2E · 공개 모두 success)
- `gh release view v4.2.0` → isDraft false, 자산 9개 (dmg · app.tar.gz(.sig) · AppImage(.sig) · deb · exe(.sig) · latest.json)
- `curl -sL https://oculpm.com/ | grep -o v4.2.0 | wc -l` → 6 (en 6 · changelog 5 · plugin 1)