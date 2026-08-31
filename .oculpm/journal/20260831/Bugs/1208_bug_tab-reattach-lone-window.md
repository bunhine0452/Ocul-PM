---
schema_version: 1
type: bug
slug: tab-reattach-lone-window
status: done
created_at: 2026-08-31T12:08:00+09:00
session_id: "manual-20260831-120800"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src/features/shell/TabStrip.tsx
    op: update
  - path: src/__tests__/tab_strip.test.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: .oculpm/planner/tab-reattach-regression.md
    op: create
related:
  - 20260829/Features_to_add/1949_feature_chrome-tear-off-real-window.md
  - 20260828/Features_to_add/2005_feature_drag-tabs-across-windows-and-panes.md
tags: [tabs, drag, tear-off, regression, window]
---

[x] 떼어낸 창을 드래그로 다시 붙일 수 없었다 — 마지막 탭 거절이 놓기 경로까지 막았다

## 발생 원인

사용자 보고: "창을 분리하는 기능은 잘 되는데, 창을 다시 붙혀넣는 기능이 안돼."

떼어낸 창은 탭이 **하나**다. 그런데 `begin_tear_off` 가 `st.order.len() <= 1` 로 거절한다. 크롬식 재부착은 `Registry.tearing`(손에 든 창)이 서 있을 때만 성립하도록 짜여 있고 — 마무리인 `drop_tear_off` 의 첫 줄이 `take_tearing()` 이고 없으면 곧장 `Ok(false)` — 탭 하나짜리 창은 그 상태에 **진입 자체를 못 한다.** 프런트는 `if (state.detaching) { onDragCleanup(); return; }` 로 떨어지는데, `tab_drag_end` 는 `unhover()` 로 겨누던 자리를 버리기만 한다. 이동을 부르는 곳이 아예 없었다.

증상이 "안 되는 기능" 이 아니라 "고장" 으로 읽힌 이유는 따로 있다. `tab_drag_over` 는 `tearing` 유무와 무관하게 히트테스트를 하고 `TabDragOver` 를 쏜다 — 받는 창은 캐럿을 그리고 자리까지 벌렸다. 놓을 수 있다고 화면이 약속한 뒤에 아무 일도 안 일어났다.

회귀 지점은 `5e2ebc1`(2026-08-29). 그전에는 `attach_tab` 이 있었고 주석이 이 케이스를 명시했다 — "원래 창의 **마지막** 탭이어도 옮긴다(그 창은 닫힌다). 떼어내기가 마지막 탭을 거부하는 것과 다른데, 여기서는 창이 하나 줄어드는 것이 사용자가 바란 결과이기 때문이다." 그 커맨드가 tear-off 로 흡수되면서 예외가 함께 사라졌다. `src/__tests__/tab_strip.test.tsx` 의 `"떼어낼 수 없는 창이면(탭 하나) 아무 일도 안 한다"` 가 깨진 동작을 그대로 고정하고 있어 CI 는 초록이었고, 플래너의 실기기 확인 항목은 미체크였다.

## 해결 방법

거절을 푸는 대신 **드는 방법을 하나 더** 뒀다 (크롬: 마지막 탭을 끌면 창이 끌린다).

- `Registry::carry_whole` — 탭이 하나뿐인 창은 새 창을 만들지 않고 그 창 자체를 `tearing` 에 앉힌다(`label == source`). 이후는 기존 경로 그대로다: `follow_cursor` 가 그 창을 옮기고, `strip_under_cursor` 는 자기 창을 제외하며, `move_tab` 이 원래 창을 비우고 `commit_move` 가 닫는다. 새 창을 만들지 않으니 프로젝트가 다시 마운트되지도 않는다.
- `TearOff.home` — 창째로 들었을 때의 원래 좌상단(논리 px). 무를 때 되돌릴 것이 탭 자리가 아니라 **창 자리**다.
- `cancel_tear_off` — `home` 이 있으면 창 자리를 복원하고 `settle_tear_off`. 여기서 `commit_move` 로 보내면 같은 창 안 재배열이라 **성공해 버려서**, 겨누는 동안 숨겨 둔 창(합치기 미리보기)이 숨은 채로 남는다.
- `begin_tear_off` — 창 자리를 **먼저** 재고(옮기기 시작하면 두 번 다시 알 수 없다) `carry_whole` 을 우선 시도, 든 직후 `follow_cursor` 로 스냅한다. 남은 `order.len() <= 1` 가드는 "웹뷰 자리를 못 읽었다" 는 뜻으로 의미가 바뀌었다.
- 사라진 `attach_tab` 을 가리키던 주석 3곳을 `drop_tear_off` 로 고쳤다 — 없는 이름을 가리키는 지도가 이 회귀를 못 보게 했다.

## 검증

`cargo test` 전량 그린(신규 4건: 창째로 듦·형제 있으면 거절·모르는 탭 거절·되붙이면 창이 사라짐), `cargo fmt`·`cargo clippy --all-targets -D warnings` 0. 프런트 `pnpm typecheck`/`lint`/`test`(1494) 그린 — 깨진 동작을 고정하던 테스트는 뜻을 갈아 `"손에 들지 못했으면 아무 일도 안 한다"` 로 바꾸고, `"탭이 하나뿐인 창도 떼어내기를 물어본다"` 를 새로 세웠다.

실기기 확인은 아직이다(`#manual-verify-reattach`) — 설치본이 도는 동안 dev 빌드를 띄우면 app-data·SQLite·`.oculpm` 락을 다툰다. 앱이 꺼진 뒤 몰아서 본다.

## 메모

`?tearoff=1` 마운트 보류는 창째로 들 때는 해당이 없다 — 이미 마운트된 창이라 붙잡을 것이 없다. `TearOffSettled` 를 받아도 `held` 는 원래 false 라 무해하다.
