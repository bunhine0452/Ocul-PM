---
schema_version: 1
type: feature
slug: "tree-keyboard-nav-and-cut-paste"
status: done
difficulty: high
created_at: "2026-09-04T08:52:21+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/treeKeys.ts"
    op: create
  - path: "src/features/code/useTreeKeys.ts"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/treeMenu.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_tree_keys.test.ts"
    op: create
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
  - path: "src/__tests__/code_tree_drag.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "docs/20260904_ux-candidates/00-candidates.md"
    op: update
related: []
tags:
  - "code"
  - "a11y"
  - "keyboard"
  - "mcp-tool"
---
[x] 트리를 손 없이 다닌다 — 화살표 이동·로빙 tabindex 와 ⌘X→⌘V 옮기기

## 추가 기능

`docs/20260904_ux-candidates/00-candidates.md` 의 P0 3·4. 이로써 P0 네 항목이 전부 끝났다.

**1. 트리 키보드 이동**

트리는 `role="tree"` / `role="treeitem"` 을 쓰면서 화살표가 없었다. 규약을 절반만
지킨 것도 문제지만 실질적인 손해는 따로 있다 — **드래그를 못 쓰는 사용자에게는
어제 넣은 '옮기기' 가 아예 없는 기능**이었다.

- `↑↓` 이동(⇧ 얹으면 범위 선택), `Home/End` 양 끝
- `→` 접힌 폴더를 열고, **열린 폴더에서는 첫 자식으로 들어간다**
- `←` 열린 폴더를 접고, 그 밖에서는 **부모로 올라간다** (VS Code 와 같다)
- `⏎` 열기/여닫기 · `Space` 뽑기 · `F2` 이름 바꾸기 · `Delete`/`⌫` 삭제 · `Esc` 비우기

**로빙 tabindex** 를 넣었다. 행마다 기본 tabindex 를 두면 파일 300개짜리 저장소에서
Tab 이 300번 걸린다. 트리 안에서 Tab 의 입구는 언제나 하나다.

**2. ⌘X → ⌘V 로 옮기기**

한 키가 두 갈래를 나눠 쓴다: 잘라 둔 것이 있으면 **옮기고**, 없으면 Finder
클립보드를 들여온다(기존 `pasteFiles`). 사용자에게는 같은 동작("여기에 넣어라")
이고 어디서 왔는지는 앱이 가른다. 깊은 트리 — 스크롤을 두 번 해야 보이는 폴더 —
로는 드래그로 손이 닿지 않으므로 이쪽이 늘 더 빠르다.

우클릭 메뉴에 [잘라내기]·[여기에 붙여넣기] 가 붙고(붙여넣기는 **잘라 둔 것이 있을
때만** — 회색으로 놔두면 왜 못 누르는지 모른다), 항목마다 단축키 힌트를 달았다.
⌘/ 치트시트 '코드' 묶음에도 트리 다섯 줄이 들어갔다.

## 동작 흐름

- **자리는 하나다.** 화살표가 옮기는 자리, ⌘X 가 잘라내는 자리, ⌘V 가 넣는 자리가
  전부 `treeFocus` 다. 둘로 나누면 손과 키보드가 서로 다른 '지금' 을 갖는다.
  (기존 `treeAnchor` — ⌘V 가 기대던 '마지막으로 손댄 자리' — 를 이걸로 통합했다.)
- **서 있던 행이 사라지면 첫 행으로 돌아간다.** 옮김·삭제·필터로 경로가 없어졌을
  때 그 경로가 tabindex 의 주인이면 트리에 **아예 들어갈 수 없다**.
- **잘린 행은 사라지지 않는다.** 점선 + 흐림으로 "들려 있다" 만 말한다 — ⌘V 를 안
  눌러도 안전하다는 것이 보여야 한다.
- **⌘·⌃·⌥ 조합은 트리가 손대지 않는다** (`treeKeyAction` 이 먼저 거른다). 그 자리는
  화면·앱 단축키의 것이고, 트리가 먼저 집으면 그쪽이 조용히 죽는다.
- `Space`·`⏎` 는 `preventDefault` 로 버튼의 기본 활성화를 막는다 — 안 그러면 한 번의
  키 입력이 두 번 처리된다.

## 리팩토링 (또 자리를 만들려고)

`CodeScreenV2.tsx` 가 다시 래칫(1526줄)을 넘겨 1581줄이 됐다. 키보드 표면과
잘라내기를 `useTreeKeys.ts` 로 떼어냈다 — 둘은 `treeFocus` 를 공유하는 한 덩어리라
같이 나가는 것이 맞다. 화면은 **1486줄**로 내려왔다.

## 검증

- `pnpm typecheck` · `pnpm test` **168파일 2194건 통과** · `pnpm lint` 4게이트 ·
  `pnpm build` 전부 exit 0.
- 신규 `code_tree_keys.test.ts` 10건 — 이동·끝에서 멈춤·⇧범위·Home/End·좌우
  (열림/접힘/파일/최상위)·조작 6종·수식키 무시·빈 트리.
- `code_screen.test.tsx` +3 — 화살표로 걷고 F2 가 인라인 입력을 열기, →/← 여닫기,
  **⌘X→⌘V 가 실제로 `code_rename` 을 부르기**. 단축키는 `isVisible()` 뒤에 있어
  jsdom 에서는 `getClientRects` 를 그 테스트에서만 채워 준다.
- 기존 `code_screen_tabs.test.tsx` 의 메뉴 헬퍼를 고쳤다 — 항목에 단축키 힌트가
  붙어 `textContent` 완전일치가 깨졌다. 라벨은 첫 `<span>` 으로 본다.
- **실기기 육안 확인은 아직.**

## 메모

- 파일 크기 래칫은 지금 저장소 전체로는 붉지만 걸린 것은 다른 세션의 신규 파일
  (`src-tauri/src/oculpm/mcp/tools/tests.rs` 1703줄) 하나다.
- 남은 후보는 P1(계획 항목 `move_item` · 호버 카드 행동)과 P2(화면 뒤로가기 ⌘[ /
  호버 카드 공용 프리미티브화).