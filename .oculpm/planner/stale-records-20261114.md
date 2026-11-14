---
oculpm_plan: v1
id: stale-records-20261114
title: "쌓인 일지·계획 — 지우지 않고 접는다"
status: active
created: 2026-11-14
updated: 2026-11-14
owner: claude-code
---

일지 1,030건 가운데 41%가 건드린 파일의 절반 이상이 사라진 것이고(11-14 실측), 진행 계획 12개 중 3개는 남은 항목이 없다. 낡음은 파일이 있는가로 기계가 판정한다(LLM 0 · git 0).

**완료 조건:** 에이전트의 일지 검색이 건드린 파일이 지금 하나도 없는 일지를 뒤로 보내고 남은 파일 수를 말하며, 오늘 화면이 닫을 수 있는 계획을 한 줄로 말하고, 일지 화면이 사라진 코드의 일지를 한 줄로 접는다. 일지·계획 파일은 하나도 지우지 않는다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 에이전트가 읽는 쪽 {#agent}
- [x] 일지 검색에 남은 파일 칸, 사라진 것은 뒤로 {#search-alive}

## 사람이 보는 쪽 {#human}
- [x] 오늘에 닫을 수 있는 계획 한 줄 {#closable-plans}
- [x] 일지 화면에서 사라진 코드의 일지 접기 {#fold-gone}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-14T17:04:33+09:00 | #search-alive | claude-code | ☐→~ |  | 잡음 |
| 2026-11-14T17:11:38+09:00 | #search-alive | claude-code | ~→x | .oculpm/journal/20261114/Features_to_add/1711_feature_search-alive-files.md | 판정 ✓ pnpm test 1109 passed · cargo test 1162 passed 0 failed · typecheck/lint/build/clippy/fmt exit 0 · 설치본 눈 확인은 안 함 · mac |
| 2026-11-14T17:16:40+09:00 | #fold-gone | claude-code | ☐→x | .oculpm/journal/20261114/Features_to_add/1716_feature_journal-fold-gone.md | 판정 ✓ pnpm test 1113 passed · cargo test 1163 passed 0 failed · typecheck/lint/build/clippy/fmt exit 0 · 설치본 눈 확인은 안 함 · mac |
| 2026-11-14T17:16:55+09:00 | #closable-plans | claude-code | ☐→! |  | 사용자 결정 필요(11-14) — 계획을 닫는 동작이 앱에도 MCP 에도 없다(4.0 에서 「완료·잠금」 토글을 걷음). 계획 화면에 닫기 단추를 되살릴지, Claude 도구(plan_close)로 줄지, 둘 다일지 정해야 줄을 세울 수 있다 |
| 2026-11-14T17:18:24+09:00 | #closable-plans | claude-code | !→~ |  | 사용자 결정(11-14 「네 권장대로 갈게」) — 계획 화면에 닫기 단추(남은 항목 0일 때만) + 오늘 한 줄 |
| 2026-11-14T17:26:46+09:00 | #closable-plans | claude-code | ~→x | .oculpm/journal/20261114/Features_to_add/1726_feature_plan-close-button.md | 판정 ✓ pnpm test 1117 passed · cargo test 1168 passed 0 failed · typecheck/lint/build/clippy/fmt exit 0 · 설치본 눈 확인은 안 함 · mac |
<!-- oculpm:plan-log end -->
