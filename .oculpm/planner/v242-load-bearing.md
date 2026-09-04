---
oculpm_plan: v1
id: v242-load-bearing
title: "구조가 하중을 견디게 — 측정 먼저, 그다음 백프레셔와 락 스코프 (v2.42.0)"
status: active
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

3.0 이 색인·그래프·히스토리를 확장하면 전부 단일 DB 큐를 지난다. 먼저 안 하면 새 기능마다 같은 증상을 다시 진단한다. v3-round 감사의 성능 주장은 전부 구조적 추정(앱 미실행)이므로 측정이 Phase 0 이다.

## 추정을 측정으로 바꿈다 {#measure}
- [ ] 1회 측정 — 일지 537건 전 기간 렌더·브랜치 전환 시 워처 이벤트 수와 DB 큐 지연·번들과 초기 페인트·screens.css 파싱. 앱이 꺼진 뒤 몰아서 (설치본과 락 경합 회피) {#measure-once}
- [ ] 측정치를 회귀 기준으로 기록 — 다음 라운드가 비교할 수 있게 {#perf-baseline}

## 워처·인덱서 백프레셔 {#backpressure}
- [ ] watcher.rs:147 unbounded 채널 → bounded + drop-oldest + 재동기화 신호 {#watcher-bounded}
- [ ] classify 의 std::fs::read(최대 8MB) + blake3 를 spawn_blocking 으로 (watcher.rs:785-790) — 지금 런타임 워커에서 바로 돌고 있다 {#classify-blocking}
- [ ] schedule_incremental_index / schedule_history_capture 앞에 Semaphore + 수명을 워처에 묶기 — 지금 detached 라 프로젝트를 닫은 뒤에도 DB 를 두드린다 {#index-semaphore}
- [ ] commands/project.rs:187 index_project 전체 심이 spawn_blocking 밖에서 도는 것 정정 (walk·read·hash·tree-sitter) {#index-project-blocking}
- [ ] commands/terminal.rs:79 pty-data 전역 broadcast — 열린 모든 웹뷰가 모든 세션의 모든 청크를 역직렬화한다. 같은 팀이 project.rs 에서는 100ms 스로틀했다 {#pty-broadcast-scope}

## 락을 IO 너머로 잡지 않는다 {#lock-scopes}
- [ ] ptyhost/host.rs:518 전역 세션 뮤텍스를 잡은 채 write_all+flush — 핸들 복사 후 락 밖에서. 같은 파일 :578-586 이 이미 그 패턴을 쓴다. 지금은 붙여넣기 한 번이 모든 터미널 연결을 끊는다 {#pty-write-lock}
- [ ] manager/lifecycle.rs:326 전역 write 락을 ps fork 와 워처 등록 너머로 잡는 것 — 이미 있는 ProjectSnapshot 활용 {#manager-write-lock}
- [ ] lsp/state.rs:296 맵 락을 바이너리 해석·슬롯 락 너머로 잡는 것 — 같은 파일 running_clients 가 올바른 모양(슬롯 Arc 복사 후 맵 락 해제) {#lsp-status-lock}
- [ ] embedding.rs:177 전역 std 뮤텍스를 spawn_blocking 안에서 잡는 것 — N 동시 호출자가 N개 OS 스레드를 파킹하고 그 풀을 git·히스토리·코드검색과 공유한다 {#embedder-mutex}

## 재렌더 비용 {#render-cost}
- [ ] 설정 슬라이더 한 프레임 = 전체 재렌더 + SQLite 쓰기 + setZoom + 구독 재무장. 디바운스 + 커밋 시점 분리 (AppearanceTab.tsx:253) {#settings-slider}
- [ ] useWorkspace() 전체를 쓰는 상시 마운트 셋(ShellV2·ProjectTab·TerminalDock)을 슬라이스로 — 컨텍스트 4분할은 이미 올바르게 돼 있다 {#workspace-full-consumers}
- [ ] 떠 있는 프로미스 110곳 중 사용자 조작 발동 경로 우선 (AcpConversation:1514,1527,1567·TerminalSurface:410,451·useLsp:138,153 — 뒤는 버퍼 편집마다) {#floating-promises}
- [ ] 설정 12곳 중 11곳이 async set() 을 void 도 catch 도 없이 버리는 것 정정 (LlmTab·ContextTab·IndexingTab·AppearanceTab) {#settings-set-unhandled}

## 릴리스 v2.42.0 {#release-242}
- [ ] 측정 재실행 — Phase 0 기준 대비 실제로 나아졌는지 확인 (개선 주장은 측정치로만) {#measure-after}
- [ ] 게이트 전수 exit 0 + 릴리스 5면 + 태그 {#release-242-2}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
