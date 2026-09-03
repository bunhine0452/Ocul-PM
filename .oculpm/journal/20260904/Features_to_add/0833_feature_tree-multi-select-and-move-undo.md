---
schema_version: 1
type: feature
slug: "tree-multi-select-and-move-undo"
status: done
difficulty: high
created_at: "2026-09-04T08:33:46+09:00"
session_id: "20260904-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/treeSelection.ts"
    op: create
  - path: "src/features/code/useFileOps.ts"
    op: create
  - path: "src/api/code.ts"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/useTreeDrag.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_tree_selection.test.ts"
    op: create
  - path: "src/__tests__/code_file_ops_undo.test.tsx"
    op: create
  - path: "src/__tests__/code_tree_drag.test.tsx"
    op: update
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "docs/20260904_ux-candidates/00-candidates.md"
    op: update
related: []
tags:
  - "code"
  - "undo"
  - "multi-select"
  - "a11y"
  - "mcp-tool"
---
[x] 여럿을 한 번에 옮기고, 잘못 옮겼으면 되돌린다 — 트리 다중 선택 + 되돌리기 토스트

## 추가 기능

어제 넣은 트리 포인터 드래그가 곧바로 부딪히던 두 자리
(`docs/20260904_ux-candidates/00-candidates.md` 의 P0 1·2)를 구현했다.

**1. 되돌리기 토스트 — 옮기기·이름 바꾸기**

`toast.ts` 에 `ToastAction` 이 이미 있었는데 파일 조작만 쓰지 않고 있었다.
`code_rename` 은 인자를 뒤집으면 **정확한 역연산**이라 [되돌리기] 가 진짜로
되돌린다.

- 되돌리기는 **역순**이다. `a→b`, `b→c` 사슬이 생겼을 때 앞에서부터 풀면 되돌린
  `b` 를 그 다음 되돌리기가 다시 데려간다.
- 성공한 만큼에만 단다. 열 개 중 셋이 실패하면 일곱 개짜리 되돌리기다.
- 실패 토스트는 **첫 건만** 이유를 말한다 — 열 개가 같은 이유로 막히면 토스트
  열 개는 소음이다.

**삭제에는 달지 않았다.** `trash` 크레이트의 복원 API(`os_limited`)는 소스에서
`cfg(any(windows, all(unix, not(macos), …)))` 로 걸려 있다 — **macOS 에는 아예
없다.** 눌러도 안 되는 버튼을 다느니 "휴지통으로 보냈습니다" 라고 말하는 편이
정직하고, 그 문장이 이미 복구 경로다.

**2. 다중 선택 (⌘/⇧ 클릭)**

- ⌘클릭 = 토글, ⇧클릭 = 범위, 그냥 클릭 = 하나만 남기고 열기/펼치기.
  ⌘·⇧ 는 **고르기만** 한다 — 열면 방금 뽑아 둔 것이 곧바로 흩어진다.
- 드래그·삭제는 "뽑아 둔 것 **안에서** 잡았으면 전부, 밖에서 잡았으면 그것
  하나" (Finder·VS Code 규약). 유령이 `+n` 으로 딸려 오는 수를 말한다.

## 동작 흐름

- **선택은 `Set` 이 아니라 `Map<경로, 폴더여부>`** 다. 삭제 확인 문구가
  파일/폴더로 갈리는데, 뽑아 둔 경로가 스크롤 밖으로 나가거나 부모가 접힌
  뒤에는 트리에서 그 사실을 되찾을 수 없다. 누를 때 이미 알던 것을 들고 다닌다.
- **`pruneNested`** — 폴더와 그 안의 파일을 함께 뽑아 옮기면 첫 이동이 자식을
  데려가 버려 두 번째 이동이 **없는 경로**를 가리킨다. 조상이 있으면 후손을 뺀다.
- **⇧ 범위의 기준은 '보이는 행'** 이다. 접힌 폴더의 자식까지 넣으면 사용자가
  고른 적 없는 파일이 조용히 딸려 옮겨진다.
- **옮기기는 차례로**(병렬 아님). 같은 폴더로 열 개가 동시에 들어가면 트리 캐시
  갱신이 서로를 덮어써 목록이 디스크와 어긋난다.
- **`aria-selected` 의 뜻을 바꿨다** — 이제 "뽑힘"이다(+ `aria-multiselectable`).
  "지금 열려 있는 파일" 은 탭 줄·툴바가 이미 말하고 있고, 보조기술에서 선택은
  곧 조작 대상이다.

## 리팩토링 (자리를 만들려고)

`CodeScreenV2.tsx` 가 파일 크기 래칫(1525줄)에 걸려 **한 줄도 늘릴 수 없었다.**
그래서 먼저 쪼갰다: 만들기·이름 바꾸기·옮기기·삭제가 `useFileOps.ts` 로 나갔고
(경로가 바뀌면 탭·버퍼·펼침이 따라간다는 하나의 관심사), 화면은 1525 → 1446줄.
새 커맨드 호출은 `bindings` 직접 대신 `@/api/code.ts` 래퍼를 지난다 (lint:bindings 규약).

## 검증

- `pnpm typecheck` (내 파일 0건) / `pnpm test` **167파일 2181건 통과** / `pnpm lint`
  4게이트 통과 / `pnpm build` exit 0.
- 신규 `code_tree_selection.test.ts` 12건 — 클릭 의도·보이는 행·범위·토글·
  중첩 걷어내기·조작 대상.
- 신규 `code_file_ops_undo.test.tsx` 7건 — 되돌리기 왕복, 역순, 실패분 제외,
  폴더+자식 한 번만, 삭제에는 액션 없음.
- `code_tree_drag.test.tsx` +2 (여럿 들면 `+1`, 선택 밖은 하나만),
  `code_screen.test.tsx` +1 (⌘클릭이 열지 않고 표시만 남긴다).
- **실기기 육안 확인은 아직.**

## 메모

- 작업 중 병렬 세션이 `useTreeDrag.tsx` 에 `e.buttons === 0` 가드를 넣었다
  (창 밖에서 손을 뗐을 때 유령이 남는 것을 잡는 진짜 수정이라 그대로 뒀다).
  대신 jsdom 은 `buttons` 를 기본 0 으로 보내므로 드래그 테스트가 `buttons: 1` 을
  명시해야 한다 — 실제 드래그와도 그쪽이 맞다.
- 파일 크기 래칫은 지금 저장소 전체로는 붉지만, 걸린 파일은 전부 다른 세션의
  것(`oculpm/*.rs` · `AcpConversation.tsx` · `TerminalSurface.tsx` · `TrayPopover.tsx`)이다.
- 남은 P0: 트리 키보드 이동(↑↓←→·F2·Delete)과 ⌘X→⌘V 옮기기.