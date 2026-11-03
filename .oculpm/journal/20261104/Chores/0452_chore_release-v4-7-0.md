---
schema_version: 1
type: chore
slug: "release-v4-7-0"
status: done
difficulty: low
created_at: "2026-11-04T04:52:24+09:00"
session_id: "20261104-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "011dde9e-5e7e-4fbe-b351-fec86b11e9b0"
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
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "릴리스"
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.7.0 을 낸다

사용자 결정(11-04, 「응 바로 릴리즈해」). v4.6.0 과 같은 날의 둘째 판이자 「마이너 2주에 한 번」 을 건너뛴다 — 이유를 CHANGELOG v4.7.0 첫 줄에 적었다. 확인 날 기록 없음 · 눈 확인 26건 그대로.

## 한 일
- `node scripts/bump-version.mjs 4.7.0 --title-ko "⌥Tab 으로 창을 오가고, 창마다 색이 또렷하게" --title-en "Switch windows with ⌥Tab, each window in its own colour"` + plugin.html ko/en nav-ver + `cargo update -p ocul-pm --offline`.
- CHANGELOG v4.7.0(창 전환기 ⌥Tab · 또렷한 창 색 · 색 없는 프로젝트 점이 따라 바뀌던 결함), README ko/en 의 v4.7 절(v4.5 절은 「지난 릴리스 한눈에」 한 줄로), 랜딩 ko/en: 변경 이력 li(4.4.0 빼고 4.7.0), featureList 한 줄, 작은 것들 두 줄을 고쳐 짝수 유지(「창을 오가고, 나란히」 · 「창마다 제 색」).
- `node landing/wiki-src/build.mjs` (142개 · 최신 v4.7.0).
- 랜딩은 사용자가 공개 **전에** `vercel --prod` 를 돌렸다 — 다운로드 링크는 `releases/latest` 라 공개 뒤 저절로 맞는다.

## 검증
```
gh run view 41702837481 (CI, 릴리스 커밋 0133a87e) → success
gh run view 41703412972 (release.yml) → completed success — macOS 빌드·서명·검증 · windows/linux 번들 · 설치 스모크 · 설치본 E2E · 공개 전부 success
releases/latest → v4.7.0, 자산 9개
latest.json → 4.7.0 ['darwin-aarch64','darwin-aarch64-app','linux-x86_64-appimage','windows-x86_64','windows-x86_64-nsis']
oculpm.com softwareVersion → 4.7.0
```