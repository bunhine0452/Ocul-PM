---
oculpm_plan: v1
id: v242-load-bearing
title: "구조가 하중을 견디게 — 측정 먼저, 그다음 백프레셔와 락 스코프 (v2.42.0)"
status: done
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

3.0 이 색인·그래프·히스토리를 확장하면 전부 단일 DB 큐를 지난다. 먼저 안 하면 새 기능마다 같은 증상을 다시 진단한다. v3-round 감사의 성능 주장은 전부 구조적 추정(앱 미실행)이므로 측정이 Phase 0 이다.

## 추정을 측정으로 바꿈다 {#measure}
- [x] 1회 측정 — 일지 537건 전 기간 렌더·브랜치 전환 시 워처 이벤트 수와 DB 큐 지연·번들과 초기 페인트·screens.css 파싱. 앱이 꺼진 뒤 몰아서 (설치본과 락 경합 회피) {#measure-once}
- [x] 측정치를 회귀 기준으로 기록 — 다음 라운드가 비교할 수 있게 {#perf-baseline}

## 워처·인덱서 백프레셔 {#backpressure}
- [x] watcher.rs:147 unbounded 채널 → bounded + drop-oldest + 재동기화 신호 {#watcher-bounded}
- [x] classify 의 std::fs::read(최대 8MB) + blake3 를 spawn_blocking 으로 (watcher.rs:785-790) — 지금 런타임 워커에서 바로 돌고 있다 {#classify-blocking}
- [x] schedule_incremental_index / schedule_history_capture 앞에 Semaphore + 수명을 워처에 묶기 — 지금 detached 라 프로젝트를 닫은 뒤에도 DB 를 두드린다 {#index-semaphore}
- [x] commands/project.rs:187 index_project 전체 심이 spawn_blocking 밖에서 도는 것 정정 (walk·read·hash·tree-sitter) {#index-project-blocking}
- [-] commands/terminal.rs:79 pty-data 전역 broadcast — 열린 모든 웹뷰가 모든 세션의 모든 청크를 역직렬화한다. 같은 팀이 project.rs 에서는 100ms 스로틀했다 {#pty-broadcast-scope}

## 락을 IO 너머로 잡지 않는다 {#lock-scopes}
- [x] ptyhost/host.rs:518 전역 세션 뮤텍스를 잡은 채 write_all+flush — 핸들 복사 후 락 밖에서. 같은 파일 :578-586 이 이미 그 패턴을 쓴다. 지금은 붙여넣기 한 번이 모든 터미널 연결을 끊는다 {#pty-write-lock}
- [x] manager/lifecycle.rs:326 전역 write 락을 ps fork 와 워처 등록 너머로 잡는 것 — 이미 있는 ProjectSnapshot 활용 {#manager-write-lock}
- [x] lsp/state.rs:296 맵 락을 바이너리 해석·슬롯 락 너머로 잡는 것 — 같은 파일 running_clients 가 올바른 모양(슬롯 Arc 복사 후 맵 락 해제) {#lsp-status-lock}
- [x] embedding.rs:177 전역 std 뮤텍스를 spawn_blocking 안에서 잡는 것 — N 동시 호출자가 N개 OS 스레드를 파킹하고 그 풀을 git·히스토리·코드검색과 공유한다 {#embedder-mutex}

## 재렌더 비용 {#render-cost}
- [x] 설정 슬라이더 한 프레임 = 전체 재렌더 + SQLite 쓰기 + setZoom + 구독 재무장. 디바운스 + 커밋 시점 분리 (AppearanceTab.tsx:253) {#settings-slider}
- [x] useWorkspace() 전체를 쓰는 상시 마운트 셋(ShellV2·ProjectTab·TerminalDock)을 슬라이스로 — 컨텍스트 4분할은 이미 올바르게 돼 있다 {#workspace-full-consumers}
- [x] 떠 있는 프로미스 110곳 중 사용자 조작 발동 경로 우선 (AcpConversation:1514,1527,1567·TerminalSurface:410,451·useLsp:138,153 — 뒤는 버퍼 편집마다) {#floating-promises}
- [x] 설정 12곳 중 11곳이 async set() 을 void 도 catch 도 없이 버리는 것 정정 (LlmTab·ContextTab·IndexingTab·AppearanceTab) {#settings-set-unhandled}

## 릴리스 v2.42.0 {#release-242}
- [x] 측정 재실행 — Phase 0 기준 대비 실제로 나아졌는지 확인 (개선 주장은 측정치로만) {#measure-after}
- [x] 게이트 전수 exit 0 + 릴리스 5면 + 태그 {#release-242-2}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-04T15:17:52+09:00 | #measure-once | claude-code | ☐→x | 20260904/Chores/1517_chore_v242-measure-once-baseline.md | 앱 없이 실측. 추정 2개 사망(screens.css 7.6ms · DB큐 0.05ms/op), index_project 6,411ms 로 최대 발견. WKWebView 초기 페인트만 확인 못 함 |
| 2026-09-04T15:18:00+09:00 | #perf-baseline | claude-code | ☐→x | 20260904/Chores/1517_chore_v242-measure-once-baseline.md | docs/20260904_v242-load-bearing/perf-baseline.md — 수치 + 재현 명령 + 판정표. 하니스가 남아 다음 라운드가 같은 방법으로 잰다 |
| 2026-09-04T15:41:56+09:00 | #watcher-bounded | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-watcher-backpressure-index-blocking.md | 유계 링 4,096(측정 버스트 1,058의 3.9배·~1MB) + drop-oldest. tokio mpsc 는 앞을 못 버려 직접. 만회는 기존 reindex 경로+IntegrityWarning, 새 커맨드 0 |
| 2026-09-04T15:42:01+09:00 | #classify-blocking | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-watcher-backpressure-index-blocking.md | spawn_blocking 으로 이동. 성능 개선 아님 — 측정치 체크아웃당 33ms·최악 단일 파일 36ms. 위생 수정 |
| 2026-09-04T15:42:08+09:00 | #index-semaphore | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-watcher-backpressure-index-blocking.md | 갈래별 Semaphore(색인 2·히스토리 4) + watch 취소로 워처 수명에 묶음. 테스트가 shutdown 순서 버그를 잡았다(취소 먼저면 퍼밋이 대기자에게 넘어가 내려가는 중에 실행) |
| 2026-09-04T15:42:14+09:00 | #index-project-blocking | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-watcher-backpressure-index-blocking.md | 이 라운드 최대 발견 — 측정 6,411ms 워커 점유. CPU 구간 셋을 spawn_blocking 으로. IndexConfig Arc 화로 파일당 clone 제거, 진행률 스로틀 유지 |
| 2026-09-04T15:42:21+09:00 | #manager-write-lock | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-lock-scopes-manager-lsp-embed.md | 스냅샷→락 밖 느린 일→CAS 커밋 3단계. 경합은 두 겹(프로젝트 단위 lifecycle_lock + watcher_epoch CAS). 음성 대조로 close/stop 경합 테스트는 가드일 뿐임을 확인·주석화 |
| 2026-09-04T15:42:27+09:00 | #lsp-status-lock | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-lock-scopes-manager-lsp-embed.md | 같은 파일 running_clients 관용구로 — 맵에서 슬롯 Arc 만 복사하고 락 놓은 뒤 resolve_binary().await(로그인 셸 fork) |
| 2026-09-04T15:42:33+09:00 | #embedder-mutex | claude-code | ☐→x | 20260904/Refactors/1541_refactor_v242-lock-scopes-manager-lsp-embed.md | Semaphore(1) 로 줄서기를 blocking 풀 밖으로. 직렬성은 유지 — 바뀐 것은 어디서 기다리는가 |
| 2026-09-04T15:47:44+09:00 | #pty-write-lock | claude-code | ☐→x | 20260904/Bugs/1547_bug_v242-pty-write-queue-broadcast-verdict.md | 락만 좁혀선 안 됐다 — handle_request 가 접속 읽기루프 안에서 동기라 10초 타임아웃이 접속을 버렸다. 세션별 FIFO 쓰기 큐로. raw+미소비 tty 에서 무기한 블록을 직접 재현 |
| 2026-09-04T15:47:52+09:00 | #pty-broadcast-scope | claude-code | ☐→- | 20260904/Bugs/1547_bug_v242-pty-write-queue-broadcast-verdict.md | 전제 사망(코드 무변경). tauri 2.11.2 listener.rs:283 이 리스너 없는 웹뷰를 통째로 건너뛴다 — 이벤트명이 세션별이라 남의 창엔 안 간다. emit_to 로 바꿔도 listen()이 Any 라 안 준다. 게다가 한 세션을 두 웹뷰가 그릴 수 있어 좁히면 청크를 잃는다 |
| 2026-09-04T16:09:33+09:00 | #workspace-full-consumers | claude-code | ☐→x | 20260904/Features_to_add/1609_feature_v242-frontend-rerender-and-swallowed-failures.md | 상시 셋을 조각 훅으로. 회귀 테스트 3겹 — 실제 TerminalDock 마운트해 openTab/selectTab 10회에 추가 렌더 +10→0. useWorkspace 되돌리면 9케이스 중 2개 붉어짐 확인 |
| 2026-09-04T16:09:40+09:00 | #settings-slider | claude-code | ☐→x | 20260904/Features_to_add/1609_feature_v242-frontend-rerender-and-swallowed-failures.md | useDeferredCommit 으로 미리보기/커밋 분리. 20프레임 쓰기 20→0(놓을 때 1), 언마운트 flush. 공유 슬라이더 8개 동승. 플랜의 "구독 재무장" 갈래는 사실 아님을 확인·정정 |
| 2026-09-04T16:09:47+09:00 | #floating-promises | claude-code | ☐→x | 20260904/Features_to_add/1609_feature_v242-frontend-rerender-and-swallowed-failures.md | 지목된 자리(AcpConversation 3·TerminalSurface 3·useLsp 2)를 reportFailure 로. useLsp 는 고빈도라 토스트 대신 상태줄+로그 1회. 저장소 전체 ~100개는 플랜 밖으로 남음 |
| 2026-09-04T16:09:53+09:00 | #settings-set-unhandled | claude-code | ☐→x | 20260904/Features_to_add/1609_feature_v242-frontend-rerender-and-swallowed-failures.md | set() 12곳 전부 useSaveSetting 경유. set 은 거절 대신 알리고 resolve — 소유 밖 8자리가 아직 void set 이라 거절 계약이면 실패가 unhandled rejection 으로 자리만 옮긴다 |
| 2026-09-04T16:10:01+09:00 | #measure-after | claude-code | ☐→x | 20260904/Chores/1517_chore_v242-measure-once-baseline.md | 재실행했고 **개선을 주장하지 않는다** — 하니스는 날것의 일을 잰다. 바뀐 건 어느 스레드에서 도는가와 큐에 바닥이 있는가. 실제 전/후는 프런트 테스트 단언(쓰기 20→0, 렌더 +10→0). perf-baseline §6 |
| 2026-09-04T16:18:54+09:00 | #release-242-2 | claude-code | ☐→~ |  | 게이트 8종 전수 exit 0 직접 확인 · PR #13 잡 3개 conclusion=success · rebase 머지(886019c) · 태그 v2.42.0 푸시로 release.yml run 33848106608 시작 확인. 랜딩 배포 진행 중 |
| 2026-09-04T17:00:15+09:00 | #release-242-2 | claude-code | ~→x |  | release.yml 33848106608 success — dmg·app.tar.gz·sig·latest.json 게시(2026-09-04T07:58Z). 랜딩 ko/en 라이브 v2.42.0 확인 |
<!-- oculpm:plan-log end -->
