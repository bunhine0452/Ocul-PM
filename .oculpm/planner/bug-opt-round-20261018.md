---
oculpm_plan: v1
id: bug-opt-round-20261018
title: "버그·최적화 라운드 (2026-10-18) — 터미널 뭉개짐 · 터미널 결함 · 앱 결함 · vec0"
status: active
created: 2026-10-18
updated: 2026-10-18
owner: claude-code
---

병렬 레인 4개(Opus 5.5 medium)로 잡은 결함·최적화와, 실기기 확인·보류한 의심 항목.

## 수정 (합류 브랜치 fix/bug-opt-round-20261018) {#fixes}
- [x] 터미널 극소 크기 fit 바닥(20열·4행) — 줄였다 키우면 뭉개지던 것 {#lane-a-tiny-fit}
- [x] 숨은 터미널 15초 뒤 WebGL 컨텍스트·아틀라스 반납 (WebglSlot) {#lane-a-webgl-release}
- [x] 터미널 결함 5건 — 종료 패닉·입력 거절 토스트·드래그 취소·채우기 대상·닫기 포커스 {#lane-b-terminal-five}
- [x] 앱 결함 4건 — 사라진 폴더 유령 색인·늦게 생긴 .gitignore·플랜 앵커 이중·자동화 날짜 UTC {#lane-c-app-four}
- [x] vec0 성긴 파티션 자동 다지기 (KNN 128→13ms) {#lane-d-vec0-repack}

## 실기기 확인 (설치본 업데이트 뒤) {#eyes}
- [ ] 도크를 최소 폭·높이까지 줄였다 다시 키워도 셸·Claude Code 지난 출력·스크롤백이 그대로 {#eyes-tiny-fit}
- [ ] 터미널 세션 여럿 띄우고 하나만 보이게 15초 뒤 WebContent vmmap owned unmapped (graphics) 가 1.5G 에서 크게 준다 · 다시 보인 탭 글자 선명 {#eyes-webgl-release}
- [ ] 앱 종료 뒤 oculpm.log 에 lifecycle.rs 패닉 없음 · 고아 rust-analyzer 없음 {#eyes-quit-panic}
- [ ] 앱이 도는 중 폴더 삭제 → 의미검색에서 빠짐 · .gitignore 편집 → 새로 무시된 경로 미색인 {#eyes-ghost-gitignore}
- [ ] 로그 vec0 partition repacked 확인 · 진단 탭 compact 로 DB 813→~370MB · 다지기 중 탭 init 안 막힘 {#eyes-vec0}

## 보류한 의심 (근거 있음, 미확정) {#carry}
- [ ] ptyhost 가 죽으면 열린 페인이 모르는 채 먹통 — client.rs 읽기 루프 종료가 프런트에 신호 안 냄 (새 신호 = 범위 동결 판단 필요) {#carry-ptyhost-death-silent}
- [ ] 트레이 상주 중 앱 창 먼저 닫고 분리 터미널 창만 닫으면 handle_last_window_closed 안 불려 종료될 수 있음 (terminal_windows.rs) {#carry-tray-detached-close}
- [ ] attach·재생 중 도착한 exit 뒤 input.open() 이 입력 문을 다시 엶 · [프로세스 종료됨] 이 재생 중간에 찍힘 {#carry-exit-reopens-input}
- [ ] KillPrefix/KillExcept 가 세션 심 디렉터리를 안 지움 · blockPips 맵 미정리 {#carry-shim-killprefix}
- [ ] 남은 유령 색인 14행 — Lane::Index permit 2개로 같은 경로 Update·Delete 동시 실행 의심 (10-08 FK 실패 WARN) {#carry-ghost-index-race}
- [ ] 외부 에이전트 일지 parse_ok=0 12건 — 템플릿 files_touched 예시가 [ ] , { } 경로 인용을 안 알림 (template_version 올려야) {#carry-journal-yaml-quote}
- [ ] ocul-pm.db.bak-v40 734MB 보존 정책 (며칠 뒤 정리할지) — 사용자 결정 {#carry-bak-v40}
- [ ] shell_integration::policy 테스트 2건이 부하 중 cargo test 에서 간헐 실패 (단독·64스레드 재현 안 됨, ETXTBSY 의심) {#carry-policy-test-flake}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-18T01:14:45+09:00 | #lane-a-tiny-fit | claude-code | ☐→x | .oculpm/journal/20261018/Bugs/0114_bug_terminal-tiny-fit-and-webgl-release.md | a25c4a22 · 실기기 미확인 |
| 2026-10-18T01:14:49+09:00 | #lane-a-webgl-release | claude-code | ☐→x | .oculpm/journal/20261018/Bugs/0114_bug_terminal-tiny-fit-and-webgl-release.md | 8ae27bd5 · 재측정 필요 |
| 2026-10-18T01:14:54+09:00 | #lane-b-terminal-five | claude-code | ☐→x | .oculpm/journal/20261018/Bugs/0114_bug_terminal-bug-hunt-five.md | 92bd69ee..c96be75e |
| 2026-10-18T01:14:59+09:00 | #lane-c-app-four | claude-code | ☐→x | .oculpm/journal/20261018/Bugs/0114_bug_app-bug-hunt-ghost-index-gitignore.md | fedc42c6..b603ad9c · 종료 패닉은 B 쪽 채택 |
| 2026-10-18T01:15:04+09:00 | #lane-d-vec0-repack | claude-code | ☐→x | .oculpm/journal/20261018/Refactors/0114_refactor_perf-vec0-partition-repack.md | 1953ec2c · 설치본 재측정 필요 |
<!-- oculpm:plan-log end -->
