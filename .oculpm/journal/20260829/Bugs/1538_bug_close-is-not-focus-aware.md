---
schema_version: 1
type: bug
slug: close-is-not-focus-aware
status: done
created_at: 2026-08-29T15:38:00+09:00
session_id: manual-20260829-153800
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/lib/closeIntent.ts
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/close_intent.test.ts
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - 20260829/Bugs/1537_bug_native-drag-hijacks-tab-drag.md
tags: [tabs, terminal, shortcuts, focus, silent-failure]
---

[x] ⌘W 가 포커스를 안 봤고, 닫기 실패는 아무 말 없이 사라졌다

## 발생 원인

사용자 요청: "프로젝트 탭을 클릭하고 ⌘W 시 프로젝트 탭이 닫힘. 터미널을
작업중일 땐 터미널 닫힘. 이런 UX를 구현해줘. 포커싱 말이야."
그리고 보고: "창 분리 후 프로젝트 닫으려고 x 버튼 눌러도 분리된 창은 안 닫힘."

### ⌘W — 터미널이 사슬에 없었다

⌘W 는 "안쪽부터 닫기" 사슬(`lib/closeIntent`)로 처리된다. Rust 메뉴가 직접
닫지 않고 `CloseIntent` 를 쏘면, 프런트가 등록된 처리기에게 안쪽부터 물어보고
아무도 안 받을 때 탭을 닫는 구조다. 등록한 곳은 둘뿐이었다 — 코드 화면(파일
탭)과 ACP 대화(세션 탭). **터미널은 없었다.**

터미널에는 ⌘W 가 `keydown` 리스너로 달려 있었는데, macOS 에서 ⌘W 는 앱 메뉴의
accelerator 라 **OS 가 먼저 먹고 웹뷰에는 keydown 이 오지 않는다**. 그 분기는
한 번도 돌지 않았고, 터미널에 타이핑하다 ⌘W 를 누르면 프로젝트 탭이 닫혔다.

사슬을 등록 순서(LIFO)로만 도는 것도 문제였다. 터미널 도크는 다른 화면 **위에
얹혀** 있어서, "가장 나중에 등록된 것" 이 사용자가 지금 보고 있는 것과 무관하다.

### 닫기 실패가 조용했다

`close_tab_inner` 은 마지막 탭이면 창을 닫는데, 그 두 줄이 실패를 통째로
삼켰다: 창을 못 찾으면 `if let Some(win)` 이 조용히 지나가고, 닫기가 실패하면
`let _ = win.close()` 가 삼킨다. 프런트도 `void commands.closeTab(id)` 로 결과
봉투를 버려 — 이웃인 `onDetach`·`onOpenProject` 는 `status === "error"` 를 보고
토스트를 띄우는데 이 자리만 안 봤다.

실패하는 모양이 하필 **"탭은 사라졌는데 창이 남는다"** 라서, 화면에는 아무 말도
없이 닫기 버튼이 안 먹는 것처럼 보인다. 되돌릴 수도 없다 — 레지스트리에서 탭은
이미 빠져나갔다.

## 해결 방법

**사슬에 포커스 우선권을 넣었다.** `registerCloseHandler(handler, scope?)` —
`scope` 를 준 등록은 그 안에 포커스가 있을 때 순서를 건너뛰고 먼저 답한다.
`runCloseIntent` 는 두 바퀴를 돈다: ① 지금 포커스를 품은 등록, ② 나머지. 둘 다
나중에 등록된 것부터다. `scope` 없는 기존 등록만 있으면 ②만 도므로 **예전 동작
그대로**다 (코드 화면·ACP 는 손대지 않았다).

**터미널을 사슬에 등록했다** — scope 는 자기 루트. 포커스가 터미널 안이면
`closeFocusedPane()`(마지막 페인이면 세션까지)을 하고 `true`, 아니면 `false` 로
뒤 화면에 넘긴다. 돌지 않던 ⌘W keydown 분기는 걷어냈다 — 남겨 두면 언젠가
두 번 닫는 길이 된다.

**닫기 실패를 드러냈다.** Rust 는 창을 못 찾거나 `close()` 가 실패하면
`tracing::error!` 로 남기고 `Err` 를 돌려준다. 프런트는 `closeTab` 헬퍼로
모아 실패 시 토스트를 띄운다 (⌘W 경로와 × 버튼 경로 둘 다).

## 검증

- `pnpm typecheck` · `pnpm test`(1428건, 신규 4건) · `pnpm lint` · `pnpm build` ·
  `cargo test` 전부 exit 0.
- 신규 vitest 4건 — 포커스를 품은 쪽이 나중 등록을 이기고, 포커스가 밖이면
  예전 순서 그대로이며, 포커스를 품었어도 `false` 면 다음으로 넘어가고,
  scope 가 사라진 등록(언마운트)은 우선권을 잃는다.
- 신규 Rust 1건 — 떼어낸 창의 탭을 닫으면 그 창이 비었다고 보고하는지
  (`closing_the_tab_of_a_detached_window_empties_that_window`).

## 메모

**× 버튼 증상의 근본 원인은 아직 못 잡았다.** 레지스트리는 정상이었다 —
떼어낸 창의 탭을 닫으면 `emptied=true` 가 나오고 창이 제거되며, 다른 창이 남아
있어 `prevent_close` 도 안 걸린다. 커맨드 등록·창 라벨 판정(`is_app_window`)·
capability(`win-*`)도 모두 정상. 로그(`oculpm.log`)에도 `win-1`·`win-2` 가
정상 마운트된 기록만 있고 닫기 흔적이 없었다.

그래서 이번에 한 일은 **다음 재현을 진단 가능하게** 만든 것이다: 실패하면
로그와 토스트 양쪽에 남는다. 재현되면 어느 갈래인지(창을 못 찾는가 / `close()`
가 거부되는가 / 애초에 커맨드가 안 불리는가) 그 자리에서 갈린다.
