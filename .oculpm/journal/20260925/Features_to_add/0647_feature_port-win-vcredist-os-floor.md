---
schema_version: 1
type: feature
slug: "port-win-vcredist-os-floor"
status: done
difficulty: high
created_at: "2026-09-25T06:47:21+09:00"
session_id: "20260925-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: update
  - path: ".github/scripts/fetch-vcredist.ps1"
    op: create
  - path: ".github/scripts/install-smoke-windows-vcrt.ps1"
    op: create
  - path: ".github/scripts/install-smoke-windows.ps1"
    op: update
  - path: ".github/scripts/install-smoke-linux.sh"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: "src-tauri/windows/vcredist/.gitignore"
    op: create
  - path: "src-tauri/Cargo.toml"
    op: update
related:
  - ref: "20260925/Features_to_add/0305_feature_port-lpkg-bundles-install-smoke.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "windows"
  - "packaging"
  - "ci"
  - "mcp-tool"
---
[x] Windows 설치 파일 — VC++ 재배포 없을 때만 자동 설치 · Windows 10 2004 미만 차단 (L-PKG 후속, PR #46)

## 추가 기능

출시를 막던 `#win-msvcp140` 을 해소했다. 사전 빌드 ONNX Runtime 이 동적 CRT(/MD)라 exe 가 `MSVCP140.dll` 을 가져온다. 그래서 VC++ 재배포가 없는 PC 에서는 앱이 `0xC0000135` 로 아예 뜨지 않았다. 사용자 결정(2026-09-25)대로 구현했다.

- **OS 하한** — NSIS PREINSTALL 첫 단계에서 레지스트리 `CurrentBuildNumber` 를 읽는다. 19041 미만이면 한국어·영어로 이유(DirectML `DMLCreateDevice1` 이 Windows 10 2004 부터 있음)를 알리고 멈춘다. 빌드를 못 읽으면 막지 않고 로그만 남긴다.
- **VC++ 재배포 — 없을 때만 설치**
  - 판정: 레지스트리 `VC\Runtimes\x64` 의 `Installed`·`Bld` 와 실제 System32 의 DLL 4개(msvcp140 파일 빌드)를 **둘 다** 본다.
  - 부족하면 동봉 `vc_redist.x64.exe /install /quiet /norestart` 를 돌린다. 같은 판이 등록된 채 파일만 없으면 `/repair` 로 다시 돌린다. 이 파일은 asInvoker 라 UAC 는 부족한 PC 에서만 뜬다.
  - 실패(UAC 취소 1602 등)면 파일을 깔기 전에 멈추고 안내한다. 3010 은 계속 진행하고 재시작을 안내한다.
- **요구 판 36247 (14.51)** — 처음엔 ONNX Runtime 목적 파일의 도구 빌드 35222 만 보고 정했다. 그런데 스모크의 Rich 헤더 gate 가 exe 를 링크한 러너 MSVC 가 14.51 계열(36256)임을 잡았다. Microsoft 규칙은 "재배포 ≥ 앱 구성 요소가 쓴 가장 새 도구" 라 동봉 판 14.51.36247 로 올렸다.
- **`fetch-vcredist.ps1`**
  - 판 고정 URL · SHA-256 · Authenticode(Microsoft Corporation) · 파일 버전 · 빌드 도구 계열 ≤ 재배포 계열을 확인한다.
  - 이 스크립트 없이 번들하면 makensis 가 `vcredist.nsh is missing` 으로 멈춘다. 재배포가 조용히 빠진 설치 파일은 만들어지지 않는다.
- 대화상자에 `MB_TOPMOST|MB_SETFOREGROUND` 를 붙였다. passive 업데이트에서 창 뒤에 숨어 있었다.
- `Cargo.toml` authors `"you"` → `"Kim Hyunbin"` (deb Maintainer).

## 동작 흐름

스모크 `install-smoke-windows-vcrt.ps1` 이 러너에서 실측한 것:
- 19040 주입이면 막히고, 19041 주입이면 통과한다.
- 재배포가 이미 있으면 건너뛴다.
- DLL 4개를 숨기고 `Installed=0` 으로 만들면 기존 설치본은 뜨지 않는다. 이 상태에서 설치하면 `/install` → `/repair` 로 되살리고, 좁힌 PATH 에서 GUI 가 `App window mounted` 까지 뜬다.
- 1602 흉내면 종료 코드 2 로 멈춘다.
- Rich 헤더 gate 는 "링커보다 새 도구로 컴파일된 코드 없음" 을 본다.

설치 파일은 38.7 → 57.1 MB 로 늘었다(+18.4, 동봉 재배포).

## 검증

- PR #46: ci.yml 3잡, portability(설치 스모크 win 30 gate · linux 32 gate), E2E 양 OS 모두 pass. rebase 병합(6d81674a).
- 중간에 한 번 붉었다. rebase 로 들어온 PR #43 의 로그 자리 변경(`<앱 데이터>/logs`) 탓에 스모크가 옛 ProjectDirs 경로를 봤다. 스모크 쪽을 고쳤다. PR #43 은 번들 파일을 안 바꿔 그쪽 CI 에서 설치 스모크가 돌지 않았다.
- CI 가 못 본 것: 실제 UAC 창·표준 사용자 계정의 관리자 암호 경로·실제 취소·3010·한국어 대화상자 화면·2004 미만 실기. `#w5-eyes` 에 적었다.