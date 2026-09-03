---
schema_version: 1
type: feature
slug: "code-tree-pointer-drag-and-plan-hovercard"
status: done
difficulty: high
created_at: "2026-09-04T07:44:50+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/useTreeDrag.tsx"
    op: create
  - path: "src/features/code/treeDom.ts"
    op: create
  - path: "src/features/code/treeMenu.ts"
    op: create
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/useCodeImport.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/planner/PlanHoverCard.tsx"
    op: create
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_tree_drag.test.tsx"
    op: create
  - path: "src/__tests__/plan_hover_card.test.tsx"
    op: create
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
  - path: "src/__tests__/code_import.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "docs/20260904_ux-candidates/00-candidates.md"
    op: create
related: []
tags:
  - "code"
  - "planner"
  - "dnd"
  - "a11y"
  - "mcp-tool"
---
[x] 트리에서 폴더를 손으로 옮긴다 — HTML5 드래그를 포인터 몸짓으로 갈아엎고, 레일 행에 카드를 얹었다

## 추가 기능

**1. 코드 트리 드래그 이동 (폴더 안으로 넣고, 밖으로 꺼내기)**

코드에는 이미 `draggable` + `dataTransfer` 배선이 있었고 배선 자체는 멀쩡했다.
그런데 실제 WKWebView 에서는 **드래그가 시작되지 않는다** — 트리 행이
`<button>` 이라 WebKit 이 네이티브 드래그 세션을 열어 주지 않는다. 창 탭 줄
(`TabStrip`)이 이미 같은 이유로 HTML5 드래그를 버리고 포인터 이벤트로 옮겨
갔었고(2026-08 PTY/탭 라운드), 트리도 같은 길로 통일했다.

- `useTreeDrag.tsx` — pointerdown/move/up 으로 모는 몸짓. 문턱 4px 을 넘어야
  드래그이고, 그 전에는 그냥 클릭이다.
- `treeDom.ts` — 좌표→행 (`elementFromPoint`). OS 드롭(`useCodeImport`)과 트리 안
  드래그가 **같은 표식**(`data-tree-path`)을 나눠 쓰므로 한 자리로 모았다.
- `treeMenu.ts` — 우클릭 차림표를 화면에서 떼어냈다. 파일 크기 래칫이
  `CodeScreenV2.tsx`(1525줄)를 한 줄도 못 늘리게 막고 있어, 배선을 넣을 자리를
  먼저 만들어야 했다.

포인터로 직접 모니 `dataTransfer` 로는 못 하던 것이 따라왔다:

- **유령이 커서를 따라간다** — 손에 무엇이 들렸는지 보인다.
- **스프링 로드** — 접힌 폴더 위에 0.55초 머물면 열린다. 이게 없으면 *폴더 안의
  폴더 안*으로는 옮길 방법이 아예 없었다 (Finder 와 같은 동작).
- **가장자리 자동 스크롤** — 화면 밖 폴더로도 옮겨진다.
- **놓을 수 없는 자리는 강조하지 않는다** — 자기 자신·자기 후손·제자리.
  `moveTarget` 이 이미 알고 있던 판정을 드롭 순간이 아니라 **드래그 내내** 쓴다.

**2. 계획 레일 행의 호버 카드 (`PlanHoverCard`)**

레일 폭이 170~460px 이라 제목이 거의 항상 잘린다. 카드가 되돌려 주는 것은 잘린
제목 전문 + 행에 자리가 없어 버렸던 사실들: 상태 배지·진행 바·남은 항목·
마지막 활동의 **절대 시각**·작성자·계획 id. 네이티브 `title` 은 걷어냈다 (지연이
1초 넘고 줄바꿈·진행 바를 못 그린다). 월 섹션 라벨("완료 · 2026.07")도 잘리므로
거기에는 `title` 을 남겼다.

## 동작 흐름

- **클릭 삼키기** — 드래그로 끝난 몸짓의 `click` 을 `onClickCapture` 가 한 번
  먹는다. 없으면 놓는 순간 그 행이 열리거나(파일) 접힌다(폴더).
- **`dropDir` 를 하나로** — Finder 드롭과 트리 안 이동이 같은 prop 을 쓴다.
  사용자에게는 둘 다 "여기에 들어간다" 는 같은 사실이고, 동시에 일어나지 않는다.
- **포인터 캡처 대신 창 구독** — 스프링 로드가 트리를 다시 그려 잡았던 행이
  갈릴 수 있다. Escape·pointercancel 로 취소된다.
- **카드는 body 로 포털** — `.pln-body` 가 `container-type: inline-size` 라 그
  안에서는 `position: fixed` 조차 뷰포트가 아니라 컨테이너 기준이 된다.
- `-webkit-user-drag: none` 을 행에 건다 — 글자가 잡혀 WebKit 이 자기 드래그를
  열면 우리 pointermove 사슬이 `pointercancel` 로 끊긴다 (`.tabstrip-tab` 과 같은 짝).

## 검증

- `pnpm typecheck` / `pnpm test` (164파일 2139 통과, 신규 13) / `pnpm lint`
  (5게이트) / `pnpm build` 전부 exit 0.
- 신규 `code_tree_drag.test.tsx` 8건 — 폴더→폴더, 트리 배경→루트(꺼내기),
  자기 자신 거부, 문턱 미만은 클릭, 드래그 뒤 클릭 삼킴, 스프링 로드.
- 신규 `plan_hover_card.test.tsx` 5건 — 카드 내용·상대/절대 시각·지연·닫힘·
  네이티브 title 부재.
- **실기기 육안 확인은 아직**. jsdom 은 WKWebView 의 드래그 시작 여부를 못 본다 —
  이번 변경의 전제(포인터는 되고 네이티브는 안 된다)가 정확히 그 축이다.

## 메모

- 같은 시각 **병렬 세션이 같은 버그를 CSS 한 줄(`-webkit-user-drag: element`)로
  고치고 있었다.** 사용자가 포인터 방식으로 통일하기로 결정해 그쪽 변경은
  물러났다. 두 방식은 공존할 수 없다 — 네이티브 드래그가 살아 있으면 포인터
  몸짓을 `pointercancel` 로 끊는다.
- 후속 조사는 `docs/20260904_ux-candidates/00-candidates.md` 에. 가장 급한 것은
  **이동 되돌리기 토스트**(드래그는 손이 미끄러지는 입력이다)와 **다중 선택**,
  그리고 트리 **키보드 이동**(드래그를 못 쓰면 이동 기능이 없는 것과 같다).
- 플래너 `PlanEditOp` 에 `move_item` 이 없다는 것을 조사 중에 확인했다 — 단계는
  올리고 내릴 수 있는데 항목은 만든 자리에 묶여 있다.