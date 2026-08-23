---
schema_version: 1
type: feature
slug: lsp-hover-and-definition
status: done
difficulty: high
created_at: "2026-08-21T22:01:00+09:00"
session_id: "manual-20260821-220100"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/lsp_rust_analyzer.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/lspBridge.ts"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/__tests__/lsp_bridge.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ".oculpm/journal/20260821/Features_to_add/1949_feature_lsp-code-intelligence.md"
tags: [lsp, hover, go-to-definition, code-editor, rust-analyzer, ide]
---

[x] PR-LSP1 — 호버(타입·문서)와 정의로 이동(F12 · ⌘클릭)

## 추가 기능

PR-LSP0 이 깐 파이프 위에 읽기 기능 둘을 얹었다. 커맨드 두 개(`lsp_hover`,
`lsp_definition`)와 CM6 확장 두 개가 전부다 — 프로세스 수명·프레이밍·상관은 이미
있던 것을 그대로 쓴다.

- **호버** — 커서를 500ms 올리면 시그니처와 문서가 뜬다.
- **정의로 이동** — `F12` 또는 `⌘클릭`. 같은 파일이면 그 자리로, 다른 파일이면
  그 파일을 열고 그 줄로.

## 동작 흐름

응답 모양이 제각각이라 **변환이 이 라운드의 실제 작업**이었다. 둘 다 순수 함수로
떼어 테스트로 잠갔다.

**호버 `contents` 는 세 모양으로 온다** — `MarkupContent{kind,value}`(요즘 서버),
`MarkedString`(문자열 또는 `{language,value}`, 구형), 그리고 **그 배열**
(rust-analyzer 가 쓴다: 시그니처 블록 + 문서). 구형 `{language,value}` 는 코드이므로
펜스를 씌워 프런트가 산문과 구별할 수 있게 했다. 빈 내용은 `None` 으로 접는다 —
빈 툴팁이 뜨는 것보다 안 뜨는 게 낫다.

**정의는 네 모양으로 온다** — `Location` · `Location[]` · `LocationLink[]` · null.
여기서 값을 한 선택은 `LocationLink` 의 **`targetSelectionRange` 를 `targetRange`
보다 먼저** 보는 것이다. `targetRange` 는 정의 블록 전체라 커서가 함수 맨 위
빈 줄에 떨어지고, `targetSelectionRange` 는 심볼 이름 자체를 가리킨다. 통합
테스트가 `character == 3`(= `fn greet` 의 `g`)으로 이걸 잠근다.

**프로젝트 밖 정의를 조용히 버리지 않는다.** 표준 라이브러리나 의존성으로 가는
정의는 코드 화면이 열 수 없다. `path: None` + `display`(파일명)로 돌려주고 UI 가
"정의가 프로젝트 밖에 있어요 — option.rs" 라고 말한다. 조용히 아무 일도 안 하면
사용자는 기능이 고장난 줄 안다. 정의를 못 찾은 경우도 마찬가지로 토스트를 띄운다.

루트 비교는 `canonicalize` 한 뒤에 한다 — 서버는 심링크가 풀린 실경로로 답하므로,
저장소가 심링크 아래에 있으면 접두사가 안 맞아 **프로젝트 안의 정의까지 "밖"으로**
판정된다.

프런트 쪽 결정 셋:

- **호버 지연을 500ms 로** (CM6 기본 300ms). 코드를 훑느라 마우스가 지나가는 동안에도
  요청이 나가면 rust-analyzer 가 그것들을 처리하느라 진짜 필요한 완성이 밀린다.
- **마크다운 렌더러를 붙이지 않았다.** 호버는 거의 전부 코드 펜스와 짧은 산문이고,
  CM6 툴팁 안에서 React 를 그리려면 포털이 필요하다. 필요한 구별은 "고정폭이냐"
  하나뿐이라 `parseHover` 로 그것만 가른다. `---` 구분선은 버리고 CSS 경계선으로 대신했다.
- **⌘클릭은 `true` 를 돌려준다** — 기본 동작을 막지 않으면 이동과 동시에 엉뚱한
  곳이 드래그 선택된다.

## 검증

- **실제 rust-analyzer 왕복** (`hover_and_definition_round_trip`) — 호버에 심볼
  이름이 들어 있고, 정의가 같은 파일의 **0번째 줄 3번째 문자**(= `greet` 의 `g`)를
  정확히 가리킨다. 진단(알림)과 달리 이 경로는 요청 id 상관을 타므로 그쪽도 함께 증명된다.
- `cargo test` 682 + 통합 4 그린 (직전 676 + 신규 6). 단위: 호버 세 모양·배열
  이어붙이기·빈 값 접기, 정의 네 모양·targetSelectionRange 우선·프로젝트 밖 display·
  못 찾음 3종.
- `pnpm test` 1112 그린 (신규 5) — 호버 파싱(rust-analyzer 실제 모양·언어 없는 펜스·
  닫히지 않은 펜스·구분선 버리기·빈 입력).
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0.

**여전히 앱을 띄운 육안 확인은 안 했다** (PR-LSP0 과 같은 상태). 백엔드↔서버는
실프로세스로, 변환은 단위로 증명됐지만 툴팁이 실제로 그려지고 ⌘클릭이 먹는지는
확인하지 않았다.

## 메모

`textDocument/definition` 이 여러 정의를 줄 때(트레이트 구현 등) **첫 번째로만**
이동한다. 고르게 하는 목록 UI 가 없어서인데, 아무 일도 안 하는 것보다는 낫다는
판단이다. 목록 UI 는 후속 몫으로 남긴다.

다음(Phase 2): 이름 바꾸기 — 서버가 준 `WorkspaceEdit` 을 `code_write` 의 blake3
낙관적 잠금과 **함께** 적용해야 한다. 편집을 적용하는 동안 디스크가 더 나아갔을 수
있고, 여러 파일을 건드리므로 부분 적용이 되면 코드가 깨진 채로 남는다. 이 라운드의
읽기 기능들과 달리 실패 모드가 파괴적이라 설계를 먼저 적어야 한다.
