---
schema_version: 1
type: bug
slug: "ci-vcrt-smoke-config-verb-leftover"
status: done
difficulty: low
created_at: "2026-10-29T04:13:20+09:00"
session_id: "20261029-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/scripts/install-smoke-windows-vcrt.ps1"
    op: update
related:
  - ref: "20261029/Refactors/0326_refactor_v4-integrate-lanes-release-prep.md"
    kind: "followup"
  - ref: "20261029/Bugs/0033_bug_ci-e2e-smoke-pty-host-leftovers.md"
    kind: "followup"
tags:
  - "v4"
  - "ci"
  - "windows"
  - "mcp-tool"
---
[x] Windows 설치 스모크의 VC++ 없는 PC 단계가 4.0 에서 걷은 config 하위 명령을 불러 30초 시한을 넘기던 것

## 증상

PR #115(4.0.0) 의 Portability run 40745285289 에서 `설치 스모크 — windows-latest` 하나만 붉었다. gate 40여 개 중 실패는 `(a) 그 PC 에서 앱이 뜬다 — 좁힌 PATH 로 사이드카 · 메인 exe · GUI` 한 건이다. 실패 문구는 `사이드카 [exit=0 … oculpm-mcp 4.0.0] · 메인 [시한 초과(30초)]`. CI · E2E 두 run 과 같은 run 안의 첫 실행·재설치·사이드카 잠금·제거 gate 는 모두 초록이었다.

## 원인

`install-smoke-windows-vcrt.ps1` 가 메인 exe 를 `config --help` 로 불러 CLI 로 끝나는지 본다. 4.0 엔진 레인이 선언적 설정(`ocul-pm config`)을 걷으면서 `main.rs` 의 `config` 분기도 사라졌다. 그 결과 그 인자가 GUI 로 흘러가 창이 떴고, 프로세스가 끝나지 않아 30초 시한을 넘겼다. 10-28 의 PTY 호스트 잔재(0033)와 같은 꼴이다. 하네스가 걷힌 표면을 부르고 있었다.

## 수정

- 두 호출(재배포를 숨긴 직후의 관찰, 설치 뒤 gate)을 남아 있는 CLI 낱말 `tools` 로 바꿨다. `is_cli_verb` 에 있고, 프로젝트 판정 전에 도구 정의 JSON 을 찍고 0 으로 끝난다.
- `Invoke-CleanEnv` 가 `WaitForExit` 뒤에 `ReadToEnd` 하던 것을, 기다리기 전에 `ReadToEndAsync` 를 시작하도록 바꿨다. `tools` 출력은 수 KB 라 파이프 버퍼를 넘기므로, 그대로 두면 자식이 쓰기에서 막혀 다시 시한을 넘긴다.

## 검증

- 로컬에는 이 스크립트를 읽는 테스트가 없다 — CI(Portability `설치 스모크 — windows-latest`)가 심판. 푸시 5c70cff2.
- `tools` 가 프로젝트 없이 성공한다는 것: `agent_cli::tests::tools_prints_the_same_definitions_the_mcp_server_serves`.
- `git grep "config --help\|'config'" -- .github e2e scripts` → 남은 호출 없음(주석 한 줄뿐).