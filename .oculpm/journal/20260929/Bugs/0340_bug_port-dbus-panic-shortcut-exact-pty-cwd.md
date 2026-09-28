---
schema_version: 1
type: bug
slug: "port-dbus-panic-shortcut-exact-pty-cwd"
status: done
difficulty: medium
created_at: "2026-09-29T03:40:49+09:00"
session_id: "20260929-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/instance_lock.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/ptyhost/launch.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_update_survival.rs"
    op: update
  - path: "src/lib/kbd.ts"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
related:
  - ref: "20260928/Features_to_add/2330_feature_port-cli-console-dbus-newwindow-paths.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "linux"
  - "windows"
  - "shortcuts"
  - "mcp-tool"
---
[x] Linux D-Bus 주소 패닉 방지 · 화면 단축키 수식키 정확 매칭 · Windows PTY 호스트 폴백 cwd (L-OS4, PR #59)

## 발생 원인

- **D-Bus 주소 패닉** — L-OS3 는 코드를 읽고 추정만 했는데, 실제였다. tauri-plugin-single-instance 2.4.4 는 setup 첫 줄에서 `Builder::session().unwrap()` 을 부른다. zbus 가 세션 주소를 못 읽으면(빈 값·오타·모르는 전송·guid 형식 등) 기동 중에 패닉한다. ubuntu 러너에서 못 읽는 주소 9개가 모두 패닉했다.
- **단축키** — 비-mac 에서 일지·검색·시작 화면의 Ctrl+N 등이 Shift·Alt 를 보지 않아, Ctrl+Shift+N(새 창) 같은 다른 키를 먹을 수 있었다.
- **PTY 호스트 폴백 cwd** — Windows 호스트가 원본 exe 로 물러설 때 앱의 작업 폴더를 물려받았다. 그래서 프로젝트 폴더 터미널에서 띄운 앱의 호스트가 그 폴더를 잠갔다.
- **잠금 테스트 간헐 실패** — 옆 스레드가 자식을 fork/posix_spawn 하면 exec 전까지 flock 설명을 물고 있다. scratchpad 에서 재현했다.

## 해결 방법

- `instance_lock::register` 가 zbus 규칙으로 먼저 주소를 검사한다. 못 읽으면 경고 한 줄을 남기고 single-instance 를 건너뛴다(instance-lock 만 남는다). macOS·Windows 는 불변이다.
- `kbd.ts::isModChord` — 비-mac 은 요구하지 않은 Shift·Alt 가 있으면 거짓이고, mac 은 옛 식 그대로다. 세 화면이 이것으로 통일했다.
- 원본 폴백 기동의 cwd 를 실행 파일 폴더로 뒀다(`proc::spawn_detached` 는 이미 cwd 를 받는다).
- 잠금 테스트의 재획득 단언에 재시도 창을 뒀다(제품은 이미 3초 재시도).

## 검증

- CI(83c3ab24) Portability · E2E 전부 success. ubuntu 에서는 나쁜 주소 9개가 플러그인에서 패닉하고 `register` 경로로는 앱이 뜨는 것까지 실측했다. windows 는 원본 폴백 뒤 project 폴더 rename·remove 를 통과했다.
- mac 단축키 결과를 옛 식과 직접 대조했다. PR #59 rebase 병합(451207e2).
- 주의: `journal_v2.test.tsx` 가 800줄 한계에 닿았다 — 다음 테스트 추가 때는 분리해야 한다.