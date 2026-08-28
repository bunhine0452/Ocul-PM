---
schema_version: 1
type: feature
slug: drag-tabs-across-windows-and-panes
status: done
difficulty: high
created_at: "2026-08-28T20:05:00+09:00"
session_id: "manual-20260828-200500"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/shell/TabStrip.tsx"
    op: update
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/styles/tabs.css"
    op: update
  - path: "src/__tests__/tab_strip.test.tsx"
    op: update
  - path: "src/features/terminal/paneDrop.ts"
    op: create
  - path: "src/features/terminal/dragOps.ts"
    op: create
  - path: "src/lib/termPanes.ts"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/terminal/TerminalRail.tsx"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/term_pane_drop.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related:
  - "20260828/Features_to_add/1949_feature_terminal-visual-identity.md"
tags: [tabs, terminal, drag-and-drop, multi-window, ux]
---

[x] 끌어서 옮기기 — 탭을 창 사이로, 세션을 페인으로

## 추가 기능

떼어내기는 있는데 **되돌릴 길이 없었다.** 탭을 창 밖으로 끌면 새 창이 되지만, 그
창을 다시 합치려면 탭을 닫고 원래 창에서 다시 여는 수밖에 없었다 (프로젝트 탭은
전역 유일이라 그나마 가능했던 것이지, 설계된 길이 아니었다). 터미널도 마찬가지로
분할은 ⌘D 로만 되고, 이미 떠 있는 세션 둘을 나란히 놓을 방법은 없었다.

**① 창 탭 — 다른 창의 스트립에 떨어뜨려 합치기 (크롬과 같다)**

- 스트립 밖으로 끌면 **다른 창 위인지 먼저 본다.** 겨누는 창이 있으면 그 창의
  스트립에 세로 캐럿이 서고, 놓으면 그 자리로 들어간다. 없을 때만 새 창이 된다.
- 원래 창의 마지막 탭이어도 옮긴다 — 그 창은 닫힌다. 떼어내기가 마지막 탭을
  거부하는 것과 반대인데, 여기서는 창이 하나 줄어드는 게 사용자가 바란 결과다.
- 내주는 스트립은 더 흐려지고(0.32) 받는 스트립은 액센트 테두리를 두른다. 손을
  놓기 전에 "새 창이 뜬다" 와 "저기로 합쳐진다" 를 구분할 수 있어야 한다.

**② 터미널 — 세션을 끌어 나란히, 페인을 빼서 세션으로**

- 세션 레일의 카드를 화면 가장자리로 끌면 **그 자리에 분할되어** 두 세션이 나란히
  선다. 이미 분할된 세션을 끌어와도 그 구조가 통째로 들어온다.
- 레일 안에서 놓으면 순서 바꾸기 (지금까지 아예 없던 조작이다).
- 페인 우상단의 **손잡이(⠿)** 로 페인을 집는다 — 다른 페인 가장자리에 놓으면 자리
  바꾸기, 레일에 놓으면 독립 세션으로 빼내기(분할의 반대).
- 놓기 전에 **차지할 넓이 그대로** 미리보기 상자가 뜨고, 기준이 되는 페인에 링이
  걸린다. 상자만으로는 두 페인 사이에서 어느 쪽이 기준인지 모른다.

## 동작 흐름

**창 간 드래그는 몫을 셋으로 나눴다.** 한 쪽이 다 하려 하면 반드시 막힌다.

1. **어느 창 위인가 — Rust.** 창 기하는 Rust 만 안다. 커서는 이벤트의 `screenX` 가
   아니라 OS 에 직접 묻는다(`cursor_position`, 물리 px): 웹뷰 줌이 걸려 있어도
   흔들리지 않는 유일한 좌표계다. 창마다 그 창의 배율로 나눠 안쪽 좌표를 낸다
   (모니터별 배율이 다른 환경에서도 맞는 유일한 변환).
2. **어느 탭 사이인가 — 받는 창의 프런트.** 탭 폭은 CSS 가 정하므로(이름 길이에
   따라 96~200px) DOM 을 가진 쪽만 답을 안다. `TabDragOver` 를 받아 계산하고
   `tab_drop_hint` 로 인덱스를 되돌려 준다.
3. **이동 — Rust(`attach_tab`).** 레지스트리가 SSOT 다.

손을 놓는 순간에 ②를 물어보면 왕복 한 번이 늦으므로 드래그 **내내** 주고받아 둔다
— 놓는 순간은 레지스트리를 읽는 것으로 끝난다. 겨누기 질의는 한 번에 하나만 띄운다
(답이 온 뒤 다음 것을 보낸다): 포인터는 초당 수십 번 움직이는데 그때마다 IPC 를
걸면 왕복이 밀려 캐럿이 커서를 못 따라온다.

`move_tab` 을 따로 만든 이유는 `remove_tab`+`append` 로는 안 되기 때문이다.
인덱스를 지정해 끼워야 하고(크롬은 커서 자리에 꽂는다), 원래 창이 비어도
**프로젝트를 놓아주면 안 된다** — `close_tab` 경로를 재사용하면 그 자리에서
`release_project` 가 돌아 살아 있는 셸이 통째로 죽는다.

**터미널 쪽은 전부 프런트다.** PTY 는 sid 로만 식별되므로(창·탭과 무관) 트리를
아무리 옮겨도 셸은 죽지 않는다 — 이번 라운드에서 세션을 죽이는 코드는 한 줄도 없다.

- `paneDrop.ts` (순수) — 가장자리 판정. 네 변까지의 **비율 거리** 중 가장 가까운
  쪽을 고른다. 사분면으로 나누면 모서리 근처에서 45° 선을 따라 판정이 요동치는데,
  거리 기준은 그 선 위에서만 갈리므로 손이 떨려도 결과가 안 튄다. 가운데 40% 는
  취소이고, 취소에는 **아무것도 그리지 않는다** — 반쪽 하이라이트를 그리면 놓아도
  된다는 뜻으로 읽힌다.
- `dragOps.ts` (순수) — 탭 목록 변형 4종(순서·합치기·페인 이동·빼내기). 규칙이 서로
  물려 있어서(합치면 탭이 줄고, 빼내면 늘고, 둘 다 포커스와 활성 탭이 함께 움직인다)
  컴포넌트 안에 두면 조합을 눈으로만 확인하게 된다. 바뀔 게 없으면 **받은 상태를
  그대로** 돌려주므로 호출부가 참조 비교로 불필요한 setState 를 건너뛴다.
- `termPanes.splitPane` 은 `splitPaneWith(…, incoming, before)` 로 일반화했다.
  `incoming` 이 서브트리여도 되고 `before` 로 좌/우를 정한다 — 이 방향을 못 정하면
  왼쪽에 놓으려던 것이 늘 오른쪽에 붙는다.
- 포인터 캡처를 쓴다. 안 쓰면 커서가 xterm 캔버스 위로 들어가는 순간 터미널이
  이벤트를 삼켜 드래그가 페인 위에서 끊긴다. 대신 카드의 ×·이름 편집에
  `pointerdown` 전파 차단을 넣어야 했다 — 캡처가 걸리면 `click` 이 카드로 재조준되어
  × 를 눌러도 세션이 안 닫히고 선택만 된다.
- 캐럿은 둘 다 **절대 위치**로 띄운다. 탭/카드 사이에 끼우면 `role="tablist"` 가
  직계 자식으로 `tab` 만 요구하는 규약이 깨진다(axe `aria-required-children`).

## 검증

- Rust 단위 8건 신설 — 대상 창 인덱스 삽입, 마지막 탭 이동 시 원래 창 비움 판정
  (+ **프로젝트는 계속 열린 것으로 남는지**), 같은 창 이동 = 순서 변경, 없는 창은
  무변경, hover 전환 시 인덱스 폐기, 늦게 도착한 남의 인덱스 무시, 스트립 띠 경계
  (위로는 10px 여유 · 아래(콘텐츠)로는 없음). `cargo test` 836건 그린.
- vitest 33건 신설 — `tab_strip.test.tsx` 6건(스트립 밖에서만 질의 · 높이 동봉 ·
  다른 창이 받으면 떼어내지 않음 · 못 받으면 화면 좌표 그대로 떼어냄 · 복귀 시 캐럿
  정리 · 인덱스 계산과 중복 보고 억제), `term_pane_drop.test.ts` 27건(가장자리 띠
  경계 포함·모서리 비율 판정·상자 밖·0 나눗셈, 미리보기 상자, 변형 4종의 no-op
  조건과 포커스·활성 탭 이동).
- 전체 게이트 직접 확인 — `pnpm typecheck` / `pnpm test`(118파일 1,376건) /
  `pnpm lint`(storage·i18n) / `pnpm build` / `cargo test` 전부 exit 0.
- **남은 확인**: 창 두 개를 실제로 띄워 스트립 사이로 끌어 보는 것은 못 했다
  (`cursor_position` 과 창 기하는 실행 중인 Tauri 런타임이 있어야 한다). 판정 산술은
  순수 함수로 고정했지만 **좌표계가 실기기에서 맞는지는 눈으로 봐야 한다** — 특히
  ⌘+/- 로 앱 배율을 바꾼 상태와 배율이 다른 외부 모니터.

## 메모

같은 워킹트리에서 **다른 세션(ai-pm-86)이 터미널 시각 정체성 개편**을 동시에
진행했다. 시작 시점엔 가로 탭 줄(`.term-tabs`)에 드래그를 붙일 참이었는데, 그 줄이
세로 레일(`TerminalRail`)로 교체되는 중이었다 — 알아채고 서로 파일 담당을 교환한 뒤
레일 위에 다시 설계했다. 결과적으로 세로 목록이 더 나은 바탕이다: 카드가 넓어 잡기
쉽고, 재배열 산술(`tabDropIndex`)이 축을 모르는 순수 함수라 y 좌표로 그대로 통했다.

두 세션 모두 **커밋하지 않았다** — 인덱스를 공유하므로 남의 WIP 를 쓸어 담을 수 있다.

의도적으로 안 한 것: 터미널 세션을 **창 밖으로** 떼어내기. 분리 터미널 창은 지금
프로젝트당 하나(`term-<id>`)라 세션 단위 창을 도입하려면 그 규약부터 바꿔야 한다.
