---
oculpm_plan: v1
id: cross-platform-port
title: "Windows · Linux 출시 — CI 러너가 실기기 (크로스플랫폼 라운드)"
status: active
created: 2026-09-23
updated: 2026-09-23
owner: claude-code
---

사용자가 Windows·Linux 를 직접 테스트할 수 없으므로 그 OS 러너에서 실행된 테스트만 완료로 친다. 설계 SSOT: docs/20260923_cross-platform/ (D1~D10 · 레인 브리프 · 파일 소유 표).

## W0 — 이식성 CI (오케스트레이터) {#w0}
- [x] portability.yml — windows-latest·ubuntu-22.04 에서 cargo check/clippy/test + vitest. ci.yml(릴리스 게이트)과 분리해 붉어도 macOS 릴리스를 막지 않는다 (D2) {#w0-portability-ci}
- [x] 첫 실행 오류 전수 → docs/20260923_cross-platform/02-error-inventory.md 에 레인별 배정 {#w0-inventory}
- [ ] 초록이 된 잡부터 required 로 승격, 전부 초록이면 ci.yml 에 합쳐 릴리스 게이트 편입 {#w0-promote}

## W1 — 컴파일 기준선 L-BASE (단독 세션, W2 전에) {#w1}
- [x] src-tauri/src/proc.rs 프로세스 생성 단일 창구 — Windows CREATE_NO_WINDOW(콘솔 깜빡임) + PATHEXT(.cmd/.exe) 해석, Command::new ~40곳 이전 (D5) {#w1-proc}
- [x] clippy.toml disallowed-methods 로 proc.rs 밖 Command::new 금지 — 재발 게이트 {#w1-proc-gate}
- [x] 유닉스 전용 테스트(std::os::unix ~25곳) cfg(unix) 게이트, Windows 판이 필요한 곳은 PORT-TEST(L-FS) 표시 {#w1-test-gates}
- [x] windows·ubuntu 에서 cargo check --all-targets · clippy -D warnings 초록 — ptyhost 등은 명시적 에러 스텁(PORT-STUB, D4), cargo test 는 컴파일까지 + 실패 목록 레인 배정 {#w1-compile-green}

## W2 — 플랫폼 레인 6개 (병렬 세션, 파일 소유 분리) {#w2}
- [x] L-PTY 터미널 호스트 Windows {#l-pty}
  - [x] 전송 계층: Unix 소켓 ↔ 네임드 파이프(사용자별 이름·현재 사용자 전용 보안 기술자·옛 자리 이어받기) {#pty-transport}
  - [x] 호스트 분리 기동 DETACHED_PROCESS·CREATE_NO_WINDOW — 앱 종료·업데이트 뒤 생존 {#pty-detach}
  - [x] 세션 종료: SIGHUP/killpg → Job Object 로 프로세스 트리 종료 {#pty-kill}
  - [x] ConPTY 기본 셸 pwsh→powershell→COMSPEC, UTF-8 코드페이지(한글 출력), 리사이즈 {#pty-conpty}
  - [x] 호스트·포그라운드 판정의 ps 의존 제거 (Toolhelp32/sysinfo) {#pty-liveness}
  - [x] windows 러너 왕복 테스트: 열기→echo 한글-ok→단언→리사이즈→Kill 뒤 자식 0→재접속 {#pty-tests}
- [x] L-SHELL 셸 통합 · 심 {#l-shell}
  - [x] PowerShell OSC 133/7 스크립트 + $PROFILE 관리 블록 설치/제거 (nonce 규율 동일) {#shell-pwsh}
  - [x] SHELL 없을 때 기본값 /bin/zsh 의 macOS 전제 제거 (Linux=/bin/bash, Windows=pwsh) {#shell-linux}
  - [x] 심: Windows 복사본·.cmd 실검증, AppImage 는 current_exe 대신 $APPIMAGE {#shell-shim}
  - [x] acp/env.rs 로그인 셸 환경 캡처 — Windows 프로세스 환경 / Linux $SHELL -lic 확인 {#shell-env}
  - [x] windows 러너에서 실제 pwsh 에 스크립트 로드 → OSC 133 출력 단언, ubuntu 에서 bash/zsh {#shell-tests}
- [x] L-INTEG 외부 도구 연동 경로 {#l-integ}
  - [x] OS별 설정 위치 한 곳(paths.rs): Claude Desktop %APPDATA%\Claude · ~/.config/Claude, ~/.claude, ~/.codex(CODEX_HOME) {#integ-paths}
  - [x] 사이드카 안정 경로 — Windows 설치 디렉터리, AppImage 는 ~/.local/share/ocul-pm/bin 으로 복사(해시 같으면 무접촉) {#integ-sidecar}
  - [x] plugin bin/oculpm-mcp 탐색 목록에 Windows·Linux 설치 경로 + 'macOS 전용' 문구 갱신 (Claude·Codex 판 둘 다) {#integ-plugin-bin}
  - [x] 플러그인 훅 크로스플랫폼 — Claude Code(Git Bash)·Codex Windows 실행 셸 조사→호환 (← skill-catalog-round-2 #hooks-xplat) {#integ-hooks}
  - [x] build-sidecar.mjs Windows triple·.exe 산출을 windows 러너에서 실확인 {#integ-build-sidecar}
- [x] L-FS 경로 · 파일 의미론 {#l-fs}
  - [x] .oculpm 저장 상대경로는 항상 '/' — files_touched·인덱스·journal_ref·diff sidecar 전수 {#fs-separators}
  - [x] CRLF(core.autocrlf) — frontmatter·관리 블록·plan-log 파서 내성 + 기존 EOL 보존 {#fs-crlf}
  - [x] 원자적 쓰기: 대상이 열려 있을 때 rename 공유 위반 재시도·백오프, hard_link 경로 NTFS 확인 {#fs-atomic}
  - [x] notify ReadDirectoryChangesW 이벤트 모양·대소문자 무시 FS·긴 경로(\\?\) {#fs-watch}
  - [x] git quotepath·autocrlf 가짜 diff·출력 경로 구분자 {#fs-git}
  - [x] lock.rs 의 ps 프로세스 판정 Windows 대응 (OpenProcess/GetExitCodeProcess) {#fs-lock}
  - [x] PORT-TEST(L-FS) 심링크·경로 탈출 가드 테스트의 Windows 판 {#fs-symlink-tests}
- [x] L-OS 나머지 OS 분기 {#l-os}
  - [x] 인벤토리 잔여 실패 중 L-OS 소유분 전부 {#os-compile}
  - [x] 딥링크: Windows·Linux 는 두 번째 인스턴스 argv 로 온다 — single-instance 콜백에서 dispatch + 런타임 등록 {#os-deeplink}
  - [x] 트레이 투명 팝오버·앱 메뉴·TitleBarStyle 의 비-mac 동작 {#os-tray-menu}
  - [x] Linux Secret Service 부재 시 평문 저장 없이 명확한 에러 + 안내 {#os-secrets}
  - [x] DAP xcrun·themes defaults·external_editor·greenfield·npx(.cmd) 비-mac 분기 검증 {#os-tools}
  - [x] menu.rs 비-mac 에서 앱 메뉴 미부착 — GTK 액셀러레이터가 터미널 Ctrl+W/C 를 가로챈다(L-UI 발견), 필요 시 new_window 커맨드 {#os-no-menu}
- [~] L-UI 프런트엔드 플랫폼 추상화 {#l-ui}
  - [x] src/lib/platform.ts OS 판정 단일 창구 — navigator.platform 4곳 교체 {#ui-platform}
  - [x] 단축키 매칭 mac=meta·그 외=ctrl + 터미널 포커스 시 셸 키(Ctrl+C/D/K/L/R/U/W/Z) 양보, 복사·붙여넣기 Ctrl+Shift+C/V {#ui-shortcuts}
  - [x] ⌘ 리터럴 476곳 → modLabel() 표기 함수·i18n 치환 {#ui-labels}
  - [x] 비-mac 창 크롬: 트래픽라이트 여백·드래그 영역·WebView2 스크롤바·폰트 폴백 {#ui-chrome}
  - [x] 터미널 IME 브리지의 WKWebView 우회가 WebView2·WebKitGTK 에서 해가 없는지 — Chromium 조합 시퀀스 vitest {#ui-ime}
  - [x] 세 UA(mac/win/linux) 단축키·표기 테이블 vitest + pnpm lint 초록 {#ui-tests}
  - [ ] 맥 전용 문구 정리 — settings.tray.*·tray.*(메뉴바·Dock)·「Finder 에서 보기」·키체인·macOS 설정 안내의 비-mac 판 (L-UI 발견) {#ui-mac-words}
- [x] W2 종료 조건: rg PORT-STUB 0건 · portability.yml 전 잡 초록 · ci.yml(macOS) 초록 {#w2-no-stubs}

## W2+ — 레인이 찾은 후속 (W2 합류 뒤, 한 세션씩) {#w2plus}

- [ ] 프런트 후속 — errors.ts 규칙(`The system keyring is unavailable`·Linux 파일 붙여넣기 미지원), useCodeImport.pasteFiles 오류 토스트, 비-mac 트레이 팝오버의 투명 여백·그림자 제거, op.shell.desc2(iTerm2·Terminal.app) 비-mac 문구, **Windows 에서 틀린 MCP 권고 셋**(op.mcp.pluginCovers·op.mcp.pluginConflict·op.plugin.warn — 따르면 MCP 가 하나도 안 남는다, McpServerBlock·ClaudePluginBlock) (L-OS·L-SHELL·L-INTEG 발견) {#ui-followups}
- [ ] Windows 릴리스 exe 는 GUI 서브시스템 — 사람이 콘솔에서 `oculpm` 을 치면 출력이 안 붙는다. CLI 진입 앞 AttachConsole(ATTACH_PARENT_PROCESS), 대기 문제는 콘솔 서브시스템 별도 바이너리 검토 (L-SHELL 발견) {#os-cli-console}
- [ ] 에이전트가 준 files_touched 경로를 쓰기 시점에 `/` 로 정규화 (MCP journal_write·manager) — Windows 에이전트의 `src\a.ts` 가 diff 사이드카 키를 어긋나게 한다 (L-FS 발견) {#fs-files-touched-norm}
- [ ] planner·discussion·rollup 파서의 CRLF 내성 — `planner/parse.rs::fold_wrapped_items` 가 split('\n') 이라 autocrlf 체크아웃의 plan-log·{#id} 가 흔들릴 수 있다, 테스트 0건 (L-FS 발견) {#fs-crlf-parsers}
- [ ] 워처 rename 쌍의 새 이름이 빠진다 — 디바운서 Name(Both)[from,to] 에서 paths.first() 만 처리 (양 OS 기존 결함, L-FS 발견) {#fs-rename-pair}
- [x] 간헐 실패 — watcher::removing_the_project_root_does_not_resurrect_it 가 Windows 에서 Access is denied(os 5)로 한 번 붉음(L-SHELL run 35893773736), 다른 run 은 초록. 감시 핸들이 루트 삭제를 막는 경합인지 — 사용자가 감시 중인 프로젝트 폴더를 지울 때도 같은 일이 나는지 확인 {#fs-watcher-flake}
- [x] [사용자 결정] macOS 기존 결함 — acp/adapter.rs npm_platform 이 "macos" 로 찾아 딸려 온 claude(claude-agent-sdk-darwin-arm64)를 못 보고 PATH claude 로 물러선다. 고치면 ACP 가 쓰는 claude 바이너리가 바뀐다 (L-OS 발견) {#mac-bundled-claude}
- [ ] 비-mac 새 창 키(Ctrl+Shift+N) — new_window 커맨드 + L-UI 바인딩, 앱 메뉴를 뗀 뒤 빈 자리 (L-OS 제안 diff 있음) {#os-new-window}
- [ ] [사용자 결정] Windows 에서 Claude Code 플러그인의 MCP 서버가 안 뜬다 — Claude Code 는 stdio MCP 를 셸 없이 직접 실행하고 sh 셔틀은 실행 파일이 아니다(claude-code#58510), .mcp.json 은 OS 별로 못 가른다. 지금은 앱의 「MCP 등록」(절대경로 .exe) 안내. 대안 = Windows 전용 마켓플레이스 항목(「플러그인 1개」 원칙과 충돌) (L-INTEG 발견) {#integ-win-plugin-mcp}
- [ ] Linux 세션 D-Bus 부재 시 single-instance 가 조용히 꺼져 앱이 두 번 뜰 수 있다 — 명시적 경고 또는 락 (L-OS 발견) {#os-single-instance-dbus}
- [ ] PowerShell 세션의 네이티브 출력 인코딩 — 콘솔 코드 페이지(949/437)를 따른다. oculpm.ps1 의 OCULPM_TERM 가드 안에서 [Console]::InputEncoding/OutputEncoding 을 UTF-8 로 (L-PTY 제안) {#shell-pwsh-utf8}
- [ ] Windows 분리 기동 호스트의 핸들 상속 — std spawn 은 bInheritHandles=TRUE 라 부모 파이프를 물 수 있다(dev·CI 에서만 실해). 근본은 CreateProcessW 직접 호출 (L-PTY 발견) {#pty-handle-inherit}
- [ ] Windows 의 Job 종료가 셸에서 띄운 GUI 프로그램(예: 처음 띄운 `code .`)까지 함께 끝낸다 — macOS 와 다른 동작. GUI 서브시스템 자식은 breakaway 할지 결정 (L-PTY 발견) {#pty-job-gui-children}
- [ ] 간헐 실패 — windows 러너에서 ^C 뒤 ping 이 30초 동안 계속 돌았다(ptyhost::host::windows::tests::idle_shell…, PR #39 run). 테스트 경합인지 「가끔 ^C 가 안 먹는다」 제품 결함인지 판정 — L-PTY2 가 조사 {#pty-ctrlc-flake}
- [ ] [결정 필요] Windows 에서 CWD 가 프로젝트 루트인 오래 사는 자식(LSP 서버 lsp/client.rs · DAP · PTY 셸)이 도는 동안 사용자가 그 폴더를 옮기거나 지울 수 없다(ERROR_SHARING_VIOLATION 32). LSP 는 CWD 를 밖으로 옮길 여지가 있으나 서버의 설정 탐색이 바뀔 수 있다. PTY 셸은 모든 Windows 터미널의 공통 제약 (L-FS2 발견) {#os-child-cwd-lock}

## W3 — 패키징 · E2E (W2 합류 뒤, 병렬 2) {#w3}
- [ ] tauri.windows.conf.json·tauri.linux.conf.json 분리 — tauri.conf.json(macOS) 불변 (D3) {#w3-conf}
- [ ] Windows NSIS(currentUser·WebView2 embedBootstrapper) / Linux AppImage+deb, ubuntu-22.04 빌드(glibc 하한) {#w3-bundles}
- [ ] tauri-driver E2E: windows·ubuntu(xvfb) 기동→15화면 렌더→터미널 왕복→MCP 사이드카 일지→일지 화면 반영, 단계별 스크린샷 아티팩트 {#w3-e2e}
- [ ] 설치 스모크: NSIS /S 설치→실행→로그 기동 줄→제거 / deb 설치·AppImage 실행 {#w3-install-smoke}
- [ ] WebView2 CDP Input.imeSetComposition 로 한글 조합 → 터미널 도착 단언 (D8) {#w3-ime-cdp}
- [ ] 업데이터 N→N+1 스모크 (로컬 latest.json · 테스트 키) {#w3-updater-smoke}
- [~] [결정 필요] Windows 업데이트 때 터미널 세션이 끊긴다 — Tauri NSIS 가 ocul-pm.exe 를 이름으로 끝내 같은 exe 로 도는 --pty-host 도 끝난다(macOS 는 업데이트를 건넌다). L-PTY 권고: 호스트를 설치 폴더 밖 판별 복사본(%APPDATA%\<id>\ptyhost\ocul-pm-ptyhost-<판>.exe)에서 — 대가 AppData 의 exe·판마다 수십 MB. NSIS 템플릿 실제 동작부터 확인 (L-SHELL·L-PTY 발견) {#w3-update-ptyhost-lock}

## W4 — 릴리스 파이프라인 (사용자 결정 포함) {#w4}
- [x] [사용자 결정] Windows 코드 서명 — Azure Trusted Signing(월 과금) vs 무서명 베타(SmartScreen 경고) {#w4-signing-decision}
- [x] [사용자 결정] Linux 형식 — AppImage+deb(권장, D10) / +rpm / +Flatpak {#w4-linux-formats}
- [ ] release.yml 매트릭스 windows·ubuntu-22.04 — 비-mac 실패가 macOS draft·검증을 막지 않게 분리 {#w4-release-matrix}
- [ ] E2E·설치 스모크 통과 플랫폼만 latest.json 에 — macOS 업데이트 오염 금지 (D7) {#w4-latest-json}
- [ ] 5면 반영: README ko/en 지원 표(베타)·랜딩 ko/en 다운로드·CHANGELOG·docs/RELEASE.md·버전 6파일 {#w4-surfaces}

## W5 — 베타 운영과 졸업 {#w5}
- [ ] 플랫폼 버그 리포트 이슈 템플릿 + 진단 번들 내보내기(로그·버전·OS·WebView 버전) {#w5-report}
- [ ] [사용자 액션] Windows·Linux 외부 테스터 모집 {#w5-testers}
- [ ] CI 가 못 보는 것 원장 — Linux 실제 IME(fcitx/ibus)·Wayland 트레이·HiDPI 혼합·WebView2 버전 편차·WebKitGTK 의 navigator.platform 실제 값·Ctrl+Shift+V 클립보드 권한·Windows Ctrl+Shift+0 입력 언어 전환 충돌·Defender 실시간 보호가 켜진 PC 의 폴더 이동 막힘·감시 중 루트의 **상위 폴더는 이동 불가**(ReadDirectoryChangesW 본질, VS Code 동일 — 문서에 알림)·큰 프로젝트 첫 세션의 긴 막힘 (D8) {#w5-eyes}
- [ ] 졸업: 연속 3릴리스 E2E 초록 + 테스터 P0 0건 → '베타' 표기 제거 {#w5-graduate}

<!-- oculpm:plan-log begin v1 -->
<!-- oculpm:plan-log archived: 15 rows → cross-platform-port.log.md -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
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
| 2026-09-24T18:58:51+09:00 | #w3-update-ptyhost-lock | claude-code | ☐→~ |  | 사용자 결정 2026-09-24: 살린다 — 호스트를 설치 폴더 밖 판별 복사본에서. 구현 레인 출발 |
| 2026-09-24T18:58:56+09:00 | #mac-bundled-claude | claude-code | ☐→~ |  | 사용자 결정 2026-09-24: 고친다 — npm_platform macos→darwin. 실기기(macOS) 확인 필요 |
| 2026-09-24T19:43:40+09:00 | #mac-bundled-claude | claude-code | ~→x | .oculpm/journal/20260924/Bugs/1943_bug_acp-mac-bundled-claude-darwin.md | darwin 매핑 + 실제 폴더 이름 못박은 테스트. 진단만 바뀜(실행 claude 불변). 실기기: 릴리스 뒤 ACP 진단 경로 확인. PR #39 |
<!-- oculpm:plan-log archived: 15 rows → cross-platform-port.log.md -->
<!-- oculpm:plan-log end -->
