---
schema_version: 1
type: feature
slug: "sticky-scroll-in-code-editor"
status: done
difficulty: medium
created_at: "2026-09-02T17:54:29+09:00"
session_id: "20260902-007"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/stickyModel.ts"
    op: create
  - path: "src/features/code/stickyScroll.ts"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/code_sticky.test.ts"
    op: create
related:
  - ref: "20260902/Features_to_add/1722_feature_goto-symbol-and-line-in-file.md"
    kind: "followup"
tags:
  - "code"
  - "codemirror"
  - "lsp"
  - "vscode-borrows"
  - "mcp-tool"
---
[x] 코드 화면 스티키 스크롤 — 상위 스코프를 위에 겹쳐 고정 (vscode-borrows Phase 4)

## 추가 기능

편집면 맨 위에 **뷰포트 첫 줄을 감싸는 상위 스코프의 시작 줄**을 겹쳐 고정한다.
1,000줄짜리 파일 중간에서 "여기가 무슨 클래스의 무슨 메서드인가"를 스크롤해
올라가 확인하지 않게 된다. 줄을 누르면 그 줄로 간다. 설계 SSOT 는
`docs/20260902_vscode-borrows/04-sticky-scroll.md`.

설정 2개 — `codeStickyScroll`(기본 **꺼짐**) · `codeStickyMaxLines`(5, 1–10).
VS Code 기본은 켜짐이지만 우리 편집면은 분할·미리보기로 이미 좁고, 맨 위 몇
줄을 늘 덮는 물건은 켤지를 사용자가 골라야 한다.

## 동작 흐름

1. **`stickyModel.ts` (순수)** — 2단 폴백.
   - `stickyFromSymbols`: 아웃라인이 쓰는 그 `LspSymbol[]`. 백엔드가 시작 줄만
     주므로 범위는 "다음 형제(같거나 얕은 depth)의 시작까지"로 추정한다
     (`CodeOutline.indexOfEnclosing` 과 같은 근거). 결과는 바깥→안쪽,
     `max` 절단은 **안쪽부터** 버린다 — 무슨 클래스인가가 더 크다.
   - `stickyFromIndent`: 언어 서버가 없는 파일(css·md·json). 탭은 탭 스톱으로
     환산하고, 빈 줄·주석만 있는 줄은 앵커가 되지 않는다.
   - VS Code 의 3단 중 **폴딩 제공자 모델은 건너뛴다** — CM6 폴딩은 언어 확장
     마다 제각각이라 심볼과 들여쓰기 사이에서 값이 겹친다.
2. **`stickyScroll.ts` (CM6)** — `StateField` + `ViewPlugin` 하나. 패널은
   `.cm-content` **밖**(`view.dom`)에 붙는다: CM 은 콘텐츠 DOM 만 관찰하므로
   편집 모델을 건드리지 않고 스크롤과 무관하게 제자리에 남는다.
3. **배선** — `CodeScreenV2`(심볼) → `CodePane`(설정·탭 폭) → `CodeEditor`
   (확장 등록 + `setStickySource` 트랜잭션).

## 구현 중 정한 것 4

- **심볼 시작 줄을 문서 오프셋으로 들고 `mapPos` 로 따라가게** 했다. 심볼 목록은
  저장·포맷 때만 갱신되는데, 그 사이에 위쪽에 한 줄만 넣어도 스티키가 통째로
  남의 줄을 말한다. 편집마다 서버에 다시 묻지 않고 이걸로 푼다.
- **`tr.state` 대신 `tr.newDoc`.** `StateField.update` 안에서 `tr.state` 를 읽으면
  자기 자신을 계산하는 중인 상태를 부른다.
- **폭 판단은 CSS 가 아니라 플러그인에서** (`view.dom.clientWidth < 320`).
  미디어 쿼리는 창 폭을 볼 뿐 분할된 편집면의 폭을 보지 못한다.
- **설정 토글은 `CodeEditor` key 재마운트로** 반영한다. 확장은 마운트 시점에
  결정되는 것이 이 파일의 규약이고, 본문은 버퍼가 갖고 있어 미저장 편집은
  살아남는다(실행 취소 이력만 잃는다 — 파일 전환과 같은 대가).

하이라이팅은 하지 않는다 — 그러려면 그 줄만 다시 파싱해야 하고, 값의 90%는
"어느 함수 안인가"라 색이 거기 기여하지 않는다.

## 검증

- 신규 테스트 21건(`code_sticky.test.ts`) — 전부 순수 함수. jsdom 에는 레이아웃이
  없어 CM6 뷰포트를 흉내낼 수 없으므로 계산을 전부 모델로 빼고 확장을 얇게 뒀다.
- 4게이트 exit 0. 다만 **병렬 세션이 `StartScreen`·`home/tiles` 를 고치는 중**이라
  공유 워킹트리의 `tsc` 가 그쪽 미완성 prop 으로 붉었다 — HEAD + 이번 변경만 담은
  임시 워크트리에서 typecheck(0) · vite build(0) · critical-css(0) · vitest
  (155 파일 1991건 통과)를 따로 확인했다. lint 4종은 공유 트리에서 통과.
- 육안 확인은 라운드 마감(#eyes)에서 한 번에 한다.