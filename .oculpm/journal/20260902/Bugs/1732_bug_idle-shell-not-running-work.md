---
schema_version: 1
type: bug
slug: "idle-shell-not-running-work"
status: done
difficulty: low
created_at: "2026-09-02T17:32:16+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/host.rs"
    op: update
related: []
tags:
  - "terminal"
  - "pty-host"
  - "close-guard"
  - "mcp-tool"
---
[x] 터미널을 켜 두기만 해도 뜨던 탭 닫기 경고 — 프롬프트에 멈춘 셸은 "실행 중" 이 아니다

사이드바에 터미널을 열어 두기만 해도 프로젝트 탭을 닫을 때마다 "실행 중인 작업이 있어요" 확인(danger)이 떴다. 아무것도 돌고 있지 않은데도.

## 발생 원인

탭 닫기 문지기(`src/windows/useTabRunningWork.ts`)는 페인마다 `pty_foreground_command` 를 물어 이름이 오는 것만 "실행 중" 으로 센다 — 주석에도 "프롬프트에 멈춰 있는 셸은 세지 않는다" 고 적혀 있었다. 그런데 그 전제가 백엔드에서 성립하지 않았다.

PTY 호스트의 `Request::Foreground` 는 `tcgetpgrp` 결과를 그대로 `ps` 에 넣는다. **셸이 놀고 있을 때 포그라운드 프로세스 그룹은 셸 자신**이므로 `-zsh` 같은 명령줄이 돌아왔고, 문지기는 그걸 돌고 있는 일로 읽었다. 늘 뜨는 확인은 곧 읽지 않고 누르는 확인이 된다.

## 해결 방법

`host.rs` 에 `foreground_of()` 를 두고 포그라운드 그룹이 셸 pid(`child.process_id()`)와 같으면 `None` 을 돌려준다. 이 비교는 종료 계약 테스트 헬퍼(`sh_with_stubborn_foreground`)가 "포그라운드가 셸에서 넘어간 순간" 을 기다릴 때 쓰던 것과 같은 판별식이다.

다른 소비자인 디스패치 프리필(`dispatchTarget.choosePayload`)은 `foreground ?? ""` 로 접어 "모르면 셸" 로 가므로 결론이 같다 — 놀고 있는 셸엔 종전대로 한 줄 명령을 프리필한다.

## 검증

- 새 테스트 `idle_shell_has_no_foreground_command_but_a_running_one_does` — `sleep` 이 포그라운드일 땐 명령줄이 나오고, ^C 로 프롬프트가 돌아오면 `None` 이 된다. `cargo test --lib ptyhost::host` 13개 통과.
- `cargo fmt --check` · `cargo clippy --all-targets -D warnings` · `pnpm typecheck` · `pnpm test`(1970) · `pnpm build` · lint storage/bindings/design 모두 통과. `lint:i18n` 만 붉은데, 원인은 병렬 세션의 미추적 파일(`src/__tests__/code_sticky.test.ts`)로 이 변경과 무관하다.