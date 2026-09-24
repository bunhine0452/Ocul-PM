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
<!-- oculpm:plan-log end -->
