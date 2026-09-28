---
schema_version: 1
type: feature
slug: "release-v3-6-0-windows-linux-beta"
status: done
difficulty: high
created_at: "2026-09-29T06:05:49+09:00"
session_id: "20260929-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
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
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related:
  - ref: "20260928/Features_to_add/2145_feature_port-release-pipeline-nonmac.md"
    kind: "followup"
tags:
  - "release"
  - "cross-platform"
  - "windows"
  - "linux"
  - "mcp-tool"
---
[x] v3.6.0 릴리스 — 첫 Windows · Linux 베타 공개 (macOS · Windows · Linux 세 플랫폼 초록)

## 추가 기능

사용자 결정(2026-09-28): 첫 Windows·Linux 공개를 진행하고, ACP 어댑터 올림을 같은 판에 싣는다. 후속 항목 결정과 병렬 세션은 오케스트레이터에 위임했다.

- 레인 7개(1차 L-FS3·L-OS3·L-PTY3·L-UPD·L-MISC, 2차 L-PLAN2·L-OS4)와 오케스트레이터 수정 PR 들을 합류했다(PR #47·#50~#61).
- 릴리스 면(PR #61)
  - 버전 6파일 3.6.0
  - CHANGELOG `## v3.6.0`
  - README ko/en: 하이라이트 · 설치 표 · Windows 주의 · 버그 리포트 경로
  - 랜딩 ko/en: 버전 6곳 · 변경 이력 · OS 별 받기 · FAQ · 플러그인 배지
  - 생성물 재빌드, RELEASE.md 갱신
- 순서는 docs/RELEASE.md §5-1 을 따랐다: `OCULPM_RELEASE_NONMAC=true` → main CI 초록(e1d0b3ab) → `git push origin v3.6.0`(태그만) → 공개 확인 → 랜딩 배포.

## 동작 흐름

release run 36477736356 이 전 잡 success 로 끝났다.
- gate(ci.yml) → macOS 빌드·서명·공증·업데이터 검증
- Windows·Linux 번들 → 깨끗한 러너 설치 스모크 → 설치본 E2E
- publish: 세 플랫폼 병합 · latest.json 검증 · draft 해제

## 검증

- `releases/latest` → v3.6.0 (draft=false). 자산은 10개다: dmg · app.tar.gz(+sig) · x64-setup.exe(+sig) · AppImage(+sig) · deb · vsix · latest.json.
- latest.json 키는 `darwin-aarch64` · `darwin-aarch64-app` · `windows-x86_64` · `windows-x86_64-nsis` · `linux-x86_64-appimage` 다. 맨 linux 키는 없다(설계대로).
- 랜딩: 태그 커밋 워크트리에 `landing/.vercel` 링크를 복사해 `vercel --prod` → oculpm.com 연결. ko·en·plugin·changelog 모두 v3.6.0, OS 별 다운로드 링크가 살아 있다. api/notion 의 TS 경고는 기존의 비치명 경고다.
- 남은 것: `#w5-eyes`(CI 가 못 보는 것 — 실제 UAC 창, fcitx/ibus, Wayland 트레이 등), `#w5-testers`(사용자 액션), `#w5-graduate`(연속 3릴리스 E2E 초록 + P0 0건), `#fs-mac-rename-old-name`(macOS 기존 결함, 다음 판).