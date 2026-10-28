---
oculpm_plan: v1
id: ui-density-round-3-20261028
title: "UI 밀도 라운드 3 — 시안 17장의 나머지 전부"
status: active
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

사용자가 라운드 2 보고의 「시안 중 그대로 둔 것」을 보고 「외 다 적용안햇어 시안 그대로 적용해야지」라고 했다. 시안 캔버스(claude.ai/artifact/GUnxubRtCWw11JAJwavzSg, 17장)를 다시 한 장씩 대조해, 그대로 둔 셋(첫 실행 시트 · 논의 옵션/결정 · 스킬 후보/잠자는 중)과 나머지 빈틈을 전부 코드로 옮긴다. 새 자료는 거의 없다 — 이미 아는 것을 시안의 자리에 놓는 라운드. 데이터가 없는 칸(CI 결과 · 10월 fix 수)은 그리지 않고 「모름」이라고 적는다.

**완료 조건:** 시안 캔버스 17장의 모든 요소가 앱에 있고(설정 표시 · 첫 실행 시트 · 베타 알약 · 결과 끝 줄과 검증 칸 받은함 · 도크 접힘 · 결정 칸 · 스킬 두 열 · 시작 탭 사령탑), 설치본에서 사용자가 눈으로 그 자리를 확인했으며, 데이터가 없는 칸은 그리지 않고 「모름」이라고 적혀 있다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && (cd src-tauri && cargo clippy --all-targets --locked -- -D warnings)

## 탐색·설정 {#p1}
- [x] 설정 「표시」 — 밀도 두 카드 · 베타 화면 스위치 다섯 · 단축키 힌트 · 테마 바로가기 · 접힌 탭 이름 {#display-tab}
- [x] 보류 등급 네 화면 툴바에 「베타 · 결함 수정만」 알약 · 사이드바 꺼 둔 베타 행 접힘 · 일지/변경 배지 · ⌘K 바닥 힌트 {#beta-pill}
- [x] 첫 실행 세 단계 시트 — 플러그인 탐침으로 스스로 초록 · 건너뛰기는 설정에 {#first-run-sheet}

## 핵심 네 화면 {#p2}
- [x] 오늘 머리글 숫자 셋 · ① 칼럼 꼬리 · ③ 칼럼 이어하기+완료 조건 · MiniEntry 방패 {#today-nums}
- [x] 일지 상세 「다음은」 줄 · 증거 카드 사람 확인 곁줄 · 목록 「증거 없음」 칩 {#entry-next}
- [x] 플래너 [사용자] 알약 · 「변경 로그 N행」 접힘 (plan_log 명령 · log_query.rs) {#plan-log}
- [x] 변경 일지별/파일별 토글 · 「이 일지의 검증」 바닥줄 {#diff-entry-foot}

## 뷰어·보류 화면 {#p3}
- [x] 브랜치 영수증 — 한 일 · 바깥 심판(CI 는 모름) · 릴리스 노트 초안 {#branch-judge}
- [x] 논의 옵션 격자 A/B/C · 「X 로 결정」(사유 필수 → 결론·로그 → 잠금) · 열림/결정됨 묶음 {#discussion-decide}
- [x] 스킬 간단 밀도 두 열 — 규칙 후보·규칙 / 플러그인 명령 「언제 쓰나」·스킬 {#skills-two-cols}
- [x] 터미널 결과 끝 줄 바 · ⇧⌘J · 검증 칸 받은함(수동 일지 ## 검증 미리 채움) · 에러 일지 초안 · 명령 N/실패 N {#terminal-result}
- [x] 도크 접힘 한 줄 (terminal_dock_collapsed · lastResultStore) · 분리 창 크롬 일지 N·되돌리기 · 에이전트 화면 기록 열 {#dock-collapsed}
- [x] 시작 탭 머리글 「오늘 어디서부터?」 · 사령탑 최근 일지·훅 문장·이어서 작업(resumeIntent) · 원장 숫자 셋 · 첫 실행 한 가지 행동 {#start-lead}

## 확인 날 — 눈으로 {#p4}
- [ ] [사용자] 설치본에서 설정 「표시」 스위치로 베타 행이 접히고 ⌘K 로는 열리는지 · 첫 실행 시트가 일지 0건에만 뜨는지 · 터미널 결과 끝 줄 → 수동 일지 ## 검증 미리 채움 · 도크 접힘 한 줄 · 논의 「A 로 결정」이 잠그는지 {#eyes-round3}
- [ ] 3.17.0 — 라운드 2·3 + E2E 접힘 고침, Windows·Linux 복구 (릴리스 리듬: 하루 둘째 릴리스 금지 → 사용자 말에 따라) {#release-3-17}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-28T12:32+09:00 | #display-tab | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #beta-pill | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #first-run-sheet | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #today-nums | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #entry-next | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #plan-log | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #diff-entry-foot | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #branch-judge | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #discussion-decide | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #skills-two-cols | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #terminal-result | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #dock-collapsed | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
| 2026-10-28T12:32+09:00 | #start-lead | claude-code | ☐→☑ | 20261028/Features_to_add/1232_feature_ui-density-round-3.md | 커밋 7ed07533 — PR #108 |
<!-- oculpm:plan-log end -->
