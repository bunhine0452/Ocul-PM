---
schema_version: 1
type: feature
slug: "monaco-semantic-tokens-and-attribution"
status: done
difficulty: high
created_at: "2026-09-10T19:39:43+09:00"
session_id: "20260910-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "55cc0fcc-d3a8-4c54-a4d1-ef78c5bd3ef6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/semantic.rs"
    op: create
  - path: "src-tauri/src/lsp/client.rs"
    op: update
  - path: "src-tauri/src/lsp/mod.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/commands/code_history.rs"
    op: update
  - path: "src-tauri/src/oculpm/history.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/code/monaco/lsp.ts"
    op: update
  - path: "src/features/code/monaco/theme.ts"
    op: update
  - path: "src/features/code/monaco/options.ts"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/inlineEdit/useCodeAi.tsx"
    op: update
  - path: "src/__tests__/monaco_semantic_theme.test.ts"
    op: create
  - path: "src/__tests__/code_ai_attribution.test.tsx"
    op: create
related: []
tags:
  - "monaco"
  - "lsp"
  - "semantic-tokens"
  - "attribution"
  - "code"
  - "mcp-tool"
---
[x] 막혀 있던 두 항목이 같은 이유로 막혀 있었고, 그 이유가 사라졌다

## 추가 기능

Monaco 라운드에서 `!`(막힘)로 서 있던 두 항목 — `{#cap-semantic}` 과
`{#agent-attribution}` — 은 둘 다 같은 이유로 막혀 있었다. "백엔드 커맨드를
바꾸면 `bindings.ts` 를 재생성해야 하는데 그 파일이 병렬 세션(firing-ledger/
rules)의 미커밋 변경을 들고 있다." 그 작업이 머지돼(`sessions_considered` 가
바인딩에 들어와 있다) 해제 조건이 충족됐으므로 함께 풀었다.

### 시맨틱 강조

Monarch(정규식 문법)는 `foo` 가 함수인지 변수인지 모르고, 언어 서버는 안다.
백엔드에 없던 `textDocument/semanticTokens/full` 을 붙이고 Monaco 에 물렸다.

핵심 설계는 **legend 와 데이터를 따로 나르는 것**이다. Monaco 는 공급자마다
`getLegend()` 를 딱 한 번 부르고 WeakMap 에 캐시한다
(`semanticTokensStylingService.getStyling`) — 빈 표로 등록해 두고 나중에 채우는
순서가 통하지 않고, 그러면 그 편집기는 끝까지 무채색으로 남는다. legend 는
`initialize` 답에 이미 들어 있어서 읽는 데 LSP 요청이 한 번도 안 나간다. 그래서
표를 손에 쥔 뒤에 공급자를 다는 순서로 짰다.

## 동작 흐름

1. `lsp_semantic_legend` — 서버 능력의 `semanticTokensProvider.legend` 를 읽어
   `{token_types, token_modifiers}` 로. `full` 을 안 하거나 종류가 비면 `None`.
2. `CodeEditor` 의 전용 effect 가 그 표를 기다렸다가 도착하면
   `registerDocumentSemanticTokensProvider` 를 단다.
3. 공급자는 `lsp_semantic_tokens` 를 부르기 **전에** `flushText` 로 서버 문서를
   맞춘다 — 편집은 400ms 디바운스로 밀려 들어가는데 Monaco 는 타자 직후에
   물어서, 안 맞추면 옛 좌표로 칠해져 색이 한 칸씩 밀린다.
4. 5칸 상대 좌표를 `Uint32Array` 로 그대로 넘긴다 (중간에서 풀지 않는다).

### 실측으로 잡은 함정 셋

- **핸드셰이크에서 안 알리면 서버가 아예 안 켠다.** rust-analyzer 는 클라이언트
  능력에 `semanticTokens` 가 없으면 `semanticTokensProvider` 를 광고조차 하지
  않는다 — 아무리 물어도 빈 답이다.
- **standalone 테마는 `semanticHighlighting` 을 항상 false 로 들고 있다**
  (`StandaloneTheme` 생성자가 못박고, `isSemanticColoringEnabled` 는 설정이
  boolean 이 아니면 그 값을 본다). 옵션 `"semanticHighlighting.enabled": true`
  한 줄이 없으면 공급자를 등록해도 Monaco 가 묻지 않는다. 이 옵션은
  `updateConfigurationService` 로 `editor.semanticHighlighting.enabled` 가 된다.
- **테마 규칙을 빠뜨리면 색이 도로 빠진다.** 시맨틱 토큰은 Monarch 위에
  덮어쓰므로 규칙 없는 종류는 `{ token: "" }` 로 떨어져 본문색이 된다 = 켜기
  전보다 나빠진다. `method`·`property`·`parameter`·`enumMember`·`class` … 는
  물론 rust-analyzer 가 표준 밖에서 내는 `builtinType`·`lifetime` 까지 램프에
  앉혔다.

`full` 을 못 하는 서버에는 아예 안 단다 — 범위만 되는 서버에 전체를 물으면 빈
답이 오고 그게 곧 무채색이라, "반만 되는 강조" 가 안 되는 강조보다 나쁘다.
델타도 안 켠다(`resultId` 를 안 들고 있어 델타가 오면 못 읽는다).

### 귀속

⌘K 로 들어간 편집이 로컬 히스토리에 **사람**으로 적히고 있었다. 저장 창구는
사람이 ⌘S 를 누르든 ⌘K 가 쓴 문장을 담아 저장하든 똑같은 `code_write` 라
창구만 보면 둘 다 사람이 된다. 판 목록에서 알고 싶은 것은 글자를 **쓴** 손이다.

`code_write` 에 `by_agent` 를 더해 자기-쓰기 쪽지가 손까지 적게 했다. 프런트는
⌘K 편집을 받은 파일을 "아직 저장 안 함" 집합에 넣고 저장 때 한 번 꺼내 쓴다 —
한 번 적히고 지워지는 것이 규칙이다(안 지우면 그 파일의 이후 저장이 전부
에이전트가 된다). 일지 누적(`tallies`)과는 다른 축이라 따로 뒀다: 저쪽은 "일지에
아직 안 적은", 이쪽은 "디스크에 아직 안 쓴" 이다.

### 곁가지 — 래칫이 구조를 정했다

`lsp/spec.rs` 가 이미 1,164줄이라 파일 크기 래칫이 증가를 막았고, 그래서 시맨틱
쪽은 `lsp/semantic.rs` 로 새로 냈다 — 결과적으로 더 맞는 자리다.
`commands/code.rs`(2,252)·`oculpm/history.rs`(791)도 걸려서 늘어난 만큼 주석과
테스트를 접어 도로 맞췄다(자기-쓰기 테스트 둘은 같은 주제라 한 개로 합침).

머지된 병렬 세션의 작업이 `cargo fmt`·`cargo clippy -D warnings` 를 통과하지
않은 채 들어와 있어 main 이 이미 붉었다 — 별도 커밋(`0d66730`)으로 갚았다.

## 검증

typecheck · test(200파일 2,598) · lint 6종 · build · cargo test(33스위트
1,591) · `cargo fmt --check` · `cargo clippy --all-targets -D warnings` 전부
exit 0. 새 자물쇠 셋: 어휘 커버리지(`monaco_semantic_theme`), 공급자 계약 5개
(`monaco_lsp`), 귀속 규칙 4개(`code_ai_attribution`), 그리고 핸드셰이크·legend·
튜플 절단의 Rust 단위 테스트 4개. **기기에서 실제 색이 어떻게 보이는지는 사람
눈의 몫이라 `{#fin-eyes}` 격자에 그대로 남는다.**