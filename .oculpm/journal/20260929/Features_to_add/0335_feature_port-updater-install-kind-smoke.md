---
schema_version: 1
type: feature
slug: "port-updater-install-kind-smoke"
status: done
difficulty: superhigh
created_at: "2026-09-29T03:35:20+09:00"
session_id: "20260929-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/install_kind.rs"
    op: create
  - path: "src/api/installKind.ts"
    op: create
  - path: "src/lib/updaterRoute.ts"
    op: create
  - path: "src/lib/updater.ts"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".github/scripts/updater-smoke-http.mjs"
    op: create
  - path: ".github/scripts/updater-smoke-windows.ps1"
    op: create
  - path: ".github/scripts/updater-smoke-linux.sh"
    op: create
  - path: "src-tauri/tests/updater_target_wording.rs"
    op: create
related: []
tags:
  - "cross-platform"
  - "updater"
  - "release"
  - "ci"
  - "mcp-tool"
---
[x] 업데이터가 설치 형식을 먼저 본다 · 업데이터 N→N+1 스모크 Windows·Linux 실측 (L-UPD, PR #57)

## 추가 기능

- **#upd-target-missing** — 업데이터는 버전과 무관하게 자기 키부터 찾는다. 그래서 deb 설치본과 이번 릴리스에서 빠진 OS 의 앱은 확인할 때마다 「대상 없음」 오류가 났다.
  - `install_kind` 커맨드(번들러가 굽는 `bundle_type` 표식 + 업데이터 키 순서)를 두고, 순수 판정 `updaterRoute.ts` 로 가른다.
  - deb·rpm 은 업데이터에 묻지 않고(네트워크 0) 「패키지 관리자로 업데이트해요」 안내를 띄운다.
  - 대상 없음은 중립 상태 「최신 릴리스에 이 OS 용 빌드가 아직 없어요」 + 릴리스 페이지 버튼으로 보인다. 시작 배너는 조용하다.
- **#w3-updater-smoke** — 첫 비-mac 공개 판의 업데이터가 깨져 있으면 사용자가 그 판에 갇히므로, 공개 전에 실측한다. portability.yml `updater-smoke` 잡:
  - 번들 잡이 같은 일회용 키로 스모크 판 N(3.4.999, 로컬 엔드포인트)을 하나 더 굽는다. 로컬 서버가 N+1(릴리스 설정 번들)과 latest.json 을 내준다. latest.json 키는 릴리스 표(`latest-json.mjs`)에서 가져온다.
  - N 만 `VITE_OCULPM_UPDATER_SMOKE` 로 빌드해 배너의 `install()` 을 스스로 부른다(Linux AppImage 에는 WebDriver 를 붙일 수 없다).
  - 진짜 업데이터 키와 tauri.conf.json 은 건드리지 않았다.

## 동작 흐름

러너 실측(run 36441793539 · c42be7f7 의 36442504726):
- **Windows**
  - 다른 파일의 서명·다른 키의 서명은 57MB 를 끝까지 받은 뒤 거절한다. DisplayVersion·exe 해시가 그대로이고 설치 로그 새 줄은 0.
  - 맞는 서명이면 NSIS `/P /R /UPDATE` 로 3.5.0 을 설치한다. 옛 pid 가 끝나고 재시작 뒤 기동 줄 판은 3.5.0.
- **Linux AppImage** — 거절 둘은 sha256 이 그대로다. 맞는 서명이면 파일이 교체되고 스스로 재시작한다(판 3.5.0). 새 판이 진짜 GitHub 에 처음 확인했을 때 `check -> noBuild` — 중립 상태가 실전에서 쓰였다.
- **deb** — `packageManaged`, 접근 로그 0줄.
- 도중에 스모크 쪽 결함 셋을 고쳤다: 두 번째 `tauri build` 가 번들 폴더를 비움 · Windows `sha256sum` 이 역슬래시 경로 앞에 `\` 를 붙임 · PS 정규식이 숫자를 빼먹음.

## 검증

- PR #57 전 체크 pass: 업데이터 스모크 windows(gate 21)·ubuntu(gate 25), 번들·설치 스모크·Rust·E2E. rebase 병합(5fc5bb49).
- 진단 정보의 설치 형식 연결은 PR #60 이다.
- CI 가 못 본 것: 실제 사람의 클릭, 실제 GitHub https·진짜 키, SmartScreen·백신, rpm.