---
oculpm_plan: v1
id: quality-round-20261115
title: "UI · UX · 터미널 업그레이드 라운드"
status: active
created: 2026-11-15
updated: 2026-11-15
owner: claude-code
---

Orca(소스) · 동종 앱 열한 개 · 터미널 기술 조사와 다섯 화면 · 터미널 감사(스크린샷 41장)에서 나온 백로그 83건 중 P0 · P1 60건과 사용자 결정 셋.

**완료 조건:** 백로그 P0 · P1 60건과 사용자가 고른 셋(프로젝트 색 · 확인 명령 셸 실행 · Claude 테마 파일)이 main 에 들어가 전체 게이트가 통과하고, 같은 하네스로 찍은 전후 스크린샷에서 화면마다 달라진 점이 보이며, v4.11.0 으로 나간다
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 터미널 {#terminal}
- [x] 엔진: 흐름 제어 · UTF-8 · 신호 한 모델 {#term-engine}
- [x] 입력: ⇧↩ 줄바꿈 · 붙여넣기 정화 · IME {#term-input}
- [x] 화면: 탭 · 상태 띠 · 찾기 · 레인 링크 {#term-screen}

## 화면 {#screens}
- [x] 셸: ⌘J 내 차례 · ⌘K 동사 · 두벌식 키 {#shell-nav}
- [x] 디자인 바닥: 세그먼트 · 대화상자 · 부트 {#design-base}
- [x] 오늘: 한 기둥 · 열면 서 있는 화면 {#today}
- [x] 일지 · 계획: 근거 먼저 · 키보드 흐름 {#journal-plan}
- [x] 변경 · 설정: 정확한 diff · 상태표 {#diff-settings}

## 사용자 결정 (11-15) {#decisions}
- [x] 프로젝트 색 셋을 위험 · 경고색에서 떼기 {#accent-colors}
- [x] 확인 명령을 누를 때만 셸 칸에서 {#check-in-shell}
- [x] Claude Code 테마 파일(ocul.json) {#claude-theme}

## 합류 · 출시 {#ship}
- [x] 합류 · 전체 게이트 · 전후 스크린샷 {#integrate}
- [x] v4.11.0 릴리스 {#release-411}
- [ ] [사용자] 설치본에서 눈 확인 {#eyes}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-15T07:31:46+09:00 | #design-base | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0726_feature_design-base-one-set.md | DS-01~05 합류(8d4dd373 · d6724834) — 합류 뒤 vitest 1652 passed · cargo 1202 passed 0 failed |
| 2026-11-15T07:31:51+09:00 | #term-engine | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0727_feature_terminal-engine-flow-utf8-signals.md | TE-01~08 합류(197fcae5 · 173c55a9) — 흐름 제어 · UTF-8 · 쓰기 줄 · 신호 · WebGL 회복 · 셸 인자 실행 |
| 2026-11-15T07:31:58+09:00 | #term-input | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0727_feature_terminal-input-keys-paste.md | TI-01~08 합류(c44fb982 · be50b95d · 45262d15 · 4cdb3b91) — ⇧↩ · 맥 줄 편집 · 정화기 · IME 시험표 · ⌘L |
| 2026-11-15T07:32:04+09:00 | #term-screen | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0728_feature_terminal-screen-tabs-band-find.md | TS-01~08 합류(9f6b9942 · 183967cf) — 탭 · 상태 띠 · 찾기 · 키보드 · 레인 링크 · 크롬 |
| 2026-11-15T07:32:10+09:00 | #shell-nav | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0729_feature_shell-jump-palette-korean-keys.md | NV-01~06 합류(7ab21af2 · 5beb1d8a) — ⌘J · 모달 위 전역 키 · 두벌식 · ⌘K 동작 · 프로젝트 줄 · 시작 창 |
| 2026-11-15T07:32:16+09:00 | #today | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0729_feature_today-one-column-ready-store.md | TD-01~07 합류(49af7ad8 · 4537bf86) — 한 기둥 · 숫자 한 줄 · 모듈 저장소 · 키보드 · 질문 행 |
| 2026-11-15T07:32:23+09:00 | #journal-plan | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0730_feature_journal-plan-evidence-first-keys.md | JN-01~09 합류(479af17d · 508b86bc · 438af8a8 · 8e1bf387) — 검증 상자 먼저 · 판정 네 상태 · j→v→j · 같은 뼈대 |
| 2026-11-15T07:32:30+09:00 | #diff-settings | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0731_feature_diff-exact-settings-status.md | DF-01~07 · ST-01 합류(fa4bec16 … ed7c3827) — 위치 파서 · 바뀐 단어 · 봤음 · 잘림을 숫자로 · 설정 상태표 |
| 2026-11-15T07:32:40+09:00 | #integrate | claude-code | ☐→~ |  | 레인 여덟 커밋 25개 일직선 합류 + 이음 고침(28077f31). 후속 넷(이음 · 프로젝트 색 · 확인 명령 · Claude 테마) 진행 중 |
| 2026-11-15T08:26:15+09:00 | #accent-colors | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0825_feature_accent-colors-off-danger.md | e69fbd7f — 분홍 · 주황 · 앰버 강조색을 의미색과 ΔE 0.09 이상, accent_distinct 시험 |
| 2026-11-15T08:26:21+09:00 | #check-in-shell | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0825_feature_plan-check-in-shell.md | 5680088c — 확인 창 뒤에만 새 셸의 명령 인자로, 한 줄 · 정화, 판정은 Claude 몫 |
| 2026-11-15T08:26:27+09:00 | #claude-theme | claude-code | ☐→x | .oculpm/journal/20261115/Features_to_add/0825_feature_claude-code-theme-file.md | 013544ea · 40c3bfa7 — ~/.claude 가 있을 때만 원자적으로 ocul.json, settings.json 무변경, 설정 줄 + 끄기 |
| 2026-11-15T11:34:44+09:00 | #integrate | claude-code | ~→x | .oculpm/journal/20261115/Bugs/1134_bug_launch-line-ctrl-c-hidden-chars.md | 판정 ✓ cargo test 1227 passed 0 failed · pnpm test 1968 passed · typecheck/lint/build/clippy/fmt exit 0 · 최종 검수 major 8 고침 · 설치본 눈 확인은 안 함 · mac |
| 2026-11-15T12:41:13+09:00 | #release-411 | claude-code | ☐→~ |  | PR #176 머지(9e658492) → E2E 언어 선택자 고침(a837e41e) → 릴리스 커밋 a0f803c9 (CI · E2E 초록) → 태그 v4.11.0, release run 43673415294 진행 중 |
| 2026-11-15T17:14:12+09:00 | #release-411 | claude-code | ~→x | .oculpm/journal/20261115/Chores/1714_chore_release-v4-11-0.md | 판정 ✓ release run 43673415294 success · 설치본 E2E win/linux 통과 · Latest v4.11.0 · mac |
<!-- oculpm:plan-log end -->
