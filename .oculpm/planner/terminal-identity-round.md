---
oculpm_plan: v1
id: terminal-identity-round
title: "터미널 정체성 라운드 — Warp/cmux 를 참조한 3단 개편 (시각 → 관제탑 → 블록)"
status: active
created: 2026-08-28
updated: 2026-08-28
owner: claude-code
---

사용자 요청: "ocul-pm 만의 터미널 디자인 — Warp 처럼, 아니면 cmux 처럼. 에이전트를
사용할 때 편안하고, UI 도 독보적으로."

출발점 진단: 재료는 이미 다 있는데 UI 가 버리고 있었다. `oscShell.ts` 가 nonce 검증
까지 하며 명령 경계·종료코드·소요시간·cwd 를 뽑고 `agentDetect.ts` 가 에이전트를
정확히 식별하는데, 그 전부가 상태바 `.ts-seg` 한 칸으로 압축되고 끝났다.

핵심 방향 — **페인이 두 가지 옷을 갈아입는다.** Warp 는 블록만, cmux 는 오케스트
레이션만 한다. 둘을 한 면에서 자동 전환하는 건 아무도 안 한다: 셸 모드(normal
buffer)는 블록, 에이전트 모드(alt-screen)는 관제탑. 판정 신호는 이미 있다
(`term.buffer.onBufferChange` + `detectAgent`).

## Phase 1 — 시각 정체성 {#p1-visual}
- [x] 세로 세션 레일 — 카드에 상태 점·에이전트 아이콘·라이브 경과 시간·마지막 명령, 40px 접힘 {#rail}
- [x] railModel 순수 재료 — 카드 파생 + 경과 표기 + cwd 접기, 통합 꺼진 세션은 지어내지 않음 {#rail-model}
- [x] 앰비언트 페인 상태 띠 + 비활성 디밍 + 비포커스 커서 outline {#pane-ambient}
- [x] 밀도 프리셋(넉넉/표준/조밀) — xterm lineHeight + 페인 여백, 앱 전역 설정 {#density}
- [x] 상태바 재설계 — 좌 cwd · 중앙 라이브 명령(1초 시계 격리) · 우 조작 {#status-bar}
- [ ] 실제 앱 육안 확인 — xterm 캔버스와 함께, 밀도 전환 시 fit/PTY resize 왕복 {#p1-manual-verify}

## Phase 2 — 에이전트 관제탑 (cmux) {#p2-control-room}
- [x] alt-screen 감지 — buffer.onBufferChange + detectAgent 로 "에이전트 모드" 판정 {#alt-screen-detect}
- [x] "내 입력 대기" 신호 — term.onBell + 출력 무변화 타이머, 추정임을 정직하게 표시 {#waiting-signal}
- [x] 레일 배지 — "N개가 기다립니다" → 다음 대기로 순환. **정렬은 하지 않는다**(결정 3) {#rail-attention}
- [x] 에이전트 표시 — 페인 위 떠 있는 알약(이름·상태·경과). 크롬 교체는 안 한다(결정 4) {#agent-card}
- [x] 실행 종료 인라인 카드 — 세션 카드 안 "일지 남기기" 손잡이. 토스트는 **승격이 아니라 병행**(다른 화면에 닿는 알림) {#finish-card}
- [ ] 실기기 확인 — Claude Code 가 실제로 BEL 을 울리는지, 20초 유휴 문턱이 적당한지 {#p2-manual-verify}

## Phase 3 — 블록 레이어 (Warp) {#p3-blocks}
- [x] 명령 마커 — registerMarker/registerDecoration 으로 거터 상태 캡슐. `exitCode === null` 은 초록이 아니라 회색 {#block-gutter}
- [x] overview ruler — 스크롤백 전체의 실패 지점을 미니맵 점으로 (폭은 생성 시 1회 고정) {#block-ruler}
- [x] ⌘↑/⌘↓ 블록 점프 + 스티키 헤더 (스크롤 갱신은 React 를 안 거친다) {#block-nav}
- [x] 블록 액션 — 복사/출력 복사/**프롬프트에 채우기**(재실행 아님, 결정 5) + **일지로 남기기**(씨앗 프리필)·**플래너에 붙이기**(계획→단계) {#block-actions}
- [ ] 실기기 확인 — 마커가 스크롤백을 따라 정확히 붙는지, overview ruler 10px 가독성, 캡슐 클릭 히트영역 {#p3-manual-verify}

## 결정

### Decision 1 — 블록 접기는 하지 않는다 {#d1-no-collapse}

2026-08-28 · claude-code · xterm 은 그리드 렌더러라 줄을 숨길 수 없다. 블록 UI 의
한계선은 점프·복사·마킹까지다. Warp 식 하단 멀티라인 입력 에디터도 범위 밖 —
TUI 에이전트(Claude Code 등)와 정면 충돌한다.
영향: #block-nav, #block-actions

### Decision 2 — 세션 목록은 세로 레일로 교체한다 {#d2-vertical-rail}

2026-08-28 · claude-code · 사용자 선택. 가로 탭은 5개가 넘으면 이름이 뭉개지고
상태를 실을 자리가 없다. 좁은 도크에서는 폭을 줄이고(168px) 접힘(40px)으로 대응하되,
가로 탭으로 되돌리지 않는다 — 두 벌을 유지하면 조작이 갈라진다.
영향: #rail

### Decision 3 — 대기 세션을 위로 정렬하지 않는다 {#d3-no-reorder}

2026-08-28 · claude-code · 계획 항목은 "입력 대기 세션 우선"이었으나 구현하며
바꿨다. 목록이 스스로 순서를 바꾸면 누르려던 자리에 다른 세션이 와 있게 된다 —
특히 대기는 **비동기로 발생**하므로 손이 움직이는 도중에 재정렬될 수 있다.
순서는 그대로 두고 "가는 길"(대기 배지 → 다음 대기로 순환)만 준다.
영향: #rail-attention

### Decision 4 — 에이전트 표시는 레이아웃을 건드리지 않는다 {#d4-no-reflow}

2026-08-28 · claude-code · 페인 위 헤더 줄로 만들면 페인 높이가 줄고 → xterm 이
refit 하고 → PTY 가 resize 된다. 에이전트가 뜨고 질 때마다 전체화면 TUI 가 통째로
다시 그려진다는 뜻이다. 절대 위치 알약으로 간다 — 몇 글자를 덮지만 화면이
흔들리지 않는다. 덮는 폭을 줄이려 평소엔 아이콘 + 경과 시간만 남긴다.
영향: #agent-card

### Decision 5 — 블록에서 "재실행"하지 않는다 {#d5-fill-not-rerun}

2026-08-28 · claude-code · 계획 항목에는 "재실행"이 있었으나 넣지 않았다.
스크롤백에서 고른 명령을 눈으로 확인하지 않고 바로 돌리는 것이 `rm -rf` 를 두 번
하는 방법이다. 프롬프트에 **채우기만** 하고 Enter 는 사람이 친다 — 디스패치
프리필과 같은 규약이고, 라벨도 "프롬프트에 채우기"로 적어 오해가 없게 한다.
영향: #block-actions

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | agent | 전이 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-28T19:49:15+09:00 | #rail | claude-code | →☐→[x] | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | TerminalRail 신설 |
| 2026-08-28T19:49:15+09:00 | #rail-model | claude-code | →☐→[x] | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | 순수 모듈 + 16건 테스트 |
| 2026-08-28T19:49:15+09:00 | #pane-ambient | claude-code | →☐→[x] | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | 스크림 대신 opacity |
| 2026-08-28T19:49:15+09:00 | #density | claude-code | →☐→[x] | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | terminal_density 설정 |
| 2026-08-28T19:49:15+09:00 | #status-bar | claude-code | →☐→[x] | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | 시계 격리 |
| 2026-08-28T19:49:15+09:00 | #p1-manual-verify | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | 목업 확인까지만 |
| 2026-08-28T19:49:15+09:00 | #alt-screen-detect | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 2 미착수 |
| 2026-08-28T19:49:15+09:00 | #waiting-signal | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 2 미착수 |
| 2026-08-28T19:49:15+09:00 | #rail-attention | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 2 미착수 |
| 2026-08-28T19:49:15+09:00 | #agent-card | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 2 미착수 |
| 2026-08-28T19:49:15+09:00 | #finish-card | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 2 미착수 |
| 2026-08-28T19:49:15+09:00 | #block-gutter | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 3 미착수 |
| 2026-08-28T19:49:15+09:00 | #block-ruler | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 3 미착수 |
| 2026-08-28T19:49:15+09:00 | #block-nav | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | Phase 3 미착수 |
| 2026-08-28T19:49:15+09:00 | #block-actions | claude-code | →☐ | 20260828/Features_to_add/1949_feature_terminal-visual-identity.md | 일지·플래너 연결 고리 |
| 2026-08-28T21:11:10+09:00 | #alt-screen-detect | claude-code | ☐→[x] | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | agentMode.ts + PaneSignal 배선 |
| 2026-08-28T21:11:10+09:00 | #waiting-signal | claude-code | ☐→[x] | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | 벨=확실 / 20초 유휴=추정, 문구 분리 |
| 2026-08-28T21:11:10+09:00 | #rail-attention | claude-code | ☐→[x] | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | 배지+순환. 정렬은 결정 3 으로 폐기 |
| 2026-08-28T21:11:10+09:00 | #agent-card | claude-code | ☐→[x] | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | 떠 있는 알약 (결정 4) |
| 2026-08-28T21:11:10+09:00 | #finish-card | claude-code | ☐→[x] | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | 세션 카드 안 손잡이, 토스트와 병행 |
| 2026-08-28T21:30:56+09:00 | #block-gutter | claude-code | ☐→[x] | 20260828/Features_to_add/2130_feature_terminal-command-blocks.md | 마커+장식, A는 앵커·C에서 블록 |
| 2026-08-28T21:30:56+09:00 | #block-ruler | claude-code | ☐→[x] | 20260828/Features_to_add/2130_feature_terminal-command-blocks.md | overviewRulerWidth 생성 시 고정 |
| 2026-08-28T21:30:56+09:00 | #block-nav | claude-code | ☐→[x] | 20260828/Features_to_add/2130_feature_terminal-command-blocks.md | 스티키는 DOM 직접 갱신 |
| 2026-08-28T21:30:56+09:00 | #block-actions | claude-code | ☐→[x] | 20260828/Features_to_add/2130_feature_terminal-command-blocks.md | 일지 씨앗 + plan add_item. 재실행은 결정 5 |
| 2026-08-28T21:30:56+09:00 | #p2-manual-verify | claude-code | →☐ | 20260828/Features_to_add/2111_feature_terminal-agent-control-room.md | 앱 꺼진 뒤 몰아서 |
| 2026-08-28T21:30:56+09:00 | #p3-manual-verify | claude-code | →☐ | 20260828/Features_to_add/2130_feature_terminal-command-blocks.md | 앱 꺼진 뒤 몰아서 |
<!-- oculpm:plan-log end -->
