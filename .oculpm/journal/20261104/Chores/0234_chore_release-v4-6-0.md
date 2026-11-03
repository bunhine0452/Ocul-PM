---
schema_version: 1
type: chore
slug: "release-v4-6-0"
status: done
difficulty: low
created_at: "2026-11-04T02:34:34+09:00"
session_id: "mcp-20261104-023434"
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
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/changelog.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "릴리스"
  - "release"
  - "mcp-tool"
---
[x] 릴리스: v4.6.0 을 낸다

사용자 결정(11-04, 「응 릴리즈해」). v4.5.0 다음 날의 마이너라 「마이너는 2주에 한 번」 을 건너뛰고, 그 이유를 CHANGELOG v4.6.0 첫 줄에 적었다. 확인 날 기록 없음 · 눈 확인 26건은 그대로.

## 한 일
- `node scripts/bump-version.mjs 4.6.0 --title-ko "창을 나란히, 화면은 영수증처럼" --title-en "Windows side by side, screens like a receipt"` — 버전 6파일 + 랜딩 ko/en 각 6곳. plugin.html ko/en 의 nav-ver 는 손으로. `cargo update -p ocul-pm --offline` 로 Cargo.lock.
- CHANGELOG v4.6.0(창 나란히 · VS Code 프로젝트마다 · 프로젝트 색 창 전체 · 영수증 · 프로젝트 목록 · 뒤 창 빈 화면 · 오류 문장 · 일지 직접 쓰기), README ko/en 의 v4.6 절(v4.4 절은 「지난 릴리스 한눈에」 한 줄로), 랜딩 ko/en: 변경 이력 li(4.3.2 를 빼고 4.6.0), featureList 한 줄, 작은 것들 두 줄(짝수 유지).
- **FAQ 하나가 거짓이 될 뻔했다**: 「테마 색을 바꿀 수 있나요?」 가 「프로젝트별 테마는 4.0 에서 걷었습니다」 라고 했다 — 이제 프로젝트 색이 강조색 · 바탕을 물들인다. ko/en, JSON-LD 와 `<details>` 네 곳을 고쳤다.
- `node landing/wiki-src/build.mjs` (changelog 141개 · 최신 v4.6.0).
- 릴리스 커밋 `5cbdd2d6` 의 CI: 프런트 · cargo-deny 는 통과, Rust 잡은 **macOS 러너를 못 받아 취소**(annotation: 「The job was not acquired by Runner of type hosted even after multiple attempts」 · capacity constraints). 코드 실패가 아니라 `gh run rerun --failed` 로 다시 돌려 통과한 뒤 태그.

## 검증
```
gh run view 41676986321 → completed success (Rust · 프런트 · cargo-deny success)
gh run view 41680372186 (release.yml) → completed success — macOS 빌드·서명·검증 · windows/linux 번들 · 설치 스모크 · 설치본 E2E · 공개 전부 success
gh api repos/bunhine0452/Ocul-PM/releases/latest → v4.6.0
latest.json → 4.6.0 ['darwin-aarch64','darwin-aarch64-app','linux-x86_64-appimage','windows-x86_64','windows-x86_64-nsis']
```
자산 9개(dmg · app.tar.gz+sig · x64-setup.exe+sig · AppImage+sig · deb · latest.json). 랜딩 `vercel --prod` 는 자동 모드가 막아 사용자가 `!` 로 돌린다.