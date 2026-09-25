---
schema_version: 1
type: bug
slug: "port-smoke-rich-gate-cpp-only"
status: done
difficulty: medium
created_at: "2026-09-25T12:31:55+09:00"
session_id: "20260925-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/scripts/install-smoke-windows-vcrt.ps1"
    op: update
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: update
related:
  - ref: "20260925/Features_to_add/0647_feature_port-win-vcredist-os-floor.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "windows"
  - "ci"
  - "packaging"
  - "mcp-tool"
---
[x] Windows 설치 스모크의 Rich 헤더 gate 가 러너 이미지에 따라 붉던 것 — C++ 목적 파일만 재배포 판과 대조 (PR #49)

## 발생 원인

L-PKG 가 넣은 도구 판 gate 는 "exe 안에 링커보다 새 도구로 컴파일된 목적 파일이 없다" 를 단언했다. 그런데 windows-latest 러너 이미지 가운데 같은 14.51 계열 안에서 cl 이 36257, link 가 36256 으로 패치 빌드가 한 칸 어긋난 것이 있었다. 러너가 컴파일한 C 목적 파일 107개(0x0104/36257)가 링커보다 "새것" 으로 잡혀, 앱과 무관하게 붉었다. L-PKG 의 초록 run 에서는 둘 다 36256 이었다. 붉은 곳은 두 군데였다.

- 릴리스 드라이런 36063724821: Windows 가 빠졌다.
- PR #47 의 Portability 설치 스모크.

## 해결 방법

`install-smoke-windows-vcrt.ps1` 의 gate 를 바꿨다. MSVCP140(판마다 내보내기가 늘어나는 STL DLL)을 부르는 것은 C++ 목적 파일(0x0105)뿐이니, 그 최대 빌드가 동봉 재배포 요구 판(`OCULPM_VCRT_MIN_BLD` 36247) 이하인지만 본다.

- 원래 잡으려던 길은 여전히 잡는다. ONNX Runtime 사전 빌드(C++ 909개)가 재배포보다 새 MSVC 로 구워지면 요구 판을 넘어 붉어진다.
- C·MASM 은 vcruntime·ucrt 만 부르고, 러너의 도구 계열은 `fetch-vcredist.ps1` 이 빌드 전에 확인한다.
- 전체 분포는 참고 줄로 남긴다.
- `installer-hooks.nsh` 는 주석만 고쳤다(BOM 유지).

## 검증

- PR #49: ci.yml 3잡, portability(번들 양 OS 새로 구움 · 설치 스모크 양 OS), E2E 양 OS 모두 pass. rebase 병합(1b44fe94).
- 스모크 로그: `[PASS] … C++ 최대 35721 ≤ 요구 36247 · 링커 36256 · 0x0104: 36256×107 …`.