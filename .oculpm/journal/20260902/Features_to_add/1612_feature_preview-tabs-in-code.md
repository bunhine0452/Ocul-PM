---
schema_version: 1
type: feature
slug: "preview-tabs-in-code"
status: done
difficulty: medium
created_at: "2026-09-02T16:12:46+09:00"
session_id: "20260902-006"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/codeTabs.ts"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeTabsBar.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_tabs.test.ts"
    op: update
  - path: "src/__tests__/code_screen_tabs.test.tsx"
    op: update
  - path: "src/__tests__/code_tree_lazy.test.tsx"
    op: update
related:
  - ref: "20260902/Features_to_add/1537_feature_save-hygiene-and-auto-save.md"
    kind: "followup"
tags:
  - "code"
  - "tabs"
  - "preview"
  - "vscode-benchmark"
  - "mcp-tool"
---
[x] 코드 화면 — 파일을 훑어봐도 탭이 쌓이지 않는다 (미리보기 탭)

「VS Code 에서 가져오는 7가지」 라운드(`docs/20260902_vscode-borrows/`)의 Phase 2. 트리에서 파일 스무 개를 훑으면 탭이 스무 개가 됐다. 되돌리는 수단은 하나씩 닫거나 "다른 탭 모두 닫기" 뿐이었다.

## 추가 기능

창(pane)마다 **미리보기 탭 한 자리**를 둔다. 미리보기로 열린 파일은 기울임으로 그려지고, 다음에 미리보기로 여는 파일이 그 자리를 차지한다. 고정되는 순간 보통 탭이 된다.

**이 라운드에서 유일하게 기본 켜짐인 설정**(`codePreviewTabs`)이다. 나머지는 전부 "켜야 바뀐다" 인데, 여기서 유지할 옛 동작이 "훑기만 해도 탭이 계속 쌓인다" 라 지킬 가치가 없다. 끄면 예전 그대로다.

## 동작 흐름

**미리보기로 여는 입구는 트리 단일 클릭 하나뿐이다.** VS Code 기본값(`enablePreviewFromQuickOpen: false` 외)과 같은 판단 — ⌘K 팔레트·전역 검색·코드 이동(F12·참조·코드맵)·일지는 전부 고정으로 연다. 거기는 "훑어본다" 가 아니라 "이걸 하려고 왔다" 는 신호다.

고정 승격은 5경로: 탭 더블클릭 · 트리 더블클릭 · **첫 편집** · 창 이동(메뉴·드래그 드롭) · 컨텍스트 메뉴 「탭 고정」. 셋째가 핵심이다 — 미리보기로 연 파일을 고치기 시작했는데 다음 클릭에 사라지면 그건 데이터 손실처럼 느껴진다(버퍼는 남지만 화면에서 사라진다).

순수 모델(`codeTabs.ts`)에서 정한 것들:

- **교체는 자리를 옮기지 않는다.** 같은 index 에 새 경로를 얹는다 — 훑는 동안 탭이 좌우로 튀면 다음에 누를 것을 눈으로 다시 찾아야 한다.
- **이미 열린 고정 탭을 눌러도 미리보기가 되지 않는다.** 되면 그 탭이 다음 훑기에 사라진다.
- **미저장인 미리보기 자리는 교체하지 않는다.** 첫 편집이 곧바로 고정시키므로 원칙적으로 생길 수 없지만, 미저장 편집이 화면에서 사라지는 경로를 코드 수준에서 0으로 만든다.
- **미리보기는 창을 넘지 않는다.** 분할하면 새 창의 씨앗 탭은 고정이고, 합칠 때는 첫 창의 것만 남는다. 아니면 한쪽에서 훑는 것이 반대쪽에서 보던 파일을 갈아친다.
- `pinTab` 은 미리보기가 아닌 경로에 **같은 상태 객체**를 돌려준다 — 첫 편집이 타자마다 부르는 자리라, 새 객체를 만들면 매 글자 리렌더가 된다.
- 닫기·다른 탭 닫기·이름 바꾸기·삭제·영속 복원 전부 `preview` 를 따라 정리한다(필드가 없던 예전 JSON 은 `null`).

표시는 **기울임 하나뿐**이다. 색이나 테두리를 더하면 "상태" 가 아니라 "종류" 로 읽히고, 탭 바의 위계가 하나 는다.

기존 탭 테스트(`code_screen_tabs`)는 트리를 한 번씩 눌러 탭 두 개를 기대하고 있었다 — 그게 정확히 이 Phase 가 없앤 동작이라, 더블클릭으로 고정하는 헬퍼(`openPinned`)를 써 실제 사용과 같게 고쳤다.

## 검증

- 순수 12건 추가 (`code_tabs`: 연속 훑기·자리 유지·고정 탭 재클릭·승격·미저장 방어·닫기·창 이동·분할/합치기·이름 바꾸기/삭제·영속 복원).
- 화면 1건 추가 (`code_screen_tabs`: 트리 두 번 클릭 → 탭 하나, 편집하면 기울임이 풀리고 다음 훑기와 둘 다 남는다).
- `pnpm typecheck` · `test`(152파일 1926건) · `lint` · `build` 전부 exit 0.