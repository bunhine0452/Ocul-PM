---
schema_version: 1
type: bug
slug: "windows-install-update-polish"
status: done
difficulty: medium
created_at: "2026-11-19T16:22:00+09:00"
session_id: "manual-20261119-162200"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.windows.conf.json"
    op: update
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: update
  - path: "src-tauri/windows/installer-sidebar.bmp"
    op: create
  - path: "src-tauri/windows/installer-header.bmp"
    op: create
  - path: "scripts/build-installer-art.py"
    op: create
  - path: ".gitattributes"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/update_gate.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/lib/updater.ts"
    op: update
  - path: "src/lib/updaterRoute.ts"
    op: update
  - path: "src/api/installKind.ts"
    op: update
  - path: "src/components/UpdateBanner.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/update_banner.test.tsx"
    op: update
  - path: "src/__tests__/update_terminal_wait.test.tsx"
    op: update
related: []
tags:
  - "업데이트"
  - "windows"
  - "설치"
---
[x] 업데이트: Windows 설치와 업데이트를 다듬는다

## 발생 원인
사용자 요청(11-19): Windows 에서 설치하고 업데이트할 때 더 세련되게.

읽어 보니 다듬기 전에 결함이 둘 있었다.
- **업데이트마다 세션이 크래시로 적혔다.** 업데이터 플러그인(2.14.1)은 Windows 에서 설치 파일을 띄우고 `std::process::exit(0)` 으로 끝낸다. 그 길은 `RunEvent::ExitRequested` 를 지나지 않는다. 그래서 프로젝트 세션 마감(`shutdown_all_blocking`)과 터미널 정리가 빠졌고, 다음 기동이 열린 세션을 `crash_recovered` 로 닫았다. 플러그인의 `on_before_exit` 는 `updater_builder()` 가 늘 `cleanup_before_exit` 로 덮어써서 앱이 끼어들 수 없다.
- **Windows 업데이트는 묻지 않고 claude 턴을 끊었다.** `downloadAndInstall()` 한 번이 받기와 깔기(= 앱 종료)를 같이 해서, 바쁨 확인을 할 틈이 없었다. 코드 주석에도 「묻기는 그 OS 에서 아직 못 한다」로 남아 있었다.

보이는 쪽도 기본값 그대로였다. 설치 파일은 NSIS 기본 그림에, 바닥 글이 「Nullsoft Install System」(`copyright` 가 비어 있음)이었다. 환영 문구는 「(을)를 설치할 것입니다 … 모든 프로그램을 종료하여 주시기 바랍니다」였고, 설치가 끝나도 로그 쪽에서 「다음」을 한 번 더 눌러야 했다. 앱 안에서는 「설치 중…」만 보이다가 창이 말없이 사라졌다.

## 해결 방법
- **종료 정리**: `ExitRequested` 의 정리를 `teardown_for_exit` 하나로 묶었다. 동기 커맨드 `update_prepare_exit`(메인 스레드라 세션 마감의 `block_on` 이 안전하다)가 같은 함수를 부른다.
- **받기와 바꾸기를 나눴다** (`useUpdater`): `download()` 로 진척(%)을 보이고, 바쁨을 확인한 뒤에 바꾼다. Windows 는 그때 창 구성 저장 → 「다시 여는 중」 을 그릴 350ms → `update_prepare_exit` → `install()` 순서로 간다. 정리 뒤 설치 파일을 못 띄우면 `relaunch` 한다. macOS · Linux 는 예전처럼 받자마자 깔고 재시작만 미룬다. 상태에 `downloading{percent}` · `restarting` 이 붙었다. 로그 줄 `install -> installed` 는 스모크가 읽어서 이름을 그대로 뒀다.
- **배너 · 설정**: 받는 동안 「v4.9.4 내려받는 중 · 42%」 와 3px 막대(`role=progressbar`)를 보인다. 진행 중에는 단추와 닫기를 걷었다.
- **설치 파일** (템플릿은 그대로, 설정 · 훅만): 아이콘, 사이드바(164×314) · 머리(150×57) 그림, `copyright` 를 넣었다. 그림은 앱 아이보리 위에 아이콘과 「Ocul」 이고 `scripts/build-installer-art.py` 가 굽는다. 환영 · 마침 문구와 「Ocul 바로 열기」 는 `.onGUIInit` 에서 언어별 변수로 넣었다. 템플릿이 언어 파일을 훅 뒤에 넣어서 LangString 을 쓸 수 없다. 진행 쪽 머리는 설치/업데이트(/UPDATE · /R)에 맞춰 바꾸는데, 앱 안 업데이트가 띄우는 작은 창이 이것이다. 성공한 설치는 마침 쪽으로 저절로 넘어간다(POSTINSTALL `SetAutoClose true`). 로그는 `%TEMP%\ocul-pm-setup.log` 에 있다.

## 검증
- `cargo test --locked` exit 0 · `cargo clippy --all-targets --locked -- -D warnings` Finished · `cargo fmt --check` exit 0
- `vitest run` → `Tests 1104 passed (1104)` (Windows 순서 · 실패 재시작 · 받기 실패 · 진척 막대 시험 포함) · `tsc --noEmit` exit 0 · lint 5관문 clean · eslint 0 errors

## 메모
템플릿을 포크하면 더 줄일 수 있지만 하지 않았다. 이미 깔린 판 위에서 새 설치 파일을 돌릴 때 나오는 「이미 설치됨 — 지우고 설치 / 그대로」 쪽과 폴더 고르는 쪽이 그것이다. 1000줄 템플릿을 CLI 판마다 맞춰야 한다. 화면은 사람 눈이 남았다(polish-round #eyes-win-installer).
