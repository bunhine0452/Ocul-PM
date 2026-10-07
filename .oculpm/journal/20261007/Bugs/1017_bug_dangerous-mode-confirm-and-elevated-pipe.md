---
schema_version: 1
type: bug
slug: "dangerous-mode-confirm-and-elevated-pipe"
status: done
difficulty: low
created_at: "2026-10-07T10:17:28+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/conversation/ConfigControls.tsx"
    op: update
  - path: "src/__tests__/acp_dangerous_mode_confirm.test.tsx"
    op: create
  - path: "src-tauri/src/ptyhost/pipe.rs"
    op: update
related: []
tags:
  - "security"
  - "acp"
  - "external-review"
  - "mcp-tool"
---
[x] bypass 권한 모드 클릭 한 번 진입 · Windows 승격 파이프 선점 확인 누락

## 발생 원인

외부 보안 피드백 #6·#7 을 확인했다.

- #6: ⇧Tab 순환(`CYCLE_MODES`)은 원래부터 `dontAsk`·`bypassPermissions` 를 건너뛴다 — Claude Code CLI 와 같은 동작이라 리뷰의 "Shift+Tab 한 번이면 acceptEdits" 는 업스트림과 같은 수준이다. 문제는 모드 메뉴였다: 위험 모드가 클릭 한 번으로 바로 적용됐다.
- #7: 유닉스 소켓은 사용자 전용 앱 데이터 폴더의 `0600` 이라 다른 사용자는 못 붙는다. 같은 사용자 프로세스를 경계로 보지 않는 것은 tmux·VS Code 와 같은 모델이라 바꾸지 않았다. Windows 는 달랐다: 파이프 이름은 승격을 따로 세지만(`-admin`) 접속 뒤 검사(`server_is_ours`)가 서버의 사용자 SID 만 봐서, 같은 사용자의 보통 권한 프로세스가 그 이름을 먼저 만들면 승격 앱이 거기 붙었다 — 관리자 터미널 입력이 보통 권한 프로세스로 간다.

## 해결 방법

- `DANGEROUS_MODES`(dontAsk·bypassPermissions·Codex full-access)를 메뉴에서 고르면 `useConfirm` danger 확인. 어댑터가 준 모드 설명을 항목으로 싣고, 취소하면 아무것도 바뀌지 않는다.
- `server_is_ours`: 앱이 승격돼 있으면 서버 프로세스 토큰의 `TokenElevation` 도 확인하고, 보통 권한 서버면 거부한다.

## 검증

- `acp_dangerous_mode_confirm.test.tsx` 3(안전 모드 즉시·위험 모드 취소/확인·목록). 전체 vitest 3269 통과, lint·typecheck 통과.
- Windows 타깃 clippy(가짜 cc·ar·rc 레시피) 통과 — 실행 검증은 portability CI 와 실기기 몫으로 남는다.