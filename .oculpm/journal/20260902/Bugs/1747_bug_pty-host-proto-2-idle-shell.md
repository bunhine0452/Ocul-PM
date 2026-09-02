---
schema_version: 1
type: bug
slug: "pty-host-proto-2-idle-shell"
status: done
difficulty: low
created_at: "2026-09-02T17:47:18+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/protocol.rs"
    op: update
related:
  - ref: "20260902/Bugs/1732_bug_idle-shell-not-running-work.md"
    kind: "followup"
tags:
  - "terminal"
  - "pty-host"
  - "protocol"
  - "mcp-tool"
---
[x] 고쳐도 안 고쳐진 것처럼 보이는 이유 — 살아남은 구버전 PTY 호스트 (PROTO_VERSION 2)

앞선 수정(놀고 있는 셸은 `Foreground` 가 `None`) 뒤에도 사용자 화면에는 "터미널에서 실행 중: /bin/zsh" 가 그대로 떴다.

## 발생 원인

두 겹이었다.

1. 화면에 떠 있던 것은 **설치본**(`/Applications/Ocul-PM.app`)이었다 — 수정은 소스에만 있었고 빌드되지 않았다.
2. 더 중요한 쪽: **PTY 호스트는 앱 업데이트를 넘어 살아남는다** (`--pty-host`, #pty-host 의 설계 목적). 실제로 호스트 프로세스는 05:09 부터, 앱은 13:34 부터 돌고 있었다. `Foreground` 의 **뜻**을 바꿔 놓고 `PROTO_VERSION` 을 올리지 않으면, 새 앱이 구버전 호스트에 붙어 옛 답(`-zsh`)을 그대로 받는다 — 새 버전을 깔아도 고쳐지지 않은 것처럼 보인다. dev 빌드로 확인하려 해도 소켓이 같아서 같은 함정에 빠진다.

## 해결 방법

`protocol.rs` 의 버전 규율("의미가 바뀌면 올려라") 그대로 `PROTO_VERSION` 을 2 로 올렸다. 클라이언트가 불일치를 보면 구버전 호스트를 `Shutdown` 시키고 새로 띄운다 — 첫 실행에서 살아있던 터미널 세션은 한 번 사라지는데, 이게 설계된 대가다("무언의 오동작보다 낫다").

## 검증

- 사용자의 실제 zsh 로 가정을 직접 확인했다 (pty 하네스, 스크래치패드): 프롬프트에 놀고 있을 때 `tcgetpgrp` = 셸 pid, `sleep 30` 이 돌 때는 그 명령의 pgid. 즉 놀 때만 `None`, 돌 때는 종전대로 경고.
- 처음 측정에서 zsh 가 "돌 때도 셸" 로 보였던 것은 rc 로딩(2.5초)이 끝나기 전에 입력을 넣은 계측 실수였다 — 대기를 늘리자 bash·sh 와 같은 결과가 나왔다.
- `cargo test --lib ptyhost` 15 통과 · `cargo fmt --check` · `clippy --all-targets -D warnings` 통과.