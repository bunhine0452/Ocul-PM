---
oculpm_plan: v1
id: narrow-window-20261030
title: "좁은 창 — 맥북 프로 14 의 3분의 1 까지 · 계획 화면 경계"
status: active
created: 2026-10-30
updated: 2026-10-30
owner: claude-code
---

**완료 조건:** 창을 맥북 프로 14 화면의 3분의 1(약 500pt)까지 줄일 수 있고, 그 폭에서 다섯 화면 · 설정 · 시작 창이 가로로 넘치지 않으며 목록과 본문이 한 번에 하나씩 또는 위아래로 선다. 계획 화면은 단계마다 경계가 보이는 카드이고 항목 사이가 나뉘며, 「보내기」 가 항목 줄 안에 선다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 계획 화면 {#plan}
- [x] 계획 화면 경계 — 단계마다 카드(머리 · 테두리), 항목 사이 구분선, 「보내기」 를 항목 줄 안으로 {#plan-bounds}

## 좁은 창 {#narrow}
- [x] 창 최소 크기를 480 폭으로(tauri.conf · WINDOW_MIN_W) {#min-size}
- [x] 윗줄 — 좁으면 탭 · 화면 동작을 아이콘으로, 넘치지 않게 {#topbar}
- [x] 목록+본문 화면(일지 · 계획 · 변경) — 좁으면 위아래 또는 하나씩 {#split-screens}
- [x] 오늘 · 터미널 · 설정 · 시작 창을 504 폭에서 점검(가로 넘침 0) {#rest-check}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-30T22:59:32+09:00 | #plan-bounds | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2259_feature_plan-phase-cards.md |  |
| 2026-10-30T22:59:37+09:00 | #min-size | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2259_feature_narrow-window-480.md |  |
| 2026-10-30T22:59:42+09:00 | #topbar | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2259_feature_narrow-window-480.md |  |
| 2026-10-30T22:59:47+09:00 | #split-screens | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2259_feature_narrow-window-480.md |  |
| 2026-10-30T22:59:51+09:00 | #rest-check | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2259_feature_narrow-window-480.md |  |
| 2026-10-30T23:42:51+09:00 | #rest-check | claude-code | x→x |  |  |
| 2026-10-31T00:18:03+09:00 | #topbar | claude-code | x→x | .oculpm/journal/20261031/Bugs/0017_bug_narrow-topbar-actions-menu.md | 판정 ✓ Tests 973 passed · rust passed 1167 failed 0 — 레드팀 반례(동작 칸 29px · 384 에서 찾기 · 설정 창 밖) → ⋯ 메뉴 · ≤460 줄임, 윗줄 칸 창 밖 0(640~384) |
<!-- oculpm:plan-log end -->
