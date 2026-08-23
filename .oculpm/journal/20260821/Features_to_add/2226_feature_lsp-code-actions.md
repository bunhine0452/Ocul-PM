---
schema_version: 1
type: feature
slug: lsp-code-actions
status: done
difficulty: medium
created_at: "2026-08-21T22:26:00+09:00"
session_id: "manual-20260821-222600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lsp/spec.rs"
    op: update
  - path: "src-tauri/src/lsp/state.rs"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/lsp_rust_analyzer.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ".oculpm/journal/20260821/Features_to_add/2216_feature_lsp-rename.md"
tags: [lsp, code-action, quickfix, refactor, code-editor]
---

[x] 코드 액션 (⌘.) — quick fix·리팩터를 목록에서 골라 적용. Phase 2 완료

## 추가 기능

`⌘.` 로 커서(또는 선택 범위)에서 쓸 수 있는 액션을 띄우고 고르면 적용된다.
선택이 있으면 그 범위로 물으므로 "이 블록을 함수로 빼기" 류 리팩터도 나온다.

예고한 대로 **가벼운 라운드**였다 — 편집 적용은 이름 바꾸기가 깐 경로를 그대로
쓰고, 새로 만든 것은 요청 조립과 목록 UI 뿐이다.

## 동작 흐름

### 진단을 context 로 실어 보내야 quick fix 가 나온다

이 라운드에서 유일하게 까다로웠던 부분이다. `textDocument/codeAction` 의
`context.diagnostics` 에는 서버가 준 **원본** 진단 객체를 그대로 돌려줘야 한다 —
서버가 자기 `data` 필드를 알아보고 "가져오기 추가" 같은 fix 를 내놓기 때문이다.
우리는 진단을 좁은 타입(`LspDiagnostic`)으로 갈아서 프런트에 보내고 있었으므로
그 값으로는 안 된다.

→ `LspState` 에 **원본 진단 JSON 을 파일별로 캐시**했다(`raw_diagnostics`).
`publishDiagnostics` 알림이 올 때 좁은 타입으로 바꾸기 **전에** 원본을 넣어 둔다.
겹침 판정은 **줄 단위**로만 한다 — 열까지 따지면 커서가 진단 범위 한 칸 밖일 때
fix 가 사라진다.

### 적용할 수 없는 항목은 목록에서 뺀다

응답에는 `Command` 와 `CodeAction` 이 섞여 온다. `command` 만 있는 항목은
`workspace/executeCommand` 로 서버에 실행을 맡기는 방식인데, 그러면 서버가
`workspace/applyEdit` 를 **요청**으로 되보내고 우리가 답해야 한다. 그 경로가
아직 없으므로 목록에서 뺐다 — 눌러도 아무 일 없는 항목을 보여주는 것보다 낫다.

`edit` 없이 `data` 만 있는 항목은 정상이라 남긴다. rust-analyzer 가 이 방식을
쓰고, 적용 시점에 `codeAction/resolve` 로 편집을 채운다.

**인덱스는 걸러낸 뒤 기준**이다. 원본 배열 자리를 쓰면 적용 때 걸러낸 항목을
집는다 — 테스트가 이걸 못 박는다.

### 원본 액션을 프런트로 왕복시키지 않는다

액션 객체에는 서버별 `data` 가 붙어 있어 타입을 좁힐 수 없다. 그래서 목록만
좁은 타입으로 보내고 **원본은 `LspState` 에 남긴 뒤 인덱스로 되짚는다**. 목록이
갱신됐거나 파일을 다시 열었으면 인덱스가 없어 "액션 목록이 오래됐습니다" 로 끝난다.

### 적용 경로는 이름 바꾸기와 같다

`apply_workspace_edit` 를 공용 함수로 뽑아 `lsp_rename` 도 그것을 쓰도록 바꿨다.
전부-아니면-전무 · 뒤에서부터 · 겹침 거부 · 프로젝트 밖 거부가 두 기능에 동일하게
걸린다. 미저장 버퍼 게이트도 프런트에서 같이 건다(같은 이유 — 서버는 버퍼를,
백엔드는 디스크를 본다).

## 검증

- **실제 rust-analyzer 왕복** (`code_action_request_round_trips_and_indices_stay_consistent`).
  어떤 액션이 나오는지는 rust-analyzer 버전마다 달라서 **특정 제목을 단언하지
  않았다** — 그러면 서버가 assist 목록을 바꾸는 순간 깨지는 테스트가 된다. 대신
  프로토콜 왕복이 오류 없이 되는지, 걸러낸 뒤 인덱스가 원본과 어긋나지 않는지,
  남은 항목이 전부 적용 가능한지(edit 또는 data 보유)를 본다.
- `cargo test` 704 + 통합 6 그린 (직전 701+5 → 신규 4). 단위 3개: 적용 가능한
  항목 유지 · command 전용 제거와 인덱스 재계산 · 빈/깨진 응답 관용.
- `pnpm test` 1116 그린 · `pnpm typecheck` · `pnpm lint` · `pnpm build` exit 0.

**앱에서 ⌘. 를 눌러 본 육안 확인은 아직이다.** 이름 바꾸기와 같은 적용 경로라
파괴 위험은 같으니, 확인은 git 이 깨끗한 상태에서 하시길.

## 메모

이로써 플래너 Phase 2(쓰기 기능)가 닫혔다. 남은 것은 Phase 3 설정 화면 하나 —
언어별 켜기/끄기, 서버 경로 오버라이드, 미설치 안내다. 특히 **미설치 안내**가
실제로 자주 필요하다: 이 저장소만 해도 rust-analyzer 는 있지만
typescript-language-server 는 없어서, TS 파일을 열면 상태줄이 "언어 서버 없음"
이라고만 하고 어떻게 설치하는지는 말해 주지 않는다.

`⌘.` 를 CM6 인라인 메뉴가 아니라 다이얼로그로 띄웠다. VS Code 만큼 매끄럽지는
않지만 접근성(포커스 트랩·Esc)이 공짜로 따라오고, CM6 툴팁 안에 목록 UI 를
직접 그리는 것보다 훨씬 싸다. 인라인이 필요해지면 그때 바꾼다.
