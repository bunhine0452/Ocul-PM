---
oculpm_plan: v1
id: tab-reattach-regression
title: "떼어낸 창이 되돌아온다 — 마지막 탭을 창째로 든다"
status: active
created: 2026-08-31
updated: 2026-08-31
owner: claude-code
---

사용자 보고: "창을 분리하는 기능은 잘 되는데, 창을 다시 붙혀넣는 기능이 안돼."

`drag-and-drop-round` 는 `status: done` 이라 손대지 않는다 — 그 라운드의 회귀를
여기서 잇는다. 떼어낸 창은 탭이 **하나**인데 `begin_tear_off` 가 마지막 탭을
거절하므로, 되돌아오는 유일한 길(`drop_tear_off`)이 성립하지 못했다. 받는 창은
캐럿까지 그려 놓고 놓으면 아무 일도 없었다.

원칙 — **거절은 아무 일도 안 하는 것이 아니다.** 마지막 탭을 새 창으로 떼어내는
것은 손해가 맞지만, 그 판정이 "다시 붙이기" 까지 함께 막고 있었다. 크롬은 같은
자리에서 다른 답을 낸다: 새 창을 만들지 않고 **그 창 자체를 손에 들려 준다.**

## Phase 1 — 창째로 들기 {#p1-carry-whole}
- [x] `Registry::carry_whole` — 탭이 하나뿐인 창은 새 창을 만들지 않고 그 창 자체를 `tearing` 에 앉힌다. 이후는 평범한 `move_tab`(빈 창 정리 포함) {#carry-whole}
- [x] `TearOff.home` — 창째로 들었을 때의 원래 좌상단(논리 px). 무를 때 되돌릴 것이 탭 자리가 아니라 **창 자리**라서 필요하다 {#tear-home}
- [x] `begin_tear_off` — 창 자리를 먼저 재고 `carry_whole` 을 우선 시도, 안 되면 기존 새 창 경로. 든 직후 `follow_cursor` 로 스냅(첫 틱까지 멈춰 있으면 튄다) {#begin-carry-first}
- [x] `cancel_tear_off` — `home` 이 있으면 창 자리 복원 + `settle_tear_off`. `commit_move` 로 보내면 같은 창 안 재배열이라 **성공해 버려서**, 겨누는 동안 숨겨 둔 창이 숨은 채 남는다 {#cancel-restores-window}
- [x] 사라진 `attach_tab` 을 가리키던 주석 3곳을 `drop_tear_off` 로 — 없는 이름을 가리키는 지도가 이 회귀를 못 보게 했다 {#stale-attach-tab-docs}
- [x] Rust 4건 + vitest 1건. 깨진 동작을 고정하고 있던 `"떼어낼 수 없는 창이면(탭 하나) 아무 일도 안 한다"` 는 뜻이 바뀌어 이름을 갈았다 {#p1-tests}
- [ ] 실기기 확인 — 떼어낸 창을 끌어 원래 창 스트립에 붙이기 · Escape 로 제자리 복귀 · 겨누다 벗어나면 다시 보이기 · 배율 다른 외부 모니터 {#manual-verify-reattach}

## 결정 {#decisions}

### Decision 1 — 마지막 탭은 거절하지 않고 창째로 든다 {#d1-carry-whole}

잠금 2026-08-31 · claude-code

`begin_tear_off` 의 `order.len() <= 1` 거절은 "새 창을 만들어 봐야 손해" 라는
뜻이었고 그 자체로는 옳다. 틀린 것은 그 판정이 **놓기 경로까지 함께 막는다**는
사실을 못 본 것이다 — 2026-08-29 에 `attach_tab` 이 tear-off 로 흡수되면서
"마지막 탭이어도 옮긴다" 라는 예외가 그 커맨드와 함께 사라졌다.

답은 거절을 푸는 것이 아니라 **드는 방법을 하나 더 두는 것**이다: 창을 만들지
않고 이미 있는 창을 `tearing` 에 앉히면, `follow_cursor`·`strip_under_cursor`
(자기 창 제외)·`move_tab`·`commit_move` 가 전부 그대로 재사용된다. 크롬이 마지막
탭을 끌면 창이 끌리는 것과 같은 물건이고, 프로젝트가 다시 마운트되지도 않는다.

영향: #carry-whole #tear-home #begin-carry-first #cancel-restores-window

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | agent | 변화 | 일지 | 메모 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-31T12:08:00+09:00 | #carry-whole | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 새 창 대신 그 창을 든다 |
| 2026-08-31T12:08:00+09:00 | #tear-home | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 무르면 창 자리로 |
| 2026-08-31T12:08:00+09:00 | #begin-carry-first | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 자리를 먼저 재 둔다 |
| 2026-08-31T12:08:00+09:00 | #cancel-restores-window | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 숨은 채 남는 창 |
| 2026-08-31T12:08:00+09:00 | #stale-attach-tab-docs | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 없는 이름을 가리키던 지도 |
| 2026-08-31T12:08:00+09:00 | #p1-tests | claude-code | →☐→[x] | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 깨진 동작을 고정하던 테스트 교체 |
| 2026-08-31T12:08:00+09:00 | #manual-verify-reattach | claude-code | →☐ | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 설치본 꺼진 뒤 몰아서 |
| 2026-08-31T12:08:00+09:00 | #d1-carry-whole | claude-code | →☐ | 20260831/Bugs/1208_bug_tab-reattach-lone-window.md | 결정 잠금 |
<!-- oculpm:plan-log end -->
