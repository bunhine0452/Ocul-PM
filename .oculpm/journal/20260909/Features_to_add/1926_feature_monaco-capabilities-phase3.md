---
schema_version: 1
type: feature
slug: "monaco-capabilities-phase3"
status: done
difficulty: medium
created_at: "2026-09-09T19:26:49+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/monaco/options.ts"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/features/settings/settingsIndex.ts"
    op: update
  - path: "src/__tests__/monaco_options.test.ts"
    op: create
  - path: "docs/20260908_monaco-editor/03-capabilities.md"
    op: create
related:
  - ref: "20260909/Refactors/1915_refactor_monaco-reclaim-phase2.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "folding"
  - "multicursor"
  - "minimap"
  - "settings"
  - "mcp-tool"
---
[x] Monaco 이관 Phase 3 — 아예 없던 기본기를 켜고 자물쇠를 건다

## 추가 기능

Phase 0 이 CodeMirror 판에서 실측한 값은 전부 **0** 이었다 — `foldGutter` ·
`bracketMatching` · `closeBrackets` · `indentOnInput` · `multipleSelections` ·
`highlightSelectionMatches`. 지붕(LSP 17커맨드 · DAP 디버거)은 올렸는데 바닥이
비어 있던 자리다.

SSOT: `docs/20260908_monaco-editor/03-capabilities.md`

**켠 것** — 폴딩 · 괄호 매칭(`always`) · 자동 괄호/따옴표 닫기 · 선택 감싸기 ·
입력 시 들여쓰기(`autoIndent: "full"`) · 선택 일치 강조 · 다중 커서(⌥클릭·⌘D) ·
열 선택(⌥⇧드래그) · 브래킷 쌍 색칠 · 들여쓰기 가이드 · 미니맵.

`autoIndent` 를 `advanced` 가 아니라 `full` 로 둔 것이 한 판단이다 — `advanced`
는 onEnter 규칙만 보고, `}` 를 쳤을 때 도로 나오는 것은 `indentationRules` 라
`full` 이어야 채워진다.

## 동작 흐름

이 Phase 의 진짜 위험은 "못 켜는 것" 이 아니라 **"켠 줄이 조용히 지워지는 것"**
이다. 능력 전부가 옵션 몇 줄이라, 누가 리팩터링하다 `folding: true` 를 지워도
아무 테스트도 안 깨지고 화면만 옛날로 돌아간다. CodeMirror 판이 오래 0인 채로
굴러간 이유가 정확히 그것이다.

그래서 `CodeEditor.tsx` 안의 인라인 옵션 객체를 `monaco/options.ts` 의 순수
함수 둘(`baseEditorOptions` · `diffEditorOptions`)로 떼어내고
`monaco_options.test.ts`(16개)가 그 값을 문다. `CodeEditor.tsx` 는 48줄 줄었다.

## 판단 셋

**`detectIndentation: false`** + 새 prop `insertSpaces`. Monaco 기본값 `true` 는
파일 내용에서 추정해 `tabSize`·`insertSpaces` 를 덮는다. 이 앱에서는 그러면 안
된다 — 사용자가 고른 `codeTabSize`·`codeInsertSpaces` 가 **저장 시
포맷**(`lsp_format` 옵션)으로 그대로 가므로, 4로 그려 놓고 저장할 때 2로 다시
들여써서 파일 전체가 diff 로 물든다. 화면과 저장이 같은 값을 보게 한다.

**설정은 미니맵 하나만.** 플랜의 질문("설정에 켜기/끄기를 둘지")에 대한 답이다 —
**폭을 먹는 것만 끌 수 있게 한다.** 이 화면은 좌우로 분할되고 그때 미니맵이 먹는
60~100px 이 본문에서 나온다. 브래킷 쌍 색칠·들여쓰기 가이드는 자리를 안 먹고 끌
이유를 댈 수 없다 — 아무도 안 바꿀 토글은 설정 화면의 소음이다.

**peek 은 만들지 않는다** (`{#cap-peek}` 판정). 표준 Monaco 의
`StandaloneTextModelService.createModelReference()` 는 대상 파일의 모델이 이미
없으면 `Model not found` 로 거부한다. 프로젝트 전체 파일에 모델을 미리 만들거나
그 서비스를 갈아끼워야 하는데, 앞은 메모리를 파일 수만큼 먹고 뒤는 표준 API 밖이다.
얻는 것은 "같은 파일 안에서만 되는 peek" 이고 그건 지금 있는 F12 이동 + ⇧F12
전체 폭 패널보다 나쁘다 — **반만 되는 이동은 안 되는 이동보다 나쁘다.** 정의·참조
공급자를 아예 등록하지 않는 이유도 같다(⌘클릭 링크가 같은 문제를 안고 켜진다).
Phase 5 의 ⌘K 가 어차피 파일 모델 레지스트리를 요구하면 그때 다시 연다.

## 막힌 것 — 시맨틱 토큰

`{#cap-semantic}` 은 `done` 이 아니라 **`blocked`** 로 둔다.

- 백엔드에 `semanticTokens` 가 **없다** (`commands/lsp.rs` 17개 커맨드 어디에도,
  `initialize_params` 의 클라이언트 capability 에도).
- 추가 자체는 어렵지 않다 — legend 협상 + 델타 인코딩 `u32` 배열 해독 + Monaco
  `DocumentSemanticTokensProvider` + 테마 규칙.
- **그런데 지금은 못 한다.** 커맨드를 더하면 `cargo test` 가 `src/lib/bindings.ts`
  를 다시 만드는데, 지금 그 파일은 **병렬 세션의 미커밋 변경**을 들고 있다
  (`FiringOverview.sessions_considered` · `RuleEntry.readonly`). 재생성하면 남의
  진행 중 API 가 내 커밋에 섞이고, 안 섞으면 내 커맨드의 바인딩이 빠져 남의
  체크아웃에서 타입이 깨진다.

해제 조건 하나: **병렬 세션의 firing-ledger / rules 작업이 머지되어
`bindings.ts` 가 깨끗해질 것.** `done` 으로 닫지 않는 이유는 그러면 플랜에서
사라지기 때문이다.

## 검증

- `pnpm typecheck` · `pnpm lint` 6종(파일 크기 래칫 포함) · `pnpm build` exit 0.
- `pnpm test` — 새 자물쇠 16개 포함 내 스위트 전부 초록.
- **주의**: `agent_context_model.test.ts` 하나가 붉은데 그것은 병렬 세션의
  `contextModel.ts` 진행 중 변경이다(`surface.always_on is not iterable`) —
  이 라운드와 무관하고 내가 건드린 파일이 아니다.
- **미확인**: 폴딩 화살표·미니맵·다중 커서의 실제 렌더는 육안 확인 전이다
  (Phase 6 `{#fin-eyes}` 격자).