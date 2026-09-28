---
schema_version: 1
type: feature
slug: "port-release-pipeline-nonmac"
status: done
difficulty: superhigh
created_at: "2026-09-28T21:45:13+09:00"
session_id: "20260928-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/scripts/release/latest-json.mjs"
    op: create
  - path: ".github/scripts/release/notes.mjs"
    op: create
  - path: ".github/scripts/release/dryrun-version.mjs"
    op: create
  - path: ".github/scripts/release/release.test.mjs"
    op: create
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".github/workflows/e2e.yml"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: []
tags:
  - "cross-platform"
  - "release"
  - "ci"
  - "windows"
  - "linux"
  - "mcp-tool"
---
[x] 릴리스 파이프라인에 Windows·Linux — 비-mac 격리 · 검증 통과 플랫폼만 latest.json · 공개 스위치 (L-REL, PR #47)

## 추가 기능

`release.yml` 흐름: `meta → gate(ci.yml 만, D2) → macos ∥ bundle(win·linux) → smoke ∥ e2e(설치본) → publish (→ dryrun-cleanup)`.

- **macOS 는 그대로** — 빌드·서명·공증·업데이터 검증 그대로다. draft 해제만 맨 끝 publish 로 옮겼다. 비-mac 항목을 draft 안에서 병합·검증한 뒤 한 번에 공개하기 위해서다.
- **비-mac 격리**
  - 태그 커밋에서 번들 → 깨끗한 러너 설치 스모크 → 설치본 E2E 를 돈다. 셋 다 통과하고 해시가 같은 플랫폼만 자산·latest.json 에 싣는다(D7).
  - 실패·timeout 은 macOS 공개를 막지 않는다. 그 플랫폼만 빠지고, 본문에 한 줄 남기고, run 을 붉힌다.
- **latest.json** — `.github/scripts/release/latest-json.mjs` 가 병합·검증한다. 병합 결과의 macOS 항목은 baseline 과 deepEqual 로 단언한다.
  - 키는 `darwin-aarch64` · `darwin-aarch64-app` · `windows-x86_64` · `windows-x86_64-nsis` · `linux-x86_64-appimage`.
  - **맨 `linux-x86_64` 는 싣지 않는다.** 두면 deb 설치본이 AppImage 를 받아 `install_deb` 가 거절한다.
- **공개 스위치 `OCULPM_RELEASE_NONMAC`**(저장소 변수, 기본 꺼짐) — 오케스트레이터 검토에서 나왔다. 파이프라인이 main 에 있어도, 다른 세션의 macOS 핫픽스 태그가 README·랜딩 없이 Windows·Linux 를 공개하지 않게 한다. 꺼짐이면 결과물(자산 5 · 키 2 · 본문)이 v3.5.0 과 같다. 본문은 픽스처로 바이트 단위까지 단언한다.
- **드라이런(workflow_dispatch)** — 가짜 버전 `0.0.<run>` 의 draft 로 돈다. 공개·`--latest` 는 코드 경로에서 막혀 있다. 입력은 `fail` · `nonmac` · `keep_draft`.
- portability.yml·e2e.yml 에 main push 트리거를 달았다(#w0-promote 결정: required 승격·ci.yml 합치기 대신 태그 전 미리보기 창). ci.yml 프런트 잡에는 릴리스 스크립트 테스트(39건)를 넣었다.

## 동작 흐름

드라이런 실측:
- 세 플랫폼 켜짐: 전부 초록, 자산 10, 키 5(36044908635).
- 스위치 꺼짐: 비-mac 잡 skipped, v3.5.0 모양 결과물, 자동 정리(36048116681).
- `fail=linux-smoke` 주입: macOS 정상, 비-mac 은 빠짐(36040486472).
- rebase 뒤 켜짐 run 에서 Windows 가 Rich 헤더 gate 로 빠졌다(36063724821). 이것이 PR #49 로 이어졌다.

## 검증

PR #47 전 체크 pass(E2E 창 선택 수정 PR #50 병합 뒤), rebase 병합(14e631da). `releases/latest` 는 v3.5.0 그대로이고, 드라이런 draft·브랜치는 모두 지웠다.