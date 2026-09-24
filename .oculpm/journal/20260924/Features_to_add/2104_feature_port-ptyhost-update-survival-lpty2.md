---
schema_version: 1
type: feature
slug: "port-ptyhost-update-survival-lpty2"
status: done
difficulty: superhigh
created_at: "2026-09-24T21:04:58+09:00"
session_id: "20260924-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/ptyhost/stage.rs"
    op: create
  - path: "src-tauri/src/ptyhost/launch.rs"
    op: create
  - path: "src-tauri/src/ptyhost/client.rs"
    op: update
  - path: "src-tauri/src/ptyhost/mod.rs"
    op: update
  - path: "src-tauri/src/ptyhost/host/windows/tests.rs"
    op: update
  - path: "src-tauri/tests/ptyhost_update_survival.rs"
    op: create
related:
  - ref: "20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "terminal"
  - "ptyhost"
  - "mcp-tool"
---
[x] Windows 업데이트에도 터미널 세션이 산다 — 호스트 판별 복사본, ^C 간헐 실패는 테스트 경합 (L-PTY2, PR #42)

## 추가 기능

사용자 결정(2026-09-24): Windows 에서도 업데이트 때 내장 터미널 세션을 살린다. Tauri NSIS 템플릿(`@tauri-apps/cli` 2.11.2 내장)은 `CheckIfAppIsRunning "${MAINBINARYNAME}.exe"` 로 **이름으로** 찾아 끝낸 뒤 덮어쓴다 — 같은 `ocul-pm.exe` 로 도는 `--pty-host` 도 끝난다.

- 호스트를 `%LOCALAPPDATA%\<identifier>\ptyhost[-dev]\ocul-pm-ptyhost-<판>-<blake3 16>.exe` 복사본에서 띄운다(`stage.rs` — 해시 같으면 무접촉, 임시 파일 → 원자적 이름 바꾸기, Zone.Identifier 안 따라옴). 작업 폴더는 복사본 자리. 옛 판 복사본은 새 호스트에 붙은 뒤 정리(실행 중 이미지 삭제 거절 = 쓰는 호스트 있음).
- 물러서기(`launch.rs`): 복사·기동 실패·일찍 종료·15초 안에 안 받음 → 원본 exe, `warn` 로그.
- 자리 규칙(파이프 = 소켓 경로 + 사용자 SID)은 exe 경로와 무관 — 옛 호스트 이어받기 그대로. macOS 경로 불변(launch 는 Windows 전용).

## ^C 간헐 실패 — 판정: 테스트 경합, 제품 결함 아님

러너 반복 실험: ping 이 생기자마자(2~17ms) `^C` 면 4/30 이 안 먹는다 — 콘솔에 붙기 전 몇 ms 는 자식을 기다리는 cmd 만 `^C` 를 받는다(모든 Windows 터미널의 콘솔 의미론). 기존 방식 0/60, 두 번째 `^C` 는 늘 먹음, "Ctrl+C 무시" 표시 180/180 꺼짐. 사람의 `^C` 는 출력을 본 뒤라 이 틈에 안 걸린다 → 테스트가 ping 첫 줄 뒤 `^C`.

## 검증

- `tests/ptyhost_update_survival.rs`(windows 러너): 복사본 기동 → 원본으로 띄운 대조군이 원본을 잠그는 것 확인 → `taskkill /IM ocul-pm.exe /F` 에 대조군만 죽고 복사본 호스트 같은 pid 생존 → 설치 폴더 원본 덮어쓰기·지우기·새 판 쓰기 성공 → 새 접속이 스크롤백·nonce 이어받고 입력 왕복. DLL 의존은 전부 System32(`the_app_binary_needs_nothing_beside_itself`).
- portability 35993409355 전부 success · PR #42 ci.yml 3잡 SUCCESS → rebase 머지 73db1a58.
- 발견: 릴리스 exe 의 `MSVCP140.dll` 의존 가능성(#win-msvcp140 — L-PKG 확인 중), `ProjectDirs` 경로 불일치(#paths-projectdirs-mismatch — PR #43). 메모리 레시피 fakear 의 `-out:` 정정.
- CI 로 못 본 것: 실제 NSIS 업데이트 한 바퀴(설치 파일 L-PKG), 백신 첫 실행 지연·AppLocker.