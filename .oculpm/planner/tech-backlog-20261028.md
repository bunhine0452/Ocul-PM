---
oculpm_plan: v1
id: tech-backlog-20261028
title: "기술 이월 원장 (2026-10-28) — 닫은 라운드 플랜의 근거 있는 부채"
status: active
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

덜어내기 라운드(simplify-round-20261028)에서 활성 플랜 18개를 4개로 줄이며, 닫은 플랜의 미완 기술 항목 가운데 근거가 살아 있는 것만 여기로 옮겼다. 사용자 확인·결정 항목은 polish-round-20261027 로 갔다. 여기서 구현하지 않는다 — 착수할 때 라운드 플랜으로 옮겨 `[>]` 로 적는다.

**완료 조건:** 항목마다 라운드 플랜으로 옮겨져 `[>]` 가 되거나 근거가 사라져 `[-]` 가 되면 끝 — 비어 있으면 닫는다. 이 플랜에서 코드를 쓰지 않는다.
**확인 명령:** pnpm test && (cd src-tauri && cargo test --lib)

## 의존성 올리기 (근거 있음, 사용자 결정 대기) {#deps}
- [ ] notify 8 / debouncer 0.7 — Debouncer::watch 가 FileIdMap 을 루트부터 WalkDir 로 채움, OrderedFileIdCache 시그니처 이식 + perf_baseline 재측정 (← optimize-round-20261024 #carry-notify8) {#notify8}
- [-] fastembed 5.17 → 7.5 (+ ort·hf-hub 짝) — 메이저 둘, 변경 내용·메모리 실측부터 (← optimize-round-20261024 #next-fastembed7) {#fastembed7}
- [ ] 보류 유지(근거): TypeScript 7 — typescript-eslint 8.72 의 peer 가 `<6.1.0` · notify 9 rc · specta rc.27 · keyring 4 기존 키 호환 불명. 근거가 바뀔 때만 다시 본다 (← optimize-round-20261024 #next-hold) {#deps-hold}

- [ ] rusqlite 0.41(번들 SQLite 3.54) — tokio-rusqlite 가 받으면 올리고 deny.toml 의 RUSTSEC-2026-0459 ignore 를 지운다 {#rusqlite-041}

## 메모리·디스크 (측정 먼저) {#footprint}
- [ ] 라이브 풋프린트 Malloc Small 511MB 귀속 — 설치본이 꺼진 때 심볼 빌드 + MallocStackLogging 으로 상위 할당 지점(3.12.0 실측: UI footprint 604MB · peak 949MB · 할당 835MB/144만 개). 보류 등급 제거(10-28) 뒤 재측정이 먼저 (← optimize-round #carry-malloc-small, improvement-round-2026-09-14 #footprint-attribution) {#malloc-small}
- [x] 이미 쌓인 worktree 사본 로컬 히스토리 236MB — 디스크에 없는 경로의 판 정리 (← optimize-round-20261024 #carry-history-purge) {#history-purge}
- [x] 남은 빈 테이블 mobile_devices · graph_nodes · graph_edges · symbol_relations (+ 10-28 제거로 비게 된 터미널·ACP·LSP 계열 테이블 조사) — 다음 마이그레이션 라운드에서 DROP 판단 (← optimize-round-20261024 #carry-dead-tables) {#dead-tables}

## 플러그인·스킬 {#plugin}
- [ ] 플러그인 마켓플레이스 공개 — 택일 UX·훅 계약 문서·버전 스큐 매트릭스·커뮤니티 제출 (← improvement-round-2026-09-14 #plugin-marketplace ← plugin-round #a3-marketplace) {#plugin-marketplace}
- [ ] 스킬 카탈로그 2차 가운데 살아 있는 것만 — 훅 Windows 검증·일지 스키마 2(실패 원장·ADR)·플래너 승인 게이트·스킬 출처. 스킬 12→5 로 줄인 뒤라 카탈로그 3차·비용 텔레메트리는 뺐다 (← improvement-round-2026-09-14 #skill-catalog-b) {#skill-catalog-b}
- [ ] Codex 플러그인에 MCP 를 직접 싣기 — codex 0.162.1 실측: `.mcp.json` 은 읽지만 절대 경로일 때만 기동. Codex 가 플러그인 상대 경로를 풀게 되면 다시 본다 (← bug-opt-round-20261018 #carry-codex-plugin-mcp) {#codex-plugin-mcp}

## Windows 입력 · 측정 {#win-followups}
- [~] Windows 한글 입력이 부하 중 음절마다 두 번 찍힘 — 2026-11-11 병렬 빌드(CPU 100%) 중 앱 터미널의 Claude 에 「갑갑자자기기」. 다음 재현 때 ⌃⌥⇧I 덤프를 받아 원인부터. 11-10 덤프: Windows IME 는 Backspace 에 줄 전체를 다시 조합해 브리지가 DEL×N + 재전송한다 {#ime-double-windows}
- [ ] git 띄우기 수가 macOS · Linux 에서 캡처마다 하나 더 — 윈도우에서는 상한(따로 6파일 10 · 한 커밋 5)에 맞는데 CI 의 유닉스에서 11 · 6. 캐시 열쇠(`path_form::cache_key` 가 유닉스에서 경로를 펴지 않음)나 첫 `config --list` 를 의심 (← 2026-11-11 Windows 성능 라운드) {#spawn-count-unix}

## 업그레이드 라운드 이월 (11-15) {#quality-carry}
- [ ] Linux 의 Ctrl+Shift+V 붙여넣기 — WebKitGTK 가 묶는지 설치본으로 확인, 안 되면 navigator.clipboard.readText 를 같은 정화 · 경고 길로 (← quality-round-20261115) {#linux-ctrl-shift-v}
- [x] Windows PowerShell 5.1(pwsh 없음)은 && 를 몰라 && 로 이은 확인 명령이 구문 오류 — 「셸에서 돌리기」 에서 막거나 알리기 (← quality-round-20261115) {#ps51-and-and}
- [x] ⌘K 에서 다른 창의 세션을 고르면 창만 앞으로 — 창을 건너는 세션 초점 요청 (← quality-round-20261115) {#palette-cross-window-focus}
- [x] 오늘 화면이 fg 확인 없이 alive && blocked 를 센다 — claude 가 죽은 칸이 줄로 남고 배지만 내려감 (← quality-round-20261115) {#today-crashed-claude}
- [x] 터미널 상태 띠가 전체 화면 TUI 의 맨 위 약 31px 를 덮는다 — 격자를 줄일지 띠 자리를 옮길지 (← quality-round-20261115) {#status-band-overlay}
- [x] 터미널 탭 닫기 × 표적 15px(WCAG 2.5.8) — 넓히면 창 번호를 덮어 탭 배치부터 (← quality-round-20261115) {#tab-close-target}
- [x] Claude 외부 편집기(Ctrl+G)에서 돌아온 직후 다음 상태 신호까지 Shift+Enter 가 CR(vim 오탐 막는 맞바꿈) (← quality-round-20261115) {#shift-enter-ctrl-g}
- [ ] [P2] xterm 6 + 애드온 짝 + DEC 2026 동기 출력 · 출력 원시 바이트 채널 · OSC 52 쓰기 · OSC 9;4 진행 숫자 · 빠른 선택(hints) (← quality-round-20261115) {#p2-terminal-next}
- [ ] [P2] 업데이트 뒤 정확히 그 대화로 · 하위 에이전트 수 · 탭 세부 카드 · 셸 통합 없이 명령 사이 이동 · 칸 나누기 폴더 잇기 (← quality-round-20261115) {#p2-terminal-agents}
- [ ] [P2] Finder 복사 파일 ⌘V → 경로 · 보내기의 쓰다 만 입력 보호 · 레인 전체 방송 · 오른쪽 ⌥ 는 글자 · 화면 낭독기 모드 (← quality-round-20261115) {#p2-terminal-input}
- [ ] [P2] Windows 깊은 손질 — Alt 메뉴 모드 · ConPTY 사이드로드 · FULL_REPAINT (← quality-round-20261115) {#p2-windows-deep}
- [ ] [P2] diff 「내가 본 뒤로」 검토 지점 · 계획 줄 메모 → Claude · ⌘K 이 화면 동작 묶음 · 레인 준비 .worktreeinclude · 첫 실행 claude 찾기 · 일하는 동안 잠자기 막기 (← quality-round-20261115) {#p2-flow}

## 사랑받는 앱 라운드 이월 (11-23) {#love-carry}
- [ ] 설정 「고칠 것」 의 플러그인 꺼짐 · 신호 없음 겹침을 한 줄로 {#love-fix-dup}
- [ ] 저장소가 아닌 프로젝트에서 오늘 영수증 단추 감추기 {#love-receipt-nonrepo}
- [ ] plan_update 의 넘친 로그 쓰기를 파서 검사 뒤로 {#love-archive-order}
- [ ] .worktreeinclude 복사의 링크 바뀜(TOCTOU) · 넓은 패턴 상한 {#love-include-toctou}
- [ ] 시작 훅 꼬리 두 줄이 1,600자 컷 뒤에 붙는 것 {#love-hook-tail}
- [ ] README · 랜딩 스크린샷을 4.13 화면으로 다시 찍기(하네스) {#love-shots}
- [ ] VS Code 확장 판 올림 · ext 릴리스(Latest 는 앱으로) {#love-ext-release}
- [ ] plugin README 의 statusline · ▶실행 단락 낡음 {#love-plugin-readme}
- [ ] Windows Git Bash 에서 하위 폴더 훅이 루트를 못 찾음(시험 붉음) {#love-win-subfolder}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-01T15:49:35+09:00 | #dead-tables | claude-code | ☐→x | .oculpm/journal/20261101/Refactors/1549_refactor_optimize-dead-code-sweep.md | 판정 ✓ cargo test 1065 passed · 0 failed — migration 044 가 독자 없는 표 18개 DROP(graph·symbol 은 043). mobile_devices 는 CLAUDE.md 대로 남김 |
| 2026-11-01T15:49:44+09:00 | #history-purge | claude-code | ☐→! | .oculpm/journal/20261101/Refactors/1549_refactor_optimize-dead-code-sweep.md | 쓰는 쪽(history.rs)을 걷어 더는 안 쌓인다. 남은 .oculpm/index/history/ (이 저장소 328MB) 를 앱이 지울지는 사용자 결정 |
| 2026-11-01T15:49:50+09:00 | #fastembed7 | claude-code | ☐→- |  | 근거 소멸 — fastembed·ort 는 4.0 에서 의존성째 걷었다 |
| 2026-11-01T16:17:33+09:00 | #history-purge | claude-code | !→x | .oculpm/journal/20261101/Chores/1617_chore_purge-local-history-folders.md | 판정 ✓ 추적 프로젝트 12곳 .oculpm/index/history 삭제 (약 1.5GB), 쓰는 코드는 a7b576da 에서 걷음 |
| 2026-11-12T03:28:00+09:00 | #ime-double-windows | claude-code | ☐→~ | .oculpm/journal/20261112/Bugs/0326_bug_ime-double-after-alt-v.md | 판정 ✓ pnpm test Tests 1098 passed (1098). 조건은 부하가 아니라 Alt+V(사용자 11-12) — 한글 keypress 를 xterm 에 넘기지 않는다. 설치본 확인 전이라 ~ |
| 2026-11-15T11:33:35+09:00 | #linux-ctrl-shift-v | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #ps51-and-and | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #palette-cross-window-focus | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #today-crashed-claude | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #status-band-overlay | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #tab-close-target | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #shift-enter-ctrl-g | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #p2-terminal-next | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #p2-terminal-agents | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #p2-terminal-input | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #p2-windows-deep | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #p2-flow | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-23T21:29:11+09:00 | #love-fix-dup | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-receipt-nonrepo | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-archive-order | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-include-toctou | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-hook-tail | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-shots | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-ext-release | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-plugin-readme | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:50+09:00 | #ps51-and-and | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2123_feature_terminal-input-fixes.md | love-round-20261123 L5 에서 끝남 — 돌리기 전에 까닭과 PowerShell 7 안내 |
| 2026-11-23T21:29:55+09:00 | #palette-cross-window-focus | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2126_feature_palette-screen-keys.md | love-round-20261123 P1 에서 끝남 — term_focus_session · TermFocusAsked (설치본 확인 몫) |
| 2026-11-23T21:29:59+09:00 | #today-crashed-claude | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_keep-awake-sessions.md | love-round-20261123 L6 에서 끝남 — 셸만 남은 칸은 기다림 줄에서 거른다 |
| 2026-11-23T21:30:05+09:00 | #status-band-overlay | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_keep-awake-sessions.md | love-round-20261123 L6 에서 끝남 — 상태 띠를 오른쪽 위 알약으로 |
| 2026-11-23T21:30:15+09:00 | #tab-close-target | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_keep-awake-sessions.md | love-round-20261123 L6 에서 끝남 — 닫기 × 표적 24px, 창 번호와 겹치지 않게 |
| 2026-11-23T21:30:27+09:00 | #shift-enter-ctrl-g | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2123_feature_terminal-input-fixes.md | love-round-20261123 L5 에서 끝남 — Ctrl+G 뒤에도 Shift+Enter 줄바꿈 |
| 2026-11-23T21:30:34+09:00 | #p2-flow | claude-code | ☐→☐ |  | love-round-20261123 에서 일부 끝남 — 내가 본 뒤로 · ⌘K 화면 동작 · .worktreeinclude · 첫 실행 claude 찾기 · 잠자기 막기. 남은 것: 계획 줄 메모 → Claude |
| 2026-11-23T21:30:39+09:00 | #p2-terminal-input | claude-code | ☐→☐ |  | love-round-20261123 에서 일부 끝남 — Finder 파일 ⌘V → 경로 · 오른쪽 ⌥ 글자 · 허락 묻는 중 보내기 막기(이미 있었음). 남은 것: 레인 전체 방송 · 화면 낭독기 모드 |
| 2026-11-23T21:30:44+09:00 | #p2-terminal-next | claude-code | ☐→☐ |  | love-round-20261123 에서 일부 끝남 — OSC 52 쓰기. OSC 9;4 진행 숫자는 실측 근거로 걷기 권고. 남은 것: xterm 6 + DEC 2026 (IME 시험 하네스 먼저) · 원시 바이트 채널(측정 먼저) |
| 2026-11-23T22:10:00+09:00 | #love-win-subfolder | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 Portability(Windows) — plugin_hook_subfolder 인박스 빔, 따옴표(libuv)는 맞춤 · 실패 때 set -x 추적을 싣게 함 |
<!-- oculpm:plan-log end -->
