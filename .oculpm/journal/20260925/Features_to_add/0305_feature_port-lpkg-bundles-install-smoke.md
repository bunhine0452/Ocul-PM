---
schema_version: 1
type: feature
slug: "port-lpkg-bundles-install-smoke"
status: done
difficulty: high
created_at: "2026-09-25T03:05:12+09:00"
session_id: "mcp-20260925-030512"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.windows.conf.json"
    op: create
  - path: "src-tauri/tauri.linux.conf.json"
    op: create
  - path: "src-tauri/linux/ocul-pm.desktop"
    op: create
  - path: "src-tauri/windows/installer-hooks.nsh"
    op: create
  - path: ".github/scripts/install-smoke-windows.ps1"
    op: create
  - path: ".github/scripts/install-smoke-linux.sh"
    op: create
  - path: ".github/workflows/portability.yml"
    op: update
related: []
tags:
  - "cross-platform"
  - "windows"
  - "linux"
  - "packaging"
  - "ci"
  - "mcp-tool"
---
[x] Windows·Linux 번들 설정과 설치 스모크 합류 (L-PKG, PR #45)

## 추가 기능

- **플랫폼별 번들 설정** — `tauri.windows.conf.json`(NSIS 하나 · currentUser · WebView2 embedBootstrapper · 설치 언어 English·Korean), `tauri.linux.conf.json`(AppImage + deb, Depends 에 `libssl3 | libssl3t64`·`libdbus-1-3`). macOS 용 `tauri.conf.json` 은 그대로 두고, Tauri 가 플랫폼 파일을 JSON Merge Patch 로 얹는다(D3).
- **portability.yml 번들·설치 스모크 잡** — 바뀐 파일 판정 → 번들(windows-latest·ubuntu-22.04, 일회용 업데이터 키로 릴리스와 같은 설정) → 설치 스모크(깨끗한 러너에서 설치·실행·재설치·제거).
- **deb 딥링크** — 번들러 기본 `.desktop` 은 `Exec=` 에 `%u` 가 없어서 GLib 이 `oculpm://` URL 을 인자에서 빼 버렸다. `src-tauri/linux/ocul-pm.desktop` 템플릿으로 해결.
- **실행 중인 사이드카가 재설치·업데이트를 막던 결함** — Claude Code·Codex 가 설치 폴더의 `oculpm-mcp.exe` 를 MCP 서버로 띄워 두면 파일이 잠긴다. NSIS 템플릿은 메인 exe 이름만 끝낸다. 그래서 `/S` 설치는 옛 사이드카를 조용히 남기고(종료 코드 0), 업데이터 모양(`/P /UPDATE`) 설치는 "Error opening file for writing" 대화상자에서 멈췄다. `installer-hooks.nsh` 의 PREINSTALL 이 이 파일을 `.old-<틱>` 으로 비켜 두고, 남은 파일은 다음 설치·제거 때 지운다.

## 동작 흐름

- **Windows 스모크** — NSIS `/S` 설치 → 레지스트리·스킴·바로가기·사이드카 확인 → 실행(로그 기동 줄·DB·창·WebView2·프런트 마운트) → 재설치 프로브(이미지 이름 규칙·트리 종료 여부) → 사이드카 잠금 gate → 제거·잔재 확인.
- **Windows VC++ 실측** — System32 의 VC++ DLL 을 잠시 숨겨 두고 설치본을 실행해 본다. servercore 컨테이너에서는 설치본만 / +DirectML / +DirectML+VC++ 셋으로 원인을 가른다. 결과로 `win-msvcp140` 이 출시 차단으로 확정됐다. `DirectML.dll!DMLCreateDevice1` 정적 가져오기도 기록했다(Windows 10 2004 이상).
- **Linux 스모크** — D11 glibc 하한(objdump) → 깨끗한 컨테이너 3종에서 Depends 검사 → AppImage 실행(호스트가 줘야 하는 libEGL·libGLESv2 기록 뒤 설치) → deb 실행과 `gio open` 으로 딥링크 전달 gate → 제거.

## 검증

- PR #45: ci.yml 3잡과 portability.yml 11잡(번들·설치 스모크 양 OS 포함)이 전부 pass. rebase 병합(c8dcf5f1).
- 후속(VC++ 없을 때만 자동 설치, Windows 10 2004 미만 차단)은 L-PKG 가 port/l-pkg2 에서 진행 중이다.