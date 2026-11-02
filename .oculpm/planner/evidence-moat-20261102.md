---
oculpm_plan: v1
id: evidence-moat-20261102
title: "증거로 대체 불가 — 판정 · 영수증 · 터미널"
status: active
created: 2026-11-02
updated: 2026-11-02
owner: claude-code
---

Orca·claude-mem 이 못 하는 자리(확인 명령 결과로 믿음을 판정하고 증거를 git 에 남김)를 깊게 판다. 사용자 결정 11-02: 1번부터, 나머지도, 독보적 디자인까지.

**완료 조건:** 오늘 화면이 낡은 ✓ 를 짚고, 에이전트가 최근 버그를 고친 파일을 다시 고치기 직전 그 버그와 확인 명령을 듣고, 변경 화면에서 PR 에 붙일 영수증을 한 번에 복사하고, 동료(git 으로 받은) 기록의 예외도 오늘에 서고, 터미널에서 찾기 · 칸 이동 · 일지 없이 끝난 세션이 보이며, 판정이 앱 전체에서 한 시각 언어(도장)로 읽힌다 — 바깥 호스트 0 · LLM 0 그대로
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 증거 {#evidence}
- [x] 판정 뒤 바뀜 — ✓ 뒤 저장된 파일을 오늘에 {#stale-verdict}
- [x] 재수정 경고 — 최근 버그 파일을 고치기 직전 훅 {#refix-warn}
- [x] PR 영수증 — 변경 화면에서 마크다운 복사 {#pr-receipt}
- [x] 동료 기록 — git 으로 받은 일지의 예외 {#team-exceptions}

## 터미널 {#terminal}
- [x] 터미널 찾기 ⌘F {#term-find}
- [x] 칸 사이 이동 단축키 {#pane-nav}
- [x] 일지 없이 끝난 세션 표시 {#term-no-record}

## 디자인 {#design}
- [ ] 판정 도장 — 앱 전체 한 시각 언어 {#signature-design}
- [ ] [사용자] 설치본에서 칸 나누기 · 신호등 · 도장 눈 확인 {#eyes}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-02T17:49:41+09:00 | #stale-verdict | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1749_feature_today-stale-verdict.md | 판정 ✓ pnpm test 993 passed · cargo test 1067 passed · typecheck/lint/build 0 |
| 2026-11-02T17:56:17+09:00 | #refix-warn | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1756_feature_plugin-refix-warning-hook.md | 판정 ✓ cargo test 1070 passed · pnpm test 993 passed · fmt/clippy/typecheck/lint/build 0 |
| 2026-11-02T18:02:16+09:00 | #pr-receipt | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1802_feature_diff-pr-receipt-copy.md | 판정 ✓ pnpm test 995 passed ×3 · cargo test 1072 passed · fmt/clippy/typecheck/lint/build 0 |
| 2026-11-02T18:06:18+09:00 | #team-exceptions | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1810_feature_today-teammate-journals.md | 판정 ✓ pnpm test 996 passed ×2 · cargo test 1074 passed · fmt/clippy/typecheck/lint/build 0 |
| 2026-11-02T18:06:25+09:00 | #team-exceptions | claude-code | x→x | .oculpm/journal/20261102/Features_to_add/1806_feature_today-teammate-journals.md | 일지 경로 바로잡음 — 바로 위 행의 1810_… 은 잘못 적은 경로, 실제는 1806_… |
| 2026-11-02T18:08:55+09:00 | #term-find | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1813_feature_terminal-find.md | 판정 ✓ pnpm test 997 passed ×2 · typecheck/lint/build 0 (Rust 무변경) |
| 2026-11-02T18:08:59+09:00 | #term-find | claude-code | x→x | .oculpm/journal/20261102/Features_to_add/1808_feature_terminal-find.md | 일지 경로 바로잡음 — 바로 위 행의 1813_… 은 잘못 적은 경로, 실제는 1808_… |
| 2026-11-02T18:10:55+09:00 | #pane-nav | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1810_feature_terminal-pane-move-keys.md | 판정 ✓ pnpm test 999 passed ×2 · typecheck/lint/build 0 (Rust 무변경) |
| 2026-11-02T18:12:40+09:00 | #term-no-record | claude-code | ☐→x | .oculpm/journal/20261102/Features_to_add/1812_feature_terminal-ended-without-record.md | 판정 ✓ pnpm test 1000 passed ×2 · typecheck/lint/build 0 (Rust 무변경) |
<!-- oculpm:plan-log end -->
