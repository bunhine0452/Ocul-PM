---
schema_version: 1
type: bug
slug: "appimage-diricon-apprun-mode"
status: done
difficulty: medium
created_at: "2026-10-04T16:11:12+09:00"
session_id: "20261004-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
  - path: ".github/scripts/seed-appimage-apprun.sh"
    op: create
  - path: ".github/scripts/appimage-lint.sh"
    op: create
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: ".oculpm/planner/cross-platform-port.md"
    op: update
related:
  - ref: "20260929/Bugs/0832_bug_ci-ort-cache-dir-in-rust-cache.md"
    kind: "followup"
tags:
  - "port"
  - "linux"
  - "appimage"
  - "ci"
  - "release"
  - "mcp-tool"
---
[x] AppImage 카탈로그 거절 — .DirIcon 절대 심링크 · AppRun.wrapped 0770 (Tauri CLI 2.11.5 고정 + 런처 선배치 + AppImage 린트 게이트)

## 발생 원인

AppImage 카탈로그의 자동 발견 봇이 연 등재 PR(appimage.github.io#9061)이 `FATAL: .DirIcon is missing` 으로 붉었다. v3.6.0 AppImage 의 squashfs 를 직접 읽어(맥에서 PySquashfsImage, 오프셋 944632 · zstd) 374개 항목을 전수 확인하니 결함은 정확히 둘이었다.

1. **`.DirIcon` 이 빌드 러너의 절대경로 심링크** — `/home/runner/work/…/Ocul-PM.AppDir/Ocul-PM.png`. 마운트 지점(`/tmp/.mount_*`)에서는 끊긴다. 빌드 러너에서는 AppDir 가 아직 남아 있어 멀쩡해 보인다. 업스트림 tauri#15110 — tauri-bundler 2.9.4(CLI 2.11.4)에서 상대 심링크로 고쳐졌고, 우리 lockfile 은 2.11.2 였다.
2. **`AppRun.wrapped` 가 `-rwxrwx---`** — 번들러의 `write_and_make_executable` 이 받은 AppRun 을 0770 으로 쓰고, 그것이 복사돼 실린다. 카탈로그는 린트 다음에 `firejail --appimage` 로 띄운다. root 가 마운트하고 다른 사용자가 실행하므로 `Permission denied` 가 난다. 1번을 고쳐도 다음 단계에서 이걸로 다시 거절됐을 것이다. 업스트림 tauri#16155 — CLI 2.12 에서야 고쳐졌다.

설치 스모크·업데이터 스모크는 같은 사용자로, 빌드 러너 위에서 띄우므로 둘 다 구조적으로 못 본다.

## 해결 방법

- **`@tauri-apps/cli` `^2` → `~2.11.5`.** 2.11.5 는 2.11 계열 보안 패치다(업데이터 서명 trusted comment 에 판 기록, 번들러 2.9.4 = .DirIcon 수정 포함). **2.12 는 일부러 피했다.** NSIS 의 restart manager 종료(tauri#14479)가 Windows PTY 호스트 업데이트 생존 설계(2.11.2 템플릿의 이름 기반 종료 전제)에 닿고, AppImage 의 GDK_BACKEND=x11 강제 해제(Wayland 네이티브)와 xdg-open 미번들이 함께 들어오기 때문이다. 카탈로그 등재 하나 때문에 들일 변화가 아니다. 평가 항목은 플랜 `{#w5-tauri-cli-212}` 로 이월했다.
- **`.github/scripts/seed-appimage-apprun.sh`** — 번들러가 받는 것과 같은 URL 의 AppRun-x86_64 를 SHA-256 고정(`f30140a4…` = v3.6.0 안의 AppRun.wrapped 와 동일)으로 받는다. 0755 로 `${XDG_CACHE_HOME:-~/.cache}/tauri/` 에 먼저 놓는다. 번들러는 캐시에 있으면 받지 않고 fs::copy(모드 보존)한다. release.yml · portability.yml Linux 번들 잡, `tauri build` 앞이다.
- **`.github/scripts/appimage-lint.sh`** — AppImage 를 umask 022 로 통째로 풀어 두 가지를 본다. (a) 모든 심링크가 상대경로이고, 이미지 안에서 해석되고, 이미지 밖으로 나가지 않는가 (b) 모든 항목이 o+r 이고, u+x 면 o+x 인가. release.yml 산출물 단계(Linux)와 portability.yml collect 단계에서 게이트로 돈다. portability 의 번들 변경 감지기와 문법 검사(bash -n · shellcheck)에 두 스크립트를 등록했다.
- CHANGELOG `## Unreleased` 에 사용자 증상 기준으로 한 절을 넣었다.

## 검증

- 린트를 v3.6.0 재현본에 돌렸다. 심링크·모드를 그대로 옮긴 AppDir 이다(대소문자 무시 APFS 라 루트의 `ocul-pm.png` 만 접미사). 결과는 정확히 두 건, exit 1. 둘을 고친 사본은 통과했다(심링크 32개). 끊김 · 이미지 밖 탈출 · 0600 파일 · 0700 디렉터리 음성 케이스 넷도 모두 잡았다. 받은 AppRun 의 해시는 이미지 안의 것과 일치했다.
- shellcheck(-S warning) 0건이다. actionlint 는 main 과 같은 기존 8건이고 새 지적은 없다. worktree 에서 typecheck · test(252파일/3288) · lint · build 모두 exit 0 이다. `tauri --version` = 2.11.5.
- 실제 번들에 대한 판정은 `port/` 브랜치 push 의 portability 번들 잡이 한다(이 일지 시점 미확인). 카탈로그 통과는 다음 릴리스 뒤 `/retest` 로만 확인된다 — `{#w5-appimage-catalog}`.

## 메모

- 카탈로그 테스트 순서: appdir-lint(.DirIcon·.desktop·desktop-file-validate) → 아이콘 탐색 → firejail 로 실행해 10~30초 안에 창이 뜨는지(Xvfb, WEBKIT_DISABLE_DMABUF_RENDERER=1). 우리 .desktop 의 `MimeType=` 끝 세미콜론 부재는 현행 validate.c 기준 오류가 아니다.
- 2.12 로 올리면 seed 스크립트와 두 워크플로의 호출을 지운다. 린트는 남긴다.