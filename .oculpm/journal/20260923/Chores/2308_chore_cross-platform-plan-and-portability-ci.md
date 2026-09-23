---
schema_version: 1
type: chore
slug: "cross-platform-plan-and-portability-ci"
status: done
difficulty: medium
created_at: "2026-09-23T23:08:18+09:00"
session_id: "20260923-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20260923_cross-platform/00-master-plan.md"
    op: create
  - path: "docs/20260923_cross-platform/01-lane-briefs.md"
    op: create
  - path: "docs/20260923_cross-platform/03-mas-feasibility.md"
    op: create
  - path: "docs/README.md"
    op: update
  - path: ".oculpm/planner/cross-platform-port.md"
    op: create
  - path: ".oculpm/planner/mac-app-store.md"
    op: create
  - path: ".github/workflows/portability.yml"
    op: create
related: []
tags:
  - "ci"
  - "cross-platform"
  - "planning"
  - "mcp-tool"
---
[x] Windows·Linux 출시 설계와 플랜 — CI 러너가 실기기, MAS 는 하지 않기로

## 배경

사용자가 과제 셋(Windows 출시 · Mac App Store 출시 · Linux 지원)을 꺼냈다. 조건: **Windows·Linux 를 직접 테스트할 수 없으니 오류가 나면 안 된다**, 전부 플래너로 계획하고 병렬 세션으로 쪼갤 것. 도중에 사용자가 **Mac App Store 는 하지 않는다**고 결정했다.

## 한 일

- 코드 조사: Windows 컴파일을 막는 것은 `ptyhost/client.rs:13`·`host/mod.rs:24` 의 게이트 없는 `tokio::net::UnixStream/UnixListener` 하나. 유닉스 전용 테스트 ~25곳, `Command::new` ~40곳(Windows 콘솔 깜빡임·`.cmd` 미해석), 프런트 `⌘` 리터럴 476곳, `navigator.platform` 4곳. 이미 Windows 를 의식한 코드(open_native·shim 복사 폴백·pid_state·lock 폴백)도 적지 않다.
- 설계 SSOT `docs/20260923_cross-platform/`: D1 "CI 러너가 실기기 — 그 OS 러너에서 실행된 테스트만 완료", D2 이식성 CI 를 릴리스 게이트(ci.yml)와 분리, D4 스텁은 명시적 실패 + `PORT-STUB`, D5 `proc.rs` 단일 창구, D6 레인 = 파일 소유, D7 베타 + 검증 통과 플랫폼만 latest.json, D10 AppImage 마운트 함정. 파동 W0~W5, 병렬 레인 6개의 브리프와 파일 소유 표.
- 플랜 `cross-platform-port`(63항목) 생성. `mac-app-store` 는 기능별 샌드박스 표를 근거로 만든 뒤 사용자 결정으로 결정 1건 완료 + 나머지 폐기로 종결.
- W0: `.github/workflows/portability.yml` — windows-latest · ubuntu-22.04 에서 cargo check/clippy/test + Windows 프런트. `port/**` push 에서만 돈다(main 을 붉히지 않음). 브랜치 `port/w0-ci` push, 첫 run 35871385421 진행 중.
- W1(컴파일 기준선) 레인을 worktree 병렬 세션으로 출발시켰다 — `.gitattributes`(eol=lf) · proc.rs · 테스트 게이트 · PORT-STUB.

## 결정

- MAS: 샌드박스가 내장 터미널·ACP·훅/MCP 등록·자체 업데이터와 정면 충돌 → 기록 루프가 빠진 Lite 가 된다. 사용자 결정: 하지 않는다.
- 레인 세션은 일지·플랜을 쓰지 않고 보고서만 — 오케스트레이터가 합류 때 기록(메모리의 병렬 worktree 레시피).
- `ci.yml` 은 PR 에서만 돈다 → 레인은 로컬 macOS 게이트, PR 은 합류 때.

## 검증

- portability.yml YAML 파싱 확인(ruby), push 후 run 이 세 잡으로 떠서 Windows typecheck 단계 success 확인.
- 플랜 두 개 plan_status 로 생성 확인, mac-app-store 15항목 전부 종결.
- 커밋 fc865285 · c3d1ebf3(로컬 main, 미push) · ef7bb6d6(port/w0-ci, push).