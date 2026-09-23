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
- [ ] L-PTY 터미널 호스트 Windows {#l-pty}
  - [ ] 전송 계층: Unix 소켓 ↔ 네임드 파이프(사용자별 이름·현재 사용자 전용 보안 기술자·옛 자리 이어받기) {#pty-transport}
  - [ ] 호스트 분리 기동 DETACHED_PROCESS·CREATE_NO_WINDOW — 앱 종료·업데이트 뒤 생존 {#pty-detach}
  - [ ] 세션 종료: SIGHUP/killpg → Job Object 로 프로세스 트리 종료 {#pty-kill}
  - [ ] ConPTY 기본 셸 pwsh→powershell→COMSPEC, UTF-8 코드페이지(한글 출력), 리사이즈 {#pty-conpty}
  - [ ] 호스트·포그라운드 판정의 ps 의존 제거 (Toolhelp32/sysinfo) {#pty-liveness}
  - [ ] windows 러너 왕복 테스트: 열기→echo 한글-ok→단언→리사이즈→Kill 뒤 자식 0→재접속 {#pty-tests}
- [ ] L-SHELL 셸 통합 · 심 {#l-shell}
  - [ ] PowerShell OSC 133/7 스크립트 + $PROFILE 관리 블록 설치/제거 (nonce 규율 동일) {#shell-pwsh}
  - [ ] SHELL 없을 때 기본값 /bin/zsh 의 macOS 전제 제거 (Linux=/bin/bash, Windows=pwsh) {#shell-linux}
  - [ ] 심: Windows 복사본·.cmd 실검증, AppImage 는 current_exe 대신 $APPIMAGE {#shell-shim}
  - [ ] acp/env.rs 로그인 셸 환경 캡처 — Windows 프로세스 환경 / Linux $SHELL -lic 확인 {#shell-env}
  - [ ] windows 러너에서 실제 pwsh 에 스크립트 로드 → OSC 133 출력 단언, ubuntu 에서 bash/zsh {#shell-tests}
- [ ] L-INTEG 외부 도구 연동 경로 {#l-integ}
  - [ ] OS별 설정 위치 한 곳(paths.rs): Claude Desktop %APPDATA%\Claude · ~/.config/Claude, ~/.claude, ~/.codex(CODEX_HOME) {#integ-paths}
  - [ ] 사이드카 안정 경로 — Windows 설치 디렉터리, AppImage 는 ~/.local/share/ocul-pm/bin 으로 복사(해시 같으면 무접촉) {#integ-sidecar}
  - [ ] plugin bin/oculpm-mcp 탐색 목록에 Windows·Linux 설치 경로 + 'macOS 전용' 문구 갱신 (Claude·Codex 판 둘 다) {#integ-plugin-bin}
  - [ ] 플러그인 훅 크로스플랫폼 — Claude Code(Git Bash)·Codex Windows 실행 셸 조사→호환 (← skill-catalog-round-2 #hooks-xplat) {#integ-hooks}
  - [ ] build-sidecar.mjs Windows triple·.exe 산출을 windows 러너에서 실확인 {#integ-build-sidecar}
- [~] L-FS 경로 · 파일 의미론 {#l-fs}
  - [ ] .oculpm 저장 상대경로는 항상 '/' — files_touched·인덱스·journal_ref·diff sidecar 전수 {#fs-separators}
  - [ ] CRLF(core.autocrlf) — frontmatter·관리 블록·plan-log 파서 내성 + 기존 EOL 보존 {#fs-crlf}
  - [ ] 원자적 쓰기: 대상이 열려 있을 때 rename 공유 위반 재시도·백오프, hard_link 경로 NTFS 확인 {#fs-atomic}
  - [ ] notify ReadDirectoryChangesW 이벤트 모양·대소문자 무시 FS·긴 경로(\\?\) {#fs-watch}
  - [ ] git quotepath·autocrlf 가짜 diff·출력 경로 구분자 {#fs-git}
  - [ ] lock.rs 의 ps 프로세스 판정 Windows 대응 (OpenProcess/GetExitCodeProcess) {#fs-lock}
  - [~] PORT-TEST(L-FS) 심링크·경로 탈출 가드 테스트의 Windows 판 {#fs-symlink-tests}
- [ ] L-OS 나머지 OS 분기 {#l-os}
  - [ ] 인벤토리 잔여 실패 중 L-OS 소유분 전부 {#os-compile}
  - [ ] 딥링크: Windows·Linux 는 두 번째 인스턴스 argv 로 온다 — single-instance 콜백에서 dispatch + 런타임 등록 {#os-deeplink}
  - [ ] 트레이 투명 팝오버·앱 메뉴·TitleBarStyle 의 비-mac 동작 {#os-tray-menu}
  - [ ] Linux Secret Service 부재 시 평문 저장 없이 명확한 에러 + 안내 {#os-secrets}
  - [ ] DAP xcrun·themes defaults·external_editor·greenfield·npx(.cmd) 비-mac 분기 검증 {#os-tools}
  - [ ] menu.rs 비-mac 에서 앱 메뉴 미부착 — GTK 액셀러레이터가 터미널 Ctrl+W/C 를 가로챈다(L-UI 발견), 필요 시 new_window 커맨드 {#os-no-menu}
- [~] L-UI 프런트엔드 플랫폼 추상화 {#l-ui}
  - [x] src/lib/platform.ts OS 판정 단일 창구 — navigator.platform 4곳 교체 {#ui-platform}
  - [x] 단축키 매칭 mac=meta·그 외=ctrl + 터미널 포커스 시 셸 키(Ctrl+C/D/K/L/R/U/W/Z) 양보, 복사·붙여넣기 Ctrl+Shift+C/V {#ui-shortcuts}
  - [x] ⌘ 리터럴 476곳 → modLabel() 표기 함수·i18n 치환 {#ui-labels}
  - [x] 비-mac 창 크롬: 트래픽라이트 여백·드래그 영역·WebView2 스크롤바·폰트 폴백 {#ui-chrome}
  - [x] 터미널 IME 브리지의 WKWebView 우회가 WebView2·WebKitGTK 에서 해가 없는지 — Chromium 조합 시퀀스 vitest {#ui-ime}
  - [x] 세 UA(mac/win/linux) 단축키·표기 테이블 vitest + pnpm lint 초록 {#ui-tests}
  - [ ] 맥 전용 문구 정리 — settings.tray.*·tray.*(메뉴바·Dock)·「Finder 에서 보기」·키체인·macOS 설정 안내의 비-mac 판 (L-UI 발견) {#ui-mac-words}
- [ ] W2 종료 조건: rg PORT-STUB 0건 · portability.yml 전 잡 초록 · ci.yml(macOS) 초록 {#w2-no-stubs}

## W3 — 패키징 · E2E (W2 합류 뒤, 병렬 2) {#w3}
- [ ] tauri.windows.conf.json·tauri.linux.conf.json 분리 — tauri.conf.json(macOS) 불변 (D3) {#w3-conf}
- [ ] Windows NSIS(currentUser·WebView2 embedBootstrapper) / Linux AppImage+deb, ubuntu-22.04 빌드(glibc 하한) {#w3-bundles}
- [ ] tauri-driver E2E: windows·ubuntu(xvfb) 기동→15화면 렌더→터미널 왕복→MCP 사이드카 일지→일지 화면 반영, 단계별 스크린샷 아티팩트 {#w3-e2e}
- [ ] 설치 스모크: NSIS /S 설치→실행→로그 기동 줄→제거 / deb 설치·AppImage 실행 {#w3-install-smoke}
- [ ] WebView2 CDP Input.imeSetComposition 로 한글 조합 → 터미널 도착 단언 (D8) {#w3-ime-cdp}
- [ ] 업데이터 N→N+1 스모크 (로컬 latest.json · 테스트 키) {#w3-updater-smoke}

## W4 — 릴리스 파이프라인 (사용자 결정 포함) {#w4}
- [ ] [사용자 결정] Windows 코드 서명 — Azure Trusted Signing(월 과금) vs 무서명 베타(SmartScreen 경고) {#w4-signing-decision}
- [ ] [사용자 결정] Linux 형식 — AppImage+deb(권장, D10) / +rpm / +Flatpak {#w4-linux-formats}
- [ ] release.yml 매트릭스 windows·ubuntu-22.04 — 비-mac 실패가 macOS draft·검증을 막지 않게 분리 {#w4-release-matrix}
- [ ] E2E·설치 스모크 통과 플랫폼만 latest.json 에 — macOS 업데이트 오염 금지 (D7) {#w4-latest-json}
- [ ] 5면 반영: README ko/en 지원 표(베타)·랜딩 ko/en 다운로드·CHANGELOG·docs/RELEASE.md·버전 6파일 {#w4-surfaces}

## W5 — 베타 운영과 졸업 {#w5}
- [ ] 플랫폼 버그 리포트 이슈 템플릿 + 진단 번들 내보내기(로그·버전·OS·WebView 버전) {#w5-report}
- [ ] [사용자 액션] Windows·Linux 외부 테스터 모집 {#w5-testers}
- [ ] CI 가 못 보는 것 원장 — Linux 실제 IME(fcitx/ibus)·Wayland 트레이·HiDPI 혼합·WebView2 버전 편차·WebKitGTK 의 navigator.platform 실제 값·Ctrl+Shift+V 클립보드 권한·Windows Ctrl+Shift+0 입력 언어 전환 충돌 (D8) {#w5-eyes}
- [ ] 졸업: 연속 3릴리스 E2E 초록 + 테스터 P0 0건 → '베타' 표기 제거 {#w5-graduate}

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
<!-- oculpm:plan-log end -->
