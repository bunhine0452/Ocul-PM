---
schema_version: 1
type: feature
slug: "port-shell-integration-lshell"
status: done
difficulty: superhigh
created_at: "2026-09-24T04:27:23+09:00"
session_id: "20260924-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/shell_integration/templates/oculpm.ps1"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/powershell.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/default_shell.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/policy.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/policy_scopes.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/policy_registry.rs"
    op: create
  - path: "src-tauri/src/oculpm/shell_integration/live_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/shim.rs"
    op: update
  - path: "src-tauri/src/acp/env.rs"
    op: update
  - path: "src-tauri/src/commands/shell_integration.rs"
    op: update
  - path: "src-tauri/tests/session_shim_cli.rs"
    op: create
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260924/Bugs/0401_bug_port-integ-paths-home-guard.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "terminal"
  - "shell-integration"
  - "mcp-tool"
---
[x] 셸 통합 — PowerShell OSC 133/7, 실행 정책은 셸 없이 저장된 설정에서 (L-SHELL, PR #35)

## 추가 기능

크로스플랫폼 W2 · L-SHELL(병렬 worktree 세션) 합류. **이 머지로 main 의 Windows 테스트가 처음 완전 초록**(1,928 통과 · 0 실패).

- `templates/oculpm.ps1` — PowerShell OSC 133(명령 시작·끝)·OSC 7(cwd). `prompt` 를 건드리지 않고 `PSConsoleHostReadLine` 만 감싸 oh-my-posh·starship 과 공존, `$Host.UI.Write`(콘솔 코드 페이지 때문에 한글 경로가 ?), nonce, StrictMode·CLM·비콘솔 호스트 자가 비활성. `$PROFILE.CurrentUserAllHosts` 관리 블록.
- `default_shell.rs` 순수 함수 — macOS `$SHELL`→`/bin/zsh`(글자 하나 다르지 않음), Linux passwd→`/bin/bash`, Windows pwsh→powershell→COMSPEC.
- 세션 심: Windows `…\oculpm.exe` 인식(못 알아보면 GUI 두 번째 인스턴스로 샌다), 심링크→하드링크→복사, `oculpm.cmd` 는 두지 않는다(배치 `%*` 가 에이전트 JSON 인자를 다시 해석 — BatBadBut). AppImage 는 `$APPIMAGE`.
- `acp/env.rs` — `split_paths` + Windows PATHEXT(DAP·LSP·npm 탐색의 전제), Windows 는 로그인 셸을 띄우지 않는다.

## 발생 원인 → 해결 (실행 정책 확인)

설치 전 실행 정책을 **PowerShell 을 띄워** 물었는데, 반복 테스트가 부하 걸린 러너에서 5.1 콜드 스타트 **45초 초과**를 잡아냈다(느린 사용자 PC·Defender 스캔 중에도 같은 일). 첫 수정(시한 45s+재시도·실패 이유 기록)으로는 약하다고 보고 **저장된 설정을 셸 없이 먼저 읽도록** 전환 — about_Execution_Policies 의 우선순위(MachinePolicy→UserPolicy→Process→CurrentUser→LocalMachine), 5.1 은 레지스트리·pwsh 7 은 powershell.config.json. 문서끼리 어긋나는 pwsh 7 기본값과 레지스트리 이름이 문서화되지 않은 그룹 정책은 **확정하지 않고** 셸 조회로 물러선다. 그래도 모르면 쓰지 않고 수동 설치 안내.

설치 커맨드를 async 로(오케스트레이터) — 조회 동안 UI 가 멈추지 않게.

## 검증

- windows 러너: 진짜 pwsh 7 · 5.1 을 ConPTY 에 띄워 마커·nonce·종료코드·한글 cwd, 실제 프로필 설치→기동→제거 왕복, **저장된 판정 == Get-ExecutionPolicy**(RemoteSigned·Unrestricted), 20회 읽기 4ms.
- PR #35 최종: ci.yml 3잡 SUCCESS · portability windows check·clippy·test **success**(1,928 통과 0 실패) · ubuntu 초록. 오케스트레이터 로컬 macOS(rebase 뒤) cargo test 1,941 통과 0 실패. rebase 머지 6e00587b.
- CI 로 못 본 것: 클라이언트 SKU(WinNT)의 5.1 기본값 Restricted 분기(러너는 서버), 릴리스 exe 가 GUI 서브시스템이라 콘솔에서 `oculpm` 출력이 안 붙음(#os-cli-console), 실제 AppImage 심.