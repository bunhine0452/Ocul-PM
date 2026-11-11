---
schema_version: 1
type: chore
slug: "drop-vcredist"
status: done
difficulty: medium
created_at: "2026-11-11T22:00:00+09:00"
session_id: "manual-20261111-220000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: update
  - path: "src-tauri/windows/vcredist/.gitignore"
    op: delete
  - path: ".github/scripts/fetch-vcredist.ps1"
    op: delete
  - path: ".github/scripts/install-smoke-windows-vcrt.ps1"
    op: delete
  - path: ".github/scripts/install-smoke-windows-os.ps1"
    op: create
  - path: ".github/scripts/install-smoke-windows.ps1"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".github/workflows/release.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: []
tags:
  - "설치"
  - "windows"
  - "ci"
---
[x] 설치: VC++ 재배포를 싣지 않는다

## 내용
Windows 설치 파일은 Microsoft VC++ 재배포를 싣고 없거나 낡은 PC 에서 UAC 를 띄워 깔았다. 근거는 하나였다 — 사전 빌드 ONNX Runtime(ort/fastembed, `/MD`)이 MSVCP140 을 불렀다. 4.0 에서 걷혀 `Cargo.lock` 에 `ort`·`fastembed`·`onnx` 가 없다.

지금 exe 의 가져오기(`dumpbin /dependents`, 이 PC 의 debug 빌드): `ocul-pm.exe` · `oculpm-mcp.exe` 둘 다 VCRUNTIME140 · MSVCP140 이 **없다** — `api-ms-win-crt-*`(UCRT, Windows 10 부터 OS 내장)뿐이다. tauri-build 의 `static_vcruntime` 이 libcmt + libvcruntime 을 정적으로 링크하기 때문이다(`tauri-build-2.7.4` lib.rs → `static_vcruntime::metabuild`; 대조로 같은 툴체인의 맨 hello-world 는 VCRUNTIME140.dll 을 가져온다).

걷은 것:
- `installer-hooks.nsh` — 재배포 정책(`OCULPM_VCRT_MIN_BLD`) · `vcredist.nsh` include · `OCULPM_VCRT_STATE` · `OCULPM_ENSURE_VCRT` · `OCULPM_TEST_VCREDIST_EXIT`. 남은 단계는 OS 하한과 사이드카 비켜 두기 둘.
- `fetch-vcredist.ps1` 와 portability · release 의 「VC++ 재배포 받기」 단계, `src-tauri/windows/vcredist/`, 번들 판정 정규식의 `fetch-vcredist` 항목.
- 설치 스모크: `install-smoke-windows-vcrt.ps1` → `install-smoke-windows-os.ps1`(OS 하한 두 gate 그대로 + 새 gate `Test-NoVcRuntimeImports`: 두 exe 가 vcruntime/msvcp 를 가져오면 붉다). 예전 observe 「DLL 의존」 을 gate 로 올렸고, 재배포 없는 PC 흉내(5b) · Rich 헤더 도구 판 · 재설치 skipping gate 는 대상이 없어 걷었다.

**OS 하한(19041)은 남겼다.** 그 값은 DirectML(ONNX Runtime) 때문이었고 이유는 사라졌지만, README · 랜딩이 「Windows 10 2004 이상」 으로 약속하고 터미널은 ConPTY(1809) 가 필요하다 — 내리는 것은 따로 정할 일이다. 주석과 막을 때의 문구에서 ONNX Runtime · DirectML 설명만 「그보다 낮은 판은 확인된 적이 없다」 로 고쳤다(스모크가 보는 `STOP: Ocul-PM requires Windows 10 version 2004` 는 그대로).

## 검증
- `dumpbin /dependents target/debug/ocul-pm.exe` → kernel32 … `api-ms-win-crt-locale-l1-1-0.dll` (33개), vcruntime/msvcp 0 · `oculpm-mcp.exe` 18개, vcruntime/msvcp 0
- PowerShell 파서: `install-smoke-windows.ps1` · `install-smoke-windows-os.ps1` 파싱 오류 0
- NSIS 컴파일 · 설치 스모크는 로컬에서 돌리지 않았다(조정자 지시 — 번들은 CI portability/release 가 굽는다). 다음 portability 번들 · 설치 스모크 run 에서 `Test-NoVcRuntimeImports` gate 와 NSIS 컴파일을 확인할 것.
- 릴리스 때 README · README.en · 두 랜딩의 「Visual C++ 런타임이 없는 PC 에서는 설치 파일이 먼저 깔아 줍니다」 문장을 걷어야 한다(이 작업 범위 밖).
