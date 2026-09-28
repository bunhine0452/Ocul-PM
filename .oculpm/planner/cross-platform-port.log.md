---
oculpm_plan_log: v1
plan: cross-platform-port
---

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-23T23:08:25+09:00 | #w0-portability-ci | claude-code | ☐→~ | .oculpm/journal/20260923/Chores/2308_chore_cross-platform-plan-and-portability-ci.md | portability.yml 작성·port/w0-ci push, 첫 run 35871385421 진행 중. 초록 후 main 합류 |
| 2026-09-23T23:08:30+09:00 | #w1-compile-green | claude-code | ☐→~ |  | W1 L-BASE worktree 세션 출발 (port/w1-base) |
| 2026-09-23T23:09:25+09:00 | #ui-platform | claude-code | ☐→~ |  | L-UI 레인 조기 출발 — src/** 만 소유라 W1(src-tauri)과 겹치지 않음 (port/l-ui) |
| 2026-09-23T23:34:46+09:00 | #w0-portability-ci | claude-code | ~→x | .oculpm/journal/20260923/Chores/2308_chore_cross-platform-plan-and-portability-ci.md | run 35871385421 세 잡 완주·아티팩트 확인. + .gitattributes(38c7dee3). main 합류는 W1 PR 과 함께 |
| 2026-09-23T23:34:52+09:00 | #w0-inventory | claude-code | ☐→~ |  | 층 1 기록: win=trash coinit feature(의존성에서 멈춤), ubuntu=hidden_title 2+Stdio 경고, win 프런트 vitest 36(CRLF·\경로). 층 2 는 W1 push 뒤 |
| 2026-09-24T00:18:23+09:00 | #ui-platform | claude-code | ~→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | platform.ts — platform 먼저·UA 다음·모르면 mac. 4곳 교체. PR #31 |
| 2026-09-24T00:18:29+09:00 | #ui-shortcuts | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | kbd.ts isModKey/readChord/yieldsToShell, 터미널 안 Ctrl+Shift 가족, AltGr 제외. mac 은 metaKey\|\|ctrlKey 유지(D3) |
| 2026-09-24T00:18:34+09:00 | #ui-labels | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | 사전은 맥 표기 정본 + t() 출구 변환, src 리터럴 0 AST 게이트. 맥 전용 문구는 #ui-mac-words 로 분리 |
| 2026-09-24T00:18:40+09:00 | #ui-chrome | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | 드래그 영역 mac 한정, data-platform 글꼴 폴백, 스크롤바 모서리. 실기기 셀 폭은 W3 스크린샷 |
| 2026-09-24T00:18:45+09:00 | #ui-ime | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | 브리지는 mac 만, 비-mac 은 xterm 기본 — Chromium 시퀀스로 onData "한글\r" 정확히 1회(win 러너). 실 IME 는 #w3-ime-cdp·#w5-eyes |
| 2026-09-24T00:18:50+09:00 | #ui-tests | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0018_feature_port-frontend-platform-abstraction.md | 새 4파일 windows 러너 통과(run 35877998437) + PR #31 ci.yml lint 초록 |
| 2026-09-24T00:40:24+09:00 | #w0-inventory | claude-code | ~→x |  | 층 2 기록(W1 뒤): ubuntu 테스트 초록, windows 19 실패 → L-FS 12·L-SHELL 1·L-INTEG 1·L-OS 1(+cfg(unix) 0건 통합 테스트 6). 이후 층은 레인 보고로 |
| 2026-09-24T00:40:29+09:00 | #fs-symlink-tests | claude-code | ☐→~ |  | L-OS 로 이관 — PORT-TEST 마커 12곳이 전부 L-OS 소유 파일이라 충돌 회피. W2 5레인 병렬 출발(port/l-pty·l-shell·l-integ·l-fs·l-os) |
| 2026-09-24T00:58:09+09:00 | #w1-proc | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0058_feature_port-compile-baseline-w1.md | proc.rs 42곳, 배치 인용은 std BatBadBut 방어에 맡김 — windows 러너 테스트 5개 통과. PR #32 |
| 2026-09-24T00:58:13+09:00 | #w1-proc-gate | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0058_feature_port-compile-baseline-w1.md | clippy.toml disallowed-methods, 허용은 proc.rs 뿐(통합 테스트 12파일은 파일 머리 allow) |
| 2026-09-24T00:58:19+09:00 | #w1-test-gates | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0058_feature_port-compile-baseline-w1.md | 게이트 없던 심링크 테스트 2개 cfg(unix), PORT-TEST 12곳 표시 → L-OS 가 Windows 판 |
| 2026-09-24T00:58:24+09:00 | #w1-compile-green | claude-code | ~→x | .oculpm/journal/20260924/Features_to_add/0058_feature_port-compile-baseline-w1.md | windows·ubuntu check·clippy 초록, ubuntu test 초록, windows test 19 실패→W2. glibc_compat(D11)·MSVC 매니페스트. d7185e98 |
| 2026-09-24T02:30:43+09:00 | #fs-lock | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | pid.rs 단일 창구, lock+a2a 5건 windows 초록. PR #33 |
| 2026-09-24T02:30:48+09:00 | #fs-separators | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | git::slash/relative_to — 워처·indexer·rule_scope·redact·project.rs 색인 키. files_touched 쓰기 정규화는 #fs-files-touched-norm |
| 2026-09-24T02:30:53+09:00 | #fs-crlf | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | 관리 블록 \r\r\n · frontmatter CRLF 머리 · autocrlf 가짜 diff 없음 테스트. planner 파서는 #fs-crlf-parsers |
| 2026-09-24T02:30:59+09:00 | #fs-atomic | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | atomic_io_win.rs 재시도·백오프, 덮어쓰지 않는 MoveFileExW, 300자+ 경로 — windows 6테스트 |
| 2026-09-24T02:31:05+09:00 | #fs-watch | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | watcher/repeat.rs(Windows Create+Modify 재보고), 깊은 경로 '/' 기록, markers mtime. rename 쌍 결함은 #fs-rename-pair |
| 2026-09-24T02:31:10+09:00 | #fs-git | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0230_bug_port-fs-semantics-lfs.md | repo_relative canonicalize+\\?\ 제거(8.3 이름), autocrlf 가짜 diff 없음, quotepath 기존 테스트 windows 초록 |
| 2026-09-24T02:40:54+09:00 | #os-compile | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | 사이드카 후보 OS 별(recording test windows 초록), PORT-STUB(L-OS)·PORT-TEST 0건. PR #34 |
| 2026-09-24T02:41:00+09:00 | #os-deeplink | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | links_in_argv 순수 함수(세 OS), 두 번째 인스턴스·첫 기동 args_os, AppImage register_all. 실제 인계는 W3 E2E |
| 2026-09-24T02:41:05+09:00 | #os-tray-menu | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | 비-mac 트레이 메뉴 상시·불투명·작업 영역 위치(tray/placement.rs), TitleBarStyle mac 한정 확인 |
| 2026-09-24T02:41:10+09:00 | #os-no-menu | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | menu::apply 비-mac no-op, MockRuntime 테스트 windows·ubuntu. new_window 는 #os-new-window |
| 2026-09-24T02:41:16+09:00 | #os-secrets | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | SecretError::Unavailable, 평문 저장 없음, ubuntu 러너가 '저장소 없음' 갈래를 반드시 지남. 프런트 문구는 #ui-followups |
| 2026-09-24T02:41:22+09:00 | #os-tools | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | DAP·LSP·편집기·greenfield·themes·클립보드·휴지통 + cmd 명령 주입 두 곳(open_url/Notion·편집기) 수정. Windows DAP 실제 세션은 미확인 |
| 2026-09-24T02:41:27+09:00 | #fs-symlink-tests | claude-code | ~→x | .oculpm/journal/20260924/Features_to_add/0240_feature_port-os-branches-los.md | L-OS 가 처리 — test_links(심링크→정션) 12곳 windows 실링크 통과 + cfg(unix) 통합 테스트 17건 Git Bash |
| 2026-09-24T03:44:59+09:00 | #fs-watcher-flake | claude-code | ☐→~ |  | 두 번째 재현(PR #35 run) — rename(루트) Access denied. 감시 중 폴더를 휴지통으로 보내는 제품 결함 후보. L-FS2 세션 출발(port/l-fs2) |
| 2026-09-24T03:45:05+09:00 | #shell-pwsh | claude-code | ☐→~ |  | PR #35 보류 — 부하 러너에서 PowerShell 콜드 스타트 45s+ 로 정책 조회 시한 초과. 레지스트리/설정 우선 판정으로 전환 중 |
| 2026-09-24T04:01:08+09:00 | #integ-paths | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0401_bug_port-integ-paths-home-guard.md | tool_config.rs 한 곳(Claude Desktop MSIX 우선), Windows 홈 가드 결함 수정. PR #36 |
| 2026-09-24T04:01:13+09:00 | #integ-sidecar | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0401_bug_port-integ-paths-home-guard.md | AppImage 마운트 밖 해시 비교 복사 + 기동 훅, verbatim 경로 정리. 실제 AppImage 는 W3 |
| 2026-09-24T04:01:21+09:00 | #integ-plugin-bin | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0401_bug_port-integ-paths-home-guard.md | 셔틀 탐색 Windows·Linux(앱 recording.rs 와 대조 테스트), macOS 전용 문구 갱신. Windows 플러그인 MCP 는 #integ-win-plugin-mcp |
| 2026-09-24T04:01:27+09:00 | #integ-hooks | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0401_bug_port-integ-paths-home-guard.md | Claude Code=Git Bash(불변), Codex=cmd.exe → commandWindows+run-sh.cmd. delivery_gate windows 9/9 |
| 2026-09-24T04:01:33+09:00 | #integ-build-sidecar | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0401_bug_port-integ-paths-home-guard.md | portability 사이드카 잡: windows .exe 27.4MB·ubuntu release thin LTO 링크·--version 실행 초록 |
| 2026-09-24T04:27:32+09:00 | #shell-pwsh | claude-code | ~→x | .oculpm/journal/20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md | oculpm.ps1 + 실행 정책 저장 설정 우선(셸 없이 4ms). pwsh 7·5.1 ConPTY 실측 초록. PR #35 |
| 2026-09-24T04:27:37+09:00 | #shell-linux | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md | default_shell.rs — macOS 불변, Linux passwd→/bin/bash, Windows pwsh→powershell→COMSPEC. 세 OS 표 테스트 |
| 2026-09-24T04:27:42+09:00 | #shell-shim | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md | Windows oculpm.exe 인식·하드링크(같은 볼륨)·복사, .cmd 는 두지 않음, AppImage $APPIMAGE. 빌드된 앱 바이너리로 심 통합 테스트 |
| 2026-09-24T04:27:48+09:00 | #shell-env | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md | split_paths + PATHEXT, Windows 로그인 셸 없음. resolve_binary(cargo)→절대경로 cargo.exe windows 확인 |
| 2026-09-24T04:27:54+09:00 | #shell-tests | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0427_feature_port-shell-integration-lshell.md | 진짜 PTY 하네스(DSR 응답), windows pwsh/5.1 · ubuntu bash/pwsh 실행. 이 머지로 main windows test 완전 초록 |
| 2026-09-24T05:57:14+09:00 | #pty-transport | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | 네임드 파이프(사용자 SID DACL·High IL·first_pipe_instance·서버 SID 확인), 자리 규칙 공통. PR #37 |
| 2026-09-24T05:57:19+09:00 | #pty-detach | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | NO_WINDOW\|DETACHED\|NEW_PROCESS_GROUP(OR). roundtrip 이 실제 앱 바이너리로 분리 기동·재접속. 업데이트 생존은 #w3-update-ptyhost-lock |
| 2026-09-24T05:57:25+09:00 | #pty-kill | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | Job Object — 의사 콘솔 닫기 → 1.5s → TerminateJobObject. 새 콘솔 ping 까지 자식 0(windows) |
| 2026-09-24T05:57:30+09:00 | #pty-conpty | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | 셸은 Start.shell 그대로, cmd 만 chcp 65001, ^C 무시 상속 결함을 SetConsoleCtrlHandler 로 복원. 한글 왕복·리사이즈 windows 초록 |
| 2026-09-24T05:57:36+09:00 | #pty-liveness | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | 셸 종료 감시(Exit 한 번), 포그라운드 Toolhelp32+NtQueryInformationProcess, macOS 는 ps 그대로 |
| 2026-09-24T05:57:45+09:00 | #pty-tests | claude-code | ☐→x | .oculpm/journal/20260924/Features_to_add/0557_feature_port-ptyhost-windows-lpty.md | reattach·backpressure cfg(unix) 해제 + ptyhost_roundtrip, 매달림 → 원인과 함께 실패(Drop 가드·DSR/DA·워치독). windows 1,956/0 |
| 2026-09-24T06:26:15+09:00 | #fs-watcher-flake | claude-code | ~→x | .oculpm/journal/20260924/Bugs/0626_bug_port-watcher-root-rename-lfs2.md | 원인=첫 세션 시작과 겹친 짧은 창(핸들 누수 아님, 증거 8/30). git 4→2, 휴지통 테스트. PR #38 |
| 2026-09-24T06:26:21+09:00 | #w2-no-stubs | claude-code | ☐→x | .oculpm/journal/20260924/Bugs/0626_bug_port-watcher-root-rename-lfs2.md | W2 종료: PORT-STUB 0 · portability(d39d5a0d 기준 PR #38 재시도) windows 1,959/0 · ubuntu 초록 · ci.yml 초록. 남은 CI 신뢰성: lsp 테스트 직렬화(port/lsp-flake) |
| 2026-09-24T18:58:41+09:00 | #w4-linux-formats | claude-code | ☐→x |  | 사용자 결정 2026-09-24: AppImage + deb (D10 그대로). rpm 은 나중에 |
| 2026-09-24T18:58:46+09:00 | #w4-signing-decision | claude-code | ☐→x |  | 사용자 결정 2026-09-24: 무서명 베타로 시작(SmartScreen '추가 정보 → 실행' 안내 필요). 서명은 나중에 붙일 수 있게 |
<!-- oculpm:plan-log end -->
