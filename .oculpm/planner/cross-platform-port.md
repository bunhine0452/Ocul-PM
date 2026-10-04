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
- [x] 초록이 된 잡부터 required 로 승격, 전부 초록이면 ci.yml 에 합쳐 릴리스 게이트 편입 {#w0-promote}

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
- [x] L-UI 프런트엔드 플랫폼 추상화 {#l-ui}
  - [x] src/lib/platform.ts OS 판정 단일 창구 — navigator.platform 4곳 교체 {#ui-platform}
  - [x] 단축키 매칭 mac=meta·그 외=ctrl + 터미널 포커스 시 셸 키(Ctrl+C/D/K/L/R/U/W/Z) 양보, 복사·붙여넣기 Ctrl+Shift+C/V {#ui-shortcuts}
  - [x] ⌘ 리터럴 476곳 → modLabel() 표기 함수·i18n 치환 {#ui-labels}
  - [x] 비-mac 창 크롬: 트래픽라이트 여백·드래그 영역·WebView2 스크롤바·폰트 폴백 {#ui-chrome}
  - [x] 터미널 IME 브리지의 WKWebView 우회가 WebView2·WebKitGTK 에서 해가 없는지 — Chromium 조합 시퀀스 vitest {#ui-ime}
  - [x] 세 UA(mac/win/linux) 단축키·표기 테이블 vitest + pnpm lint 초록 {#ui-tests}
  - [x] 맥 전용 문구 정리 — settings.tray.*·tray.*(메뉴바·Dock)·「Finder 에서 보기」·키체인·macOS 설정 안내의 비-mac 판 (L-UI 발견) {#ui-mac-words}
- [x] W2 종료 조건: rg PORT-STUB 0건 · portability.yml 전 잡 초록 · ci.yml(macOS) 초록 {#w2-no-stubs}

## W2+ — 레인이 찾은 후속 (W2 합류 뒤, 한 세션씩) {#w2plus}

- [x] 프런트 후속 — errors.ts 규칙(`The system keyring is unavailable`·Linux 파일 붙여넣기 미지원), useCodeImport.pasteFiles 오류 토스트, 비-mac 트레이 팝오버의 투명 여백·그림자 제거, op.shell.desc2(iTerm2·Terminal.app) 비-mac 문구, **Windows 에서 틀린 MCP 권고 셋**(op.mcp.pluginCovers·op.mcp.pluginConflict·op.plugin.warn — 따르면 MCP 가 하나도 안 남는다, McpServerBlock·ClaudePluginBlock) (L-OS·L-SHELL·L-INTEG 발견) {#ui-followups}
- [x] Windows 릴리스 exe 는 GUI 서브시스템 — 사람이 콘솔에서 `oculpm` 을 치면 출력이 안 붙는다. CLI 진입 앞 AttachConsole(ATTACH_PARENT_PROCESS), 대기 문제는 콘솔 서브시스템 별도 바이너리 검토 (L-SHELL 발견) {#os-cli-console}
- [x] 에이전트가 준 files_touched 경로를 쓰기 시점에 `/` 로 정규화 (MCP journal_write·manager) — Windows 에이전트의 `src\a.ts` 가 diff 사이드카 키를 어긋나게 한다 (L-FS 발견) {#fs-files-touched-norm}
- [x] planner·discussion·rollup 파서의 CRLF 내성 — `planner/parse.rs::fold_wrapped_items` 가 split('\n') 이라 autocrlf 체크아웃의 plan-log·항목 id 앵커가 흔들릴 수 있다, 테스트 0건 (L-FS 발견) {#fs-crlf-parsers}
- [x] 워처 rename 쌍의 새 이름이 빠진다 — 디바운서 Name(Both)[from,to] 에서 paths.first() 만 처리 (양 OS 기존 결함, L-FS 발견) {#fs-rename-pair}
- [x] 간헐 실패 — watcher::removing_the_project_root_does_not_resurrect_it 가 Windows 에서 Access is denied(os 5)로 한 번 붉음(L-SHELL run 35893773736), 다른 run 은 초록. 감시 핸들이 루트 삭제를 막는 경합인지 — 사용자가 감시 중인 프로젝트 폴더를 지울 때도 같은 일이 나는지 확인 {#fs-watcher-flake}
- [x] [사용자 결정] macOS 기존 결함 — acp/adapter.rs npm_platform 이 "macos" 로 찾아 딸려 온 claude(claude-agent-sdk-darwin-arm64)를 못 보고 PATH claude 로 물러선다. 고치면 ACP 가 쓰는 claude 바이너리가 바뀐다 (L-OS 발견) {#mac-bundled-claude}
- [x] 비-mac 새 창 키(Ctrl+Shift+N) — new_window 커맨드 + L-UI 바인딩, 앱 메뉴를 뗀 뒤 빈 자리 (L-OS 제안 diff 있음) {#os-new-window}
- [x] [사용자 결정] Windows 에서 Claude Code 플러그인의 MCP 서버가 안 뜬다 — Claude Code 는 stdio MCP 를 셸 없이 직접 실행하고 sh 셔틀은 실행 파일이 아니다(claude-code#58510), .mcp.json 은 OS 별로 못 가른다. 지금은 앱의 「MCP 등록」(절대경로 .exe) 안내. 대안 = Windows 전용 마켓플레이스 항목(「플러그인 1개」 원칙과 충돌) (L-INTEG 발견) {#integ-win-plugin-mcp}
- [x] Linux 세션 D-Bus 부재 시 single-instance 가 조용히 꺼져 앱이 두 번 뜰 수 있다 — 명시적 경고 또는 락 (L-OS 발견) {#os-single-instance-dbus}
- [x] PowerShell 세션의 네이티브 출력 인코딩 — 콘솔 코드 페이지(949/437)를 따른다. oculpm.ps1 의 OCULPM_TERM 가드 안에서 [Console]::InputEncoding/OutputEncoding 을 UTF-8 로 (L-PTY 제안) {#shell-pwsh-utf8}
- [x] Windows 분리 기동 호스트의 핸들 상속 — std spawn 은 bInheritHandles=TRUE 라 부모 파이프를 물 수 있다(dev·CI 에서만 실해). 근본은 CreateProcessW 직접 호출 (L-PTY 발견) {#pty-handle-inherit}
- [x] Windows 의 Job 종료가 셸에서 띄운 GUI 프로그램(예: 처음 띄운 `code .`)까지 함께 끝낸다 — macOS 와 다른 동작. GUI 서브시스템 자식은 breakaway 할지 결정 (L-PTY 발견) {#pty-job-gui-children}
- [x] 간헐 실패 — windows 러너에서 ^C 뒤 ping 이 30초 동안 계속 돌았다(ptyhost::host::windows::tests::idle_shell…, PR #39 run). 테스트 경합인지 「가끔 ^C 가 안 먹는다」 제품 결함인지 판정 — L-PTY2 가 조사 {#pty-ctrlc-flake}
- [x] [결정 필요] Windows 에서 CWD 가 프로젝트 루트인 오래 사는 자식(LSP 서버 lsp/client.rs · DAP · PTY 셸)이 도는 동안 사용자가 그 폴더를 옮기거나 지울 수 없다(ERROR_SHARING_VIOLATION 32). LSP 는 CWD 를 밖으로 옮길 여지가 있으나 서버의 설정 탐색이 바뀔 수 있다. PTY 셸은 모든 Windows 터미널의 공통 제약 (L-FS2 발견) {#os-child-cwd-lock}

- [x] E2E 발견 — Windows 에서 프로젝트 이름이 경로 전체(StartTab.tsx:217 · GreenfieldWizard.tsx:256 이 `/` 로만 자른다) {#ui-winpath-name}
- [x] E2E 발견 — Windows 터미널에 빠르게 친 키가 뒤섞인다(`echo order-0123456789` → `roder-0124356789`, 3/3 · Linux 0/5). 키마다 따로 가는 writeToPty 의 순서 무보장 — 세션별 쓰기 직렬화 {#ui-term-write-order}
- [x] E2E 발견 — 비-mac `--mono` 의 D2Coding Term(xterm 격자로 advance 재작성) 때문에 터미널 밖 고정폭 영역의 한글 자간이 벌어진다(tokens.css) {#ui-mono-hangul}
- [x] E2E 발견 — Linux 터미널 기본 탭 라벨 "zsh" 하드코딩(TerminalSurface.tsx) · 영어 전환 직후 토스트가 한국어 {#ui-e2e-minor}
- [x] E2E 발견 — `.oculpm` 기본 workday 시간대가 Asia/Seoul 이라 다른 시간대 사용자의 Today·일지 날짜가 하루 어긋난다 — 시스템 시간대 기본값 검토(schema 영향 확인) {#oculpm-default-tz}
- [x] E2E 발견 — 프로젝트를 추가하면 색인이 두 번 동시에 돈다(로그 `index reconcile … removed=1`) {#index-double-run}
- [x] **출시 차단 (실측 확정)** — 결정 2026-09-25: 설치 파일이 없을 때만 VC++ 자동 설치 + Windows 10 2004 미만 차단(L-PKG 후속 구현 중). Windows 릴리스 exe 가 `MSVCP140.dll`(C++ 런타임, ONNX Runtime 유래 추정)을 가져오면 VC++ 재배포 없는 PC 에서 앱이 안 뜬다. 러너엔 깔려 있어 설치 스모크가 못 잡는다 — L-PKG 가 dumpbin 으로 확인 중. 앱 옆 DLL 배포는 호스트 복사본을 깨므로 피할 것 (L-PTY2 발견) {#win-msvcp140}
- [x] Windows 경로 후속 둘 — deepLinkPlan.resolveRegisteredProject 가 끝의 `/` 만 떼서 `\`·대소문자가 다르면 등록 프로젝트를 못 찾는다, homeModel 의 `~` 줄임이 `C:\Users\x` 를 모른다 (L-UI2 발견) {#ui-winpath-followups}
- [x] Windows·Linux 에서 `directories::ProjectDirs` 경로가 Tauri `app_data_dir` 과 갈린다 — `ocul-pm config` CLI 가 GUI 와 **다른 DB** 를 열고 oculpm.log 가 ptyhost.log 와 다른 폴더에 쌓인다(lib.rs setup_logging · config/cli.rs open_db). macOS 는 같은 경로라 불변 (L-PTY2 발견) {#paths-projectdirs-mismatch}

## W3 — 패키징 · E2E (W2 합류 뒤, 병렬 2) {#w3}
- [x] tauri.windows.conf.json·tauri.linux.conf.json 분리 — tauri.conf.json(macOS) 불변 (D3) {#w3-conf}
- [x] Windows NSIS(currentUser·WebView2 embedBootstrapper) / Linux AppImage+deb, ubuntu-22.04 빌드(glibc 하한) {#w3-bundles}
- [x] tauri-driver E2E: windows·ubuntu(xvfb) 기동→15화면 렌더→터미널 왕복→MCP 사이드카 일지→일지 화면 반영, 단계별 스크린샷 아티팩트 {#w3-e2e}
- [x] 설치 스모크: NSIS /S 설치→실행→로그 기동 줄→제거 / deb 설치·AppImage 실행 {#w3-install-smoke}
- [x] WebView2 CDP Input.imeSetComposition 로 한글 조합 → 터미널 도착 단언 (D8) {#w3-ime-cdp}
- [x] 업데이터 N→N+1 스모크 (로컬 latest.json · 테스트 키) {#w3-updater-smoke}
- [x] [결정 필요] Windows 업데이트 때 터미널 세션이 끊긴다 — Tauri NSIS 가 ocul-pm.exe 를 이름으로 끝내 같은 exe 로 도는 --pty-host 도 끝난다(macOS 는 업데이트를 건넌다). L-PTY 권고: 호스트를 설치 폴더 밖 판별 복사본(%APPDATA%\<id>\ptyhost\ocul-pm-ptyhost-<판>.exe)에서 — 대가 AppData 의 exe·판마다 수십 MB. NSIS 템플릿 실제 동작부터 확인 (L-SHELL·L-PTY 발견) {#w3-update-ptyhost-lock}

## W4 — 릴리스 파이프라인 (사용자 결정 포함) {#w4}
- [x] [사용자 결정] Windows 코드 서명 — Azure Trusted Signing(월 과금) vs 무서명 베타(SmartScreen 경고) {#w4-signing-decision}
- [x] [사용자 결정] Linux 형식 — AppImage+deb(권장, D10) / +rpm / +Flatpak {#w4-linux-formats}
- [x] release.yml 매트릭스 windows·ubuntu-22.04 — 비-mac 실패가 macOS draft·검증을 막지 않게 분리 {#w4-release-matrix}
- [x] E2E·설치 스모크 통과 플랫폼만 latest.json 에 — macOS 업데이트 오염 금지 (D7) {#w4-latest-json}
- [x] 5면 반영: README ko/en 지원 표(베타)·랜딩 ko/en 다운로드·CHANGELOG·docs/RELEASE.md·버전 6파일 {#w4-surfaces}
- [x] 비-mac 공개 스위치 `OCULPM_RELEASE_NONMAC`(저장소 변수, 기본 꺼짐) — 파이프라인이 main 에 있어도 다른 세션의 macOS 핫픽스 태그가 README·랜딩 없이 Windows·Linux 를 공개하지 않게. 꺼짐 = v3.5.0 과 같은 결과물. 첫 비-mac 릴리스 때 사용자 결정으로 켠다 (오케스트레이터 검토 발견) {#w4-nonmac-switch}
- [x] 업데이터가 버전과 무관하게 자기 키부터 찾아 deb 설치본·이번 릴리스에서 빠진 OS 의 앱은 확인마다 「대상 없음」 오류 — 설정에서 직접 확인하면 보인다. D10 의 「deb 는 업데이트 버튼 대신 패키지 관리자 안내」 + 대상 없음은 오류가 아니라 「이 OS 빌드는 이번 버전에 없음」 으로 (L-REL 발견) {#upd-target-missing}
- [x] 간헐 실패 — Windows E2E 기동에서 `session not created: DevToolsActivePort file doesn't exist` → attach 폴백은 CDP 를 잡았으나 첫 실행 마법사가 60초 안에 안 뜸(PR #47 E2E run 36063711206, 재실행 초록). 이 한 단계가 떨어지면 뒤 60단계가 전부 건너뛰어진다 — launch 재시도 1회 또는 attach 뒤 대기 연장 (오케스트레이터 발견) {#e2e-win-devtools-flake}
- [x] 간헐 실패 — Windows `db::tests::{healing_is_a_no_op_on_an_intact_schema, heals_a_column_a_reused_migration_number_skipped}` 가 "database is locked"(port/l-rel Portability run 36044878579, Rust 무변경 커밋). 테스트 DB 경로 공유인지 파일 잠금 해제 지연인지 (L-REL 발견) {#db-win-locked-flake}
- [x] Linux — `DBUS_SESSION_BUS_ADDRESS` 가 파싱 불가한 값이면 tauri-plugin-single-instance 2.4.4 가 `Builder::session().unwrap()` 에서 기동 중 패닉할 수 있다(코드 읽기 추정, 미재현). instance-lock 폴백으로는 못 막는다 — 등록 전에 주소를 검사해 이상하면 플러그인을 건너뛰고 잠금 파일만 쓰기 (L-OS3 발견) {#os-dbus-addr-panic}
- [x] Windows PTY 호스트가 판별 복사본을 못 써서 원본으로 물러서는 경로(`launch.rs` 의 `start(exe, None, …)`)는 앱의 작업 폴더를 물려받는다 — 사용자가 프로젝트 폴더 터미널에서 앱을 띄웠으면 앱보다 오래 사는 호스트가 그 폴더를 쥔다. 그 경로의 cwd 를 실행 파일 폴더로 (L-PTY3 발견, #os-child-cwd-lock 의 값싼 완화) {#pty-host-fallback-cwd}
- [x] 비-mac 에서 일지·검색·시작 화면의 ⌘N(=Ctrl+N) 핸들러가 Shift 를 보지 않는다 — Ctrl+Shift+N 은 캡처 단계에서 막았지만 Ctrl+Shift+<같은 글자> 계열의 다른 전역 키와 같은 모양의 충돌이 남을 수 있다. 화면 핸들러가 수식키를 정확히 맞추게 (L-OS3 발견) {#ui-shortcut-shift-exact}
- [x] VS Code 확장의 플래너 파서(`extension/src/oculpm/planner.ts`)가 아직 「첫 `{#…}` 가 이긴다」 — `reader.spec.ts` 가 그 동작을 박아 둠. Rust `anchor_span`(메모 앞 마지막 → 줄 끝)과 갈라졌으니 맞추기 (L-FS3 발견) {#ext-anchor-rule}
- [x] `plan_edit::add_item` 이 phase 를 원문 헤딩으로 비교해 `## P {#p}` 인 phase 에 항목을 더하면 `## P` 섹션이 하나 더 생긴다 — UI 는 앵커를 뗀 이름을 넘기므로 양 OS 실제 결함 (L-FS3 발견) {#plan-add-item-anchored-phase}
- [x] 결정 섹션 판정 불일치 — `plan_edit::is_decisions_name` 은 부분 문자열, 파서의 `is_decisions_heading` 은 이름 전체. `move_phase` 가 「결정」 이 든 phase 를 결정 섹션으로 보고 이동 범위를 끊는다 (L-FS3 발견) {#plan-decisions-heading-mismatch}
- [x] plan_edit 의 phase 조회가 결정 섹션 이름(「결정」 등)을 거절하지 않는다 — `add_item` 은 결정 섹션에 항목을 넣어 파서가 못 보게 만들고, **`remove_phase("결정")` 은 결정 섹션 전체를 지운다**(데이터 손실), `rename_phase`·`move_item` 도 이름으로 닿는다. phase 조회에서 결정 이름을 거절 · 겸해서 `add_item` 중복 id 검사가 부분 문자열(`contains("{#id}")`) · 확장 `slugify` 는 40자 절단이라 Rust 와 자동 id 가 다를 수 있음 (L-PLAN2 발견) {#plan-edit-decisions-guard}
- [x] macOS 이름 바꾸기에서 옛 이름 삭제가 사라진다 — FSEvents 가 옛 이름에도 Created 를 달아 디바운서가 한 판으로 접는다, ndjson·일지 캐시에 옛 이름 행이 남음(기존 동작) · 겸해서 `planner/dispatch.rs::read_journal_excerpt` 가 CRLF 일지 발췌 앞에 `\r\n` 을 남김(보기만) (L-FS3 발견) {#fs-mac-rename-old-name}

## W5 — 베타 운영과 졸업 {#w5}
- [x] 플랫폼 버그 리포트 이슈 템플릿 + 진단 번들 내보내기(로그·버전·OS·WebView 버전) {#w5-report}
- [ ] [사용자 액션] Windows·Linux 외부 테스터 모집 {#w5-testers}
- [ ] CI 가 못 보는 것 원장 — Linux 실제 IME(fcitx/ibus)·Wayland 트레이·HiDPI 혼합·WebView2 버전 편차·WebKitGTK 의 navigator.platform 실제 값·Ctrl+Shift+V 클립보드 권한·Windows Ctrl+Shift+0 입력 언어 전환 충돌·Defender 실시간 보호가 켜진 PC 의 폴더 이동 막힘·감시 중 루트의 **상위 폴더는 이동 불가**(ReadDirectoryChangesW 본질, VS Code 동일 — 문서에 알림)·큰 프로젝트 첫 세션의 긴 막힘·**일반 사용자 권한 설치에서 VC++ 재배포 UAC 승격 경로**(러너는 관리자라 창이 안 뜬다 — 예·취소 둘 다, 취소=1602 멈춤 안내)·사람이 cmd·PowerShell 에서 친 GUI 서브시스템 릴리스 exe 의 CLI 출력 모습(프롬프트 뒤에 찍힘)·세션 D-Bus 없는 실제 Linux 데스크톱에서 두 번 실행·실제 창에서 Ctrl+Shift+N (D8) {#w5-eyes}
- [ ] 졸업: 연속 3릴리스 E2E 초록 + 테스터 P0 0건 → '베타' 표기 제거 {#w5-graduate}
- [~] AppImage 카탈로그 등재(appimage.github.io#9061) — .DirIcon 절대 심링크 · AppRun.wrapped 0770 을 고친 판을 릴리스한 뒤 그 PR 에 `/retest` 코멘트 → 린트·firejail 실행·스크린샷까지 초록 확인 {#w5-appimage-catalog}
- [ ] `@tauri-apps/cli` 2.12 올리기 평가(지금 `~2.11.5` 고정) — NSIS restart manager 종료(tauri#14479)가 Windows PTY 호스트 업데이트 생존을 깨는지 · AppImage 의 GDK_BACKEND=x11 강제 해제(Wayland 네이티브) · xdg-open 미번들을 러너에서 확인. 올리면 seed-appimage-apprun.sh 와 두 워크플로 호출 제거(린트는 유지) {#w5-tauri-cli-212}

<!-- oculpm:plan-log begin v1 -->
<!-- oculpm:plan-log archived: 63 rows → cross-platform-port.log.md -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-25T02:44:15+09:00 | #ui-mac-words | claude-code | ☐→x | .oculpm/journal/20260925/Bugs/0243_bug_port-e2e-frontend-defects-lui2.md | i18n 판 조회 __win/__linux/__pc 47개 두 언어, macOS 는 조회 안 함(원문 불변 테스트) |
| 2026-09-25T02:44:24+09:00 | #ui-followups | claude-code | ☐→x | .oculpm/journal/20260925/Bugs/0243_bug_port-e2e-frontend-defects-lui2.md | errors.ts 3규칙·pasteFiles 토스트·트레이 팝오버 불투명·op.shell.desc2·Windows MCP 권고 셋 수정. 설정 실물은 vitest 로만 |
| 2026-09-25T03:05:17+09:00 | #w3-conf | claude-code | ☐→x | journal/20260925/Features_to_add/0305_feature_port-lpkg-bundles-install-smoke.md | PR #45 — 플랫폼 conf 2개 병합, macOS conf 불변 |
| 2026-09-25T03:05:21+09:00 | #w3-bundles | claude-code | ☐→x | journal/20260925/Features_to_add/0305_feature_port-lpkg-bundles-install-smoke.md | PR #45 — NSIS·AppImage·deb 번들 잡 양 OS 초록 |
| 2026-09-25T03:05:25+09:00 | #w3-install-smoke | claude-code | ☐→x | journal/20260925/Features_to_add/0305_feature_port-lpkg-bundles-install-smoke.md | PR #45 — 설치·실행·재설치·제거 스모크 양 OS 초록, 사이드카 잠금 NSIS 훅 포함 |
| 2026-09-25T03:07:58+09:00 | #paths-projectdirs-mismatch | claude-code | ☐→x | journal/20260925/Bugs/0307_bug_port-app-dirs-projectdirs-mismatch.md | PR #43 — app_dirs.rs 단일 창구, 세 자리 교체, 양 OS CI 초록 |
| 2026-09-25T06:47:28+09:00 | #win-msvcp140 | claude-code | ☐→x | journal/20260925/Features_to_add/0647_feature_port-win-vcredist-os-floor.md | PR #46 — 없을 때만 VC++ 14.51.36247 설치 · 19041 미만 차단, 러너 실측(DLL 숨김→되살림→GUI) |
| 2026-09-28T20:40:59+09:00 | #e2e-win-devtools-flake | claude-code | ☐→x | journal/20260928/Bugs/2040_bug_port-e2e-window-pick.md | PR #50 — 본 창 선택 재시도 · 비고에 창 기록, 수정본 4/4 초록(경합 재현은 없었음 — 재발 시 로그로 판별) |
| 2026-09-28T21:45:20+09:00 | #w4-release-matrix | claude-code | ☐→x | journal/20260928/Features_to_add/2145_feature_port-release-pipeline-nonmac.md | PR #47 — 비-mac 번들·스모크·E2E 격리, macOS 는 publish 만 기다림 |
| 2026-09-28T21:45:27+09:00 | #w4-latest-json | claude-code | ☐→x | journal/20260928/Features_to_add/2145_feature_port-release-pipeline-nonmac.md | PR #47 — latest-json.mjs 병합·검증, macOS baseline deepEqual, 맨 linux 키 없음 |
| 2026-09-28T21:45:34+09:00 | #w4-nonmac-switch | claude-code | ☐→x | journal/20260928/Features_to_add/2145_feature_port-release-pipeline-nonmac.md | PR #47 — OCULPM_RELEASE_NONMAC 기본 꺼짐, 꺼짐 = v3.5.0 결과물(드라이런 36048116681) |
| 2026-09-28T21:45:41+09:00 | #w0-promote | claude-code | ☐→x | journal/20260928/Features_to_add/2145_feature_port-release-pipeline-nonmac.md | 결정: required·ci.yml 합치기 대신 main push 미리보기 — 비-mac 싣기는 release.yml 이 태그 커밋에서 다시 판정(D2) |
| 2026-09-28T22:22:53+09:00 | #shell-pwsh-utf8 | claude-code | ☐→x | journal/20260928/Bugs/2222_bug_port-win-terminal-utf8-inherit-gui.md | PR #52 — pwsh 5.1·7 모두 65001, 네이티브 한글 왕복 러너 확인 |
| 2026-09-28T22:23:00+09:00 | #pty-handle-inherit | claude-code | ☐→x | journal/20260928/Bugs/2222_bug_port-win-terminal-utf8-inherit-gui.md | PR #52 — proc::spawn_detached(CreateProcessW, 상속 끔), 대조군 포함 EOF 테스트 |
| 2026-09-28T22:23:07+09:00 | #pty-job-gui-children | claude-code | ☐→x | journal/20260928/Bugs/2222_bug_port-win-terminal-utf8-inherit-gui.md | PR #52 — 위임 결정대로 GUI 자손 보존·콘솔만 종료, 러너에서 GUI 생존 단언 |
| 2026-09-28T22:49:59+09:00 | #fs-crlf-parsers | claude-code | ☐→x | journal/20260928/Bugs/2249_bug_port-crlf-anchor-rename-paths.md | PR #55 — eol.rs 읽기 LF·쓰기 보존, 롤업 CRLF 누락 결함 포함 · 앵커는 줄 끝 |
| 2026-09-28T22:50:06+09:00 | #fs-files-touched-norm | claude-code | ☐→x | journal/20260928/Bugs/2249_bug_port-crlf-anchor-rename-paths.md | PR #55 — git::touched_path, MCP journal_write·수동 일지 둘 다 |
| 2026-09-28T22:50:12+09:00 | #fs-rename-pair | claude-code | ☐→x | journal/20260928/Bugs/2249_bug_port-crlf-anchor-rename-paths.md | PR #55 — 이벤트의 모든 경로 처리 + 사전 필터 양쪽, Linux·Windows (macOS 는 #fs-mac-rename-old-name) |
| 2026-09-28T23:30:54+09:00 | #os-cli-console | claude-code | ☐→x | journal/20260928/Features_to_add/2330_feature_port-cli-console-dbus-newwindow-paths.md | PR #54 — CLI 분기 직전 AttachConsole + 빈 핸들만 CONOUT$, 러너 콘솔 테스트(대조군 포함) |
| 2026-09-28T23:30:59+09:00 | #os-single-instance-dbus | claude-code | ☐→x | journal/20260928/Features_to_add/2330_feature_port-cli-console-dbus-newwindow-paths.md | PR #54 — Linux instance-lock(flock) 폴백 + 버스 부재 경고 |
| 2026-09-28T23:31:03+09:00 | #os-new-window | claude-code | ☐→x | journal/20260928/Features_to_add/2330_feature_port-cli-console-dbus-newwindow-paths.md | PR #54 — Ctrl+Shift+N → new_window, 캡처 단계·치트시트·⌘K(비-mac) |
| 2026-09-28T23:31:08+09:00 | #ui-winpath-followups | claude-code | ☐→x | journal/20260928/Features_to_add/2330_feature_port-cli-console-dbus-newwindow-paths.md | PR #54 — 딥링크 비교·openNavFor·홈 ~ 줄임을 Windows 규칙으로 |
| 2026-09-29T00:12:07+09:00 | #oculpm-default-tz | claude-code | ☐→x | journal/20260929/Bugs/0012_bug_port-tz-index-dblock-bugreport.md | PR #53 — TZ → iana-time-zone → Asia/Seoul, 적힌 값 불변 |
| 2026-09-29T00:12:12+09:00 | #index-double-run | claude-code | ☐→x | journal/20260929/Bugs/0012_bug_port-tz-index-dblock-bugreport.md | PR #53 — index_project 프로젝트별 단일 비행, E2E 로그 start 1·joined·done 1 |
| 2026-09-29T00:12:17+09:00 | #db-win-locked-flake | claude-code | ☐→x | journal/20260929/Bugs/0012_bug_port-tz-index-dblock-bugreport.md | PR #53 — Db::close() 로 닫힘 대기 뒤 재열기 (결정적 수정, 재현은 못 함 — 누적 초록으로 판정) |
| 2026-09-29T00:12:22+09:00 | #w5-report | claude-code | ☐→x | journal/20260929/Bugs/0012_bug_port-tz-index-dblock-bugreport.md | PR #53 — platform-bug.yml + diagnostics_report 「진단 정보 복사」 (설치 형식은 L-UPD install_kind 합류 뒤) |
| 2026-09-29T00:35:14+09:00 | #plan-add-item-anchored-phase | claude-code | ☐→x | journal/20260929/Bugs/0035_bug_planner-anchored-phase-decisions-ext.md | PR #56 — heading::split_phase_heading 공유 |
| 2026-09-29T00:35:19+09:00 | #plan-decisions-heading-mismatch | claude-code | ☐→x | journal/20260929/Bugs/0035_bug_planner-anchored-phase-decisions-ext.md | PR #56 — is_decisions_heading 하나로 통일 |
| 2026-09-29T00:35:24+09:00 | #ext-anchor-rule | claude-code | ☐→x | journal/20260929/Bugs/0035_bug_planner-anchored-phase-decisions-ext.md | PR #56 — 확장 planner.ts 가 anchor_span·결정 헤딩·CRLF 를 Rust 와 같게, 공유 사례표 |
| 2026-09-29T01:23:39+09:00 | #plan-edit-decisions-guard | claude-code | ☐→x | journal/20260929/Bugs/0123_bug_plan-create-decisions-guard.md | PR #56(plan_edit 5경로 거절·중복 id 앵커) + PR #58(MCP plan_create). slugify 40자 통일은 범위 밖 |
| 2026-09-29T03:35:25+09:00 | #upd-target-missing | claude-code | ☐→x | journal/20260929/Features_to_add/0335_feature_port-updater-install-kind-smoke.md | PR #57 — install_kind + updaterRoute: deb 패키지 관리자 안내·대상 없음 중립, 러너에서 noBuild 실전 확인 |
| 2026-09-29T03:35:31+09:00 | #w3-updater-smoke | claude-code | ☐→x | journal/20260929/Features_to_add/0335_feature_port-updater-install-kind-smoke.md | PR #57 — N→N+1 Windows NSIS·Linux AppImage 설치·재시작, 서명 거절 둘, deb 안내 — 러너 success |
| 2026-09-29T03:40:55+09:00 | #os-dbus-addr-panic | claude-code | ☐→x | journal/20260929/Bugs/0340_bug_port-dbus-panic-shortcut-exact-pty-cwd.md | PR #59 — 패닉 실측(나쁜 주소 9/9) · register 가 zbus 규칙으로 먼저 검사 |
| 2026-09-29T03:41:00+09:00 | #ui-shortcut-shift-exact | claude-code | ☐→x | journal/20260929/Bugs/0340_bug_port-dbus-panic-shortcut-exact-pty-cwd.md | PR #59 — isModChord, 세 화면 통일, mac 옛 식과 대조 |
| 2026-09-29T03:41:06+09:00 | #pty-host-fallback-cwd | claude-code | ☐→x | journal/20260929/Bugs/0340_bug_port-dbus-panic-shortcut-exact-pty-cwd.md | PR #59 — 원본 폴백 cwd = exe 폴더, windows 러너에서 project 폴더 이동·삭제 확인 |
| 2026-09-29T03:41:13+09:00 | #os-child-cwd-lock | claude-code | ☐→x |  | 결정(2026-09-28 위임): 코드 불변·README 설치 절에 알림(v3.6.0 릴리스 커밋) · 값싼 완화 #pty-host-fallback-cwd 는 PR #59 |
| 2026-09-29T03:41:19+09:00 | #integ-win-plugin-mcp | claude-code | ☐→x |  | 결정(2026-09-28 위임): 앱의 「MCP 서버」 등록(절대경로 .exe) 유지, 플러그인 1개 원칙 — 플러그인 저장소 무서명 exe 안은 공급망 위험으로 기각. README 설치 절·앱 안내 문구 일치 |
| 2026-09-29T06:05:55+09:00 | #w4-surfaces | claude-code | ☐→x | journal/20260929/Features_to_add/0605_feature_release-v3-6-0-windows-linux-beta.md | v3.6.0 공개(run 36477736356 전 잡 success) — 자산 10·키 5, 랜딩 oculpm.com v3.6.0 |
| 2026-10-01T18:27:21+09:00 | #fs-mac-rename-old-name | claude-code | ☐→x | .oculpm/journal/20261001/Bugs/1827_bug_fsevents-sticky-created-flag.md | StaleFlagFilter(macOS 만) — 사라진 경로의 Create·내용 Modify 를 디바운서 앞에서 버림. 지우기도 Update 로 찍히던 것 함께. CRLF 발췌는 9c8d9280 이 이미 고침 |
| 2026-10-04T16:11:25+09:00 | #w5-appimage-catalog | claude-code | ☐→~ | .oculpm/journal/20261004/Bugs/1611_bug_appimage-diricon-apprun-mode.md | 결함 둘 확정(squashfs 전수) — CLI ~2.11.5 · AppRun 0755 선배치 · appimage-lint 게이트. 남은 것: 릴리스 → /retest |
<!-- oculpm:plan-log archived: 63 rows → cross-platform-port.log.md -->
<!-- oculpm:plan-log end -->
