---
oculpm_plan: v1
id: direction-20261102
title: "방향 정리 — 4주 동결 · 영수증 · 플러그인 입구"
status: active
created: 2026-11-02
updated: 2026-11-02
owner: claude-code
---

외부 평가(ai-pm-f4 세션, 11-02)를 원재료로 다시 잰 뒤 사용자가 고른 네 결정(4주 기능 동결 · 약속 9 를 월 1회 확인 날로 · 첫 문장을 영수증으로 · 입구는 플러그인). 실측: 재수정 7일 51%(127/247), 10월 버그 비중 38%, 30일 릴리스 24개, 스타 7 · 이슈 0 · 외부 PR 0, 14일 순방문 8명, 릴리스당 설치 파일 한 자릿수, 증거 비율 84%.

**완료 조건:** 2026-11-30 까지 feat 커밋 0 · 릴리스 주 1회 이하(결함 패치만), 눈 확인 받은함 0 이고 약속 9 가 「월 1회 확인 날」로 고쳐져 지켜지며, README · 랜딩의 첫 문장이 「에이전트가 한 일을 명령의 출력으로 믿게 하는 영수증」이고 첫 행동이 플러그인 두 줄이며, 11-30 재측정(재수정률 · 증거 비율 · 방문자 · 3명 관찰 결과)이 PROMISE 측정 표에 적힌다
**확인 명령:** python3 docs/launch/agent-report-card.py

## 고칠 것 {#act}
- [~] 4주 기능 동결(~11-30) · 패치 주 1회 이하 {#freeze}
- [x] 약속 9 → 월 1회 확인 날 (PROMISE · RELEASE · bump-version) {#promise-9}
- [x] 첫 문장을 영수증으로 (README ko/en · 랜딩 ko/en) {#position}
- [x] 첫 행동을 플러그인 두 줄로, 앱은 두 번째 {#entry-plugin}
- [ ] 바깥 문구에서 내부 용어(판정 등) 걷기 {#jargon}

## 사람 몫 {#human}
- [ ] [사용자] 눈 확인 25건 이번 주 몰아 닫거나 걷기 {#eyes-batch}
- [ ] [사용자] 한국 개발자 3명 관찰 (polish-round #observe-three-users) {#observe-three}

## 재측정 {#measure}
- [ ] 11-30 재측정 → PROMISE 측정 표 {#remeasure-1130}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-02T19:03:00+09:00 | #position | claude-code | ☐→x | .oculpm/journal/20261102/Chores/1902_chore_receipt-positioning-plugin-entry.md | 헤드라인 「「다 됐습니다」 대신, 영수증을 받으세요.」(사용자 선택) — 랜딩 ko/en · README ko/en · 배너/og 이미지 |
| 2026-11-02T19:03:05+09:00 | #entry-plugin | claude-code | ☐→x | .oculpm/journal/20261102/Chores/1902_chore_receipt-positioning-plugin-entry.md | 히어로 · 마지막 칸 주 동작 = 플러그인 두 줄(.cmd.is-primary), 내려받기 보조, README 소개 아래 두 줄 블록 |
| 2026-11-02T20:15:42+09:00 | #freeze | claude-code | ☐→~ |  | 동결 진행 중. 예외 1건(11-02, ai-pm-f4 세션이 전한 사용자 결정): VS Code 확장 재개발(.oculpm 읽기 전용 · 마켓+Open VSX) — 걷을 표면 대신 규칙 예외로 기록. 「VS Code 로 열기」 수정은 결함 수정이라 동결 대상 아님. 그 밖 feat 는 여전히 동결 |
| 2026-11-02T20:44:30+09:00 | #freeze | claude-code | ~→~ |  | 예외 2건째(11-02, ai-pm-f4 세션이 전한 사용자 결정): 「기다림 신호 묶음」 — ⌘O 목록 · ⌥⌘ 번호 줄 프로젝트별 예외 점 + 급한 순, 창 제목 「· 기다림 N」, Dock 배지. 새 화면 없음. 동결 첫날 예외 2건 — 11-30 재측정에서 예외로 넣은 것도 따로 센다 |
| 2026-11-02T22:00:15+09:00 | #freeze | claude-code | ~→~ |  | 사용자 결정(11-02, 이 세션에서 직접): 예외는 VS Code 확장 · 기다림 신호 묶음 이 둘로 닫는다 — 이후 새 기능 요청은 11-30 재측정 뒤로. v4.3.1(ai-pm-f4 세션, 오늘 둘째 릴리스)에 zip · pulldown-cmark 공지 수정이 실렸다 |
| 2026-11-02T22:06:42+09:00 | #promise-9 | claude-code | ☐→x | .oculpm/journal/20261102/Chores/2206_chore_promise-9-monthly-check-day.md | 판정 ✓ pnpm test 1009 passed · bump_version 11 passed · dry-run 경고 확인 · typecheck/lint/build 0 |
| 2026-11-02T22:22:05+09:00 | #freeze | claude-code | ~→~ | .oculpm/journal/20261102/Features_to_add/2216_feature_project-menu-open-in-editor.md | 사용자 결정(11-02, 이 세션 직접 「진짜 찐막」): 예외 3건째 = 프로젝트 ▾ 메뉴 「VS Code 에서 열기」, v4.3.2 로 냄. 이것으로 예외 끝 — 이후 새 기능은 11-30 재측정 뒤. 오늘 셋째 릴리스 |
<!-- oculpm:plan-log end -->
